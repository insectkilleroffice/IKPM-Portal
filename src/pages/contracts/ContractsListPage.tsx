import React, { useState, useEffect, useRef } from 'react';
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
import { baseRoleOf, canEditModule, roleLabel } from '../../lib/permissions';
import { effectiveContractStatus } from '../../lib/contractUtils';
import { CONTRACT_CANCEL_CATEGORY_LABELS } from '../../types/operations';
import type { Contract, ContractCancelCategory, ContractType, ServiceFrequency } from '../../types/operations';
import type { Approval } from '../../types/approvals';
import { getContractNextAction } from '../../lib/workflow';
import { frequencyForVisits } from '../../lib/proposalPlan';
import { packStatus } from '../../lib/onboarding';
import { ScheduleGeneratorModal } from '../../features/schedule/ScheduleGeneratorModal';
import { CancellationSettlementModal } from '../../features/invoices/CancellationSettlementModal';
import { BillingCycleInput } from '../../features/proposals/BillingCycleInput';
import { billingCycleLabel } from '../../lib/billingCycle';
import type { Proposal } from '../../types/proposal';

const isoDay = (d: Date) => d.toISOString().split('T')[0];

/**
 * Contract form values from a proposal. The only fill step, used both when the contract is opened
 * from the proposal and when the proposal is picked in the form, so both fill the same fields.
 * Monthly IPM plan proposal → Annual AMC (tenure, visits, billing cycle).
 * One-time treatment proposal → One-Time Job (one visit, ends on the service date, billed once).
 */
function fromProposal(p: Proposal) {
  const plan = Boolean(p.servicePlan?.length);
  const start = p.suggestedStartDate || p.tenureStart || isoDay(new Date());
  return {
    contractType: (plan ? 'amc_recurring' : 'one_time') as ContractType,
    proposalId: p.id,
    customerType: p.customerType,
    customerId: p.customerId,
    branchId: p.branchId || '',
    siteId: '',
    startDate: start,
    endDate: plan ? p.tenureEnd || isoDay(new Date(new Date(start).getTime() + 365 * 86400000)) : start,
    frequency: (plan ? frequencyForVisits(p.serviceVisitsPerMonth) : 'one_off') as ServiceFrequency,
    totalContractValue: p.totalAmount,
    billingTerm: (plan ? 'monthly_billing' : 'per_service') as Contract['billingTerm'],
    billingCycleDays: plan ? p.billingCycleDays ?? 0 : 0,
    clientPoNumber: '',
    serviceScope: plan ? (p.scopeSections ?? []).map((s) => `${s.key}. ${s.title}`).join(' · ') || p.scopeOfWork : p.scopeOfWork,
    warrantyPeriodMonths: p.warrantyPeriodMonths || 0,
  };
}

/** Before-tax value of a proposal (what billing divides; tax is added on the invoice). */
const proposalValueBeforeTax = (p: Proposal) => Math.round((p.subtotal - (p.discountAmount || 0)) * 100) / 100;

