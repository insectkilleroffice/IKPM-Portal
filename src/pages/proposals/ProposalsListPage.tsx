import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Download, Send, FileSignature, RotateCw, CheckCircle2, CalendarClock, Paperclip, Calendar, Truck } from 'lucide-react';
import { useDataStore } from '../../hooks/useDataStore';
import { SendDocumentsModal } from '../../features/outreach/SendDocumentsModal';
import { ProposalBuilderModal, type ProposalPrefill } from '../../features/proposals/ProposalBuilderModal';
import { ProposalDetailModal } from '../../features/proposals/ProposalDetailModal';
import { ReviseProposalModal } from '../../features/proposals/ReviseProposalModal';
import { fileProposalPdf } from '../../features/proposals/proposalFiles';
import { dataService } from '../../services/dataService';
import { uploadFile } from '../../lib/cloudinary';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { Modal } from '../../components/common/Modal';
import { StatusBadge } from '../../components/common/StatusBadge';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { formatPKR, formatDate } from '../../lib/formatters';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { usePdfAction } from '../../hooks/usePdfAction';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { baseRoleOf } from '../../lib/permissions';
import type { Proposal } from '../../types/proposal';
import type { Contract } from '../../types/operations';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'sent_to_client', label: 'Sent to client' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'declined', label: 'Declined' },
  { value: 'rejected', label: 'Rejected' },
];

