import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Upload,
  Download,
  Phone,
  MessageCircle,
  Mail,
  Pencil,
  CalendarClock,
  ClipboardCheck,
  FileSpreadsheet,
  XCircle,
  SkipForward,
  ExternalLink,
  Send,
  RotateCcw,
  Star,
  Building2,
  User,
  Clock,
  Users2,
  ArrowRight,
  MapPin,
  PauseCircle,
} from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { EmptyState } from '../../components/common/EmptyState';
import { RowMenu, type RowMenuItem } from '../../components/common/RowMenu';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { SendDocumentsModal } from '../../features/outreach/SendDocumentsModal';
import { LeadFormModal } from '../../features/leads/LeadFormModal';
import { ImportLeadsModal } from '../../features/leads/ImportLeadsModal';
import { InspectionFindingsModal, LogContactModal, PEST_OPTIONS, ScheduleInspectionModal } from '../../features/leads/LeadActionModals';
import { canEditModule } from '../../lib/permissions';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { usePdfAction } from '../../hooks/usePdfAction';
import { formatDate, formatDateTime } from '../../lib/formatters';
import { toWhatsAppNumber } from '../../services/outreachService';
import {
  availableActions,
  CHANNELS,
  contactsOf,
  exportLeadsToExcel,
  isFollowUpDue,
  nextStep,
  outcomeLabel,
  outcomeTone,
  PIPELINE,
  primaryContact,
  sourceLabel,
  SOURCES,
  stageMeta,
  stageOf,
  READ_ONLY_ACTIONS,
  daysSince,
  stuckAtLabel,
  STUCK_AT_REASONS,
  type LeadActionId,
  type PipelineStage,
} from '../../lib/leadWorkflow';
import type { Lead, LeadActivity, StuckAtReason } from '../../types/crm';

type Tab = 'all' | PipelineStage;

const StagePill: React.FC<{ lead: Lead }> = ({ lead }) => {
  const m = stageMeta(lead.stage);
  return (
    <span className="badge-status" style={{ background: `${m.color}1A`, color: m.color }}>
      {m.short}
    </span>
  );
};

const ACTION_ICONS: Record<LeadActionId, React.ComponentType<{ size?: number }>> = {
  edit: Pencil,
  log_contact: Phone,
  schedule_inspection: CalendarClock,
  reschedule_inspection: CalendarClock,
  record_findings: ClipboardCheck,
  create_proposal: FileSpreadsheet,
  open_proposal: FileSpreadsheet,
  skip_inspection: SkipForward,
  send_documents: Send,
  set_stuck_at: PauseCircle,
  create_revision: RotateCcw,
  mark_won: Star,
  mark_lost: XCircle,
  open_customer: ExternalLink,
  reopen: RotateCcw,
};

const ownerOf = (l: Lead) => (l as Lead & { ownerName?: string }).ownerName || l.assignedToName || l.createdBy || '—';

