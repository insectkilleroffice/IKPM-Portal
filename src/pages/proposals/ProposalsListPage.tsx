import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Download, Send, FileSignature, RotateCw } from 'lucide-react';
import { useDataStore } from '../../hooks/useDataStore';
import { SendDocumentsModal } from '../../features/outreach/SendDocumentsModal';
import { ProposalBuilderModal, type ProposalPrefill } from '../../features/proposals/ProposalBuilderModal';
import { ProposalDetailModal } from '../../features/proposals/ProposalDetailModal';
import { fileProposalPdf } from '../../features/proposals/proposalFiles';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { Modal } from '../../components/common/Modal';
import { StatusBadge } from '../../components/common/StatusBadge';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { formatPKR, formatDate, generatePermanentId } from '../../lib/formatters';
import { frequencyForVisits } from '../../lib/proposalPlan';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { usePdfAction } from '../../hooks/usePdfAction';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import type { Proposal } from '../../types/proposal';
import type { Contract, ServiceFrequency } from '../../types/operations';

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
  const { userProfile, canApproveProposals } = useAuth();
  useDataStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('filter') || 'all');
  // undefined = follow the ?view= deep link (it may load after the first render); null = closed
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [showBuilder, setShowBuilder] = useState(searchParams.get('action') === 'new_proposal');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [sendTarget, setSendTarget] = useState<Proposal | null>(null);
  const [assignTarget, setAssignTarget] = useState<Proposal | null>(null);
  const [assignLeaderId, setAssignLeaderId] = useState('');
  const [assignStartDate, setAssignStartDate] = useState(new Date().toISOString().split('T')[0]);

  const proposals = dataService.getProposals();
  const teamLeaders = dataService.getStaff(['team_leader']);
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

  const canSend = (p: Proposal) => ['approved', 'draft', 'sent_to_client', 'negotiation'].includes(p.status);

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

  const reviseProposal = (p: Proposal) => {
    const now = new Date().toISOString();
    const id = generatePermanentId('P', proposals.length + 1);
    const revised: Proposal = {
      ...p,
      id,
      revisionNumber: p.revisionNumber + 1,
      parentProposalId: p.parentProposalId || p.id,
      status: 'draft',
      approval: undefined,
      sentDate: undefined,
      acceptedDate: undefined,
      pdfUrl: undefined,
      revisionsHistory: [
        ...p.revisionsHistory,
        { revisionNumber: p.revisionNumber + 1, timestamp: now, changedBy: userProfile?.email || 'admin', changedByName: userProfile?.displayName || 'Staff', changeReason: 'Revision', subtotal: p.subtotal, discountPercent: p.discountPercent, totalAmount: p.totalAmount },
      ],
      createdAt: now,
      updatedAt: now,
    };
    try {
      dataService.saveProposal(revised, userProfile?.email);
      success('Revision created', `${id} (R${revised.revisionNumber}) is a draft. Open it to adjust pricing or scope before sending.`);
      setSelectedId(id);
    } catch (err) {
      error('Could not create revision', err instanceof Error ? err.message : String(err));
    }
  };

  const markSent = (p: Proposal) => {
    if (p.status === 'sent_to_client' || p.status === 'negotiation') return;
    save({ ...p, status: 'sent_to_client', sentDate: new Date().toISOString() });
  };

  const handleAssignAndSchedule = () => {
    if (!assignTarget || !assignLeaderId || !assignStartDate) return;
    const p = assignTarget;
    const teamLeaderUser = dataService.getStaff().find((u) => u.uid === assignLeaderId);
    if (!teamLeaderUser) return;

    const propConflict = contracts.find((c) => c.proposalId === p.id && c.status !== 'cancelled');
    if (propConflict) {
      error('Contract already exists', `${propConflict.id} was already created from this proposal.`);
      return;
    }

    const isoDay = (d: Date) => d.toISOString().split('T')[0];
    const start = assignStartDate;
    const tenureMs = (p.tenureMonths ?? 12) * 30.44 * 86400000;
    const end = isoDay(new Date(new Date(start).getTime() + tenureMs));

    let customerName = '';
    let branchName: string | undefined;
    if (p.customerType === 'company') {
      const co = dataService.getCompanyById(p.customerId);
      customerName = co?.legalCompanyName || p.customerName;
      if (p.branchId) branchName = dataService.getBranchById(p.branchId)?.branchName;
    } else {
      customerName = dataService.getClientById(p.customerId)?.fullName || p.customerName;
    }

    const nextId = generatePermanentId('CT', contracts.length + 1);
    const frequency = (p.serviceVisitsPerMonth ? frequencyForVisits(p.serviceVisitsPerMonth) : 'monthly') as ServiceFrequency;

    const created: Contract = {
      id: nextId,
      contractType: 'amc_recurring',
      proposalId: p.id,
      customerType: p.customerType,
      customerId: p.customerId,
      customerName,
      branchId: p.branchId || undefined,
      branchName,
      siteIds: ['SITE-01'],
      startDate: start,
      endDate: end,
      frequency,
      totalContractValue: p.totalAmount,
      billingTerm: 'monthly_billing',
      serviceScope: (p.scopeSections ?? []).map((s) => `${s.key}. ${s.title}`).join(' · ') || p.scopeOfWork,
      warrantyPeriodMonths: p.warrantyPeriodMonths || 0,
      totalJobsScheduled: 0,
      totalJobsCompleted: 0,
      assignedTeamLeaderId: teamLeaderUser.uid,
      assignedTeamLeaderName: teamLeaderUser.displayName,
      status: 'active',
      renewalAlertDate: isoDay(new Date(new Date(end).getTime() - 60 * 24 * 60 * 60 * 1000)),
      servicePlan: p.servicePlan,
      serviceVisitsPerMonth: p.serviceVisitsPerMonth,
      followUpVisitsPerMonth: p.followUpVisitsPerMonth,
      monthlyRate: p.monthlyRate,
      taxMode: p.taxMode,
      taxPercent: p.taxPercent,
      tenureMonths: p.tenureMonths,
      paymentTermsDays: p.paymentTermsDays,
      terms: p.terms,
      exclusions: p.exclusions,
      deviceOwnership: p.deviceOwnership,
      chemicals: p.chemicals,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      dataService.saveContract(created, userProfile?.email);
      success('Contract Created', `${nextId} assigned to ${teamLeaderUser.displayName}. Service starts ${assignStartDate}.`);
      setAssignTarget(null);
      setAssignLeaderId('');
    } catch (err) {
      error('Failed to create contract', err instanceof Error ? err.message : String(err));
    }
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

  const filtered = proposals.filter((p) => {
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
        <div className="chip-row" style={{ marginBottom: 0 }}>
          {STATUS_FILTERS.map((sf) => (
            <button key={sf.value} type="button" className={`chip ${statusFilter === sf.value ? 'chip-on' : ''}`} onClick={() => setStatusFilter(sf.value)}>
              {sf.label}
            </button>
          ))}
        </div>
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
                    {p.status === 'accepted' && (
                      <button className="btn btn-sm btn-primary" title="Create the contract from this proposal" onClick={() => navigate(`/contracts?action=new_contract&fromProposal=${p.id}`)}>
                        <FileSignature size={12} /> <span>Contract</span>
                      </button>
                    )}
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

      {selected && (
        <ProposalDetailModal
          proposal={selected}
          canApprove={canApproveProposals()}
          pdfBusy={pdfAction.busy === selected.id}
          onClose={() => setSelectedId(null)}
          onExportPdf={() => pdfAction.run(selected.id, () => pdfGenerator.generateProposalPDF(selected))}
          onFilePdf={() => filePdf(selected)}
          onApprove={() => decide('approved')}
          onReject={() => setShowRejectDialog(true)}
          onAccept={() => {
            // Guard: only one accepted proposal per lead
            if (selected.leadId) {
              const alreadyWon = proposals.find((p) => p.id !== selected.id && p.leadId === selected.leadId && p.status === 'accepted');
              if (alreadyWon) {
                error('Already won', `${alreadyWon.id} is already accepted for this lead. Decline or revise that proposal before accepting another.`);
                return;
              }
            }
            save({ ...selected, status: 'accepted', acceptedDate: new Date().toISOString() }, () =>
              success('Accepted', selected.leadId ? `Lead ${selected.leadId} is now Won. Next: onboarding pack and contract.` : 'Proposal accepted by the client.')
            );
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
    </div>
  );
};

export default ProposalsListPage;
