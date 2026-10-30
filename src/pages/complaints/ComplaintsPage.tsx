import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, AlertCircle, CheckCircle2, Clock, UserCheck, Wrench, XCircle, ArrowRight } from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { canEditModule } from '../../lib/permissions';
import { formatDate, generatePermanentId } from '../../lib/formatters';
import { dataService } from '../../services/dataService';
import type { Complaint, ComplaintCategory, ComplaintPriority, ComplaintSource, ComplaintStatus } from '../../types/complaints';
import {
  CATEGORY_LABELS, STATUS_LABELS, PRIORITY_LABELS, SOURCE_LABELS,
  computeDueDate, isComplaintOverdue,
} from '../../types/complaints';

// ---- Badge colours ----
const STATUS_BADGE: Record<ComplaintStatus, string> = {
  new: 'badge-amber',
  assigned: 'badge-blue',
  in_progress: 'badge-indigo',
  resolved: 'badge-teal',
  closed: 'badge-slate',
  reopened: 'badge-rose',
  escalated: 'badge-rose',
};
const PRIORITY_BADGE: Record<ComplaintPriority, string> = {
  low: 'badge-slate',
  normal: 'badge-blue',
  urgent: 'badge-rose',
};
const STATUS_ORDER: ComplaintStatus[] = ['new', 'assigned', 'in_progress', 'resolved', 'closed', 'reopened', 'escalated'];

// ---- Timeline helpers ----
interface TimelineStep { label: string; done: boolean; at?: string }
function buildTimeline(c: Complaint): TimelineStep[] {
  const s = STATUS_ORDER.indexOf(c.status);
  return [
    { label: 'Logged', done: true, at: c.createdAt },
    { label: 'Assigned', done: s >= 1, at: c.assignedAt },
    { label: 'In Progress', done: s >= 2 },
    { label: 'Re-service visit', done: !!c.reServiceJobId },
    { label: 'Resolved', done: s >= 3 || c.status === 'closed', at: c.resolvedAt },
    { label: 'Closed', done: c.status === 'closed' },
  ];
}

// ---- Blank form ----
function blank(prefill?: Partial<Complaint>): Omit<Complaint, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByName' | 'notes' | 'reopenedCount'> {
  return {
    customerType: 'company',
    customerId: prefill?.customerId ?? '',
    customerName: prefill?.customerName ?? '',
    branchId: prefill?.branchId,
    branchName: prefill?.branchName,
    contractId: prefill?.contractId,
    jobId: prefill?.jobId,
    category: 'pest_present',
    priority: 'normal',
    subject: '',
    description: '',
    source: 'phone',
    status: 'new',
  };
}

