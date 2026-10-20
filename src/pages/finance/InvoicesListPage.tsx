import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Receipt,
  Plus,
  Search,
  Download,
  AlertCircle,
  FileCheck2,
  DollarSign,
  AlertTriangle,
  RotateCcw,
  CheckCircle,
  Send,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { formatPKR, formatDate, formatNTN, generatePermanentId } from '../../lib/formatters';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { SendDocumentsModal } from '../../features/outreach/SendDocumentsModal';
import type { Invoice, PaymentReceipt, TaxJurisdiction, InvoiceLineItem } from '../../types/finance';
import { provinceToJurisdiction, getStandardTaxRate } from '../../lib/workflow';

export const InvoicesListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { success, error, warning } = useNotification();
  const { userProfile, effectiveRole } = useAuth();
  useDataStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [showNewInvoiceModal, setShowNewInvoiceModal] = useState(
    searchParams.get('action') === 'new_invoice' || Boolean(searchParams.get('fromJob'))
  );
  const [sendReminderInvoice, setSendReminderInvoice] = useState<Invoice | null>(null);

  // Payment Form State
  const [paymentForm, setPaymentForm] = useState({
    amountReceived: 0,
    paymentMode: 'bank_transfer' as const,
    bankReferenceNo: '',
    bankName: 'Meezan Bank Ltd',
    hasWhtDeduction: false,
    whtRatePercent: 3,
    whtAmount: 0,
    whtCertificateNumber: '',
  });

  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const invoices = dataService.getInvoices();

  // If fromJob is provided, verify and pre-fill
  const fromJobId = searchParams.get('fromJob');
  const linkedJob = fromJobId ? dataService.getJobById(fromJobId) : undefined;

  // New Invoice Form State
  const initialCustomerType = linkedJob?.customerType || ('company' as const);
  const initialCustomerId = linkedJob?.customerId || companies[0]?.id || '';

  // Determine site province to auto-select provincial tax
  const getSiteProvince = (custId: string, jobSiteAddr?: string): string => {
    if (jobSiteAddr) {
      if (jobSiteAddr.toLowerCase().includes('lahore') || jobSiteAddr.toLowerCase().includes('punjab')) return 'Punjab';
      if (jobSiteAddr.toLowerCase().includes('islamabad')) return 'Islamabad_ICT';
      if (jobSiteAddr.toLowerCase().includes('peshawar') || jobSiteAddr.toLowerCase().includes('kpk')) return 'KPK';
      if (jobSiteAddr.toLowerCase().includes('quetta')) return 'Balochistan';
    }
    const sites = dataService.getSites(custId);
    if (sites[0]?.province) return sites[0].province;
    const client = dataService.getClientById(custId);
    if (client?.province) return client.province;
    const company = dataService.getCompanyById(custId);
    if (company?.province) return company.province;
    return 'Sindh';
  };

  const initialProvince = getSiteProvince(initialCustomerId, linkedJob?.siteAddress);
  const initialJurisdiction = provinceToJurisdiction(initialProvince);
  const initialTaxRate = getStandardTaxRate(initialJurisdiction);

  const [newInvoice, setNewInvoice] = useState({
    customerType: initialCustomerType,
    customerId: initialCustomerId,
    branchId: linkedJob?.branchId || '',
    jobId: linkedJob?.id || '',
    contractId: linkedJob?.contractId || '',
    jurisdiction: initialJurisdiction as TaxJurisdiction,
    taxRatePercent: initialTaxRate,
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    serviceDescription: linkedJob?.serviceType || 'Integrated Pest Management (IPM) Professional Service',
    baseAmount: 45000,
  });

  // Check guard rail on mount if fromJob is present
  useEffect(() => {
    if (linkedJob) {
      // Guard Rail 1: No invoice before a verified report
      if (!linkedJob.supervisorVerification?.isVerified) {
        warning(
          'Invoice Blocked by Guard Rail Policy',
          `Job ${linkedJob.id} cannot be invoiced because its service report has not yet been verified by an operations supervisor.`
        );
        setShowNewInvoiceModal(false);
        return;
      }

      const prov = getSiteProvince(linkedJob.customerId, linkedJob.siteAddress);
      const jur = provinceToJurisdiction(prov);
      const rate = getStandardTaxRate(jur);

      setNewInvoice({
        customerType: linkedJob.customerType,
        customerId: linkedJob.customerId,
        branchId: linkedJob.branchId || '',
        jobId: linkedJob.id,
        contractId: linkedJob.contractId || '',
        jurisdiction: jur,
        taxRatePercent: rate,
        issueDate: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        serviceDescription: `${linkedJob.serviceType} (Job: ${linkedJob.id})`,
        baseAmount: 45000,
      });
      setShowNewInvoiceModal(true);
    }
  }, [linkedJob]);

  const filteredInvoices = invoices.filter((i) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      i.invoiceNumber.toLowerCase().includes(q) ||
      i.customerName.toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q);

    const matchStatus = statusFilter === 'all' || i.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleOpenPayment = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setPaymentForm({
      amountReceived: inv.balanceDue,
      paymentMode: 'bank_transfer',
      bankReferenceNo: `FT-${Date.now().toString().slice(-6)}`,
      bankName: 'Meezan Bank Ltd',
      hasWhtDeduction: false,
      whtRatePercent: 3,
      whtAmount: 0,
      whtCertificateNumber: '',
    });
    setShowPaymentModal(true);
  };

  const handleCreateInvoice = (e: React.FormEvent) => {
    e.preventDefault();

    let customerName = '';
    let customerNtn: string | undefined = undefined;
    let customerStrn: string | undefined = undefined;
    let billingAddress = 'City Facility';
    let branchName: string | undefined = undefined;

    if (newInvoice.customerType === 'company') {
      const co = dataService.getCompanyById(newInvoice.customerId);
      customerName = co?.legalCompanyName || 'Corporate Customer';
      customerNtn = co?.ntn;
      customerStrn = co?.strn;
      billingAddress = co?.headOfficeAddress || 'Karachi HQ';
      if (newInvoice.branchId) {
        const br = dataService.getBranchById(newInvoice.branchId);
        branchName = br?.branchName;
        if (br?.physicalAddress) billingAddress = br.physicalAddress;
      }
    } else {
      const cl = dataService.getClientById(newInvoice.customerId);
      customerName = cl?.fullName || 'Individual Client';
      billingAddress = cl?.residentialAddress || 'Residence';
    }

    const subtotal = Number(newInvoice.baseAmount);
    const taxAmount = (subtotal * newInvoice.taxRatePercent) / 100;
    const grossPayable = subtotal + taxAmount;

    const lineItems: InvoiceLineItem[] = [
      {
        id: `li_${Date.now()}`,
        description: newInvoice.serviceDescription,
        serviceCategory: 'Pest Control Services (Tariff 9822.3000)',
        quantity: 1,
        unitPrice: subtotal,
        amount: subtotal,
        taxRatePercent: newInvoice.taxRatePercent,
        taxAmount,
        totalWithTax: grossPayable,
      },
    ];

    const nextId = generatePermanentId('INV', invoices.length + 1);
    const invoiceNum = `IKPM-${new Date().getFullYear()}-${String(invoices.length + 1).padStart(4, '0')}`;

    const created: Invoice = {
      id: nextId,
      invoiceNumber: invoiceNum,
      invoiceType: 'statutory_sales_tax_invoice',
      jobId: newInvoice.jobId || undefined,
      contractId: newInvoice.contractId || undefined,
      customerType: newInvoice.customerType,
      customerId: newInvoice.customerId,
      customerName,
      customerNtn,
      customerStrn,
      branchId: newInvoice.branchId || undefined,
      branchName,
      billingAddress,
      issueDate: newInvoice.issueDate,
      dueDate: newInvoice.dueDate,
      jurisdiction: newInvoice.jurisdiction,
      lineItems,
      subtotal,
      taxTotal: taxAmount,
      grossPayable,
      amountPaid: 0,
      customerWhtTotal: 0,
      balanceDue: grossPayable,
      status: 'posted',
      isPosted: true,
      postedAt: new Date().toISOString(),
      postedBy: userProfile?.displayName || 'Finance Department',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    dataService.saveInvoice(created, userProfile?.email);
    success(
      'Statutory Sales Tax Invoice Generated',
      `Invoice ${created.invoiceNumber} posted (${created.jurisdiction.toUpperCase()} tax: ${newInvoice.taxRatePercent}%)`
    );
    setShowNewInvoiceModal(false);
  };

  const handleRecordPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;

    const receiptId = generatePermanentId('REC', Date.now() % 9000);
    const receipt: PaymentReceipt = {
      id: receiptId,
      receiptNumber: `REC-${Date.now().toString().slice(-4)}`,
      invoiceId: selectedInvoice.id,
      invoiceNumber: selectedInvoice.invoiceNumber,
      customerId: selectedInvoice.customerId,
      customerName: selectedInvoice.customerName,
      branchId: selectedInvoice.branchId,
      paymentDate: new Date().toISOString().split('T')[0],
      paymentMode: paymentForm.paymentMode,
      bankReferenceNo: paymentForm.bankReferenceNo,
      bankName: paymentForm.bankName,
      cashAmountReceived: Number(paymentForm.amountReceived),
      customerWhtDeducted: {
        isApplicable: paymentForm.hasWhtDeduction,
        ratePercent: paymentForm.hasWhtDeduction ? Number(paymentForm.whtRatePercent) : 0,
        amountDeducted: paymentForm.hasWhtDeduction ? Number(paymentForm.whtAmount) : 0,
        certificateNumber: paymentForm.whtCertificateNumber,
        sectionCode: 'Section 153(1)(b) - Services',
      },
      totalCreditApplied:
        Number(paymentForm.amountReceived) + (paymentForm.hasWhtDeduction ? Number(paymentForm.whtAmount) : 0),
      recordedBy: userProfile?.email || 'admin',
      recordedByName: userProfile?.displayName || 'Admin',
      createdAt: new Date().toISOString(),
    };

    dataService.recordPayment(receipt, userProfile?.email);
    success(
      'Payment Recorded & Allocated',
      `Cash: ${formatPKR(receipt.cashAmountReceived)} | Customer WHT: ${formatPKR(receipt.customerWhtDeducted.amountDeducted)}`
    );
    setShowPaymentModal(false);
  };

  const handleVoidInvoice = (reason: string) => {
    if (!selectedInvoice) return;
    const voided: Invoice = {
      ...selectedInvoice,
      status: 'void_reversed',
      creditNoteReason: reason,
      balanceDue: 0,
    };
    dataService.saveInvoice(voided, userProfile?.email);
    success('Invoice Reversed with Credit Note', `Invoice ${selectedInvoice.invoiceNumber} voided.`);
    setSelectedInvoice(voided);
  };

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Invoices, Receivables & Tax' }]} />

      <div
        style={{
          padding: '0.85rem 1.25rem',
          backgroundColor: 'var(--ikpm-navy-900)',
          color: '#FFFFFF',
          borderRadius: 'var(--radius-lg)',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Statutory Provincial Sales Tax Compliance</div>
          <div style={{ fontSize: '0.75rem', color: '#CBD5E1', marginTop: '2px' }}>
            Automatic provincial jurisdiction mapping: SRB 13% (Sindh), PRA 16% (Punjab), ICT 16% (Islamabad), KPRA 15% (KPK), BRA 15% (Balochistan).
          </div>
        </div>

        <button className="btn btn-primary" onClick={() => setShowNewInvoiceModal(true)}>
          <Plus size={16} />
          <span>+ Create Sales Tax Invoice</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {['all', 'posted', 'partially_paid', 'paid', 'void_reversed'].map((st) => (
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
            placeholder="Search invoice #, customer..."
            className="form-input"
            style={{ paddingLeft: '2.2rem', height: '34px', fontSize: '0.8rem' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Invoices Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Customer Name</th>
              <th>Branch</th>
              <th>Issue / Due Date</th>
              <th>Jurisdiction</th>
              <th>Gross Payable</th>
              <th>Paid (Cash)</th>
              <th>WHT Deducted</th>
              <th>Balance Due</th>
              <th>Status</th>
              <th>Next Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.map((inv) => {
              const isOverdue = new Date(inv.dueDate) < new Date() && inv.balanceDue > 0 && inv.status !== 'void_reversed';

              return (
                <tr key={inv.id}>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{inv.invoiceNumber}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)', fontFamily: 'monospace' }}>
                      {inv.id} {inv.jobId ? `• Job: ${inv.jobId}` : ''}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{inv.customerName}</div>
                    {inv.customerNtn && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>NTN: {formatNTN(inv.customerNtn)}</div>}
                  </td>
                  <td>{inv.branchName || 'Company HQ'}</td>
                  <td style={{ fontSize: '0.8rem' }}>
                    <div>{formatDate(inv.issueDate)}</div>
                    <div style={{ color: isOverdue ? 'var(--ikpm-rose-500)' : 'var(--text-muted)', fontSize: '0.72rem', fontWeight: isOverdue ? 700 : 400 }}>
                      Due: {formatDate(inv.dueDate)} {isOverdue ? '(OVERDUE)' : ''}
                    </div>
                  </td>
                  <td><span className="badge-status badge-slate">{inv.jurisdiction.toUpperCase()}</span></td>
                  <td style={{ fontWeight: 700 }}>{formatPKR(inv.grossPayable)}</td>
                  <td style={{ color: 'var(--ikpm-emerald-600)', fontWeight: 600 }}>{formatPKR(inv.amountPaid)}</td>
                  <td style={{ color: '#92400E' }}>{formatPKR(inv.customerWhtTotal || 0)}</td>
                  <td style={{ fontWeight: 800, color: inv.balanceDue > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                    {formatPKR(inv.balanceDue)}
                  </td>
                  <td><StatusBadge status={inv.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      {inv.balanceDue > 0 && inv.status !== 'void_reversed' ? (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                          onClick={() => handleOpenPayment(inv)}
                        >
                          <DollarSign size={12} />
                          <span>Record Receipt</span>
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)', fontWeight: 600 }}>
                          Settled ✓
                        </span>
                      )}

                      {isOverdue && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
                          title="1-Tap: Send Overdue Invoice Reminder via WhatsApp / Email"
                          onClick={() => setSendReminderInvoice(inv)}
                        >
                          <Send size={12} />
                        </button>
                      )}

                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
                        onClick={() => setSelectedInvoice(inv)}
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

      {/* Modal: Create Sales Tax Invoice (Pre-filled from Verified Job) */}
      <Modal
        isOpen={showNewInvoiceModal}
        onClose={() => setShowNewInvoiceModal(false)}
        title="Generate Statutory Sales Tax Invoice"
        subtitle={linkedJob ? `Pre-filled from Verified Service Report ${linkedJob.id}` : 'Automatic Provincial Tax Jurisdiction Allocation'}
        maxWidth="680px"
      >
        <form onSubmit={handleCreateInvoice}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Client Type</label>
              <select
                className="form-select"
                value={newInvoice.customerType}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setNewInvoice({
                    ...newInvoice,
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
              <label className="form-label">Customer Account <span className="required">*</span></label>
              <select
                className="form-select"
                value={newInvoice.customerId}
                onChange={(e) => {
                  const cId = e.target.value;
                  const prov = getSiteProvince(cId);
                  const jur = provinceToJurisdiction(prov);
                  const rate = getStandardTaxRate(jur);
                  setNewInvoice({
                    ...newInvoice,
                    customerId: cId,
                    jurisdiction: jur,
                    taxRatePercent: rate,
                  });
                }}
              >
                {newInvoice.customerType === 'company'
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

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Provincial Tax Jurisdiction (Auto-mapped) <span className="required">*</span></label>
              <select
                className="form-select"
                value={newInvoice.jurisdiction}
                onChange={(e) => {
                  const jur = e.target.value as TaxJurisdiction;
                  setNewInvoice({
                    ...newInvoice,
                    jurisdiction: jur,
                    taxRatePercent: getStandardTaxRate(jur),
                  });
                }}
              >
                <option value="sindh_srb">Sindh (SRB — 13%)</option>
                <option value="punjab_pra">Punjab (PRA — 16%)</option>
                <option value="islamabad_ict">Islamabad ICT (16%)</option>
                <option value="kpk_kpra">KPK (KPRA — 15%)</option>
                <option value="balochistan_bra">Balochistan (BRA — 15%)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Sales Tax Rate (%)</label>
              <input
                type="number"
                className="form-input"
                value={newInvoice.taxRatePercent}
                onChange={(e) => setNewInvoice({ ...newInvoice, taxRatePercent: Number(e.target.value) })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Issue Date</label>
              <input
                type="date"
                required
                className="form-input"
                value={newInvoice.issueDate}
                onChange={(e) => setNewInvoice({ ...newInvoice, issueDate: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input
                type="date"
                required
                className="form-input"
                value={newInvoice.dueDate}
                onChange={(e) => setNewInvoice({ ...newInvoice, dueDate: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Service Description</label>
            <input
              type="text"
              required
              className="form-input"
              value={newInvoice.serviceDescription}
              onChange={(e) => setNewInvoice({ ...newInvoice, serviceDescription: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Base Service Amount Excl. Tax (PKR)</label>
            <input
              type="number"
              required
              className="form-input"
              value={newInvoice.baseAmount}
              onChange={(e) => setNewInvoice({ ...newInvoice, baseAmount: Number(e.target.value) })}
            />
          </div>

          <div
            style={{
              padding: '0.75rem',
              backgroundColor: 'var(--bg-surface-alt)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.825rem',
              textAlign: 'right',
            }}
          >
            <div>Taxable Subtotal: <strong>{formatPKR(Number(newInvoice.baseAmount))}</strong></div>
            <div>
              {newInvoice.jurisdiction.toUpperCase()} Sales Tax ({newInvoice.taxRatePercent}%):{' '}
              <strong>{formatPKR((Number(newInvoice.baseAmount) * newInvoice.taxRatePercent) / 100)}</strong>
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginTop: '4px' }}>
              Total Gross Payable: {formatPKR(Number(newInvoice.baseAmount) * (1 + newInvoice.taxRatePercent / 100))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowNewInvoiceModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              <Receipt size={15} />
              <span>Post Statutory Sales Tax Invoice</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Record Payment & Withholding Tax Certificate */}
      {selectedInvoice && showPaymentModal && (
        <Modal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          title={`Receive Payment: ${selectedInvoice.invoiceNumber}`}
          subtitle={`Customer: ${selectedInvoice.customerName} • Outstanding Balance: ${formatPKR(selectedInvoice.balanceDue)}`}
          maxWidth="640px"
        >
          <form onSubmit={handleRecordPayment}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Cash / Cheque Amount Received (PKR) <span className="required">*</span></label>
                <input
                  type="number"
                  required
                  className="form-input"
                  value={paymentForm.amountReceived}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amountReceived: Number(e.target.value) })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Payment Channel</label>
                <select
                  className="form-select"
                  value={paymentForm.paymentMode}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentMode: e.target.value as any })}
                >
                  <option value="bank_transfer">Direct Online Bank Transfer</option>
                  <option value="cross_cheque">Crossed Cheque</option>
                  <option value="pay_order">Bank Pay Order</option>
                  <option value="cash">Direct Cash Collection</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Bank Reference / Cheque #</label>
                <input
                  type="text"
                  className="form-input"
                  value={paymentForm.bankReferenceNo}
                  onChange={(e) => setPaymentForm({ ...paymentForm, bankReferenceNo: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Depository Bank</label>
                <input
                  type="text"
                  className="form-input"
                  value={paymentForm.bankName}
                  onChange={(e) => setPaymentForm({ ...paymentForm, bankName: e.target.value })}
                />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem', marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                  type="checkbox"
                  id="wht_checkbox"
                  checked={paymentForm.hasWhtDeduction}
                  onChange={(e) => setPaymentForm({ ...paymentForm, hasWhtDeduction: e.target.checked })}
                />
                <label htmlFor="wht_checkbox" style={{ fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
                  Customer Withheld Income Tax at Source (Section 153 WHT Certificate)
                </label>
              </div>

              {paymentForm.hasWhtDeduction && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">WHT Rate (%)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={paymentForm.whtRatePercent}
                      onChange={(e) => {
                        const r = Number(e.target.value);
                        const autoAmt = (selectedInvoice.subtotal * r) / 100;
                        setPaymentForm({ ...paymentForm, whtRatePercent: r, whtAmount: autoAmt });
                      }}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">WHT Deducted (PKR)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={paymentForm.whtAmount}
                      onChange={(e) => setPaymentForm({ ...paymentForm, whtAmount: Number(e.target.value) })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">FBR CPR / Cert Number</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="CPR-2026-XXXX"
                      value={paymentForm.whtCertificateNumber}
                      onChange={(e) => setPaymentForm({ ...paymentForm, whtCertificateNumber: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowPaymentModal(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Record Payment & Issue Receipt
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: View Invoice Details */}
      {selectedInvoice && !showPaymentModal && (
        <Modal
          isOpen={Boolean(selectedInvoice)}
          onClose={() => setSelectedInvoice(null)}
          title={`Invoice: ${selectedInvoice.invoiceNumber}`}
          subtitle={`Statutory Tax Invoice • Jurisdiction: ${selectedInvoice.jurisdiction.toUpperCase()}`}
          maxWidth="680px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              {selectedInvoice.status !== 'void_reversed' && ['super_admin', 'management'].includes(effectiveRole || '') && (
                <button className="btn btn-danger" onClick={() => setShowVoidDialog(true)}>
                  <RotateCcw size={14} />
                  <span>Void / Issue Credit Note</span>
                </button>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                {selectedInvoice.balanceDue > 0 && selectedInvoice.status !== 'void_reversed' && (
                  <button className="btn btn-primary" onClick={() => handleOpenPayment(selectedInvoice)}>
                    <DollarSign size={14} />
                    <span>Record Receipt</span>
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
            {selectedInvoice.status === 'void_reversed' && (
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--ikpm-rose-100)', color: '#991B1B', borderRadius: 'var(--radius-md)' }}>
                <strong>Reversed Invoice:</strong> This record was voided by authorized credit note. Reason: {selectedInvoice.creditNoteReason}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Customer Details:</span>
                <div style={{ fontWeight: 700 }}>{selectedInvoice.customerName}</div>
                <div>{selectedInvoice.billingAddress}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Tax Registration:</span>
                <div>NTN: {selectedInvoice.customerNtn ? formatNTN(selectedInvoice.customerNtn) : '—'}</div>
                <div>STRN: {selectedInvoice.customerStrn || '—'}</div>
              </div>
            </div>

            {/* Line items */}
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Rate</th>
                    <th>Tax Amount</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.lineItems.map((li) => (
                    <tr key={li.id}>
                      <td><strong>{li.description}</strong></td>
                      <td>{li.quantity}</td>
                      <td>{formatPKR(li.unitPrice)}</td>
                      <td>{formatPKR(li.taxAmount)} ({li.taxRatePercent}%)</td>
                      <td style={{ fontWeight: 700 }}>{formatPKR(li.totalWithTax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div>Subtotal: {formatPKR(selectedInvoice.subtotal)}</div>
              <div>Sales Tax: {formatPKR(selectedInvoice.taxTotal)}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>
                Gross Payable: {formatPKR(selectedInvoice.grossPayable)}
              </div>
              <div style={{ color: 'var(--ikpm-emerald-600)' }}>Amount Paid: {formatPKR(selectedInvoice.amountPaid)}</div>
              {selectedInvoice.customerWhtTotal > 0 && (
                <div style={{ color: '#92400E' }}>Customer WHT Cert: {formatPKR(selectedInvoice.customerWhtTotal)}</div>
              )}
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: selectedInvoice.balanceDue > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                Balance Due: {formatPKR(selectedInvoice.balanceDue)}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* 1-Tap Send Overdue Reminder Modal */}
      {sendReminderInvoice && (
        <SendDocumentsModal
          isOpen={Boolean(sendReminderInvoice)}
          onClose={() => setSendReminderInvoice(null)}
          recipient={{
            name: sendReminderInvoice.customerName,
            phone: '+92 300 1234567',
          }}
          related={{
            kind: 'proposal',
            id: sendReminderInvoice.id,
            title: `Payment Reminder for Invoice ${sendReminderInvoice.invoiceNumber} (Balance: ${formatPKR(sendReminderInvoice.balanceDue)})`,
          }}
          onSent={() => {
            success('Payment Reminder Dispatched', `Reminder sent to ${sendReminderInvoice.customerName} via WhatsApp / Email.`);
          }}
        />
      )}

      {/* Reversal Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showVoidDialog}
        onClose={() => setShowVoidDialog(false)}
        onConfirm={handleVoidInvoice}
        title="Authorized Invoice Reversal (Credit Note)"
        message="Posted invoices cannot be silently deleted. Reversing an invoice issues an authorized credit note and creates an immutable audit trail."
        requireReason={true}
        reasonLabel="Mandatory Reason for Reversal / Voiding:"
        confirmLabel="Issue Reversal Credit Note"
      />
    </div>
  );
};