export const ProposalsListPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { success, error, warning } = useNotification();
  const pdfAction = usePdfAction();
  const { userProfile, canApproveProposals, effectiveRole, isSuperAdmin } = useAuth();
  const baseRole = baseRoleOf(effectiveRole) ?? '';
  const canAccept = isSuperAdmin || ['admin', 'sales'].includes(baseRole);
  const isOperations = baseRole === 'operations';

  const [acceptTarget, setAcceptTarget] = useState<Proposal | null>(null);
  useDataStore();

  const [searchQuery, setSearchQuery] = useState('');
  // Operations → accepted only; admin/super_admin → pending_approval by default so review queue is front-and-centre
  const isAdminRole = ['admin', 'super_admin'].includes(baseRole);
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get('filter') || (isOperations ? 'accepted' : isAdminRole ? 'pending_approval' : 'all')
  );
  // undefined = follow the ?view= deep link (it may load after the first render); null = closed
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [showBuilder, setShowBuilder] = useState(searchParams.get('action') === 'new_proposal');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showChangesDialog, setShowChangesDialog] = useState(false);
  const [sendTarget, setSendTarget] = useState<Proposal | null>(null);
  const [reviseTarget, setReviseTarget] = useState<Proposal | null>(null);

  const proposals = dataService.getProposals();
  const contracts = dataService.getContracts();
  const activeId = selectedId === undefined ? searchParams.get('view') : selectedId;
  const selected = activeId ? dataService.getProposalById(activeId) ?? null : null;

  const prefill: ProposalPrefill = {
    fromLead: searchParams.get('fromLead') || undefined,
    customerType: (searchParams.get('customerType') as 'company' | 'individual') || undefined,
    customerId: searchParams.get('customerId') || undefined,
    city: searchParams.get('city') || undefined,
    address: searchParams.get('address') || undefined,
    pests: searchParams.get('pests')?.split(',').filter(Boolean),
  };

  // After admin requests changes, CRO can edit and send directly — no re-approval needed
  const canSend = (p: Proposal) =>
    ['approved', 'sent_to_client', 'negotiation'].includes(p.status) ||
    (p.status === 'draft' && p.approval?.status === 'changes_requested');

  const recipientFor = (p: Proposal) => {
    if (p.attentionTo?.name && p.customerType === 'company') {
      const co = dataService.getCompanyById(p.customerId);
      return {
        name: p.attentionTo.name,
        phone: p.attentionTo.phone || co?.primaryContact.mobile,
        email: p.attentionTo.email || co?.primaryContact.email,
      };
    }
    if (p.customerType === 'company') {
      const branch = p.branchId ? dataService.getBranchById(p.branchId) : undefined;
      if (branch) return { name: branch.branchManagerName, phone: branch.branchManagerPhone || branch.branchPhone, email: branch.branchEmail };
      const co = dataService.getCompanyById(p.customerId);
      return { name: co?.primaryContact.fullName || p.customerName, phone: co?.primaryContact.mobile, email: co?.primaryContact.email };
    }
    const cl = dataService.getClientById(p.customerId);
    return { name: cl?.fullName || p.customerName, phone: cl?.primaryPhone, email: cl?.email };
  };

  const save = (updated: Proposal, ok?: () => void) => {
    try {
      dataService.saveProposal(updated, userProfile?.email);
      ok?.();
    } catch (err) {
      error('Could not update proposal', err instanceof Error ? err.message : String(err));
    }
  };

  const submitForApproval = (p: Proposal) => {
    if (!userProfile) return;
    save(
      {
        ...p,
        status: 'pending_approval',
        approval: {
          ruleId: 'AP-ADMIN',
          ruleDescription: 'All proposals require admin approval before sending to client.',
          requiredRole: 'admin',
          status: 'pending',
          requestedAt: new Date().toISOString(),
          requestedBy: userProfile.email || '',
          requestedByName: userProfile.displayName || '',
        },
      },
      () => success('Submitted for approval', `${p.id} has been sent to admin for review.`)
    );
  };

  const requestChanges = (comments: string) => {
    if (!selected) return;
    if (!canApproveProposals()) return;
    save(
      {
        ...selected,
        status: 'draft',
        approval: selected.approval
          ? { ...selected.approval, status: 'changes_requested', comments, decisionAt: new Date().toISOString(), decisionBy: userProfile?.email, decisionByName: userProfile?.displayName }
          : undefined,
      },
      () => { warning('Changes requested', `${selected.id} sent back to ${selected.preparedByName} for revisions.`); setShowChangesDialog(false); }
    );
  };

  const reviseProposal = (p: Proposal) => setReviseTarget(p);

  const markSent = (p: Proposal) => {
    if (p.status === 'sent_to_client' || p.status === 'negotiation') return;
    save({ ...p, status: 'sent_to_client', sentDate: new Date().toISOString() });
  };

  const decide = (status: 'approved' | 'rejected', reason?: string) => {
    if (!selected) return;
    if (!canApproveProposals()) return error('Access denied', 'Only Management or Sales Managers can approve escalated proposals.');
    save(
      {
        ...selected,
        status,
        approval: selected.approval
          ? { ...selected.approval, status, decisionAt: new Date().toISOString(), decisionBy: userProfile?.email, decisionByName: userProfile?.displayName, ...(reason ? { rejectionReason: reason } : {}) }
          : undefined,
      },
      () => (status === 'approved' ? success('Approved', `${selected.id} is ready to send.`) : warning('Rejected', `${selected.id} was rejected.`))
    );
  };

  const filePdf = (p: Proposal) =>
    pdfAction.run(p.id, async () => {
      const doc = await fileProposalPdf(p, { email: userProfile?.email, displayName: userProfile?.displayName });
      if (doc) success('Saved', `PDF filed in ${p.customerName} / Proposals.`);
      else warning('Not saved', 'File storage is not configured or you are offline.');
    });

  const pendingApprovalCount = proposals.filter((p) => p.status === 'pending_approval').length;

  const filtered = proposals.filter((p) => {
    if (isOperations && p.status !== 'accepted') return false;
    const q = searchQuery.toLowerCase();
    const hit = p.id.toLowerCase().includes(q) || p.customerName.toLowerCase().includes(q) || (p.branchName ?? '').toLowerCase().includes(q);
    return hit && (statusFilter === 'all' || p.status === statusFilter);
  });

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Proposals' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Proposals</h1>
          <p className="page-subtitle">Monthly IPM service plan quotations and one-time treatments, with approval, revisions and PDF.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowBuilder(true)}>
          <Plus size={16} /> <span>New proposal</span>
        </button>
      </div>

      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        {!isOperations && (
          <div className="chip-row" style={{ marginBottom: 0 }}>
            {STATUS_FILTERS.map((sf) => (
              <button key={sf.value} type="button" className={`chip ${statusFilter === sf.value ? 'chip-on' : ''}`} onClick={() => setStatusFilter(sf.value)}>
                {sf.label}
                {sf.value === 'pending_approval' && pendingApprovalCount > 0 && (
                  <span style={{ marginLeft: 5, background: 'var(--ikpm-amber-500, #f59e0b)', color: '#fff', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, padding: '1px 5px' }}>
                    {pendingApprovalCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {isOperations && (
          <span className="badge-status badge-emerald" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem' }}>Showing: Accepted proposals only</span>
        )}
        <div className="drive-search" style={{ width: 260 }}>
          <Search size={15} color="var(--text-muted)" />
          <input placeholder="Search proposals…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Proposal</th>
              <th>Client</th>
              <th>Type</th>
              <th>Prepared by</th>
              <th>Monthly / total</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(p.id)}>
                <td>
                  <div className="cell-title">{p.id}</div>
                  <div className="cell-sub">R{p.revisionNumber} · {formatDate(p.createdAt)}</div>
                  {p.revisionNumber > 1 && p.revisionsHistory.length > 0 && (
                    <div className="cell-sub" style={{ marginTop: 2, fontStyle: 'italic', color: 'var(--ikpm-amber-700, #b45309)' }}>
                      {p.revisionsHistory[p.revisionsHistory.length - 1].changeReason}
                    </div>
                  )}
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{p.customerName}</div>
                  <div className="cell-sub">{p.branchName || (p.customerType === 'company' ? 'Head office' : 'Individual')}</div>
                </td>
                <td>
                  {p.servicePlan?.length
                    ? <span className="badge-status badge-emerald">Monthly plan · {p.tenureMonths} mo</span>
                    : <span className="badge-status badge-slate">{p.templateType.replace(/_/g, ' ')}</span>}
                </td>
                <td className="cell-sub">{p.preparedByName}</td>
                <td>
                  {p.monthlyRate ? <div style={{ fontWeight: 700 }}>{formatPKR(p.monthlyRate)} / mo</div> : null}
                  <div className={p.monthlyRate ? 'cell-sub' : ''} style={p.monthlyRate ? undefined : { fontWeight: 700 }}>{formatPKR(p.totalAmount)}{p.discountPercent > 10 ? ' · AP-01' : ''}</div>
                </td>
                <td><StatusBadge status={p.status} /></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {p.status === 'draft' && baseRole === 'sales' && !p.approval && (
                      <button className="btn btn-sm btn-primary" onClick={() => submitForApproval(p)}>
                        <Send size={12} /> <span>Submit</span>
                      </button>
                    )}
                    {p.status === 'accepted' && (() => {
                      const linked = contracts.find((c) => c.proposalId === p.id && c.status !== 'cancelled');
                      if (!linked) {
                        return (
                          <button className="btn btn-sm btn-primary" title="Create the contract from this proposal" onClick={() => navigate(`/contracts?action=new_contract&fromProposal=${p.id}`)}>
                            <FileSignature size={12} /> <span>Contract</span>
                          </button>
                        );
                      }
                      const hasJobs = (linked.totalJobsScheduled || 0) > 0;
                      if (!hasJobs) {
                        return (
                          <button className="btn btn-sm btn-primary" title={`Generate visit schedule for ${linked.id}`} onClick={() => navigate('/contracts')}>
                            <Calendar size={12} /> <span>Generate Schedule</span>
                          </button>
                        );
                      }
                      return (
                        <button className="btn btn-sm btn-outline-emerald" title={`${linked.totalJobsScheduled} jobs scheduled — view in Operations`} onClick={() => navigate('/operations/jobs')}>
                          <Truck size={12} /> <span>Jobs ({linked.totalJobsScheduled})</span>
                        </button>
                      );
                    })()}
                    {['sent_to_client', 'declined', 'rejected', 'expired', 'accepted', 'negotiation'].includes(p.status) && (
                      <button className="btn btn-sm btn-secondary" title="Create a revised version of this proposal" onClick={() => reviseProposal(p)}>
                        <RotateCw size={12} /> <span>Revise</span>
                      </button>
                    )}
                    <button className="icon-btn" title="Download PDF" onClick={() => pdfAction.run(p.id, () => pdfGenerator.generateProposalPDF(p))} disabled={pdfAction.busy === p.id}>
                      <Download size={15} />
                    </button>
                    {canSend(p) && (
                      <button className="icon-btn" title="Send proposal and company documents" onClick={() => setSendTarget(p)}>
                        <Send size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showBuilder && <ProposalBuilderModal isOpen onClose={() => setShowBuilder(false)} prefill={prefill} onCreated={(p) => setSelectedId(p.id)} />}
      {reviseTarget && (
        <ReviseProposalModal
          proposal={reviseTarget}
          onClose={() => setReviseTarget(null)}
          onRevised={(revised) => { setReviseTarget(null); setSelectedId(revised.id); }}
        />
      )}

      {selected && (
        <ProposalDetailModal
          proposal={selected}
          canApprove={canApproveProposals()}
          canAccept={canAccept}
          pdfBusy={pdfAction.busy === selected.id}
          onClose={() => setSelectedId(null)}
          onExportPdf={() => pdfAction.run(selected.id, () => pdfGenerator.generateProposalPDF(selected))}
          onFilePdf={() => filePdf(selected)}
          onApprove={() => decide('approved')}
          onReject={() => setShowRejectDialog(true)}
          onRequestChanges={canApproveProposals() && selected.status === 'pending_approval' ? () => setShowChangesDialog(true) : undefined}
          onSubmitForApproval={baseRole === 'sales' && selected.status === 'draft' && !selected.approval ? () => { submitForApproval(selected); setSelectedId(null); } : undefined}
          onAccept={() => {
            if (selected.leadId) {
              const alreadyWon = proposals.find((p) => p.id !== selected.id && p.leadId === selected.leadId && p.status === 'accepted');
              if (alreadyWon) {
                error('Already won', `${alreadyWon.id} is already accepted for this lead. Decline or revise that proposal before accepting another.`);
                return;
              }
            }
            setAcceptTarget(selected);
          }}
          onDecline={() => save({ ...selected, status: 'declined' }, () => warning('Declined', selected.leadId ? `Lead ${selected.leadId} moved to Negotiation. Schedule a negotiation meeting as the next step.` : 'Proposal declined by the client.'))}
          onSend={canSend(selected) ? () => setSendTarget(selected) : undefined}
        />
      )}

      {sendTarget && (
        <SendDocumentsModal
          isOpen
          onClose={() => setSendTarget(null)}
          recipient={recipientFor(sendTarget)}
          related={{ kind: 'proposal', id: sendTarget.id, title: `${sendTarget.id} — ${sendTarget.customerName}` }}
          proposal={sendTarget}
          onSent={(results) => {
            if (results.some((r) => r.ok)) markSent(sendTarget);
          }}
        />
      )}

      <ConfirmDialog
        isOpen={showRejectDialog}
        onClose={() => setShowRejectDialog(false)}
        onConfirm={(reason) => {
          decide('rejected', reason);
          setShowRejectDialog(false);
        }}
        title="Reject proposal"
        message="Give the reason for rejecting this proposal."
        requireReason
        confirmLabel="Reject"
      />

      <ConfirmDialog
        isOpen={showChangesDialog}
        onClose={() => setShowChangesDialog(false)}
        onConfirm={(comments) => requestChanges(comments)}
        title="Request changes"
        message="Describe what changes the CRO needs to make before this proposal can be approved."
        requireReason
        confirmLabel="Send back for changes"
      />

      {acceptTarget && (
        <AcceptProposalModal
          proposal={acceptTarget}
          onClose={() => setAcceptTarget(null)}
          onConfirm={(suggestedStartDate, acceptanceNote) => {
            save(
              { ...acceptTarget, status: 'accepted', acceptedDate: new Date().toISOString(), suggestedStartDate: suggestedStartDate || undefined, acceptanceNote: acceptanceNote || undefined },
              () => success('Accepted', acceptTarget.leadId ? `Lead ${acceptTarget.leadId} is now Won. Next: create the contract.` : 'Proposal accepted by the client.')
            );
            setAcceptTarget(null);
          }}
        />
      )}
    </div>
  );
};

export default ProposalsListPage;

// ---------------------------------------------------------------------------
// Accept Proposal Modal
// ---------------------------------------------------------------------------
const AcceptProposalModal: React.FC<{
  proposal: Proposal;
  onClose: () => void;
  onConfirm: (suggestedStartDate: string, acceptanceNote: string) => void;
}> = ({ proposal: p, onClose, onConfirm }) => {
  const { userProfile } = useAuth();
  const { error: notifError } = useNotification();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [suggestedStartDate, setSuggestedStartDate] = useState(p.suggestedStartDate || '');
  const [acceptanceNote, setAcceptanceNote] = useState(p.acceptanceNote || '');
  const [letterFile, setLetterFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      // Upload acceptance letter if provided
      if (letterFile) {
        try {
          const stored = await uploadFile(letterFile, {
            scope: dataService.uploadScopeFor({ kind: 'proposal', id: p.id }, 'proposal'),
            subPath: p.id,
            fileName: letterFile.name,
          });
          dataService.saveDocument(
            {
              id: `DOC-ACCEPT-${p.id}-${Date.now()}`,
              title: `Acceptance letter — ${p.id} (${p.customerName})`,
              category: 'other',
              fileCategory: 'correspondence',
              owner: { kind: 'proposal', id: p.id },
              ownerScope: 'client',
              clientId: p.customerId,
              clientType: p.customerType === 'company' ? 'company' : 'individual',
              source: 'uploaded',
              file: stored,
              uploadedBy: userProfile?.email || 'admin',
              uploadedByName: userProfile?.displayName || 'Staff',
              uploadedAt: new Date().toISOString(),
            },
            userProfile?.email
          );
        } catch (err) {
          notifError('Letter upload failed', err instanceof Error ? err.message : String(err));
        }
      }

      onConfirm(suggestedStartDate, acceptanceNote);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Client accepted: ${p.id}`}
      subtitle={`${p.customerName} · R${p.revisionNumber} · ${p.totalAmount ? `PKR ${p.totalAmount.toLocaleString()}` : ''}`}
      maxWidth="480px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
            <CheckCircle2 size={15} /> {saving ? 'Saving…' : 'Confirm acceptance'}
          </button>
        </>
      }
    >
      <div className="info-hint" style={{ marginBottom: '1rem' }}>
        Recording this will mark the proposal as <strong>Accepted</strong> and move the lead to <strong>Won</strong>. Operations will be able to create the contract.
      </div>

      <div className="form-group">
        <label className="form-label">
          <CalendarClock size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          Suggested job start date
          <span className="cell-sub" style={{ marginLeft: 6, fontSize: '0.75rem' }}>Operations will see this when creating the contract</span>
        </label>
        <input
          type="date"
          className="form-input"
          value={suggestedStartDate}
          min={todayStr}
          onChange={(e) => setSuggestedStartDate(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">
          <Paperclip size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          Acceptance / confirmation letter
          <span className="cell-sub" style={{ marginLeft: 6, fontSize: '0.75rem' }}>Saved to client folder</span>
        </label>
        <input
          type="file"
          className="form-input"
          style={{ padding: '0.35rem 0.6rem' }}
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          onChange={(e) => setLetterFile(e.target.files?.[0] || null)}
        />
        {letterFile && (
          <div className="cell-sub" style={{ marginTop: 4 }}>
            {letterFile.name} ({(letterFile.size / 1024).toFixed(0)} KB)
          </div>
        )}
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Note (optional)</label>
        <input
          className="form-input"
          value={acceptanceNote}
          onChange={(e) => setAcceptanceNote(e.target.value)}
          placeholder="e.g. client wants to start after Eid, signed via email"
        />
      </div>
    </Modal>
  );
};
