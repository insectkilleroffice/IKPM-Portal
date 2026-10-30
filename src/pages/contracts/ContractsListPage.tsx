import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileSignature,
  Plus,
  Search,
  Calendar,
  AlertTriangle,
  Truck,
  RotateCw,
  UserCheck,
  Ban,
  RefreshCw,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { formatPKR, formatDate, generatePermanentId } from '../../lib/formatters';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { baseRoleOf, canEditModule } from '../../lib/permissions';
import { effectiveContractStatus } from '../../lib/contractUtils';
import type { Contract, ContractType, ServiceFrequency } from '../../types/operations';
import type { Approval } from '../../types/approvals';
import { getContractNextAction } from '../../lib/workflow';
import { frequencyForVisits } from '../../lib/proposalPlan';
import { packStatus } from '../../lib/onboarding';
import { ScheduleGeneratorModal } from '../../features/schedule/ScheduleGeneratorModal';
import type { Proposal } from '../../types/proposal';

const isoDay = (d: Date) => d.toISOString().split('T')[0];

/** Contract form values from a proposal (plan proposals carry tenure, visits and pricing). */
function fromProposal(p: Proposal) {
  const plan = Boolean(p.servicePlan?.length);
  const start = p.suggestedStartDate || p.tenureStart || isoDay(new Date());
  return {
    contractType: 'amc_recurring' as ContractType,
    proposalId: p.id,
    customerType: p.customerType,
    customerId: p.customerId,
    branchId: p.branchId || '',
    startDate: start,
    endDate: p.tenureEnd || isoDay(new Date(new Date(start).getTime() + 365 * 86400000)),
    frequency: (plan ? frequencyForVisits(p.serviceVisitsPerMonth) : 'monthly') as ServiceFrequency,
    totalContractValue: p.totalAmount,
    billingTerm: 'monthly_billing' as const,
    serviceScope: plan ? (p.scopeSections ?? []).map((s) => `${s.key}. ${s.title}`).join(' · ') || p.scopeOfWork : p.scopeOfWork,
    warrantyPeriodMonths: p.warrantyPeriodMonths || 0,
  };
}

/** Plan fields copied from the accepted proposal onto the contract, so nothing is retyped. */
function planFieldsFrom(p: Proposal | undefined): Partial<Contract> {
  if (!p) return {};
  return {
    servicePlan: p.servicePlan,
    serviceVisitsPerMonth: p.serviceVisitsPerMonth,
    followUpVisitsPerMonth: p.followUpVisitsPerMonth,
    pcoCountMin: p.pcoCountMin,
    pcoCountMax: p.pcoCountMax,
    documentationIncluded: p.documentationIncluded,
    monthlyRate: p.monthlyRate,
    taxMode: p.taxMode,
    taxPercent: p.taxPercent,
    tenureMonths: p.tenureMonths,
    paymentTermsDays: p.paymentTermsDays,
    terms: p.terms,
    exclusions: p.exclusions,
    deviceOwnership: p.deviceOwnership,
    chemicals: p.chemicals,
    templateVersion: p.templateVersion,
    templateSnapshot: p.templateSnapshot,
  };
}

type ContractStatusFilter = 'all' | 'active' | 'expiring' | 'expired' | 'renewed' | 'cancelled';

