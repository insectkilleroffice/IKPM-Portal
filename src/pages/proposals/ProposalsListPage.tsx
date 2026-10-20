import React, { useState } from 'react';
import { useDataStore } from '../../hooks/useDataStore';
import { SendDocumentsModal } from '../../features/outreach/SendDocumentsModal';
import { OutreachHistory } from '../../features/outreach/OutreachHistory';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Download,
  CheckCircle2,
  History,
  Send,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { formatPKR, generatePermanentId } from '../../lib/formatters';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import type { Proposal, ProposalLineItem, TemplateType } from '../../types/proposal';

export const ProposalsListPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { success, error, warning } = useNotification();
  const { userProfile, canApproveProposals } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('filter') || 'all');
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);

  const [showBuilderModal, setShowBuilderModal] = useState(searchParams.get('action') === 'new_proposal');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [sendTarget, setSendTarget] = useState<Proposal | null>(null);
  useDataStore();

  const canSend = (p: Proposal) => ['approved', 'draft', 'sent_to_client', 'negotiation'].includes(p.status);

  const recipientFor = (p: Proposal) => {
    if (p.customerType === 'company') {
      const branch = p.branchId ? dataService.getBranchById(p.branchId) : undefined;
      if (branch) return { name: branch.branchManagerName, phone: branch.branchManagerPhone || branch.branchPhone, email: branch.branchEmail };
      const co = dataService.getCompanyById(p.customerId);
      return { name: co?.primaryContact.fullName || p.customerName, phone: co?.primaryContact.mobile, email: co?.primaryContact.email };
    }
    const cl = dataService.getClientById(p.customerId);
    return { name: cl?.fullName || p.customerName, phone: cl?.primaryPhone, email: cl?.email };
  };

  const markSent = (p: Proposal) => {
    if (p.status === 'sent_to_client' || p.status === 'negotiation') return;
    const updated: Proposal = { ...p, status: 'sent_to_client', sentDate: new Date().toISOString() };
    dataService.saveProposal(updated, userProfile?.email);
    if (selectedProposal?.id === p.id) setSelectedProposal(updated);
  };

  // New Proposal Form State
  const companies = dataService.getCompanies();
  const clients = dataService.getClients();

  const [selectedCustomerType, setSelectedCustomerType] = useState<'company' | 'individual'>('company');
  const [selectedCustomerId, setSelectedCustomerId] = useState(companies[0]?.id || '');
  const [selectedBranchId] = useState('');
  const [templateType, setTemplateType] = useState<TemplateType>('commercial_kitchen');
  const [scopeOfWork, setScopeOfWork] = useState(
    'Complete Integrated Pest Management (IPM) for facility perimeter, kitchen storage, and production floor.'
  );
  const [discountPercent, setDiscountPercent] = useState<number>(5);
  const [taxPercent, setTaxPercent] = useState<number>(13);
  const [paymentTerms] = useState('30 Days Net from date of monthly tax invoice');
  const [warrantyMonths] = useState(12);

  const [lineItems, setLineItems] = useState<ProposalLineItem[]>([
    {
      id: 'li_1',
      serviceName: 'German Cockroach Gel Matrix Treatment',
      targetPest: 'cockroaches',
      chemicalsSuggested: 'Maxforce FC Magnum Gel (Hydramethylnon)',
      treatmentMethod: 'Precision Micro-Dot Application',
      quantity: 1,
      unitPrice: 35000,
      totalPrice: 35000,
      frequency: 'Monthly',
    },
  ]);

  const proposals = dataService.getProposals();

  const filteredProposals = proposals.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      p.id.toLowerCase().includes(q) ||
      p.customerName.toLowerCase().includes(q) ||
      (p.branchName && p.branchName.toLowerCase().includes(q));

    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const subtotal = lineItems.reduce((acc, curr) => acc + curr.totalPrice, 0);
  const discountAmount = (subtotal * discountPercent) / 100;
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = (taxableAmount * taxPercent) / 100;
  const totalAmount = taxableAmount + taxAmount;

  const handleAddLineItem = () => {
    setLineItems([
      ...lineItems,
      {
        id: `li_${Date.now()}`,
        serviceName: 'Subterranean Termite Perimeter Injection',
        targetPest: 'termites',
        chemicalsSuggested: 'Premise 200SC (Imidacloprid)',
        treatmentMethod: 'Drill & Pressure Sub-Slab Injection',
        quantity: 1,
        unitPrice: 45000,
        totalPrice: 45000,
        frequency: 'One-Time with Warranty',
      },
    ]);
  };

  const handleCreateProposal = (e: React.FormEvent) => {
    e.preventDefault();
    let customerName = '';
    let branchName: string | undefined = undefined;

    if (selectedCustomerType === 'company') {
      const co = dataService.getCompanyById(selectedCustomerId);
      customerName = co?.legalCompanyName || 'Corporate Client';
      if (selectedBranchId) {
        const br = dataService.getBranchById(selectedBranchId);
        branchName = br?.branchName;
      }
    } else {
      const cl = dataService.getClientById(selectedCustomerId);
      customerName = cl?.fullName || 'Individual Client';
    }

    const nextId = generatePermanentId('P', proposals.length + 1);
    const created: Proposal = {
      id: nextId,
      revisionNumber: 0,
      templateType,
      customerType: selectedCustomerType,
      customerId: selectedCustomerId,
      customerName,
      branchId: selectedBranchId || undefined,
      branchName,
      preparedByUserId: userProfile?.uid || 'admin',
      preparedByName: userProfile?.displayName || 'Salman (CEO)',
      scopeOfWork,
      warrantyPeriodMonths: warrantyMonths,
      lineItems,
      subtotal,
      discountPercent,
      discountAmount,
      taxPercent,
      taxAmount,
      totalAmount,
      validityDays: 30,
      paymentTerms,
      status: discountPercent > 10 ? 'pending_approval' : 'draft',
      revisionsHistory: [
        {
          revisionNumber: 0,
          timestamp: new Date().toISOString(),
          changedBy: userProfile?.email || 'admin',
          changedByName: userProfile?.displayName || 'Admin',
          changeReason: 'Initial proposal submission',
          subtotal,
          discountPercent,
          totalAmount,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    dataService.saveProposal(created, userProfile?.email);
    if (created.status === 'pending_approval') {
      warning('Approval Required (AP-01)', `Discount ${discountPercent}% exceeds 10% threshold. Sent to Sales Manager / CEO for authorization.`);
    } else {
      success('Proposal Created', `${created.id} is ready for client review.`);
    }
    setShowBuilderModal(false);
  };

  const handleApprove = (proposal: Proposal) => {
    if (!canApproveProposals()) {
      error('Access Denied', 'Only Management or Sales Managers can approve escalated proposals.');
      return;
    }
    const updated: Proposal = {
      ...proposal,
      status: 'approved',
      approval: proposal.approval
        ? {
            ...proposal.approval,
            status: 'approved',
            decisionAt: new Date().toISOString(),
            decisionBy: userProfile?.email,
            decisionByName: userProfile?.displayName,
          }
        : undefined,
    };
    dataService.saveProposal(updated, userProfile?.email);
    success('Proposal Approved', `${proposal.id} is authorized and ready to send.`);
    setSelectedProposal(updated);
  };

  const handleReject = (reason: string) => {
    if (!selectedProposal) return;
    const updated: Proposal = {
      ...selectedProposal,
      status: 'rejected',
      approval: selectedProposal.approval
        ? {
            ...selectedProposal.approval,
            status: 'rejected',
            decisionAt: new Date().toISOString(),
            decisionBy: userProfile?.email,
            decisionByName: userProfile?.displayName,
            rejectionReason: reason,
          }
        : undefined,
    };
    dataService.saveProposal(updated, userProfile?.email);
    error('Proposal Rejected', `Proposal ${selectedProposal.id} marked rejected with reason.`);
    setSelectedProposal(updated);
  };

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Proposals & Quotations' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Proposals & Revision History</h1>
          <p className="page-subtitle">
            IPM chemical service quotations, discount escalation workflows, immutable revision history, and printable PDF documents.
          </p>
        </div>

        <button className="btn btn-primary" onClick={() => setShowBuilderModal(true)}>
          <Plus size={16} />
          <span>+ Draft IPM Proposal</span>
        </button>
      </div>

      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {['all', 'draft', 'pending_approval', 'approved', 'sent_to_client', 'accepted', 'rejected'].map((st) => (
            <button
              key={st}
              className={`btn ${statusFilter === st ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
              onClick={() => setStatusFilter(st)}
            >
              {st.replace(/_/g, ' ').toUpperCase()}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: '260px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search proposals..."
            className="form-input"
            style={{ paddingLeft: '2.2rem', height: '34px', fontSize: '0.8rem' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Proposal ID & Rev</th>
              <th>Customer Name</th>
              <th>Branch / Site</th>
              <th>Scope Template</th>
              <th>Prepared By</th>
              <th>Discount %</th>
              <th>Total Value</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProposals.map((p) => (
              <tr key={p.id}>
                <td>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.id}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)', fontFamily: 'monospace' }}>
                    Revision R{p.revisionNumber}
                  </div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{p.customerName}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {p.customerType}
                  </div>
                </td>
                <td>{p.branchName || 'Company HQ / Residence'}</td>
                <td>
                  <span className="badge-status badge-slate">{p.templateType.replace('_', ' ')}</span>
                </td>
                <td>{p.preparedByName}</td>
                <td>
                  {p.discountPercent > 10 ? (
                    <span className="badge-status badge-amber">{p.discountPercent}% (AP-01 Escalated)</span>
                  ) : (
                    <span>{p.discountPercent}%</span>
                  )}
                </td>
                <td style={{ fontWeight: 700 }}>{formatPKR(p.totalAmount)}</td>
                <td><StatusBadge status={p.status} /></td>
                <td>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      className="btn btn-outline-emerald"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                      onClick={() => setSelectedProposal(p)}
                    >
                      View
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                      title="Download Official Proposal PDF"
                      onClick={() => pdfGenerator.generateProposalPDF(p)}
                    >
                      <Download size={13} />
                    </button>
                    {canSend(p) && (
                      <button
                        className="btn btn-primary"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                        title="Send proposal + company documents via WhatsApp / Email"
                        onClick={() => setSendTarget(p)}
                      >
                        <Send size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal: Proposal Builder */}
      <Modal
        isOpen={showBuilderModal}
        onClose={() => setShowBuilderModal(false)}
        title="Draft IPM Service Proposal & Quotation"
        subtitle="Automatic discount evaluation (Approval Matrix AP-01). Generates client-ready PDF."
        maxWidth="740px"
      >
        <form onSubmit={handleCreateProposal}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Client Type</label>
              <select
                className="form-select"
                value={selectedCustomerType}
                onChange={(e) => {
                  setSelectedCustomerType(e.target.value as any);
                  if (e.target.value === 'company') {
                    setSelectedCustomerId(companies[0]?.id || '');
                  } else {
                    setSelectedCustomerId(clients[0]?.id || '');
                  }
                }}
              >
                <option value="company">Corporate / Commercial Company</option>
                <option value="individual">Individual Client</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Select Customer Account <span className="required">*</span></label>
              <select
                className="form-select"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
              >
                {selectedCustomerType === 'company'
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">IPM Treatment Template</label>
              <select
                className="form-select"
                value={templateType}
                onChange={(e) => setTemplateType(e.target.value as any)}
              >
                <option value="commercial_kitchen">Commercial Kitchen & Food Facility IPM</option>
                <option value="termite_proofing">Pre/Post Construction Termite Proofing</option>
                <option value="bedbug_eradication">Bedbug Eradication & Thermal Treatment</option>
                <option value="rodent_control">Industrial Rodent Bait Station Management</option>
                <option value="general_ipm">General Cockroach & Mosquito Fogging</option>
                <option value="fumigation_export">Export Cargo & Warehouse Fumigation</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Provincial Sales Tax Jurisdiction</label>
              <select
                className="form-select"
                value={taxPercent}
                onChange={(e) => setTaxPercent(Number(e.target.value))}
              >
                <option value={13}>Sindh Revenue Board (SRB) — 13%</option>
                <option value={16}>Punjab Revenue Authority (PRA) — 16%</option>
                <option value={15}>Islamabad ICT (Federal FBR) — 15%</option>
                <option value={0}>Exempt / Zero-Rated</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Treatment Scope Description <span className="required">*</span></label>
            <textarea
              className="form-textarea"
              rows={2}
              value={scopeOfWork}
              onChange={(e) => setScopeOfWork(e.target.value)}
            />
          </div>

          {/* Line Items */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--ikpm-navy-900)' }}>
                Service Line Items & Chemicals
              </h4>
              <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }} onClick={handleAddLineItem}>
                + Add Service Line
              </button>
            </div>

            {lineItems.map((item, idx) => (
              <div
                key={item.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 1.2fr 80px 100px',
                  gap: '0.75rem',
                  alignItems: 'center',
                  marginBottom: '0.5rem',
                  backgroundColor: 'var(--bg-surface-alt)',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <input
                  type="text"
                  className="form-input"
                  style={{ height: '32px', fontSize: '0.8rem' }}
                  value={item.serviceName}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[idx].serviceName = e.target.value;
                    setLineItems(next);
                  }}
                />
                <input
                  type="text"
                  className="form-input"
                  style={{ height: '32px', fontSize: '0.8rem' }}
                  value={item.chemicalsSuggested}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[idx].chemicalsSuggested = e.target.value;
                    setLineItems(next);
                  }}
                />
                <input
                  type="number"
                  min="1"
                  className="form-input"
                  style={{ height: '32px', fontSize: '0.8rem' }}
                  value={item.quantity}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[idx].quantity = Number(e.target.value);
                    next[idx].totalPrice = next[idx].quantity * next[idx].unitPrice;
                    setLineItems(next);
                  }}
                />
                <input
                  type="number"
                  className="form-input"
                  style={{ height: '32px', fontSize: '0.8rem' }}
                  value={item.unitPrice}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[idx].unitPrice = Number(e.target.value);
                    next[idx].totalPrice = next[idx].quantity * next[idx].unitPrice;
                    setLineItems(next);
                  }}
                />
              </div>
            ))}
          </div>

          {/* Pricing Summary */}
          <div style={{ backgroundColor: 'var(--bg-surface-alt)', padding: '1rem', borderRadius: 'var(--radius-md)', marginTop: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem' }}>
              <div>
                <label className="form-label">
                  Discount Percentage ({discountPercent}%)
                  {discountPercent > 10 && (
                    <span style={{ color: 'var(--ikpm-amber-500)', marginLeft: '6px' }}>(Triggers AP-01 Escalation)</span>
                  )}
                </label>
                <input
                  type="range"
                  min="0"
                  max="35"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div>Subtotal: <strong>{formatPKR(subtotal)}</strong></div>
                {discountPercent > 0 && <div style={{ color: 'var(--ikpm-rose-500)' }}>Discount: -{formatPKR(discountAmount)}</div>}
                <div>Sales Tax ({taxPercent}%): <strong>{formatPKR(taxAmount)}</strong></div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginTop: '4px' }}>
                  Grand Total: {formatPKR(totalAmount)}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowBuilderModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Generate IPM Proposal
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Details, Approval & Revision */}
      {selectedProposal && (
        <Modal
          isOpen={Boolean(selectedProposal)}
          onClose={() => setSelectedProposal(null)}
          title={`Proposal ${selectedProposal.id} (Revision R${selectedProposal.revisionNumber})`}
          subtitle={`Client: ${selectedProposal.customerName} • Status: ${selectedProposal.status.toUpperCase()}`}
          maxWidth="700px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <button
                className="btn btn-secondary"
                onClick={() => pdfGenerator.generateProposalPDF(selectedProposal)}
              >
                <Download size={14} />
                <span>Export PDF</span>
              </button>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {selectedProposal.status === 'pending_approval' && canApproveProposals() && (
                  <>
                    <button
                      className="btn btn-danger"
                      onClick={() => setShowRejectDialog(true)}
                    >
                      Reject
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleApprove(selectedProposal)}
                    >
                      <CheckCircle2 size={15} />
                      <span>Approve Proposal (AP-01)</span>
                    </button>
                  </>
                )}
                {canSend(selectedProposal) && (
                  <button className="btn btn-primary" onClick={() => setSendTarget(selectedProposal)}>
                    <Send size={14} />
                    <span>Send to Client</span>
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
            {selectedProposal.approval && (
              <div
                style={{
                  padding: '0.85rem',
                  backgroundColor: selectedProposal.approval.status === 'approved' ? 'var(--ikpm-emerald-50)' : 'var(--ikpm-amber-100)',
                  border: `1px solid ${selectedProposal.approval.status === 'approved' ? 'var(--ikpm-emerald-100)' : '#FCD34D'}`,
                  borderRadius: 'var(--radius-md)',
                  color: selectedProposal.approval.status === 'approved' ? '#065F46' : '#92400E',
                }}
              >
                <strong>Approval Status:</strong> {selectedProposal.approval.status.toUpperCase()} ({selectedProposal.approval.ruleId})
                <div style={{ fontSize: '0.78rem', marginTop: '3px' }}>
                  {selectedProposal.approval.ruleDescription}
                </div>
                {selectedProposal.approval.rejectionReason && (
                  <div style={{ color: 'var(--ikpm-rose-500)', marginTop: '4px' }}>
                    <strong>Rejection Reason:</strong> {selectedProposal.approval.rejectionReason}
                  </div>
                )}
              </div>
            )}

            <div>
              <strong>Scope of Work:</strong>
              <p style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>{selectedProposal.scopeOfWork}</p>
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Service Item</th>
                    <th>Target Pest</th>
                    <th>Qty</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProposal.lineItems.map((li) => (
                    <tr key={li.id}>
                      <td>
                        <strong>{li.serviceName}</strong>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{li.chemicalsSuggested}</div>
                      </td>
                      <td>{li.targetPest}</td>
                      <td>{li.quantity}</td>
                      <td style={{ fontWeight: 700 }}>{formatPKR(li.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', textAlign: 'right', gap: '1.5rem' }}>
              <div>
                <div>Subtotal: {formatPKR(selectedProposal.subtotal)}</div>
                <div>Discount ({selectedProposal.discountPercent}%): -{formatPKR(selectedProposal.discountAmount)}</div>
                <div>Sales Tax ({selectedProposal.taxPercent}%): {formatPKR(selectedProposal.taxAmount)}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginTop: '4px' }}>
                  Grand Total: {formatPKR(selectedProposal.totalAmount)}
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <History size={14} /> Immutable Revision History
              </h4>
              {selectedProposal.revisionsHistory.map((rev) => (
                <div key={rev.revisionNumber} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', padding: '4px 0' }}>
                  • <strong>R{rev.revisionNumber}</strong> ({rev.timestamp.slice(0, 10)}) by {rev.changedByName}: {rev.changeReason} — Total: {formatPKR(rev.totalAmount)}
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Send size={14} /> Sent to Client
              </h4>
              <OutreachHistory related={{ kind: 'proposal', id: selectedProposal.id }} emptyText="Not shared with the client yet." />
            </div>
          </div>
        </Modal>
      )}

      {/* One-click send: proposal PDF + company documents via WhatsApp / Email */}
      {sendTarget && (
        <SendDocumentsModal
          isOpen={Boolean(sendTarget)}
          onClose={() => setSendTarget(null)}
          recipient={recipientFor(sendTarget)}
          related={{ kind: 'proposal', id: sendTarget.id, title: `${sendTarget.id} — ${sendTarget.customerName}` }}
          proposal={sendTarget}
          onSent={(results) => {
            if (results.some((r) => r.ok)) markSent(sendTarget);
          }}
        />
      )}

      {/* Confirm Reject Dialog */}
      <ConfirmDialog
        isOpen={showRejectDialog}
        onClose={() => setShowRejectDialog(false)}
        onConfirm={handleReject}
        title="Reject Proposal (Escalation Matrix)"
        message="Please provide an authorized justification for rejecting this proposal."
        requireReason={true}
        confirmLabel="Confirm Rejection"
      />
    </div>
  );
};
