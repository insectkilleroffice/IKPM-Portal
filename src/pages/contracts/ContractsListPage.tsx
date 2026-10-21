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
  ShieldCheck,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { formatPKR, formatDate, generatePermanentId } from '../../lib/formatters';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import type { Contract, ContractType, ServiceFrequency } from '../../types/operations';
import { getContractNextAction } from '../../lib/workflow';
import { frequencyForVisits } from '../../lib/proposalPlan';
import { packStatus } from '../../lib/onboarding';
import { ScheduleGeneratorModal } from '../../features/schedule/ScheduleGeneratorModal';
import type { Proposal } from '../../types/proposal';

const isoDay = (d: Date) => d.toISOString().split('T')[0];

/** Contract form values from a proposal (plan proposals carry tenure, visits and pricing). */
function fromProposal(p: Proposal) {
  const plan = Boolean(p.servicePlan?.length);
  const start = p.tenureStart || isoDay(new Date());
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

export const ContractsListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { success, warning, info } = useNotification();
  const { userProfile } = useAuth();
  useDataStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Contract | null>(null);
  const [showNewContractModal, setShowNewContractModal] = useState(
    searchParams.get('action') === 'new_contract' || Boolean(searchParams.get('fromProposal'))
  );

  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const proposals = dataService.getProposals();

  // If fromProposal is provided, find and prefill
  const fromPropId = searchParams.get('fromProposal');
  const linkedProposal = fromPropId ? dataService.getProposalById(fromPropId) : undefined;

  const [newContract, setNewContract] = useState(() =>
    linkedProposal
      ? fromProposal(linkedProposal)
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
        }
  );

  // The proposal may arrive from Firestore after the first render
  const linkedId = linkedProposal?.id;
  useEffect(() => {
    if (!linkedId) return;
    const p = dataService.getProposalById(linkedId);
    if (p) {
      setNewContract(fromProposal(p));
      setShowNewContractModal(true);
    }
  }, [linkedId]);

  const contracts = dataService.getContracts();

  // Check 60-day AMC expiry warnings (Step 15)
  const expiringContracts = contracts.filter((c) => {
    if (c.status !== 'active') return false;
    const end = new Date(c.endDate);
    const diffDays = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diffDays <= 60 && diffDays >= 0;
  });

  const filtered = contracts.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.id.toLowerCase().includes(q) ||
      c.customerName.toLowerCase().includes(q) ||
      (c.branchName && c.branchName.toLowerCase().includes(q))
    );
  });

  const handleCreateContract = (e: React.FormEvent) => {
    e.preventDefault();
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
      status: 'active',
      renewalAlertDate: new Date(new Date(newContract.endDate).getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    dataService.saveContract(created, userProfile?.email);
    success('Contract Registered & Activated', `Contract ${created.id} created for ${created.customerName}`);
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
      `Cloned as Contract ${clonedContract.id} & generated Renewal Proposal ${renewalProposal.id} for term ${formatDate(newStart)} to ${formatDate(newEnd)}.`
    );
  };

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

        <button className="btn btn-primary" onClick={() => setShowNewContractModal(true)}>
          <Plus size={16} />
          <span>+ Create New Contract</span>
        </button>
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
        </div>
      )}

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
              <th>Contract Value</th>
              <th>Visit Schedule</th>
              <th>Status</th>
              <th>Next Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const nextAct = getContractNextAction(c);
              const hasJobs = (c.totalJobsScheduled || 0) > 0;

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
                  <td style={{ fontWeight: 700 }}>{formatPKR(c.totalContractValue)}</td>
                  <td>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                      {c.totalJobsCompleted || 0} / {c.totalJobsScheduled || 0} completed
                    </div>
                    {!hasJobs && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--ikpm-amber-600)', fontWeight: 600 }}>
                        Visits not generated yet
                      </div>
                    )}
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      {!hasJobs ? (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                          title="Generate all scheduled visit jobs across contract term"
                          onClick={() => handleGenerateSchedule(c)}
                        >
                          <Calendar size={12} />
                          <span>Generate Schedule</span>
                        </button>
                      ) : (
                        <button
                          className="btn btn-outline-emerald"
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                          title="View all jobs for this contract in Operations"
                          onClick={() => navigate('/operations/jobs')}
                        >
                          <Truck size={12} />
                          <span>View Jobs ({c.totalJobsScheduled})</span>
                        </button>
                      )}

                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                        onClick={() => setSelectedContract(c)}
                      >
                        Details
                      </button>
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
        title="Register & Activate Service Contract"
        subtitle={linkedProposal ? `Pre-filled from Approved Proposal ${linkedProposal.id}` : 'Create Annual Maintenance Agreement (AMC)'}
        maxWidth="680px"
      >
        <form onSubmit={handleCreateContract}>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Client Type</label>
              <select
                className="form-select"
                value={newContract.customerType}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setNewContract({
                    ...newContract,
                    customerType: val,
                    customerId: val === 'company' ? companies[0]?.id || '' : clients[0]?.id || '',
                  });
                }}
              >
                <option value="company">Corporate Company</option>
                <option value="individual">Individual Client</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Select Customer Account <span className="required">*</span></label>
              <select
                className="form-select"
                value={newContract.customerId}
                onChange={(e) => setNewContract({ ...newContract, customerId: e.target.value })}
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
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Contract Type</label>
              <select
                className="form-select"
                value={newContract.contractType}
                onChange={(e) => setNewContract({ ...newContract, contractType: e.target.value as any })}
              >
                <option value="amc_recurring">Annual AMC (Recurring)</option>
                <option value="one_time">One-Time Project</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Service Frequency</label>
              <select
                className="form-select"
                value={newContract.frequency}
                onChange={(e) => setNewContract({ ...newContract, frequency: e.target.value as any })}
              >
                <option value="monthly">Monthly (12 visits/yr)</option>
                <option value="bi_monthly">Bi-Monthly (6 visits/yr)</option>
                <option value="quarterly">Quarterly (4 visits/yr)</option>
                <option value="fortnightly">Fortnightly (24 visits/yr)</option>
                <option value="weekly">Weekly (52 visits/yr)</option>
                <option value="one_off">One-Off Job</option>
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowNewContractModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              <FileSignature size={15} />
              <span>Register & Activate Contract</span>
            </button>
          </div>
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
              <button
                className="btn btn-outline-emerald"
                onClick={() => handleRenewContract(selectedContract)}
              >
                <RotateCw size={14} />
                <span>Renew AMC</span>
              </button>

              <button
                className="btn btn-primary"
                onClick={() => {
                  handleGenerateSchedule(selectedContract);
                  setSelectedContract(null);
                }}
              >
                <Calendar size={14} />
                <span>Generate Visit Schedule</span>
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
                  {selectedContract.monthlyRate ? (<><dt>Monthly rate</dt><dd>{formatPKR(selectedContract.monthlyRate)} ({selectedContract.taxMode === 'inclusive' ? 'incl.' : 'excl.'} {selectedContract.taxPercent ?? 0}% tax)</dd></>) : null}
                  {selectedContract.paymentTermsDays ? (<><dt>Payment</dt><dd>Within {selectedContract.paymentTermsDays} days of invoice</dd></>) : null}
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
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Contract Value:</span>
                <div style={{ fontWeight: 700, color: 'var(--ikpm-emerald-600)' }}>
                  {formatPKR(selectedContract.totalContractValue)}
                </div>
              </div>
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
    </div>
  );
};