export const ContractsListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { success, warning, error } = useNotification();
  const { userProfile, effectiveRole } = useAuth();
  useDataStore();

  const canEdit = canEditModule(effectiveRole, 'contracts');
  const canDirectAction = canEditModule(effectiveRole, 'approvals');
  const canAdminAction = ['super_admin', 'admin'].includes(effectiveRole ?? '');
  // Operations coordinators manage scheduling/assignment but don't own financials.
  const isOpsRole = baseRoleOf(effectiveRole) === 'operations';
  const canCreateContract = canEditModule(effectiveRole, 'crm') || canAdminAction;
  const canSeeFinancials = !isOpsRole;

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractStatusFilter>('all');
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Contract | null>(null);
  const [showNewContractModal, setShowNewContractModal] = useState(
    searchParams.get('action') === 'new_contract' || Boolean(searchParams.get('fromProposal'))
  );
  const [assignOpsModal, setAssignOpsModal] = useState<Contract | null>(null);
  const [selectedOpsUserId, setSelectedOpsUserId] = useState('');
  const [cancelModal, setCancelModal] = useState<Contract | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [reactivateModal, setReactivateModal] = useState<Contract | null>(null);
  const [reactivateNote, setReactivateNote] = useState('');

  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const proposals = dataService.getProposals();
  const teamLeaders = dataService.getStaff(['team_leader']);

  // If fromProposal is provided, find and prefill
  const fromPropId = searchParams.get('fromProposal');
  const linkedProposal = fromPropId ? dataService.getProposalById(fromPropId) : undefined;

  const [newContract, setNewContract] = useState(() =>
    linkedProposal
      ? { ...fromProposal(linkedProposal), assignedTeamLeaderId: '', assignedTeamLeaderName: '' }
      : {
          contractType: 'amc_recurring' as ContractType,
          proposalId: '',
          customerType: 'company' as 'company' | 'individual',
          customerId: companies[0]?.id || '',
          branchId: '',
          startDate: isoDay(new Date()),
          endDate: isoDay(new Date(Date.now() + 365 * 86400000)),
          frequency: 'monthly' as ServiceFrequency,
          totalContractValue: 0,
          billingTerm: 'monthly_billing' as const,
          serviceScope: 'Integrated Pest Management (IPM) maintenance',
          warrantyPeriodMonths: 0,
          assignedTeamLeaderId: '',
          assignedTeamLeaderName: '',
        }
  );

  // The proposal may arrive from Firestore after the first render
  const linkedId = linkedProposal?.id;
  useEffect(() => {
    if (!linkedId) return;
    const p = dataService.getProposalById(linkedId);
    if (p) {
      setNewContract((prev) => ({ ...fromProposal(p), assignedTeamLeaderId: prev.assignedTeamLeaderId ?? '', assignedTeamLeaderName: prev.assignedTeamLeaderName ?? '' }));
      setShowNewContractModal(true);
    }
  }, [linkedId]);

  const contracts = dataService.getContracts();
  const allJobs = dataService.getJobs();
  const allInvoices = dataService.getInvoices();

  /** Returns live completed-job count for a contract from actual service_jobs data. */
  const liveJobStats = (contractId: string) => {
    const contractJobs = allJobs.filter((j) => j.contractId === contractId && j.status !== 'cancelled');
    const completed = contractJobs.filter((j) => j.status === 'completed').length;
    const total = contractJobs.length;
    const allDone = total > 0 && completed === total;
    const contractInvoices = allInvoices.filter((inv) => inv.contractId === contractId);
    const allPaid = contractInvoices.length > 0 && contractInvoices.every((inv) => inv.status === 'paid' || inv.balanceDue <= 0);
    return { completed, total, allDone, allPaid };
  };
  const allComplaints = dataService.getComplaints();
  const today = new Date().toISOString().split('T')[0];

  // Check 60-day AMC expiry warnings (Step 15)
  const expiringContracts = contracts.filter((c) => {
    if (c.status !== 'active') return false;
    const end = new Date(c.endDate);
    const diffDays = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diffDays <= 60 && diffDays >= 0;
  });

  const filtered = contracts.filter((c) => {
    const q = searchQuery.toLowerCase();
    const nameHit =
      c.id.toLowerCase().includes(q) ||
      c.customerName.toLowerCase().includes(q) ||
      (c.branchName && c.branchName.toLowerCase().includes(q));
    if (!nameHit) return false;
    const eff = effectiveContractStatus(c, today);
    if (statusFilter === 'all') return true;
    if (statusFilter === 'expiring') return eff === 'active' && expiringContracts.some((ec) => ec.id === c.id);
    return eff === statusFilter;
  });

  const handleCreateContract = (e: React.FormEvent) => {
    e.preventDefault();
    // Guard: block if this proposal already has a contract
    if (newContract.proposalId) {
      const propConflict = dataService.getContracts().find(
        (c) => c.proposalId === newContract.proposalId && c.status !== 'cancelled'
      );
      if (propConflict) {
        error(
          'Contract already exists',
          `${propConflict.id} was already created from proposal ${newContract.proposalId}. Open that contract to renew or manage it.`
        );
        return;
      }
    }
    // Guard: block if an active contract already exists for this client/branch
    const activeConflict = dataService.getContracts().find(
      (c) => c.customerId === newContract.customerId &&
        (c.branchId || undefined) === (newContract.branchId || undefined) &&
        effectiveContractStatus(c, today) === 'active'
    );
    if (activeConflict) {
      const daysLeft = Math.ceil((new Date(activeConflict.endDate).getTime() - Date.now()) / 86400000);
      error(
        'Active contract exists',
        daysLeft <= 30
          ? `${activeConflict.id} expires in ${daysLeft} day(s) — use Renew instead.`
          : `${activeConflict.id} is still active. Cancel it or wait for it to expire first.`
      );
      return;
    }
    let customerName = '';
    let branchName: string | undefined = undefined;

    if (newContract.customerType === 'company') {
      const co = dataService.getCompanyById(newContract.customerId);
      customerName = co?.legalCompanyName || 'Corporate Company';
      if (newContract.branchId) {
        const br = dataService.getBranchById(newContract.branchId);
        branchName = br?.branchName;
      }
    } else {
      const cl = dataService.getClientById(newContract.customerId);
      customerName = cl?.fullName || 'Individual Client';
    }

    const sites = dataService.getSites(newContract.customerId, newContract.branchId || undefined);
    const nextId = generatePermanentId('CT', contracts.length + 1);

    const sourceProposal = newContract.proposalId ? dataService.getProposalById(newContract.proposalId) : undefined;
    const teamLeaderUser = newContract.assignedTeamLeaderId ? dataService.getStaff().find((u) => u.uid === newContract.assignedTeamLeaderId) : undefined;
    const created: Contract = {
      ...planFieldsFrom(sourceProposal),
      id: nextId,
      contractType: newContract.contractType,
      proposalId: newContract.proposalId || undefined,
      customerType: newContract.customerType,
      customerId: newContract.customerId,
      customerName,
      branchId: newContract.branchId || undefined,
      branchName,
      siteIds: sites.length > 0 ? [sites[0].id] : ['SITE-01'],
      startDate: newContract.startDate,
      endDate: newContract.endDate,
      frequency: newContract.frequency,
      totalContractValue: Number(newContract.totalContractValue),
      billingTerm: newContract.billingTerm,
      serviceScope: newContract.serviceScope,
      warrantyPeriodMonths: Number(newContract.warrantyPeriodMonths),
      totalJobsScheduled: 0,
      totalJobsCompleted: 0,
      assignedTeamLeaderId: teamLeaderUser?.uid,
      assignedTeamLeaderName: teamLeaderUser?.displayName,
      status: 'active',
      renewalAlertDate: new Date(new Date(newContract.endDate).getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    dataService.saveContract(created, userProfile?.email);
    success('Contract Registered & Activated', `Contract ${created.id} created for ${created.customerName}${teamLeaderUser ? ` · Assigned to ${teamLeaderUser.displayName}` : ''}. Next: generate the visit schedule.`);
    const pack = dataService.getOnboardingPack(created.customerId);
    if (!pack || packStatus(pack) !== 'sent') warning('Onboarding pack not sent', `Send ${created.customerName} their SOP, MSDS, certificates and layout from the customer's Onboarding tab.`);
    setShowNewContractModal(false);
  };

  // Opens the schedule planner (Step 14): review and edit visits before jobs are created
  const handleGenerateSchedule = (contract: Contract) => setScheduleFor(contract);

  // Step 15: 60 days before tenureEnd: clone contract and create renewal proposal
  const handleRenewContract = (contract: Contract) => {
    const prevStart = new Date(contract.startDate);
    const prevEnd = new Date(contract.endDate);
    const durationMs = Math.max(30 * 86400000, prevEnd.getTime() - prevStart.getTime());
    const newStart = contract.endDate;
    const newEnd = isoDay(new Date(new Date(newStart).getTime() + durationMs));

    // 1. Create a renewal proposal carrying forward the service plan, scope, and rates
    const origProp = contract.proposalId ? dataService.getProposalById(contract.proposalId) : undefined;
    const propId = generatePermanentId('P', proposals.length + 1);
    const subtotal = contract.monthlyRate ? contract.monthlyRate * (contract.tenureMonths || 12) : contract.totalContractValue;
    const taxPercent = contract.taxPercent ?? 13;
    const taxAmount = (subtotal * taxPercent) / 100;

    const renewalProposal: Proposal = {
      ...(origProp || {}),
      id: propId,
      revisionNumber: 1,
      templateType: origProp?.templateType || 'general_ipm',
      customerType: contract.customerType,
      customerId: contract.customerId,
      customerName: contract.customerName,
      branchId: contract.branchId,
      branchName: contract.branchName,
      preparedByUserId: userProfile?.uid || 'admin',
      preparedByName: userProfile?.displayName || 'Admin',
      scopeOfWork: contract.serviceScope,
      lineItems: origProp?.lineItems || [],
      subtotal,
      discountPercent: 0,
      discountAmount: 0,
      taxPercent,
      taxAmount,
      totalAmount: subtotal + taxAmount,
      validityDays: 30,
      paymentTerms: 'Within 15 days of invoice date',
      servicePlan: contract.servicePlan,
      serviceVisitsPerMonth: contract.serviceVisitsPerMonth,
      followUpVisitsPerMonth: contract.followUpVisitsPerMonth,
      monthlyRate: contract.monthlyRate,
      taxMode: contract.taxMode,
      tenureStart: newStart,
      tenureEnd: newEnd,
      status: 'draft',
      revisionsHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dataService.saveProposal(renewalProposal, userProfile?.email);

    // 2. Clone the contract for the new tenure
    const nextContractId = generatePermanentId('CT', contracts.length + 1);
    const clonedContract: Contract = {
      ...contract,
      id: nextContractId,
      proposalId: propId,
      startDate: newStart,
      endDate: newEnd,
      status: 'active',
      totalJobsScheduled: 0,
      totalJobsCompleted: 0,
      isRenewalInitiated: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dataService.saveContract(clonedContract, userProfile?.email);

    // 3. Mark original contract as renewal initiated
    const updatedOriginal: Contract = {
      ...contract,
      isRenewalInitiated: true,
      status: 'renewed',
    };
    dataService.saveContract(updatedOriginal, userProfile?.email);

    success(
      'AMC Renewal Completed',
      `Contract ${clonedContract.id} & Renewal Proposal ${renewalProposal.id} created for ${formatDate(newStart)}–${formatDate(newEnd)}. Next: schedule a renewal meeting with the client to discuss terms.`
    );
  };

  const handleAssignOpsManager = () => {
    if (!assignOpsModal || !selectedOpsUserId) return;
    const opsUser = dataService.getStaff().find((u) => u.uid === selectedOpsUserId);
    if (!opsUser) return;
    const now = new Date().toISOString();
    const updated: Contract = {
      ...assignOpsModal,
      assignedOperationsManagerId: opsUser.uid,
      assignedOperationsManagerName: opsUser.displayName,
      assignedAt: now,
      updatedAt: now,
    };
    dataService.saveContract(updated, userProfile?.email);
    // Copy assignment to all pending jobs for this contract
    const contractJobs = dataService.getJobs().filter((j) => j.contractId === assignOpsModal.id && j.status === 'scheduled');
    contractJobs.forEach((job) => {
      dataService.saveJob({ ...job, assignedTeamLeaderId: opsUser.uid, assignedTeamLeaderName: opsUser.displayName, updatedAt: now }, userProfile?.email);
    });
    success('Operations Manager assigned', `${opsUser.displayName} is now managing ${assignOpsModal.id}.`);
    setAssignOpsModal(null);
    setSelectedOpsUserId('');
  };

  function handleCancelContract() {
    if (!cancelModal || !cancelReason.trim()) { error('Reason required', 'Please state the cancellation reason.'); return; }
    if (canDirectAction) {
      const updated: Contract = { ...cancelModal, status: 'cancelled', updatedAt: new Date().toISOString() };
      dataService.saveContract(updated, userProfile?.email);
      success('Contract cancelled', `${cancelModal.id} has been cancelled.`);
    } else {
      const approvalId = `AP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const approval: Approval = {
        id: approvalId,
        type: 'contract_cancel',
        entityType: 'contract',
        entityId: cancelModal.id,
        entityTitle: `${cancelModal.id} — ${cancelModal.customerName}`,
        ownerUid: userProfile?.uid ?? '',
        requestedBy: userProfile?.email ?? '',
        requestedByName: userProfile?.displayName ?? 'Staff',
        requestedAt: new Date().toISOString(),
        reason: cancelReason,
        status: 'pending',
        updatedAt: new Date().toISOString(),
      };
      dataService.saveApproval(approval, userProfile?.email);
      success('Cancellation requested', `Approval ${approvalId} submitted — awaiting manager decision.`);
    }
    setCancelModal(null);
    setCancelReason('');
  }

  function handleReactivateContract() {
    if (!reactivateModal) return;
    if (canDirectAction) {
      const updated: Contract = { ...reactivateModal, status: 'active', updatedAt: new Date().toISOString() };
      dataService.saveContract(updated, userProfile?.email);
      success('Contract reactivated', `${reactivateModal.id} is now active.`);
    } else {
      const approvalId = `AP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const approval: Approval = {
        id: approvalId,
        type: 'contract_reactivate',
        entityType: 'contract',
        entityId: reactivateModal.id,
        entityTitle: `${reactivateModal.id} — ${reactivateModal.customerName}`,
        ownerUid: userProfile?.uid ?? '',
        requestedBy: userProfile?.email ?? '',
        requestedByName: userProfile?.displayName ?? 'Staff',
        requestedAt: new Date().toISOString(),
        reason: reactivateNote.trim() || 'Reactivation requested',
        status: 'pending',
        updatedAt: new Date().toISOString(),
      };
      dataService.saveApproval(approval, userProfile?.email);
      success('Reactivation requested', `Approval ${approvalId} submitted — awaiting manager decision.`);
    }
    setReactivateModal(null);
    setReactivateNote('');
  }

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Contracts & AMC Renewals' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Contracts & AMC Maintenance Agreements</h1>
          <p className="page-subtitle">
            Target pipeline: Proposal ─► Contract ─► Generate Visit Schedule. Single-click schedule dispatch & 60-day renewal alerts.
          </p>
        </div>

        {canCreateContract && (
          <button className="btn btn-primary" onClick={() => setShowNewContractModal(true)}>
            <Plus size={16} />
            <span>+ Create New Contract</span>
          </button>
        )}
      </div>

      {/* 60-Day AMC Expiry Warning Banner (Step 15) */}
      {expiringContracts.length > 0 && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: 'var(--ikpm-amber-100)',
            border: '1px solid #FCD34D',
            borderRadius: 'var(--radius-lg)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertTriangle size={22} color="#92400E" />
            <div>
              <strong style={{ color: '#92400E' }}>
                {expiringContracts.length} AMC Contract(s) Expiring within 60 Days
              </strong>
              <div style={{ fontSize: '0.8rem', color: '#B45309' }}>
                Automated follow-up: Send AMC renewal quotations or initiate renewal terms before coverage lapses.
              </div>
            </div>
          </div>
          {canAdminAction && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {expiringContracts.map((ec) => (
                <button
                  key={ec.id}
                  className="btn btn-primary"
                  style={{ backgroundColor: '#92400E', padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                  onClick={() => handleRenewContract(ec)}
                >
                  <RotateCw size={12} />
                  <span>Renew {ec.id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status filter chips */}
      <div className="card" style={{ padding: '0.65rem 1.25rem', marginBottom: '0.75rem' }}>
        <div className="chip-row" style={{ marginBottom: 0 }}>
          {([
            ['all', 'All'],
            ['active', 'Active'],
            ['expiring', 'Expiring (60d)'],
            ['expired', 'Expired'],
            ['renewed', 'Renewed'],
            ['cancelled', 'Cancelled'],
          ] as [ContractStatusFilter, string][]).map(([val, label]) => (
            <button key={val} type="button" className={`chip ${statusFilter === val ? 'chip-on' : ''}`} onClick={() => setStatusFilter(val)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Search Bar */}
      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ position: 'relative', width: '320px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search contracts by ID, customer..."
            className="form-input"
            style={{ paddingLeft: '2.2rem', height: '36px', fontSize: '0.825rem' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Showing <strong>{filtered.length}</strong> active agreements
        </div>
      </div>

      {/* Contracts Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Contract ID</th>
              <th>Customer Name</th>
              <th>Branch / Location</th>
              <th>Type & Frequency</th>
              <th>Term Period</th>
              {canSeeFinancials && <th>Contract Value</th>}
              <th>Visit Schedule</th>
              <th>Status</th>
              <th>Next Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const _nextAct = getContractNextAction(c);
              const stats = liveJobStats(c.id);
              const hasJobs = stats.total > 0 || (c.totalJobsScheduled || 0) > 0;
              const openComplaintCount = allComplaints.filter((cmp) => cmp.contractId === c.id && !['closed'].includes(cmp.status)).length;

              return (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>
                    <div style={{ color: 'var(--text-primary)' }}>{c.id}</div>
                    {c.proposalId && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--ikpm-emerald-600)' }}>From: {c.proposalId}</div>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.customerName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                      {c.customerType}
                    </div>
                  </td>
                  <td>{c.branchName || 'Company HQ / Primary'}</td>
                  <td>
                    <div>
                      <span className={`badge-status ${c.contractType === 'amc_recurring' ? 'badge-emerald' : 'badge-slate'}`}>
                        {c.contractType === 'amc_recurring' ? 'Annual AMC' : 'One-Time'}
                      </span>
                    </div>
                    <div style={{ marginTop: '2px' }}>
                      <span className="badge-status badge-navy">{c.frequency}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>
                    <div>Start: {formatDate(c.startDate)}</div>
                    <div style={{ color: 'var(--text-muted)' }}>End: {formatDate(c.endDate)}</div>
                  </td>
                  {canSeeFinancials && <td style={{ fontWeight: 700 }}>{formatPKR(c.totalContractValue)}</td>}
                  <td>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                      {stats.completed > 0 ? stats.completed : (c.totalJobsCompleted || 0)} / {stats.total > 0 ? stats.total : (c.totalJobsScheduled || 0)} visits completed
                    </div>
                    {!hasJobs && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--ikpm-amber-600)', fontWeight: 600 }}>
                        Visits not generated yet
                      </div>
                    )}
                    {stats.allDone && stats.allPaid && (
                      <div style={{ marginTop: '4px' }}>
                        <span className="badge-status badge-emerald" style={{ fontSize: '0.7rem' }}>✓ Completed & Paid</span>
                      </div>
                    )}
                    {stats.allDone && !stats.allPaid && (
                      <div style={{ marginTop: '4px' }}>
                        <span className="badge-status badge-amber" style={{ fontSize: '0.7rem' }}>✓ Completed — Invoice Pending</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={effectiveContractStatus(c, today)} />
                    {openComplaintCount > 0 && (
                      <div style={{ marginTop: 3 }}>
                        <button className="btn-link" style={{ fontSize: '0.7rem', color: 'var(--ikpm-rose-600)' }}
                          onClick={() => navigate(`/complaints?contractId=${c.id}`)}>
                          ⚠ {openComplaintCount} complaint{openComplaintCount > 1 ? 's' : ''}
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button
                        className={hasJobs ? 'btn btn-secondary' : 'btn btn-primary'}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                        title={hasJobs ? 'Edit or regenerate the visit schedule for this contract' : 'Generate all scheduled visit jobs across contract term'}
                        onClick={() => handleGenerateSchedule(c)}
                      >
                        <Calendar size={12} />
                        <span>{hasJobs ? 'Edit Schedule' : 'Generate Schedule'}</span>
                      </button>

                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                        onClick={() => { setAssignOpsModal(c); setSelectedOpsUserId(c.assignedOperationsManagerId || ''); }}
                        title={c.assignedOperationsManagerName ? `Ops: ${c.assignedOperationsManagerName}` : 'Assign Operations Manager'}
                      >
                        <UserCheck size={12} />
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                        onClick={() => setSelectedContract(c)}
                      >
                        Details
                      </button>
                      {canAdminAction && effectiveContractStatus(c, today) !== 'cancelled' && effectiveContractStatus(c, today) !== 'renewed' && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', color: 'var(--ikpm-rose-600)' }}
                          title="Cancel contract"
                          onClick={() => { setCancelModal(c); setCancelReason(''); }}
                        >
                          <Ban size={12} />
                        </button>
                      )}
                      {canAdminAction && effectiveContractStatus(c, today) === 'cancelled' && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}
                          title="Reactivate contract"
                          onClick={() => { setReactivateModal(c); setReactivateNote(''); }}
                        >
                          <RefreshCw size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal: Create Contract (Pre-filled from Proposal if applicable) */}
      <Modal
        isOpen={showNewContractModal}
        onClose={() => setShowNewContractModal(false)}
        title="Create Contract"
        subtitle={linkedProposal ? `Pre-filled from proposal ${linkedProposal.id}` : 'Fill in the details below'}
        maxWidth="680px"
      >
        <form onSubmit={handleCreateContract}>
          {/* Optional: link to an accepted proposal to auto-fill */}
          {(() => {
            const accepted = proposals.filter((p) => p.status === 'accepted');
            if (accepted.length === 0) return null;
            const contractedProposalIds = new Set(
              dataService.getContracts().filter((c) => c.proposalId && c.status !== 'cancelled').map((c) => c.proposalId!)
            );
            return (
              <div className="form-group" style={{ marginBottom: '1.25rem', padding: '0.85rem 1rem', background: 'var(--bg-surface-alt)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                <label className="form-label" style={{ fontWeight: 700 }}>
                  Link to a proposal <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 400 }}>(optional — auto-fills the form)</span>
                </label>
                <select
                  className="form-select"
                  value={newContract.proposalId}
                  onChange={(e) => {
                    const p = proposals.find((x) => x.id === e.target.value);
                    if (!p) { setNewContract({ ...newContract, proposalId: '' }); return; }
                    setNewContract({
                      ...newContract,
                      proposalId: p.id,
                      customerType: p.customerType,
                      customerId: p.customerId,
                      branchId: p.branchId || '',
                      startDate: p.tenureStart || newContract.startDate,
                      endDate: p.tenureEnd || newContract.endDate,
                      frequency: p.serviceVisitsPerMonth ? (p.serviceVisitsPerMonth >= 4 ? 'weekly' : p.serviceVisitsPerMonth >= 2 ? 'fortnightly' : 'monthly') : 'monthly',
                      totalContractValue: p.totalAmount,
                      serviceScope: p.scopeOfWork || newContract.serviceScope,
                    });
                  }}
                >
                  <option value="">— No proposal (manual entry) —</option>
                  {accepted.map((p) => {
                    const hasContract = contractedProposalIds.has(p.id);
                    return (
                      <option key={p.id} value={p.id} disabled={hasContract}>
                        {p.id} · {p.customerName}{p.branchName ? ` / ${p.branchName}` : ''} · {new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(p.totalAmount)}{hasContract ? ' (contract exists)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            );
          })()}
          {newContract.customerId && (() => {
            const pack = dataService.getOnboardingPack(newContract.customerId);
            if (pack && packStatus(pack) === 'sent') return null;
            const path = `/customers/${newContract.customerType === 'company' ? 'company' : 'individual'}/${newContract.customerId}?tab=onboarding`;
            return (
              <div className="error-hint" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <AlertTriangle size={16} />
                <span style={{ flex: 1 }}>
                  The onboarding pack (SOP, MSDS, certificates, layout) {pack ? 'has not been sent' : 'has not been started'} for this client. You can still activate the contract.
                </span>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate(path)}>Send pack now</button>
              </div>
            );
          })()}
          {(() => {
            const allContracts = dataService.getContracts();
            const active = allContracts.filter(
              (c) => c.customerId === newContract.customerId &&
                (c.branchId || undefined) === (newContract.branchId || undefined) &&
                effectiveContractStatus(c, today) === 'active'
            );
            if (active.length === 0) return null;
            const daysLeft = Math.ceil((new Date(active[0].endDate).getTime() - Date.now()) / 86400000);
            const nearExpiry = daysLeft <= 30;
            return (
              <div className="error-hint" style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Cannot create a new contract.</strong>
                    {' '}{active[0].id} is already active for this client{newContract.branchId ? ' / branch' : ''} ({daysLeft > 0 ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining` : 'expires today'}).
                    {nearExpiry
                      ? <> Use the <strong>Renew</strong> button on that contract to extend it for the next period.</>
                      : <> Cancel or wait for the existing contract to expire before creating a new one.</>
                    }
                  </div>
                </div>
              </div>
            );
          })()}
          {!newContract.proposalId && (
            <div className="chip-row" style={{ marginBottom: '0.75rem' }}>
              <button type="button" className={`chip ${newContract.customerType === 'company' ? 'chip-on' : ''}`} onClick={() => setNewContract({ ...newContract, customerType: 'company', customerId: companies[0]?.id || '', branchId: '' })}>Company</button>
              <button type="button" className={`chip ${newContract.customerType === 'individual' ? 'chip-on' : ''}`} onClick={() => setNewContract({ ...newContract, customerType: 'individual', customerId: clients[0]?.id || '', branchId: '' })}>Individual</button>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Client <span className="required">*</span></label>
            <select
              className="form-select"
              value={newContract.customerId}
              onChange={(e) => setNewContract({ ...newContract, customerId: e.target.value, branchId: '' })}
            >
              {newContract.customerType === 'company'
                ? companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.legalCompanyName} ({c.id})
                    </option>
                  ))
                : clients.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.fullName} ({cl.id})
                    </option>
                  ))}
            </select>
          </div>

          {newContract.customerType === 'company' && (() => {
            const branchList = dataService.getBranches(newContract.customerId);
            return (
              <div className="form-group">
                <label className="form-label">Branch / Location</label>
                <select
                  className="form-select"
                  value={newContract.branchId}
                  onChange={(e) => setNewContract({ ...newContract, branchId: e.target.value })}
                >
                  <option value="">Head office / all branches</option>
                  {branchList.map((b) => (
                    <option key={b.id} value={b.id}>{b.branchName}</option>
                  ))}
                </select>
                {newContract.customerId && (
                  <div style={{ fontSize: '0.72rem', marginTop: '0.2rem' }}>
                    <a href={`/customers/company/${newContract.customerId}?tab=branches`} style={{ color: 'var(--ikpm-emerald-600)' }}>＋ Add new branch</a>
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Contract Type</label>
              <select
                className="form-select"
                value={newContract.contractType}
                onChange={(e) => setNewContract({ ...newContract, contractType: e.target.value as any })}
              >
                <option value="amc_recurring">Annual AMC (Recurring)</option>
                <option value="one_time">One-Time Job</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Service Frequency</label>
              <select
                className="form-select"
                value={newContract.frequency}
                onChange={(e) => setNewContract({ ...newContract, frequency: e.target.value as any })}
              >
                <option value="monthly">Monthly</option>
                <option value="bi_monthly">Bi-Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="weekly">Weekly</option>
                <option value="one_off">One-Off</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Total Contract Value (PKR)</label>
              <input
                type="number"
                required
                className="form-input"
                value={newContract.totalContractValue}
                onChange={(e) => setNewContract({ ...newContract, totalContractValue: Number(e.target.value) })}
              />
            </div>
          </div>

          {linkedProposal?.suggestedStartDate && (
            <div className="info-hint" style={{ marginBottom: '0.5rem' }}>
              <strong>Suggested start date from CRO:</strong> {linkedProposal.suggestedStartDate}
              {linkedProposal.acceptanceNote && <span> — {linkedProposal.acceptanceNote}</span>}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Start Date <span className="required">*</span></label>
              <input
                type="date"
                required
                className="form-input"
                value={newContract.startDate}
                onChange={(e) => setNewContract({ ...newContract, startDate: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">End Date <span className="required">*</span></label>
              <input
                type="date"
                required
                className="form-input"
                value={newContract.endDate}
                onChange={(e) => setNewContract({ ...newContract, endDate: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Scope of Service Agreement</label>
            <textarea
              className="form-input"
              rows={2}
              value={newContract.serviceScope}
              onChange={(e) => setNewContract({ ...newContract, serviceScope: e.target.value })}
            />
          </div>

          {teamLeaders.length > 0 && (
            <div className="form-group">
              <label className="form-label">Assign Team Leader <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — can be changed later)</span></label>
              <select
                className="form-select"
                value={newContract.assignedTeamLeaderId}
                onChange={(e) => {
                  const tl = teamLeaders.find((u) => u.uid === e.target.value);
                  setNewContract({ ...newContract, assignedTeamLeaderId: e.target.value, assignedTeamLeaderName: tl?.displayName || '' });
                }}
              >
                <option value="">— Assign later —</option>
                {teamLeaders.map((u) => (
                  <option key={u.uid} value={u.uid}>{u.displayName} ({u.role})</option>
                ))}
              </select>
            </div>
          )}

          {(() => {
            const hasActiveConflict = dataService.getContracts().some(
              (c) => c.customerId === newContract.customerId &&
                (c.branchId || undefined) === (newContract.branchId || undefined) &&
                effectiveContractStatus(c, today) === 'active'
            );
            return (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewContractModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={hasActiveConflict} title={hasActiveConflict ? 'An active contract already exists for this client / branch' : undefined}>
                  <FileSignature size={15} />
                  <span>Register & Activate Contract</span>
                </button>
              </div>
            );
          })()}
        </form>
      </Modal>

      {/* Modal: View Contract Details */}
      {selectedContract && (
        <Modal
          isOpen={Boolean(selectedContract)}
          onClose={() => setSelectedContract(null)}
          title={`Contract: ${selectedContract.id}`}
          subtitle={`Customer: ${selectedContract.customerName} • Term: ${formatDate(selectedContract.startDate)} to ${formatDate(selectedContract.endDate)}`}
          maxWidth="640px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              {canAdminAction && (
                <button
                  className="btn btn-outline-emerald"
                  onClick={() => handleRenewContract(selectedContract)}
                >
                  <RotateCw size={14} />
                  <span>Renew AMC</span>
                </button>
              )}
              {!canAdminAction && <span />}

              <button
                className="btn btn-primary"
                onClick={() => {
                  handleGenerateSchedule(selectedContract);
                  setSelectedContract(null);
                }}
              >
                <Calendar size={14} />
                <span>{selectedContract.totalJobsScheduled > 0 ? 'Edit Visit Schedule' : 'Generate Visit Schedule'}</span>
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
            {selectedContract.servicePlan?.length ? (
              <div>
                <div className="section-title" style={{ marginTop: 0 }}>Monthly IPM service plan</div>
                <div className="table-container">
                  <table className="data-table">
                    <thead><tr><th style={{ width: 36 }}>#</th><th>Service</th><th>Frequency</th></tr></thead>
                    <tbody>
                      {selectedContract.servicePlan.map((r, i) => <tr key={r.id}><td>{i + 1}</td><td>{r.service}</td><td>{r.frequency}</td></tr>)}
                    </tbody>
                  </table>
                </div>
                <dl className="detail-list" style={{ marginTop: '0.75rem' }}>
                  <dt>Visits / month</dt><dd>{selectedContract.serviceVisitsPerMonth ?? '—'} service · {selectedContract.followUpVisitsPerMonth ?? 0} follow-up</dd>
                  {canSeeFinancials && selectedContract.monthlyRate ? (<><dt>Monthly rate</dt><dd>{formatPKR(selectedContract.monthlyRate)} ({selectedContract.taxMode === 'inclusive' ? 'incl.' : 'excl.'} {selectedContract.taxPercent ?? 0}% tax)</dd></>) : null}
                  {canSeeFinancials && selectedContract.paymentTermsDays ? (<><dt>Payment</dt><dd>Within {selectedContract.paymentTermsDays} days of invoice</dd></>) : null}
                  {selectedContract.exclusions && (<><dt>Exclusions</dt><dd>{selectedContract.exclusions}</dd></>)}
                </dl>
              </div>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Customer:</span>
                <div style={{ fontWeight: 700 }}>{selectedContract.customerName}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Contract Type:</span>
                <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                  {selectedContract.contractType.replace('_', ' ')} ({selectedContract.frequency})
                </div>
              </div>
              {canSeeFinancials && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Contract Value:</span>
                  <div style={{ fontWeight: 700, color: 'var(--ikpm-emerald-600)' }}>
                    {formatPKR(selectedContract.totalContractValue)}
                  </div>
                </div>
              )}
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Visit Progress:</span>
                <div>
                  <strong>{selectedContract.totalJobsCompleted || 0}</strong> of {selectedContract.totalJobsScheduled || 0} visits completed
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Service Scope:</span>
              <p style={{ marginTop: '3px', color: 'var(--text-primary)' }}>{selectedContract.serviceScope}</p>
            </div>
          </div>
        </Modal>
      )}
      {scheduleFor && <ScheduleGeneratorModal contract={scheduleFor} onClose={() => setScheduleFor(null)} />}

      {/* Modal: Cancel Contract */}
      {cancelModal && (
        <Modal
          isOpen
          onClose={() => { setCancelModal(null); setCancelReason(''); }}
          title={canDirectAction ? 'Cancel Contract' : 'Request Contract Cancellation'}
          subtitle={`${cancelModal.id} — ${cancelModal.customerName}`}
          maxWidth="440px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => { setCancelModal(null); setCancelReason(''); }}>Back</button>
              <button className="btn btn-danger" onClick={handleCancelContract} disabled={!cancelReason.trim()}>
                <Ban size={14} /> {canDirectAction ? 'Cancel contract' : 'Submit for approval'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {!canDirectAction && (
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                A cancellation request will be sent to the manager for approval. The contract status will only change once approved.
              </p>
            )}
            <div className="form-group">
              <label className="form-label">Cancellation reason <span className="required">*</span></label>
              <textarea className="form-input" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Why is this contract being cancelled?" />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Reactivate Contract */}
      {reactivateModal && (
        <Modal
          isOpen
          onClose={() => { setReactivateModal(null); setReactivateNote(''); }}
          title={canDirectAction ? 'Reactivate Contract' : 'Request Contract Reactivation'}
          subtitle={`${reactivateModal.id} — ${reactivateModal.customerName}`}
          maxWidth="440px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => { setReactivateModal(null); setReactivateNote(''); }}>Back</button>
              <button className="btn btn-primary" onClick={handleReactivateContract}>
                <RefreshCw size={14} /> {canDirectAction ? 'Reactivate' : 'Submit for approval'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {!canDirectAction && (
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                A reactivation request will be submitted for manager approval.
              </p>
            )}
            <div className="form-group">
              <label className="form-label">Note (optional)</label>
              <input className="form-input" value={reactivateNote} onChange={(e) => setReactivateNote(e.target.value)}
                placeholder="Reason for reactivation" />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Assign Operations Manager */}
      {assignOpsModal && (
        <Modal
          isOpen
          onClose={() => { setAssignOpsModal(null); setSelectedOpsUserId(''); }}
          title="Assign Operations Manager"
          subtitle={`Contract ${assignOpsModal.id} — ${assignOpsModal.customerName}`}
          maxWidth="420px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => { setAssignOpsModal(null); setSelectedOpsUserId(''); }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAssignOpsManager} disabled={!selectedOpsUserId}>
                <UserCheck size={14} /> Assign
              </button>
            </>
          }
        >
          {(() => {
            const opsStaff = dataService.getStaff(['team_leader']);
            return (
              <div className="form-group">
                <label className="form-label">Operations Manager <span className="required">*</span></label>
                <select
                  className="form-select"
                  value={selectedOpsUserId}
                  onChange={(e) => setSelectedOpsUserId(e.target.value)}
                >
                  <option value="">— Select staff —</option>
                  {opsStaff.map((u) => (
                    <option key={u.uid} value={u.uid}>{u.displayName} · {u.role}</option>
                  ))}
                </select>
                {assignOpsModal.assignedOperationsManagerName && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                    Currently: {assignOpsModal.assignedOperationsManagerName}
                  </div>
                )}
              </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
};