export const LeadsListPage: React.FC = () => {
  const store = useDataStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { userProfile, effectiveRole } = useAuth();
  const { success, warning, error } = useNotification();
  const canEdit = canEditModule(effectiveRole, 'crm');

  const [tab, setTab] = useState<Tab>((searchParams.get('stage') as Tab) || 'all');
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyDue, setOnlyDue] = useState(false);

  const [formLead, setFormLead] = useState<Lead | null | undefined>(searchParams.get('action') === 'new_lead' ? null : undefined);
  const [showImport, setShowImport] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(searchParams.get('lead'));
  const [contactLead, setContactLead] = useState<Lead | null>(null);
  const [scheduleLead, setScheduleLead] = useState<Lead | null>(null);
  const [findingsLead, setFindingsLead] = useState<Lead | null>(null);
  const [lostLead, setLostLead] = useState<Lead | null>(null);
  const [skipLead, setSkipLead] = useState<Lead | null>(null);
  const [sendLead, setSendLead] = useState<Lead | null>(null);
  const [stuckLead, setStuckLead] = useState<Lead | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const leads = store.getLeads();
  const detail = detailId ? store.getLeadById(detailId) ?? null : null;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length };
    PIPELINE.forEach((p) => (c[p.stage] = 0));
    leads.forEach((l) => (c[stageOf(l)] = (c[stageOf(l)] || 0) + 1));
    return c;
  }, [leads]);
  const dueCount = leads.filter(isFollowUpDue).length;

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    return leads
      .filter((l) => tab === 'all' || stageOf(l) === tab)
      .filter((l) => sourceFilter === 'all' || l.source === sourceFilter)
      .filter((l) => !onlyMine || (l as Lead & { ownerUid?: string }).ownerUid === userProfile?.uid || l.assignedToUserId === userProfile?.uid)
      .filter((l) => !onlyDue || isFollowUpDue(l))
      .filter((l) => {
        if (!q) return true;
        const hay = [l.id, l.title, l.companyName, l.city, l.area, l.industry, ...contactsOf(l).flatMap((c) => [c.name, c.phone, c.email, c.designation])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        // Follow-ups due first, then most recently updated
        const d = Number(isFollowUpDue(b)) - Number(isFollowUpDue(a));
        return d || (b.updatedAt || '').localeCompare(a.updatedAt || '');
      });
  }, [leads, tab, sourceFilter, onlyMine, onlyDue, query, userProfile?.uid]);

  const switchTab = (t: Tab) => {
    setTab(t);
    const next = new URLSearchParams(searchParams);
    if (t === 'all') next.delete('stage');
    else next.set('stage', t);
    next.delete('action');
    setSearchParams(next, { replace: true });
  };

  const openDetail = (id: string | null) => {
    setDetailId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('lead', id);
    else next.delete('lead');
    setSearchParams(next, { replace: true });
  };

  const createProposal = (lead: Lead) => {
    try {
      const { customerId, customerType } = store.ensureLeadCustomer(lead.id, userProfile?.email);
      const params = new URLSearchParams({
        action: 'new_proposal',
        fromLead: lead.id,
        customerId,
        customerType,
        city: lead.city || '',
        address: lead.propertyAddress || lead.area || lead.city || '',
      });
      const pests = lead.inspection?.pestTypesFound?.length ? lead.inspection.pestTypesFound : lead.pestIssues;
      if (pests?.length) params.set('pests', pests.join(','));
      navigate(`/proposals?${params.toString()}`);
    } catch (err) {
      error('Could not start proposal', err instanceof Error ? err.message : String(err));
    }
  };

  /** Runs one of the actions allowed by the lead's stage (see STAGE_ACTIONS). */
  const runAction = (lead: Lead, id: LeadActionId) => {
    const action = availableActions(lead).find((a) => a.id === id);
    if (!action) return;
    if (!action.enabled) return warning('Not available', action.disabledReason || 'This step is not allowed at the current stage.');
    if (!canEdit && !READ_ONLY_ACTIONS.includes(id)) return openDetail(lead.id);
    switch (id) {
      case 'edit': return setFormLead(lead);
      case 'log_contact': return setContactLead(lead);
      case 'schedule_inspection':
      case 'reschedule_inspection': return setScheduleLead(lead);
      case 'record_findings': return setFindingsLead(lead);
      case 'create_proposal': return createProposal(lead);
      case 'skip_inspection': return lead.inspectionSkipped ? createProposal(lead) : setSkipLead(lead);
      case 'send_documents': return setSendLead(lead);
      case 'set_stuck_at': return setStuckLead(lead);
      case 'create_revision':
        return navigate(lead.proposalId ? `/proposals?view=${lead.proposalId}&action=revision` : '/proposals');
      case 'mark_lost': return setLostLead(lead);
      case 'mark_won': return; // Won happens when the proposal is accepted
      case 'open_proposal': return navigate(lead.proposalId ? `/proposals?view=${lead.proposalId}` : '/proposals');
      case 'open_customer':
        return lead.existingCustomerId
          ? navigate(`/customers/${lead.customerType === 'individual' ? 'individual' : 'company'}/${lead.existingCustomerId}`)
          : openDetail(lead.id);
      case 'reopen':
        try {
          store.setLeadStage(lead.id, 'contacted', 'Reopened', userProfile?.email);
          return success('Lead reopened', `${lead.title} is back in Contacted.`);
        } catch (err) {
          return error('Could not reopen', err instanceof Error ? err.message : String(err));
        }
    }
  };

  const runNext = (lead: Lead) => runAction(lead, nextStep(lead).action);

  /** "⋮" menu items: every allowed action except the one already on the primary button. */
  const menuItems = (lead: Lead, exclude?: LeadActionId): RowMenuItem[] =>
    availableActions(lead)
      .filter((a) => a.id !== exclude && (canEdit || READ_ONLY_ACTIONS.includes(a.id)))
      .map((a) => ({
        icon: ACTION_ICONS[a.id],
        label: a.label,
        run: () => runAction(lead, a.id),
        disabled: !a.enabled,
        disabledReason: a.disabledReason,
        danger: a.id === 'mark_lost',
      }));

  const doExport = async () => {
    if (!visible.length) return warning('Nothing to export', 'No leads match the current tab and filters.');
    try {
      const tabName = tab === 'all' ? 'all' : stageMeta(tab).short.toLowerCase();
      await exportLeadsToExcel(visible, `IKPM-leads-${tabName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      success('Exported', `${visible.length} lead(s) downloaded as Excel.`);
    } catch (err) {
      error('Export failed', err instanceof Error ? err.message : String(err));
    }
  };

  const activeTabMeta = tab === 'all' ? null : stageMeta(tab);

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Leads pipeline' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Leads pipeline</h1>
          <p className="page-subtitle">
            Add the company and who to contact → log calls until they're engaged → schedule an inspection → record findings → send a proposal → won or lost.
          </p>
        </div>
        <div>
          {canEdit && (
            <button className="btn btn-secondary" onClick={() => setShowImport(true)}>
              <Upload size={15} /> Import
            </button>
          )}
          <button className="btn btn-secondary" onClick={doExport}>
            <Download size={15} /> Export
          </button>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setFormLead(null)}>
              <Plus size={16} /> New lead
            </button>
          )}
        </div>
      </div>

      {/* Stage tabs */}
      <div className="tab-bar" role="tablist">
        <button className={`tab-btn ${tab === 'all' ? 'active' : ''}`} onClick={() => switchTab('all')} role="tab">
          All <span className="tab-count">{counts.all}</span>
        </button>
        {PIPELINE.map((p) => (
          <button key={p.stage} className={`tab-btn ${tab === p.stage ? 'active' : ''}`} onClick={() => switchTab(p.stage)} role="tab" title={p.hint}>
            <span className="stage-dot" style={{ background: p.color }} /> {p.label} <span className="tab-count">{counts[p.stage] || 0}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div className="drive-search" style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <Search size={16} color="var(--text-muted)" />
          <input placeholder="Search company, contact, phone, city…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="form-select" style={{ width: 'auto', minHeight: 36 }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">All sources</option>
          {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button type="button" className={`chip ${onlyMine ? 'chip-on' : ''}`} onClick={() => setOnlyMine((v) => !v)}>
          <User size={14} /> My leads
        </button>
        <button type="button" className={`chip ${onlyDue ? 'chip-on' : ''}`} onClick={() => setOnlyDue((v) => !v)}>
          <Clock size={14} /> Follow-up due {dueCount > 0 && <span className="tab-count" style={{ background: '#FEE2E2', color: '#991B1B' }}>{dueCount}</span>}
        </button>
        {activeTabMeta && <span className="cell-sub" style={{ marginLeft: 'auto' }}>{activeTabMeta.hint}</span>}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Users2}
          title={leads.length === 0 ? 'No leads yet' : 'No leads here'}
          description={leads.length === 0 ? 'Add a lead with the company details and one contact, or import a list from Excel.' : 'Try another tab or clear the filters.'}
          action={canEdit && leads.length === 0 ? { label: 'New lead', onClick: () => setFormLead(null) } : undefined}
        />
      ) : (
        <div className="table-container">
          <table className="data-table is-wide">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Company / client</th>
                <th style={{ minWidth: 180 }}>Contact</th>
                <th>Stage</th>
                <th>Progress</th>
                <th>Follow-up</th>
                <th>Owner</th>
                <th style={{ width: 210, textAlign: 'right' }}>Next step</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => {
                const p = primaryContact(l);
                const extra = contactsOf(l).length - 1;
                const step = nextStep(l);
                const due = isFollowUpDue(l);
                const st = stageOf(l);
                return (
                  <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(l.id)}>
                    <td>
                      <div className="cell-main">
                        <span className="lead-avatar">{l.customerType === 'individual' ? <User size={16} /> : <Building2 size={16} />}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="cell-title">{l.title}</div>
                          <div className="cell-sub">{[l.industry, l.area, l.city].filter(Boolean).join(' · ') || l.id}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {p ? (
                        <>
                          <div>{p.name}{p.designation ? <span className="cell-sub"> · {p.designation}</span> : null}</div>
                          <div className="cell-sub nowrap">{p.phone}{extra > 0 ? ` · +${extra} more` : ''}</div>
                        </>
                      ) : <span className="cell-sub">No contact</span>}
                    </td>
                    <td>
                      <StagePill lead={l} />
                      {l.stuckAt && (
                        <div style={{ marginTop: 4 }}>
                          <span
                            className="badge-status badge-amber"
                            style={{ fontSize: '0.72rem' }}
                            title={`Stuck: ${stuckAtLabel(l.stuckAt)} (${daysSince(l.stuckAtDate)} days)`}
                          >
                            {stuckAtLabel(l.stuckAt)} · {daysSince(l.stuckAtDate)}d
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="cell-sub">
                      {st === 'inspection_scheduled' && l.inspection
                        ? <>{formatDate(l.inspection.scheduledDate)} · {l.inspection.teamName || l.inspection.inspectorName}</>
                        : st === 'inspection_completed' && l.inspection
                          ? <>{l.inspection.infestationSeverity} · {l.inspection.pestTypesFound.map((x) => PEST_OPTIONS.find((o) => o.value === x)?.label || x).join(', ')}</>
                          : st === 'proposal_sent'
                            ? <>Proposal {l.proposalId || ''}</>
                            : st === 'lost'
                              ? <>{l.lostReason || 'Closed'}</>
                              : l.contactOutcome
                                ? <span className={`badge-status badge-${outcomeTone(l.contactOutcome)}`}>{outcomeLabel(l.contactOutcome)}</span>
                                : <>{sourceLabel(l.source)}</>}
                    </td>
                    <td>
                      {l.nextFollowUp && !['won', 'lost'].includes(st) ? (
                        <span className={due ? 'badge-status badge-rose' : 'cell-sub'}>{due ? 'Due ' : ''}{formatDate(l.nextFollowUp)}</span>
                      ) : (
                        <span className="cell-sub">{l.lastContactedAt ? `Last ${formatDate(l.lastContactedAt)}` : '—'}</span>
                      )}
                    </td>
                    <td className="cell-sub">{ownerOf(l)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="cell-actions" style={{ position: 'relative' }}>
                        {(canEdit || READ_ONLY_ACTIONS.includes(step.action)) && (
                          <button className="btn btn-sm btn-secondary" onClick={() => runNext(l)}>
                            {step.label} <ArrowRight size={13} />
                          </button>
                        )}
                        <RowMenu
                          open={menuFor === l.id}
                          onOpenChange={(o) => setMenuFor(o ? l.id : null)}
                          items={menuItems(l, step.action)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- Lead detail ---------- */}
      {detail && (
        <LeadDetail
          lead={detail}
          canEdit={canEdit}
          onClose={() => openDetail(null)}
          onAction={(id) => runAction(detail, id)}
          menuItems={menuItems(detail, nextStep(detail).action)}
        />
      )}

      <LeadFormModal isOpen={formLead !== undefined} lead={formLead} onClose={() => setFormLead(undefined)} />
      <ImportLeadsModal isOpen={showImport} onClose={() => setShowImport(false)} />
      <LogContactModal lead={contactLead} onClose={() => setContactLead(null)} />
      <ScheduleInspectionModal lead={scheduleLead} onClose={() => setScheduleLead(null)} />
      <InspectionFindingsModal lead={findingsLead} onClose={() => setFindingsLead(null)} />

      <ConfirmDialog
        isOpen={Boolean(lostLead)}
        onClose={() => setLostLead(null)}
        onConfirm={(reason) => {
          if (!lostLead) return;
          try {
            store.setLeadStage(lostLead.id, 'lost', reason, userProfile?.email);
            warning('Moved to Lost', lostLead.title);
          } catch (err) {
            error('Could not mark as lost', err instanceof Error ? err.message : String(err));
          }
          setLostLead(null);
        }}
        title="Mark lead as lost?"
        message={`${lostLead?.title} will move to Lost / rejected. You can reopen it later.`}
        confirmLabel="Mark as lost"
        requireReason
        reasonLabel="Why was it lost? (e.g. price, chose competitor, not interested)"
        isDestructive
      />

      <ConfirmDialog
        isOpen={Boolean(skipLead)}
        onClose={() => setSkipLead(null)}
        onConfirm={(reason) => {
          if (!skipLead) return;
          try {
            const updated = store.skipLeadInspection(skipLead.id, reason || '', userProfile?.email);
            setSkipLead(null);
            createProposal(updated);
          } catch (err) {
            error('Could not skip inspection', err instanceof Error ? err.message : String(err));
          }
        }}
        title="Skip the site inspection?"
        message={`${skipLead?.title} will go straight to a proposal without a recorded inspection. This is logged on the lead and in the audit log.`}
        confirmLabel="Skip and create proposal"
        requireReason
        reasonLabel="Why is no inspection needed? (e.g. repeat client, site already known)"
      />

      {sendLead && (() => {
        const p = primaryContact(sendLead);
        return (
          <SendDocumentsModal
            isOpen
            onClose={() => setSendLead(null)}
            recipient={{ name: p?.name || sendLead.title, phone: p?.phone, email: p?.email || sendLead.companyEmail }}
            related={{ kind: 'lead', id: sendLead.id, title: sendLead.title }}
            onSent={(results) => {
              if (results.some((r) => r.ok)) {
                store.sendLeadDocuments(
                  sendLead.id,
                  results.some((r) => r.channel === 'whatsapp') ? 'whatsapp' : 'email',
                  'Sent company documents',
                  userProfile?.email
                );
              }
            }}
          />
        );
      })()}

      {stuckLead && (
        <SetStuckAtModal
          lead={stuckLead}
          onClose={() => setStuckLead(null)}
          onSaved={(updated) => {
            setStuckLead(null);
            if (detailId === updated.id) openDetail(updated.id);
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Set Stuck At Modal
// ---------------------------------------------------------------------------
const SetStuckAtModal: React.FC<{ lead: Lead; onClose: () => void; onSaved: (updated: Lead) => void }> = ({ lead, onClose, onSaved }) => {
  const store = useDataStore();
  const { userProfile } = useAuth();
  const { success, error } = useNotification();
  const [reason, setReason] = useState<string>(lead.stuckAt || '');

  const save = () => {
    try {
      const updated = store.setLeadStuckAt(lead.id, (reason as StuckAtReason) || undefined, userProfile?.email);
      if (updated) {
        success('Status updated', `${lead.title} status updated.`);
        onSaved(updated);
      } else {
        onClose();
      }
    } catch (err) {
      error('Could not update status', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Set "Stuck at" status: ${lead.title}`}
      subtitle="Track the exact reason this lead is delayed"
      maxWidth="500px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save status</button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label">Current delay reason</label>
        <select className="form-select" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Not stuck / in motion</option>
          {STUCK_AT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <div className="form-hint" style={{ marginTop: '0.4rem' }}>
          {lead.stuckAt && lead.stuckAtDate ? `Previously marked stuck on ${lead.stuckAtDate} (${daysSince(lead.stuckAtDate)} days ago)` : 'Selecting a reason resets the stuck-at timer to today.'}
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Lead detail
// ---------------------------------------------------------------------------
interface DetailProps {
  lead: Lead;
  canEdit: boolean;
  onClose: () => void;
  onAction: (id: LeadActionId) => void;
  /** Allowed actions other than the primary next step. */
  menuItems: RowMenuItem[];
}

const channelLabel = (a: LeadActivity) => CHANNELS.find((c) => c.value === a.channel)?.label || a.channel;

const LeadDetail: React.FC<DetailProps> = ({ lead, canEdit, onClose, onAction, menuItems }) => {
  const st = stageOf(lead);
  const contacts = contactsOf(lead);
  const step = nextStep(lead);
  const activities = lead.activities ?? [];
  const pdfAction = usePdfAction();
  const sitePhotos = [...(lead.inspection?.photos ?? []), ...(lead.sitePhotos ?? [])];
  const stageIndex = PIPELINE.findIndex((p) => p.stage === st);
  const actions = availableActions(lead);
  const allowed = (id: LeadActionId) => canEdit && actions.some((a) => a.id === id && a.enabled);
  const stepAllowed = canEdit || READ_ONLY_ACTIONS.includes(step.action);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={lead.title}
      subtitle={`${lead.id} · ${[lead.industry, lead.area, lead.city].filter(Boolean).join(' · ')} · Source: ${sourceLabel(lead.source)}`}
      maxWidth="940px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} style={{ marginRight: 'auto' }}>Close</button>
          <RowMenu items={menuItems} />
          {stepAllowed && <button className="btn btn-primary" onClick={() => onAction(step.action)}>{step.label} <ArrowRight size={15} /></button>}
        </>
      }
    >
      {/* Stage progress */}
      <div className="stage-track">
        {PIPELINE.filter((p) => p.stage !== 'lost').map((p, i) => {
          const done = st === 'lost' ? i <= PIPELINE.findIndex((x) => x.stage === stageOf({ stage: lead.lostAtStage || 'new' })) : i <= stageIndex;
          return (
            <div key={p.stage} className={`stage-step ${done ? 'done' : ''} ${p.stage === st ? 'current' : ''}`} title={p.hint}>
              <span className="stage-step-bar" style={done ? { background: p.color } : undefined} />
              <span className="stage-step-label">{p.short}</span>
            </div>
          );
        })}
      </div>
      {lead.inspectionSkipped && (
        <div className="info-hint" style={{ marginBottom: '1rem' }}>
          <SkipForward size={14} style={{ verticalAlign: '-2px' }} /> Inspection skipped by {lead.inspectionSkipped.by} on {formatDate(lead.inspectionSkipped.at)}: {lead.inspectionSkipped.reason}
        </div>
      )}
      {lead.stuckAt && (
        <div className="warning-hint" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <strong>Stuck at:</strong> {stuckAtLabel(lead.stuckAt)} (since {formatDate(lead.stuckAtDate)}, {daysSince(lead.stuckAtDate)} days stuck)
          </div>
          {canEdit && (
            <button className="btn btn-sm btn-ghost" onClick={() => onAction('set_stuck_at')}>
              Change
            </button>
          )}
        </div>
      )}
      {(lead.negotiationRounds || lead.lastQuotedAmount || lead.clientCounterOffer || lead.bargainingNotes) && (
        <div className="card" style={{ marginBottom: '1rem', background: '#FFFBEB', borderColor: '#FDE68A' }}>
          <div className="section-title" style={{ marginTop: 0, color: '#92400E' }}>Negotiation details</div>
          <dl className="detail-list">
            {lead.negotiationRounds ? (<><dt>Rounds</dt><dd>{lead.negotiationRounds}</dd></>) : null}
            {lead.lastQuotedAmount ? (<><dt>Last quoted</dt><dd>PKR {lead.lastQuotedAmount.toLocaleString()}</dd></>) : null}
            {lead.clientCounterOffer ? (<><dt>Counter-offer</dt><dd>PKR {lead.clientCounterOffer.toLocaleString()}</dd></>) : null}
            {lead.bargainingNotes ? (<><dt>Bargaining notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{lead.bargainingNotes}</dd></>) : null}
          </dl>
        </div>
      )}
      {st === 'lost' && <div className="error-hint" style={{ marginBottom: '1rem' }}><strong>Lost</strong>{lead.lostReason ? `: ${lead.lostReason}` : ''}{lead.lostAt ? ` (${formatDate(lead.lostAt)})` : ''}</div>}

      <div className="lead-detail-grid">
        <div>
          <div className="section-title" style={{ marginTop: 0 }}>Contacts</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {contacts.map((c) => (
              <div key={c.id} className="contact-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-title">
                      {c.isPrimary && <Star size={13} fill="var(--ikpm-amber-500)" color="var(--ikpm-amber-500)" style={{ marginRight: 4, verticalAlign: '-2px' }} />}
                      {c.name}
                    </div>
                    <div className="cell-sub">{c.designation || (c.isPrimary ? 'Primary contact' : 'Contact')}</div>
                    <div className="cell-sub">{c.phone}{c.email ? ` · ${c.email}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    <a className="icon-btn" href={`tel:${c.phone}`} title="Call"><Phone size={15} /></a>
                    <a className="icon-btn" href={`https://wa.me/${toWhatsAppNumber(c.phone)}`} target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={15} /></a>
                    {c.email && <a className="icon-btn" href={`mailto:${c.email}`} title="Email"><Mail size={15} /></a>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="section-title">Company</div>
          <dl className="detail-list">
            <dt>Type</dt><dd>{lead.customerType === 'individual' ? 'Individual / household' : 'Company'}</dd>
            {lead.headquarterAddress && (<><dt>Head office</dt><dd>{lead.headquarterAddress}</dd></>)}
            {lead.propertyAddress && (<><dt>Address</dt><dd><MapPin size={13} style={{ verticalAlign: '-2px' }} /> {lead.propertyAddress}{lead.area ? `, ${lead.area}` : ''}, {lead.city}</dd></>)}
            {(lead.branches ?? []).length > 0 && (
              <>
                <dt>Branches</dt>
                <dd>{lead.branches!.map((b) => `${b.name} (${b.city || b.address})`).join(', ')}</dd>
              </>
            )}
            {lead.companyPhone && (<><dt>Phone</dt><dd>{lead.companyPhone}</dd></>)}
            {lead.companyEmail && (<><dt>Email</dt><dd>{lead.companyEmail}</dd></>)}
            {lead.website && (<><dt>Website</dt><dd>{lead.website}</dd></>)}
            <dt>Owner</dt><dd>{ownerOf(lead)}</dd>
            <dt>Created</dt><dd>{formatDate(lead.createdAt)}</dd>
            {lead.notes && (<><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{lead.notes}</dd></>)}
          </dl>

          {lead.inspection && (
            <>
              <div className="section-title">Inspection</div>
              <dl className="detail-list">
                <dt>Status</dt><dd style={{ textTransform: 'capitalize' }}>{lead.inspection.status}</dd>
                <dt>Date</dt><dd>{formatDate(lead.inspection.scheduledDate)}{lead.inspection.timeSlot ? ` · ${lead.inspection.timeSlot}` : ''}</dd>
                {lead.inspection.teamName && (<><dt>Team</dt><dd>{lead.inspection.teamName}</dd></>)}
                <dt>Inspectors</dt><dd>{lead.inspection.inspectorNames?.join(', ') || lead.inspection.inspectorName || '—'}</dd>
                {lead.inspection.status === 'completed' && (
                  <>
                    <dt>Pests</dt><dd>{lead.inspection.pestTypesFound.map((x) => PEST_OPTIONS.find((o) => o.value === x)?.label || x).join(', ')}</dd>
                    <dt>Severity</dt><dd style={{ textTransform: 'capitalize' }}>{lead.inspection.infestationSeverity}{lead.inspection.areaSqFt ? ` · ${lead.inspection.areaSqFt.toLocaleString()} sq ft` : ''}</dd>
                    {!lead.inspection.findings?.length && (<><dt>Findings</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{lead.inspection.criticalFindings}</dd></>)}
                    {lead.inspection.recommendedTreatment && (<><dt>Treatment</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{lead.inspection.recommendedTreatment}</dd></>)}
                  </>
                )}
              </dl>
              {lead.inspection.findings?.length ? (
                <div className="table-container" style={{ marginTop: '0.5rem' }}>
                  <table className="data-table finding-table">
                    <thead><tr><th>Evidence</th><th>Observation</th><th>Risk</th><th>Recommendation</th></tr></thead>
                    <tbody>
                      {lead.inspection.findings.map((f) => (
                        <tr key={f.id}>
                          <td>{f.photo ? <a href={f.photo.imageUrl} target="_blank" rel="noreferrer"><img className="finding-thumb" src={f.photo.imageUrl} alt={f.photo.caption} loading="lazy" /></a> : <span className="cell-sub">—</span>}</td>
                          <td>{f.location && <div className="cell-sub">{f.location}</div>}{f.observation}</td>
                          <td>{f.risk}</td>
                          <td>{f.recommendation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {(allowed('reschedule_inspection') || allowed('record_findings')) && (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {allowed('reschedule_inspection') && <button className="btn btn-sm btn-secondary" onClick={() => onAction('reschedule_inspection')}><CalendarClock size={14} /> Reschedule</button>}
                  {allowed('record_findings') && <button className="btn btn-sm btn-secondary" onClick={() => onAction('record_findings')}><ClipboardCheck size={14} /> {lead.inspection.status === 'completed' ? 'Edit findings' : 'Enter findings'}</button>}
                </div>
              )}
              <button className="btn btn-sm btn-ghost" style={{ marginTop: '0.4rem' }} onClick={() => pdfAction.run(lead.id, () => pdfGenerator.generateInspectionReportPDF(lead))} disabled={pdfAction.busy === lead.id}>
                <Download size={14} /> {lead.inspection.findings?.length ? 'Risk assessment PDF' : 'Inspection report PDF'}
              </button>
            </>
          )}

          {sitePhotos.length > 0 && (
            <>
              <div className="section-title">Photos ({sitePhotos.length})</div>
              <div className="photo-grid">
                {sitePhotos.map((p) => (
                  <a key={p.id} className="photo-tile" href={p.imageUrl} target="_blank" rel="noreferrer">
                    <img src={p.imageUrl} alt={p.caption} loading="lazy" />
                    <span className="photo-badge">{p.caption}</span>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="section-title" style={{ marginTop: 0 }}>Activity</div>
            {allowed('log_contact') && (
              <button className="btn btn-sm btn-secondary" onClick={() => onAction('log_contact')}><Phone size={14} /> Log contact</button>
            )}
          </div>
          {lead.nextFollowUp && !['won', 'lost'].includes(st) && (
            <div className={isFollowUpDue(lead) ? 'error-hint' : 'info-hint'} style={{ marginBottom: '0.75rem' }}>
              <Clock size={14} style={{ verticalAlign: '-2px' }} /> Next follow-up: <strong>{formatDate(lead.nextFollowUp)}</strong>
            </div>
          )}
          {activities.length === 0 ? (
            <div className="drive-empty">No activity yet. Log the first call or WhatsApp.</div>
          ) : (
            <ol className="timeline lead-timeline">
              {activities.map((a) => (
                <li key={a.id} className="timeline-item">
                  <span className={`timeline-icon ${a.channel === 'whatsapp' ? 'whatsapp' : ''}`}>
                    {a.kind === 'inspection' ? <ClipboardCheck size={14} /> : a.kind === 'proposal' ? <FileSpreadsheet size={14} /> : a.channel === 'whatsapp' ? <MessageCircle size={14} /> : a.channel === 'email' ? <Mail size={14} /> : a.kind === 'contact' ? <Phone size={14} /> : <Clock size={14} />}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.84rem' }}>{a.kind === 'contact' ? `${channelLabel(a)}${a.contactName ? ` with ${a.contactName}` : ''}` : a.note}</strong>
                      {a.outcome && <span className={`badge-status badge-${outcomeTone(a.outcome)}`}>{outcomeLabel(a.outcome)}</span>}
                    </div>
                    {a.kind === 'contact' && a.note && <div style={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{a.note}</div>}
                    <div className="cell-sub">
                      {a.byName} · {formatDateTime(a.at)}{a.nextFollowUp ? ` · follow up ${formatDate(a.nextFollowUp)}` : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default LeadsListPage;