/** An empty form: no client chosen yet (nothing is pre-selected by accident). */
const blankContract = () => ({
  contractType: 'amc_recurring' as ContractType,
  proposalId: '',
  customerType: 'company' as 'company' | 'individual',
  customerId: '',
  branchId: '',
  siteId: '',
  startDate: isoDay(new Date()),
  endDate: isoDay(new Date(Date.now() + 365 * 86400000)),
  frequency: 'monthly' as ServiceFrequency,
  totalContractValue: 0,
  billingTerm: 'monthly_billing' as Contract['billingTerm'],
  billingCycleDays: 0,
  clientPoNumber: '',
  serviceScope: 'Integrated Pest Management (IPM) maintenance',
  warrantyPeriodMonths: 0,
  assignedTeamLeaderId: '',
  assignedTeamLeaderName: '',
});

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
    billingCycleDays: p.billingCycleDays,
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
  const canAdminAction = ['super_admin', 'admin'].includes(baseRoleOf(effectiveRole) ?? '');
  // Operations coordinators manage scheduling/assignment but don't own financials.
  const isOpsRole = baseRoleOf(effectiveRole) === 'operations';
  const canCreateContract = canEditModule(effectiveRole, 'crm') || canAdminAction;
  // Renewing / revising a contract: the CRO and admins only
  const canReviseContract = canAdminAction || (baseRoleOf(effectiveRole) === 'sales' && canEdit);
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
  // Cancelled contract settlement (?settle=ID opens it, e.g. from the Approvals page)
  const [settleContract, setSettleContract] = useState<Contract | null>(null);
  const settleParam = searchParams.get('settle');
  useEffect(() => {
    if (!settleParam) return;
    const c = dataService.getContractById(settleParam);
    if (c) setSettleContract(c);
  }, [settleParam]);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelCategory, setCancelCategory] = useState<ContractCancelCategory>('client_request');
  const [cancelEffectiveDate, setCancelEffectiveDate] = useState(isoDay(new Date()));
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
    linkedProposal ? { ...blankContract(), ...fromProposal(linkedProposal) } : blankContract()
  );
  /** Same fill whichever way the proposal is chosen. */
  const applyProposal = (p: Proposal) =>
    setNewContract((prev) => ({ ...prev, ...fromProposal(p), assignedTeamLeaderId: prev.assignedTeamLeaderId, assignedTeamLeaderName: prev.assignedTeamLeaderName }));
  const openNewContract = () => { setNewContract(blankContract()); setShowNewContractModal(true); };

  // Sites of the chosen client / branch (individuals pick their home here; companies their premises)
  const formSites = newContract.customerId ? dataService.getSites(newContract.customerId, newContract.branchId || undefined) : [];
  /** An active contract of the SAME type for the same client, branch and site (a one-time job next to a monthly plan is fine). */
  const conflictFor = (f: typeof newContract) => dataService.getContracts().find((c) =>
    c.customerId === f.customerId
    && (c.branchId || '') === (f.branchId || '')
    && c.contractType === f.contractType
    && (!f.siteId || !c.siteIds?.length || c.siteIds.includes(f.siteId))
    && effectiveContractStatus(c, today) === 'active');
  // Client of the proposal not in this person's list: still show its name (instead of the first client)
  const formClientName = newContract.customerId
    ? (newContract.customerType === 'company' ? dataService.getCompanyById(newContract.customerId)?.legalCompanyName : dataService.getClientById(newContract.customerId)?.fullName)
      || (newContract.proposalId ? dataService.getProposalById(newContract.proposalId)?.customerName : undefined)
    : undefined;
  const clientListed = newContract.customerType === 'company'
    ? companies.some((c) => c.id === newContract.customerId)
    : clients.some((c) => c.id === newContract.customerId);

  // The proposal may arrive from Firestore after the first render
  const linkedId = linkedProposal?.id;
  useEffect(() => {
    if (!linkedId) return;
    const p = dataService.getProposalById(linkedId);
    if (p) {
      applyProposal(p);
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

  // One save at a time (the contract number comes from the server; repeat clicks made duplicates)
  const creatingRef = useRef(false);
  const [creatingContract, setCreatingContract] = useState(false);
  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreatingContract(true);
    try {
      await createContract();
    } finally {
      creatingRef.current = false;
      setCreatingContract(false);
    }
  };

  const createContract = async () => {
    const problems = [
      !newContract.customerId && 'Choose the client.',
      !(Number(newContract.totalContractValue) > 0) && 'Enter the contract value.',
      newContract.endDate < newContract.startDate && 'The end date cannot be before the start date.',
    ].filter(Boolean) as string[];
    if (problems.length) { error('Please correct the contract', problems.join(' ')); return; }
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
    // Guard: an active contract of the same type for this client / branch / site
    const activeConflict = conflictFor(newContract);
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
      customerName = co?.legalCompanyName || formClientName || 'Corporate Company';
      if (newContract.branchId) {
        const br = dataService.getBranchById(newContract.branchId);
        branchName = br?.branchName;
      }
    } else {
      const cl = dataService.getClientById(newContract.customerId);
      customerName = cl?.fullName || formClientName || 'Individual Client';
    }

    const sites = formSites;
    // Shared counter: never reuse (and overwrite) a contract this person can't see
    const nextId = await dataService.newRecordId('CT', 'contract', contracts.map((c) => c.id), 'contracts');

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
      // The chosen site; else the client's only / first site; never a made-up id
      siteIds: newContract.siteId ? [newContract.siteId] : sites.length > 0 ? [sites[0].id] : [],
      startDate: newContract.startDate,
      endDate: newContract.endDate,
      frequency: newContract.frequency,
      totalContractValue: Number(newContract.totalContractValue),
      // Before tax, from the proposal (billing adds tax on the invoice, so it is never taxed twice)
      ...(sourceProposal ? { valueBeforeTax: proposalValueBeforeTax(sourceProposal) } : {}),
      billingTerm: newContract.billingTerm,
      billingCycleDays: newContract.contractType === 'one_time' ? 0 : Number(newContract.billingCycleDays) || 0,
      clientPoNumber: (newContract.clientPoNumber || '').trim() || undefined,
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
  // Planning the visit schedule is dispatch work: Operations Manager, admin and CEO only (not CRO / Finance)
  const canSchedule = canEditModule(effectiveRole, 'jobs') && !['team_leader', 'technician'].includes(baseRoleOf(effectiveRole) ?? '');
  const handleGenerateSchedule = (contract: Contract) => setScheduleFor(contract);

  // Step 15: 60 days before tenureEnd: clone contract and create renewal proposal
  const handleRenewContract = async (contract: Contract) => {
    const prevStart = new Date(contract.startDate);
    const prevEnd = new Date(contract.endDate);
    const durationMs = Math.max(30 * 86400000, prevEnd.getTime() - prevStart.getTime());
    const newStart = contract.endDate;
    const newEnd = isoDay(new Date(new Date(newStart).getTime() + durationMs));

    // 1. Create a renewal proposal carrying forward the service plan, scope, and rates
    const origProp = contract.proposalId ? dataService.getProposalById(contract.proposalId) : undefined;
    const propId = await dataService.newRecordId('P', 'proposal', proposals.map((p) => p.id), 'proposals');
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
    const nextContractId = await dataService.newRecordId('CT', 'contract', contracts.map((c) => c.id), 'contracts');
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
    if (!cancelEffectiveDate) { error('Date required', 'Choose the last day of service.'); return; }
    const reasonText = cancelReason.trim();
    if (canDirectAction) {
      const ts = new Date().toISOString();
      const before = dataService.getJobs().filter((j) => j.contractId === cancelModal.id && j.status === 'scheduled').length;
      dataService.cancelContract(cancelModal.id, {
        category: cancelCategory,
        reason: reasonText,
        effectiveDate: cancelEffectiveDate,
        requestedBy: userProfile?.email ?? '',
        requestedByName: userProfile?.displayName ?? 'Admin',
        requestedAt: ts,
        approvedBy: userProfile?.email ?? '',
        approvedByName: userProfile?.displayName ?? 'Admin',
        cancelledAt: ts,
      }, userProfile?.email);
      const after = dataService.getJobs().filter((j) => j.contractId === cancelModal.id && j.status === 'scheduled').length;
      success('Contract cancelled', `${cancelModal.id} has been cancelled. ${before - after} scheduled visit(s) after ${formatDate(cancelEffectiveDate)} were cancelled.`);
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
        reason: `[${CONTRACT_CANCEL_CATEGORY_LABELS[cancelCategory]}] ${reasonText} (last service day ${formatDate(cancelEffectiveDate)})`,
        cancelCategory,
        effectiveDate: cancelEffectiveDate,
        status: 'pending',
        updatedAt: new Date().toISOString(),
      };
      dataService.saveApproval(approval, userProfile?.email);
      success('Cancellation requested', `Approval ${approvalId} submitted — awaiting manager decision.`);
    }
    closeCancelModal();
  }

  function openCancelModal(c: Contract) {
    setCancelModal(c);
    setCancelReason('');
    setCancelCategory('client_request');
    setCancelEffectiveDate(isoDay(new Date()));
  }

  function closeCancelModal() {
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
          <button className="btn btn-primary" onClick={openNewContract}>
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
          {canReviseContract && (
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
                      {canSchedule && <button
                        className={hasJobs ? 'btn btn-secondary' : 'btn btn-primary'}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                        title={hasJobs ? 'Edit or regenerate the visit schedule for this contract' : 'Generate all scheduled visit jobs across contract term'}
                        onClick={() => handleGenerateSchedule(c)}
                      >
                        <Calendar size={12} />
                        <span>{hasJobs ? 'Edit Schedule' : 'Generate Schedule'}</span>
                      </button>}

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
                          onClick={() => openCancelModal(c)}
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
            // Accepted proposals, of the chosen client once one is chosen
            const accepted = proposals.filter((p) => p.status === 'accepted' && (!newContract.customerId || newContract.proposalId === p.id || p.customerId === newContract.customerId));
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
                    applyProposal(p);
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
            const conflict = newContract.customerId ? conflictFor(newContract) : undefined;
            const active = conflict ? [conflict] : [];
            if (active.length === 0) return null;
            const daysLeft = Math.ceil((new Date(active[0].endDate).getTime() - Date.now()) / 86400000);
            const nearExpiry = daysLeft <= 30;
            return (
              <div className="error-hint" style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Cannot create a new contract.</strong>
                    {' '}{active[0].id} ({active[0].contractType === 'one_time' ? 'one-time' : 'AMC'}) is already active for this client{newContract.branchId ? ' / branch' : ''} ({daysLeft > 0 ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining` : 'expires today'}).
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
              <button type="button" className={`chip ${newContract.customerType === 'company' ? 'chip-on' : ''}`} onClick={() => setNewContract({ ...newContract, customerType: 'company', customerId: '', branchId: '', siteId: '' })}>Company</button>
              <button type="button" className={`chip ${newContract.customerType === 'individual' ? 'chip-on' : ''}`} onClick={() => setNewContract({ ...newContract, customerType: 'individual', customerId: '', branchId: '', siteId: '' })}>Individual / residential</button>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Client <span className="required">*</span></label>
            <select
              className="form-select"
              value={newContract.customerId}
              onChange={(e) => setNewContract({ ...newContract, customerId: e.target.value, branchId: '', siteId: '', proposalId: '' })}
            >
              <option value="">Choose the client…</option>
              {newContract.customerId && !clientListed && (
                <option value={newContract.customerId}>{formClientName || newContract.customerId} (from the proposal)</option>
              )}
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
                  onChange={(e) => setNewContract({ ...newContract, branchId: e.target.value, siteId: '' })}
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

          {newContract.customerId && (
            <div className="form-group">
              <label className="form-label">Site / premises</label>
              {formSites.length ? (
                <select className="form-select" value={newContract.siteId || formSites[0].id} onChange={(e) => setNewContract({ ...newContract, siteId: e.target.value })}>
                  {formSites.map((st) => <option key={st.id} value={st.id}>{st.siteName}{st.area ? ` · ${st.area}` : ''}{st.city ? `, ${st.city}` : ''}</option>)}
                </select>
              ) : (
                <div className="cell-sub" style={{ color: '#B45309' }}>
                  This client has no site / premises on record. Add it on the client's page so visits and reports show the right address.
                </div>
              )}
            </div>
          )}
          {newContract.customerType === 'individual' && newContract.customerId && (
            <div className="info-hint" style={{ marginBottom: '0.75rem' }}>
              Residential client: billed by <strong>cash memo</strong> (no sales tax line), for the amount agreed in the proposal.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Contract Type</label>
              <select
                className="form-select"
                value={newContract.contractType}
                onChange={(e) => {
                  const t = e.target.value as ContractType;
                  setNewContract(t === 'one_time'
                    ? { ...newContract, contractType: t, frequency: 'one_off', billingTerm: 'per_service', billingCycleDays: 0, endDate: newContract.startDate }
                    : { ...newContract, contractType: t, frequency: newContract.frequency === 'one_off' ? 'monthly' : newContract.frequency, billingTerm: 'monthly_billing',
                        endDate: newContract.endDate <= newContract.startDate ? isoDay(new Date(new Date(newContract.startDate).getTime() + 365 * 86400000)) : newContract.endDate });
                }}
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

            {newContract.contractType === 'one_time' ? (
              <div className="form-group">
                <label className="form-label">Invoicing</label>
                <div className="cell-sub" style={{ paddingTop: '0.5rem' }}>One-time job: invoiced once, for the full value, after the visit.</div>
              </div>
            ) : (
            <div className="form-group">
              <label className="form-label">Invoice every</label>
              <BillingCycleInput
                value={newContract.billingCycleDays ?? 0}
                onChange={(days) => setNewContract({ ...newContract, billingCycleDays: days })}
              />
              <span className="cell-sub">From the proposal. One invoice per cycle covers all visits done in it.</span>
            </div>
            )}

            <div className="form-group">
              <label className="form-label">Client PO / vendor No.</label>
              <input className="form-input" value={newContract.clientPoNumber ?? ''} placeholder="Printed on every invoice (optional)"
                onChange={(e) => setNewContract({ ...newContract, clientPoNumber: e.target.value })} />
            </div>

            <div className="form-group">
              <label className="form-label">Total contract value (PKR, incl. tax) <span className="required">*</span></label>
              <input
                type="number"
                required
                min={1}
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
                min={newContract.startDate}
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
              <label className="form-label">Assign Supervisor <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — can be changed later)</span></label>
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
                  <option key={u.uid} value={u.uid}>{u.displayName} ({roleLabel(u.role)})</option>
                ))}
              </select>
            </div>
          )}

          {(() => {
            const hasActiveConflict = Boolean(newContract.customerId && conflictFor(newContract));
            return (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewContractModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={hasActiveConflict || creatingContract || !newContract.customerId} title={hasActiveConflict ? 'An active contract already exists for this client / branch' : undefined}>
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
              {canReviseContract && (
                <button
                  className="btn btn-outline-emerald"
                  onClick={() => handleRenewContract(selectedContract)}
                >
                  <RotateCw size={14} />
                  <span>Renew AMC</span>
                </button>
              )}
              {!canReviseContract && <span />}

              {selectedContract.status === 'cancelled' && (canEditModule(effectiveRole, 'invoices') || baseRoleOf(effectiveRole) === 'super_admin') && (
                <button
                  className="btn btn-primary"
                  title={baseRoleOf(effectiveRole) === 'super_admin' ? 'Decide the final invoice: done services only or the full month' : 'Report the cancellation settlement to the super admin'}
                  onClick={() => { setSettleContract(selectedContract); setSelectedContract(null); }}
                >
                  <Ban size={14} />
                  <span>Cancellation settlement</span>
                </button>
              )}
              {selectedContract.status !== 'cancelled' && canEditModule(effectiveRole, 'invoices') && (
                <button
                  className="btn btn-secondary"
                  title={`Invoice this contract's billing periods (${billingCycleLabel(selectedContract.billingCycleDays).toLowerCase()}): visits done in each period on one invoice`}
                  onClick={() => navigate('/finance/invoices?tab=jobs')}
                >
                  <Calendar size={14} />
                  <span>Bill contract</span>
                </button>
              )}

              {canSchedule && <button
                className="btn btn-primary"
                onClick={() => {
                  handleGenerateSchedule(selectedContract);
                  setSelectedContract(null);
                }}
              >
                <Calendar size={14} />
                <span>{selectedContract.totalJobsScheduled > 0 ? 'Edit Visit Schedule' : 'Generate Visit Schedule'}</span>
              </button>}
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
            {selectedContract.status === 'cancelled' && selectedContract.cancellation && (
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--ikpm-rose-100)', color: '#991B1B', borderRadius: 'var(--radius-md)' }}>
                <strong>Cancelled — {CONTRACT_CANCEL_CATEGORY_LABELS[selectedContract.cancellation.category] || selectedContract.cancellation.category}.</strong>{' '}
                {selectedContract.cancellation.reason}
                <div className="cell-sub" style={{ marginTop: '0.25rem' }}>
                  Last service day {formatDate(selectedContract.cancellation.effectiveDate)} · requested by {selectedContract.cancellation.requestedByName}
                  {selectedContract.cancellation.approvedByName ? ` · approved by ${selectedContract.cancellation.approvedByName}` : ''}
                </div>
              </div>
            )}
            {selectedContract.servicePlan?.length ? (
              <div>
                <div className="section-title" style={{ marginTop: 0 }}>Monthly IPM service plan</div>
                <div className="table-container">
                  <table className="data-table">
                    <thead><tr><th style={{ width: 36 }}>#</th><th>Service</th><th>Frequency</th></tr></thead>
                    <tbody>
                      {selectedContract.servicePlan.map((r, i) => <tr key={r.id}><td>{i + 1}</td><td>{r.service}{r.formula?.trim() && <div className="cell-sub">{r.formula}</div>}</td><td>{r.frequency}</td></tr>)}
                    </tbody>
                  </table>
                </div>
                <dl className="detail-list" style={{ marginTop: '0.75rem' }}>
                  <dt>Visits / month</dt><dd>{selectedContract.serviceVisitsPerMonth ?? '—'} service · {selectedContract.followUpVisitsPerMonth ?? 0} follow-up</dd>
                  {canSeeFinancials && selectedContract.monthlyRate ? (<><dt>Monthly rate</dt><dd>{formatPKR(selectedContract.monthlyRate)} ({selectedContract.taxMode === 'inclusive' ? 'incl.' : 'excl.'} {selectedContract.taxPercent ?? 0}% tax)</dd></>) : null}
                  {canSeeFinancials ? (<><dt>Invoiced</dt><dd>{billingCycleLabel(selectedContract.billingCycleDays)}</dd></>) : null}
                  {selectedContract.clientPoNumber ? (<><dt>Client PO</dt><dd>{selectedContract.clientPoNumber}</dd></>) : null}
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
                  {String(selectedContract.contractType ?? '').replace('_', ' ')} ({selectedContract.frequency})
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

      {settleContract && (
        <CancellationSettlementModal contract={settleContract} onClose={() => setSettleContract(null)} />
      )}

      {/* Modal: Cancel Contract */}
      {cancelModal && (
        <Modal
          isOpen
          onClose={closeCancelModal}
          title={canDirectAction ? 'Cancel Contract' : 'Request Contract Cancellation'}
          subtitle={`${cancelModal.id} — ${cancelModal.customerName}`}
          maxWidth="480px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={closeCancelModal}>Back</button>
              <button className="btn btn-danger" onClick={handleCancelContract} disabled={!cancelReason.trim() || !cancelEffectiveDate}>
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Reason category <span className="required">*</span></label>
                <select className="form-select" value={cancelCategory} onChange={(e) => setCancelCategory(e.target.value as ContractCancelCategory)}>
                  {(Object.keys(CONTRACT_CANCEL_CATEGORY_LABELS) as ContractCancelCategory[]).map((k) => (
                    <option key={k} value={k}>{CONTRACT_CANCEL_CATEGORY_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Last day of service <span className="required">*</span></label>
                <input type="date" className="form-input" value={cancelEffectiveDate} min={cancelModal.startDate}
                  onChange={(e) => setCancelEffectiveDate(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Cancellation details <span className="required">*</span></label>
              <textarea className="form-input" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                placeholder="What happened? This is kept on the contract and shown on the final invoice." />
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Visits scheduled after the last day of service are cancelled. Visits already done stay billable.
            </p>
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