export const ComplaintsPage: React.FC = () => {
  useDataStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { userProfile, effectiveRole } = useAuth();
  const { success, error, info } = useNotification();

  const canEdit = canEditModule(effectiveRole, 'complaints');
  const isOps = ['operations', 'team_leader', 'admin', 'super_admin'].includes(effectiveRole ?? '');
  const isSalesOrAdmin = ['sales', 'admin', 'team_leader', 'super_admin'].includes(effectiveRole ?? '');
  const canAssign = isSalesOrAdmin || effectiveRole === 'super_admin';

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<ComplaintPriority | 'all'>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);

  // Modal state
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [noteText, setNoteText] = useState('');

  // Form state
  const [form, setForm] = useState(() => blank());
  const [assignOpsId, setAssignOpsId] = useState('');
  const [assignOpsName, setAssignOpsName] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [clientSatisfied, setClientSatisfied] = useState<boolean | null>(null);
  const [reServiceDate, setReServiceDate] = useState(new Date().toISOString().slice(0, 10));

  // Handle ?action=log pre-fill from other pages
  useEffect(() => {
    if (searchParams.get('action') === 'log') {
      setForm(blank({
        customerId: searchParams.get('customerId') ?? '',
        customerName: searchParams.get('customerName') ?? '',
        contractId: searchParams.get('contractId') ?? undefined,
        jobId: searchParams.get('jobId') ?? undefined,
      }));
      setShowNew(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const allComplaints = dataService.getComplaints();
  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const staff = dataService.getStaff();
  const opsStaff = staff.filter((u) => ['operations', 'team_leader', 'admin', 'super_admin'].includes(u.role));

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const openCount = allComplaints.filter((c) => !['closed'].includes(c.status)).length;
  const overdueCount = allComplaints.filter(isComplaintOverdue).length;
  const resolvedThisMonth = allComplaints.filter((c) => c.status === 'closed' && c.updatedAt.startsWith(thisMonth)).length;

  const filtered = allComplaints.filter((c) => {
    const q = query.toLowerCase();
    const hit = !q || c.customerName.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    const stOk = statusFilter === 'all' || c.status === statusFilter;
    const prOk = priorityFilter === 'all' || c.priority === priorityFilter;
    const ovOk = !overdueOnly || isComplaintOverdue(c);
    return hit && stOk && prOk && ovOk;
  });

  // ---- Actions ----
  const now = () => new Date().toISOString();

  function handleCreate() {
    if (!form.customerId || !form.subject.trim() || !form.description.trim()) {
      error('Missing fields', 'Customer, subject and description are required.');
      return;
    }
    const id = generatePermanentId('CMP', allComplaints.length + 1);
    // Change 18: Auto-assign new complaints to the Operations Manager role
    const defaultOps = opsStaff.find((u) => u.role === 'operations') || opsStaff.find((u) => u.role === 'team_leader') || opsStaff[0];
    const initialStatus: ComplaintStatus = defaultOps ? 'assigned' : 'new';

    const complaint: Complaint = {
      ...form,
      id,
      status: initialStatus,
      assignedOperationsManagerId: defaultOps?.uid,
      assignedOperationsManagerName: defaultOps?.displayName || defaultOps?.email,
      assignedAt: defaultOps ? now() : undefined,
      reopenedCount: 0,
      notes: [],
      dueDate: computeDueDate(form.priority),
      createdBy: userProfile?.uid ?? '',
      createdByName: userProfile?.displayName ?? 'Staff',
      createdAt: now(),
      updatedAt: now(),
    };
    dataService.saveComplaint(complaint, userProfile?.email);
    // Change 19: Notify the CEO on every new complaint
    info('CEO & Operations Notified', `New complaint ${id} logged. Auto-assigned to Operations Manager. CEO notified.`);
    success('Complaint logged', `${id} — ${complaint.customerName}`);
    setShowNew(false);
    setForm(blank());
  }

  function handleAssign() {
    if (!selected || !assignOpsId) return;
    const updated: Complaint = {
      ...selected,
      status: 'assigned',
      assignedOperationsManagerId: assignOpsId,
      assignedOperationsManagerName: assignOpsName,
      assignedAt: now(),
      updatedAt: now(),
    };
    dataService.saveComplaint(updated, userProfile?.email);
    setSelected(updated);
    setShowAssign(false);
    success('Assigned', `${selected.id} → ${assignOpsName}`);
  }

  function handleMarkInProgress(c: Complaint) {
    const updated: Complaint = { ...c, status: 'in_progress', updatedAt: now() };
    dataService.saveComplaint(updated, userProfile?.email);
    setSelected(updated);
    success('Status updated', `${c.id} → In Progress`);
  }

  function handleCreateReService(c: Complaint) {
    if (!reServiceDate) { error('Date required', 'Pick a re-service visit date.'); return; }
    const jobs = dataService.getJobs();
    const jobId = generatePermanentId('JOB', jobs.length + 1);
    const job = {
      id: jobId,
      contractId: c.contractId,
      customerType: c.customerType,
      customerId: c.customerId,
      customerName: c.customerName,
      branchId: c.branchId,
      branchName: c.branchName,
      siteId: c.contractId ?? c.customerId,
      siteName: c.customerName,
      siteAddress: '',
      serviceType: 'Re-service visit (complaint)',
      targetPests: [] as never[],
      scheduledDate: reServiceDate,
      timeSlot: 'morning' as const,
      assignedTechnicianIds: [] as string[],
      assignedTechnicianNames: [] as string[],
      leadPcoId: userProfile?.uid ?? '',
      leadPcoName: userProfile?.displayName ?? 'Ops',
      status: 'scheduled' as const,
      complaintId: c.id,
      checklists: [] as never[],
      chemicalsUsed: [] as never[],
      photoEvidence: [] as never[],
      createdAt: now(),
      updatedAt: now(),
    };
    dataService.saveJob(job as Parameters<typeof dataService.saveJob>[0], userProfile?.email);
    const updated: Complaint = { ...c, reServiceJobId: jobId, updatedAt: now() };
    dataService.saveComplaint(updated, userProfile?.email);
    setSelected(updated);
    success('Re-service job created', `${jobId} scheduled for ${reServiceDate}`);
  }

  function handleResolve(c: Complaint) {
    if (!resolutionNote.trim()) { error('Required', 'Resolution note is required.'); return; }
    const updated: Complaint = {
      ...c,
      status: 'resolved',
      resolutionNote,
      rootCause: rootCause || undefined,
      resolvedAt: now(),
      resolvedBy: userProfile?.uid ?? '',
      resolvedByName: userProfile?.displayName ?? 'Staff',
      updatedAt: now(),
    };
    dataService.saveComplaint(updated, userProfile?.email);
    setSelected(updated);
    setShowResolve(false);
    setResolutionNote('');
    setRootCause('');
    success('Resolved', `${c.id} resolved — awaiting CRO confirmation`);
  }

  function handleClose(c: Complaint) {
    if (clientSatisfied === null) { error('Required', 'Please indicate client satisfaction.'); return; }
    // Change 21: Closing note required to close
    if (!closingNote.trim()) { error('Closing note required', 'A closing note is required before closing or reopening the complaint.'); return; }

    const noteObj = {
      id: `n_${Date.now()}`,
      at: now(),
      byUid: userProfile?.uid ?? '',
      byName: userProfile?.displayName ?? 'Staff',
      note: `Closing note: ${closingNote.trim()}`,
    };

    if (!clientSatisfied) {
      // Reopen
      const updated: Complaint = {
        ...c,
        status: 'reopened',
        clientSatisfied: false,
        reopenedCount: (c.reopenedCount || 0) + 1,
        notes: [...(c.notes || []), noteObj],
        updatedAt: now(),
      };
      dataService.saveComplaint(updated, userProfile?.email);
      setSelected(updated);
      setShowClose(false);
      setClientSatisfied(null);
      setClosingNote('');
      success('Complaint reopened', `${c.id} — client not satisfied`);
    } else {
      const updated: Complaint = {
        ...c,
        status: 'closed',
        clientSatisfied: true,
        notes: [...(c.notes || []), noteObj],
        updatedAt: now(),
      };
      dataService.saveComplaint(updated, userProfile?.email);
      setSelected(updated);
      setShowClose(false);
      setClientSatisfied(null);
      setClosingNote('');
      success('Closed', `${c.id} — client satisfied`);
    }
  }

  function addNote(c: Complaint) {
    if (!noteText.trim()) return;
    const note = { id: `n_${Date.now()}`, at: now(), byUid: userProfile?.uid ?? '', byName: userProfile?.displayName ?? 'Staff', note: noteText.trim() };
    const updated: Complaint = { ...c, notes: [...c.notes, note], updatedAt: now() };
    dataService.saveComplaint(updated, userProfile?.email);
    setSelected(updated);
    setNoteText('');
  }

  // ---- Next step button ----
  function nextStepBtn(c: Complaint): { label: string; action: () => void } | null {
    if (!canEdit) return null;
    if (c.status === 'new' && canAssign) return { label: 'Assign to Ops Manager', action: () => { setAssignOpsId(c.assignedOperationsManagerId ?? ''); setAssignOpsName(c.assignedOperationsManagerName ?? ''); setShowAssign(true); } };
    if (c.status === 'reopened' && canAssign) return { label: 'Reassign', action: () => { setAssignOpsId(c.assignedOperationsManagerId ?? ''); setAssignOpsName(c.assignedOperationsManagerName ?? ''); setShowAssign(true); } };
    if (c.status === 'assigned' && isOps) return { label: 'Mark In Progress', action: () => handleMarkInProgress(c) };
    if (c.status === 'in_progress' && isOps) return { label: 'Mark Resolved', action: () => setShowResolve(true) };
    if (c.status === 'resolved' && isSalesOrAdmin) return { label: 'Confirm with Client', action: () => setShowClose(true) };
    return null;
  }

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Complaints' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Complaints</h1>
          <p className="page-subtitle">CRO logs · Ops Manager resolves with re-service visit · CRO closes after client confirmation</p>
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => { setForm(blank()); setShowNew(true); }}>
            <Plus size={16} /> Log complaint
          </button>
        )}
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Open / Active', count: openCount, color: openCount > 0 ? 'var(--ikpm-rose-500)' : 'var(--text-muted)', icon: AlertCircle },
          { label: 'Overdue', count: overdueCount, color: overdueCount > 0 ? '#DC2626' : 'var(--text-muted)', icon: Clock },
          { label: 'Closed this month', count: resolvedThisMonth, color: 'var(--ikpm-emerald-600)', icon: CheckCircle2 },
        ].map(({ label, count, color, icon: Icon }) => (
          <div key={label} className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <Icon size={22} color={color} />
            <div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '0.75rem 1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chip-row" style={{ marginBottom: 0 }}>
            {(['all', ...STATUS_ORDER] as const).map((s) => (
              <button key={s} type="button" className={`chip ${statusFilter === s ? 'chip-on' : ''}`} onClick={() => setStatusFilter(s)}>
                {s === 'all' ? 'All status' : STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="chip-row" style={{ marginBottom: 0 }}>
            {(['all', 'urgent', 'normal', 'low'] as const).map((p) => (
              <button key={p} type="button" className={`chip ${priorityFilter === p ? 'chip-on' : ''}`} onClick={() => setPriorityFilter(p)}>
                {p === 'all' ? 'Any priority' : PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
          <button type="button" className={`chip ${overdueOnly ? 'chip-on' : ''}`} onClick={() => setOverdueOnly((v) => !v)}>
            Overdue only
          </button>
          <div className="drive-search" style={{ width: 240, marginLeft: 'auto' }}>
            <Search size={15} color="var(--text-muted)" />
            <input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No complaints" description="Logged complaints appear here." />
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID / Date</th>
                <th>Customer</th>
                <th>Category</th>
                <th>Subject</th>
                <th>Priority</th>
                <th>Due</th>
                <th>Assigned to</th>
                <th>Status</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const overdue = isComplaintOverdue(c);
                return (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(c)}>
                    <td><div className="cell-title" style={{ fontFamily: 'monospace' }}>{c.id}</div><div className="cell-sub">{formatDate(c.createdAt)}</div></td>
                    <td><div className="cell-title">{c.customerName}</div><div className="cell-sub">{c.branchName ?? ''}</div></td>
                    <td><span className="badge-status badge-slate">{CATEGORY_LABELS[c.category]}</span></td>
                    <td style={{ maxWidth: 220 }}>{c.subject}</td>
                    <td><span className={`badge-status ${PRIORITY_BADGE[c.priority]}`}>{PRIORITY_LABELS[c.priority]}</span></td>
                    <td>{c.dueDate ? <span style={{ color: overdue ? '#DC2626' : undefined, fontWeight: overdue ? 600 : undefined }}>{formatDate(c.dueDate)}{overdue ? ' ⚠' : ''}</span> : '—'}</td>
                    <td><div className="cell-sub">{c.assignedOperationsManagerName ?? '—'}</div></td>
                    <td><span className={`badge-status ${STATUS_BADGE[c.status]}`}>{STATUS_LABELS[c.status]}</span></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canEdit && c.status !== 'closed' && (
                        <button className="btn btn-sm btn-secondary" onClick={() => setSelected(c)}>Manage</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== LOG NEW COMPLAINT ===== */}
      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title="Log complaint" maxWidth="540px"
        footer={<><button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancel</button><button className="btn btn-primary" onClick={handleCreate}>Log complaint</button></>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Customer type</label>
              <select className="form-select" value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value as 'company' | 'individual', customerId: '', customerName: '' })}>
                <option value="company">Company</option>
                <option value="individual">Individual</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Customer <span className="required">*</span></label>
              <select className="form-select" value={form.customerId}
                onChange={(e) => {
                  const co = companies.find((c) => c.id === e.target.value);
                  const cl = clients.find((c) => c.id === e.target.value);
                  setForm({ ...form, customerId: e.target.value, customerName: co?.legalCompanyName ?? cl?.fullName ?? '' });
                }}>
                <option value="">— Select —</option>
                {form.customerType === 'company'
                  ? companies.map((c) => <option key={c.id} value={c.id}>{c.legalCompanyName}</option>)
                  : clients.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ComplaintCategory })}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as ComplaintPriority })}>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Source</label>
              <select className="form-select" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ComplaintSource })}>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Related completed job</label>
              {(() => {
                const customerJobs = dataService.getJobs().filter((j) => j.customerId === form.customerId && j.status === 'completed');
                return customerJobs.length > 0 ? (
                  <select
                    className="form-select"
                    value={form.jobId ?? ''}
                    onChange={(e) => {
                      const job = customerJobs.find((j) => j.id === e.target.value);
                      setForm({ ...form, jobId: job?.id || undefined, contractId: job?.contractId || form.contractId });
                    }}
                  >
                    <option value="">— Select job —</option>
                    {customerJobs.map((j) => (
                      <option key={j.id} value={j.id}>{j.id} · {formatDate(j.scheduledDate)} · {j.serviceType}</option>
                    ))}
                  </select>
                ) : (
                  <input className="form-input" value={form.jobId ?? ''} onChange={(e) => setForm({ ...form, jobId: e.target.value || undefined })} placeholder="No completed jobs found" disabled={!form.customerId} />
                );
              })()}
              {form.contractId && <div className="form-hint">Contract: {form.contractId}</div>}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Subject <span className="required">*</span></label>
            <input className="form-input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Brief description of the complaint" />
          </div>
          <div className="form-group">
            <label className="form-label">Details <span className="required">*</span></label>
            <textarea className="form-input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What happened, when, and what the client expects" />
          </div>
          <div className="form-group">
            <label className="form-label">Due date <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(auto-set from priority: urgent=1d, normal=3d, low=7d)</span></label>
            <input type="date" className="form-input" value={computeDueDate(form.priority)} disabled />
          </div>
        </div>
      </Modal>

      {/* ===== DETAIL / MANAGE MODAL ===== */}
      {selected && (() => {
        const btn = nextStepBtn(selected);
        const tl = buildTimeline(selected);
        const overdue = isComplaintOverdue(selected);
        return (
          <Modal isOpen onClose={() => setSelected(null)} title={`Complaint ${selected.id}`}
            subtitle={`${selected.customerName} · ${CATEGORY_LABELS[selected.category]}`}
            maxWidth="600px"
            footer={
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', width: '100%' }}>
                {btn && <button className="btn btn-primary" onClick={btn.action}><ArrowRight size={14} /> {btn.label}</button>}
                {selected.status === 'in_progress' && isOps && (
                  <button className="btn btn-secondary" onClick={() => handleCreateReService(selected)}>
                    <Wrench size={14} /> Create re-service job ({reServiceDate})
                  </button>
                )}
                <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setSelected(null)}>Close</button>
              </div>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.875rem' }}>
              {/* Badges */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className={`badge-status ${STATUS_BADGE[selected.status]}`}>{STATUS_LABELS[selected.status]}</span>
                <span className={`badge-status ${PRIORITY_BADGE[selected.priority]}`}>{PRIORITY_LABELS[selected.priority]}</span>
                {overdue && <span className="badge-status badge-rose">Overdue</span>}
                <span className="badge-status badge-slate">{SOURCE_LABELS[selected.source]}</span>
                {selected.dueDate && <span className="badge-status badge-slate">Due {formatDate(selected.dueDate)}</span>}
              </div>
              {/* Timeline */}
              <div style={{ display: 'flex', gap: '0', flexWrap: 'wrap' }}>
                {tl.map((step, i) => (
                  <div key={step.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto', minWidth: 76 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: step.done ? 'var(--ikpm-emerald-500)' : 'var(--border-subtle)', border: '2px solid var(--border-subtle)' }} />
                    {i < tl.length - 1 && <div style={{ width: 60, height: 2, background: step.done ? 'var(--ikpm-emerald-500)' : 'var(--border-subtle)', margin: '4px 0 4px 10px', flexShrink: 0 }} />}
                    <div style={{ fontSize: '0.65rem', color: step.done ? 'var(--text-primary)' : 'var(--text-muted)', textAlign: 'center', marginTop: 4, whiteSpace: 'nowrap' }}>{step.label}</div>
                    {step.at && <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center' }}>{formatDate(step.at)}</div>}
                  </div>
                ))}
              </div>
              {/* Description */}
              <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Description</div><p style={{ margin: 0 }}>{selected.description}</p></div>
              {/* Assignment */}
              {selected.assignedOperationsManagerName && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <UserCheck size={14} color="var(--text-muted)" />
                  <span style={{ color: 'var(--text-muted)' }}>Assigned to</span>
                  <strong>{selected.assignedOperationsManagerName}</strong>
                  {selected.assignedAt && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>on {formatDate(selected.assignedAt)}</span>}
                </div>
              )}
              {/* Re-service job link */}
              {selected.reServiceJobId && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Wrench size={14} color="var(--text-muted)" />
                  <span style={{ color: 'var(--text-muted)' }}>Re-service job:</span>
                  <button className="btn-link" onClick={() => navigate(`/operations/jobs`)}>{selected.reServiceJobId}</button>
                  {selected.status === 'in_progress' && isOps && (
                    <div style={{ marginLeft: 8 }}>
                      <input type="date" className="form-input" style={{ width: 140 }} value={reServiceDate} onChange={(e) => setReServiceDate(e.target.value)} />
                    </div>
                  )}
                </div>
              )}
              {/* Resolution */}
              {selected.resolutionNote && (
                <div style={{ background: 'var(--bg-surface-alt)', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Resolution</div>
                  <div>{selected.resolutionNote}</div>
                  {selected.rootCause && <div style={{ color: 'var(--text-muted)', marginTop: 4 }}><strong>Root cause:</strong> {selected.rootCause}</div>}
                </div>
              )}
              {/* Re-service date picker (inline for in_progress ops) */}
              {selected.status === 'in_progress' && isOps && !selected.reServiceJobId && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <label style={{ whiteSpace: 'nowrap', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Re-service date:</label>
                  <input type="date" className="form-input" style={{ width: 160 }} value={reServiceDate} onChange={(e) => setReServiceDate(e.target.value)} />
                </div>
              )}
              {/* Notes */}
              <div>
                <div className="section-title">Notes ({selected.notes.length})</div>
                {selected.notes.map((n) => (
                  <div key={n.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.78rem' }}>{n.byName} · {formatDate(n.at)}</div>
                    <div>{n.note}</div>
                  </div>
                ))}
                {canEdit && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <input className="form-input" style={{ flex: 1 }} placeholder="Add a note…" value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addNote(selected); }} />
                    <button className="btn btn-secondary btn-sm" onClick={() => addNote(selected)}>Add</button>
                  </div>
                )}
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* ===== ASSIGN OPS MANAGER ===== */}
      {selected && (
        <Modal isOpen={showAssign} onClose={() => setShowAssign(false)} title="Assign Operations Manager" maxWidth="400px"
          footer={<><button className="btn btn-secondary" onClick={() => setShowAssign(false)}>Cancel</button><button className="btn btn-primary" onClick={handleAssign} disabled={!assignOpsId}>Assign</button></>}
        >
          <div className="form-group">
            <label className="form-label">Operations Manager</label>
            <select className="form-select" value={assignOpsId} onChange={(e) => {
              const u = opsStaff.find((s) => s.uid === e.target.value);
              setAssignOpsId(e.target.value);
              setAssignOpsName(u?.displayName ?? '');
            }}>
              <option value="">— Select —</option>
              {opsStaff.map((u) => <option key={u.uid} value={u.uid}>{u.displayName} ({u.role})</option>)}
            </select>
          </div>
        </Modal>
      )}

      {/* ===== MARK RESOLVED ===== */}
      {selected && (
        <Modal isOpen={showResolve} onClose={() => setShowResolve(false)} title="Mark Resolved" maxWidth="460px"
          footer={<><button className="btn btn-secondary" onClick={() => setShowResolve(false)}>Cancel</button><button className="btn btn-primary" onClick={() => handleResolve(selected!)}>Mark resolved</button></>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Resolution note <span className="required">*</span></label>
              <textarea className="form-input" rows={3} value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} placeholder="What was done to resolve the complaint?" />
            </div>
            <div className="form-group">
              <label className="form-label">Root cause (optional)</label>
              <input className="form-input" value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="Why did this happen?" />
            </div>
          </div>
        </Modal>
      )}

      {/* ===== CONFIRM WITH CLIENT / CLOSE ===== */}
      {selected && (
        <Modal isOpen={showClose} onClose={() => setShowClose(false)} title="Confirm with Client" maxWidth="460px"
          footer={<><button className="btn btn-secondary" onClick={() => setShowClose(false)}>Cancel</button><button className="btn btn-primary" onClick={() => handleClose(selected!)} disabled={clientSatisfied === null || !closingNote.trim()}>Confirm</button></>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ margin: 0 }}>Did the client confirm they are satisfied with the resolution?</p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className={`btn ${clientSatisfied === true ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setClientSatisfied(true)}>
                <CheckCircle2 size={14} /> Yes — close complaint
              </button>
              <button className={`btn ${clientSatisfied === false ? 'btn-danger' : 'btn-secondary'}`} onClick={() => setClientSatisfied(false)}>
                <XCircle size={14} /> No — reopen
              </button>
            </div>
            {clientSatisfied === false && (
              <p style={{ margin: 0, color: 'var(--ikpm-rose-600)', fontSize: '0.875rem' }}>
                The complaint will be reopened and returned to the assignment stage.
              </p>
            )}
            {clientSatisfied !== null && (
              <div className="form-group" style={{ marginTop: '0.5rem' }}>
                <label className="form-label">Closing note <span className="required">*</span></label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={closingNote}
                  onChange={(e) => setClosingNote(e.target.value)}
                  placeholder="Mandatory summary of client communication and closing outcome..."
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ComplaintsPage;
