import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Receipt,
  Plus,
  Search,
  DollarSign,
  RotateCcw,
  Send,
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
import { taxRateFor } from '../../lib/taxRates';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { usePdfAction } from '../../hooks/usePdfAction';
import { fileGenerated } from '../../features/documents/fileGenerated';
import type { DocumentOwner } from '../../types/document';
import { Download as DownloadIcon } from 'lucide-react';

export const InvoicesListPage: React.FC = () => {
  const _navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pdfAction = usePdfAction();
  const { success, warning } = useNotification();
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
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

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

  // Handle ?invoice=ID from search hits (Change 40 & 45)
  useEffect(() => {
    const invParam = searchParams.get('invoice');
    if (invParam) {
      const found = invoices.find((i) => i.id === invParam || i.invoiceNumber === invParam);
      if (found) setSelectedInvoice(found);
    }
  }, [searchParams, invoices.length]);

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
  const initialTaxRate = taxRateFor(dataService.getTaxRules(), initialJurisdiction as TaxJurisdiction).percent;
  const initialContract = linkedJob?.contractId ? dataService.getContractById(linkedJob.contractId) : undefined;
  const initialBaseAmount = initialContract?.monthlyRate || 0;

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
    baseAmount: initialBaseAmount,
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
      const jur = provinceToJurisdiction(prov) as TaxJurisdiction;
      const rate = taxRateFor(dataService.getTaxRules(), jur).percent;
      const contract = linkedJob.contractId ? dataService.getContractById(linkedJob.contractId) : undefined;
      const baseAmount = contract?.monthlyRate || 0;

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
        baseAmount,
      });
      setShowNewInvoiceModal(true);
    }
  }, [linkedJob]);

  const todayIso = new Date().toISOString().split('T')[0];
  const filteredInvoices = invoices.filter((i) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      i.invoiceNumber.toLowerCase().includes(q) ||
      i.customerName.toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q);
    if (!matchSearch) return false;

    if (statusFilter === 'all') return true;
    if (statusFilter === 'overdue') return i.balanceDue > 0 && i.status !== 'void_reversed' && i.dueDate < todayIso;
    return i.status === statusFilter;
  });

  const handleOpenPayment = (inv: Invoice) => {
    const existing = dataService.getPayments().find((p) => p.invoiceId === inv.id);
    if (existing) {
      warning('Receipt Already Recorded', `A payment receipt (${existing.receiptNumber}) has already been recorded for invoice ${inv.invoiceNumber}. Only 1 receipt can be recorded per invoice.`);
      return;
    }
    if (inv.status === 'paid' || inv.balanceDue <= 0) {
      warning('Invoice Already Settled', `Invoice ${inv.invoiceNumber} is already fully paid and settled.`);
      return;
    }
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

    // Step 15: Auto-file invoice PDF into client's Invoices/{YYYY} folder
    try {
      const owner: DocumentOwner = created.branchId
        ? { kind: 'branch', id: created.branchId }
        : created.customerType === 'company'
        ? { kind: 'company', id: created.customerId }
        : { kind: 'client', id: created.customerId };
      pdfGenerator.invoicePDFBlob(created).then((blob) => {
        fileGenerated(blob, {
          owner,
          category: 'invoice',
          title: `Sales Tax Invoice - ${created.invoiceNumber}`,
          fileName: `Invoice_${created.invoiceNumber}.pdf`,
          subPath: created.id,
          user: { email: userProfile?.email, displayName: userProfile?.displayName },
        }).catch((err) => console.warn('Invoice auto-file error:', err));
      }).catch((err) => console.warn('Invoice blob error:', err));
    } catch (err) {
      console.warn('Auto-filing invoice background error:', err);
    }

    success(
      'Invoice created',
      `Invoice ${created.invoiceNumber} posted${newInvoice.taxRatePercent > 0 ? ` (tax: ${newInvoice.taxRatePercent}%)` : ' (no tax)'}`
    );
    setShowNewInvoiceModal(false);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice || isSubmittingPayment) return;

    const existingReceipt = dataService.getPayments().find((p) => p.invoiceId === selectedInvoice.id);
    if (existingReceipt) {
      warning('Receipt Already Recorded', `A receipt (${existingReceipt.receiptNumber}) has already been recorded for this invoice. Only 1 receipt can be recorded per invoice.`);
      setShowPaymentModal(false);
      return;
    }

    try {
      setIsSubmittingPayment(true);
      const receiptId = generatePermanentId('REC', (Date.now() + Math.floor(Math.random() * 1000)) % 90000);
      const receiptNum = `REC-${Date.now().toString().slice(-4)}`;
      const receipt: PaymentReceipt = {
        id: receiptId,
        receiptNumber: receiptNum,
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

      // Step 15: Auto-file payment receipt PDF into client's Payments folder
      try {
        const owner: DocumentOwner = selectedInvoice.branchId
          ? { kind: 'branch', id: selectedInvoice.branchId }
          : selectedInvoice.customerType === 'company'
          ? { kind: 'company', id: selectedInvoice.customerId }
          : { kind: 'client', id: selectedInvoice.customerId };
        pdfGenerator.receiptPDFBlob(receipt).then((blob) => {
          fileGenerated(blob, {
            owner,
            category: 'payment_receipt',
            title: `Payment Receipt - ${receipt.receiptNumber}`,
            fileName: pdfGenerator.receiptFileName(receipt),
            subPath: receipt.id,
            user: { email: userProfile?.email, displayName: userProfile?.displayName },
          }).catch((err) => console.warn('Receipt auto-file error:', err));
        }).catch((err) => console.warn('Receipt blob error:', err));
      } catch (err) {
        console.warn('Auto-filing receipt background error:', err);
      }

      success(
        'Payment Recorded & Receipt Filed',
        `Cash: ${formatPKR(receipt.cashAmountReceived)} | Customer WHT: ${formatPKR(receipt.customerWhtDeducted.amountDeducted)}. Receipt auto-filed in Payments.`
      );
      setShowPaymentModal(false);
    } catch (err: any) {
      warning('Payment Recording Failed', err?.message || 'Could not record payment.');
    } finally {
      setIsSubmittingPayment(false);
    }
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

  const downloadInvoice = (inv: Invoice) => pdfAction.run(inv.id, () => pdfGenerator.generateInvoicePDF(inv));
  const downloadReceipt = (r: PaymentReceipt) => pdfAction.run(r.id, () => pdfGenerator.generateReceiptPDF(r));

  /** Real contact for payment reminders (branch manager, company primary contact or individual client). */
  const reminderRecipient = (inv: Invoice) => {
    if (inv.customerType === 'company') {
      const br = inv.branchId ? dataService.getBranchById(inv.branchId) : undefined;
      if (br) return { name: br.branchManagerName || inv.customerName, phone: br.branchManagerPhone || br.branchPhone, email: br.branchEmail };
      const co = dataService.getCompanyById(inv.customerId);
      return { name: co?.primaryContact.fullName || inv.customerName, phone: co?.primaryContact.mobile, email: co?.primaryContact.email };
    }
    const cl = dataService.getClientById(inv.customerId);
    return { name: cl?.fullName || inv.customerName, phone: cl?.primaryPhone, email: cl?.email };
  };

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Invoices & Payments' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Invoices &amp; Payments</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNewInvoiceModal(true)}>
          <Plus size={16} />
          <span>+ Create Invoice</span>
        </button>
      </div>

      {/* KPI stat cards */}
      {(() => {
        const todayStr = new Date().toISOString().split('T')[0];
        const monthStr = todayStr.slice(0, 7);
        const live = invoices.filter((i) => i.status !== 'void_reversed');
        const outstanding = live.reduce((s, i) => s + i.balanceDue, 0);
        const overdue = live.filter((i) => i.balanceDue > 0 && i.dueDate < todayStr).reduce((s, i) => s + i.balanceDue, 0);
        const collected = invoices.filter((i) => i.amountPaid > 0 && i.updatedAt.startsWith(monthStr)).reduce((s, i) => s + i.amountPaid, 0);
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'Total outstanding', value: formatPKR(outstanding), color: outstanding > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' },
              { label: 'Overdue balance', value: formatPKR(overdue), color: overdue > 0 ? '#DC2626' : 'var(--text-muted)' },
              { label: 'Collected this month', value: formatPKR(collected), color: 'var(--ikpm-emerald-600)' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card" style={{ padding: '0.9rem 1.25rem' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{label}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {(['all', 'overdue', 'posted', 'partially_paid', 'paid', 'void_reversed'] as const).map((st) => (
            <button
              key={st}
              className={`btn ${statusFilter === st ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
              onClick={() => setStatusFilter(st)}
            >
              {st === 'overdue' ? 'OVERDUE' : st.replace(/_/g, ' ').toUpperCase()}
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
                      {(() => {
                        const existingReceipt = dataService.getPayments().find((p) => p.invoiceId === inv.id);
                        if (existingReceipt) {
                          return (
                            <span style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)', fontWeight: 600 }} title={`Receipt ${existingReceipt.receiptNumber} recorded`}>
                              Settled ✓
                            </span>
                          );
                        }
                        if (inv.balanceDue > 0 && inv.status !== 'void_reversed') {
                          return (
                            <button
                              className="btn btn-primary"
                              style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                              onClick={() => handleOpenPayment(inv)}
                            >
                              <DollarSign size={12} />
                              <span>Record Receipt</span>
                            </button>
                          );
                        }
                        return (
                          <span style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)', fontWeight: 600 }}>
                            Settled ✓
                          </span>
                        );
                      })()}

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

                      <button className="icon-btn" title="Download invoice PDF" onClick={() => downloadInvoice(inv)}>
                        <DownloadIcon size={15} />
                      </button>
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
        title="Create Invoice"
        subtitle={linkedJob ? `Pre-filled from job ${linkedJob.id}` : 'Fill in the details below'}
        maxWidth="680px"
      >
        <form onSubmit={handleCreateInvoice}>
          <div className="form-group">
            <label className="form-label">Client <span className="required">*</span></label>
            {linkedJob ? (
              <select className="form-select" value={newInvoice.customerId} disabled>
                <option value={newInvoice.customerId}>
                  {newInvoice.customerType === 'company' ? companies.find(c => c.id === newInvoice.customerId)?.legalCompanyName : clients.find(c => c.id === newInvoice.customerId)?.fullName} ({newInvoice.customerId})
                </option>
              </select>
            ) : (
              <select
                className="form-select"
                value={`${newInvoice.customerType}:${newInvoice.customerId}`}
                onChange={(e) => {
                  const [type, id] = e.target.value.split(':');
                  setNewInvoice({ ...newInvoice, customerType: type as 'company' | 'individual', customerId: id });
                }}
              >
                <optgroup label="Companies">
                  {companies.map((c) => (
                    <option key={c.id} value={`company:${c.id}`}>{c.legalCompanyName} ({c.id})</option>
                  ))}
                </optgroup>
                <optgroup label="Individual Clients">
                  {clients.map((cl) => (
                    <option key={cl.id} value={`individual:${cl.id}`}>{cl.fullName} ({cl.id})</option>
                  ))}
                </optgroup>
              </select>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Apply tax?</label>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                <button
                  type="button"
                  className={`chip ${newInvoice.taxRatePercent > 0 ? 'chip-on' : ''}`}
                  onClick={() => setNewInvoice({ ...newInvoice, taxRatePercent: newInvoice.taxRatePercent > 0 ? 0 : 13 })}
                >
                  {newInvoice.taxRatePercent > 0 ? 'Yes — with tax' : 'No tax'}
                </button>
              </div>
            </div>
            {newInvoice.taxRatePercent > 0 && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tax rate (%)</label>
                <input
                  type="number"
                  className="form-input"
                  value={newInvoice.taxRatePercent}
                  min={0}
                  max={100}
                  onChange={(e) => setNewInvoice({ ...newInvoice, taxRatePercent: Number(e.target.value) })}
                />
              </div>
            )}
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
            <div>Subtotal: <strong>{formatPKR(Number(newInvoice.baseAmount))}</strong></div>
            {newInvoice.taxRatePercent > 0 && (
              <div>
                Tax ({newInvoice.taxRatePercent}%):{' '}
                <strong>{formatPKR((Number(newInvoice.baseAmount) * newInvoice.taxRatePercent) / 100)}</strong>
              </div>
            )}
            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginTop: '4px' }}>
              Total: {formatPKR(Number(newInvoice.baseAmount) * (1 + newInvoice.taxRatePercent / 100))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowNewInvoiceModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              <Receipt size={15} />
              <span>Create Invoice</span>
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
                <label className="form-label">Amount received (PKR) <span className="required">*</span></label>
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
                  Client deducted WHT (withheld tax)
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
                    <label className="form-label">Certificate / reference #</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. CPR-2026-XXXX"
                      value={paymentForm.whtCertificateNumber}
                      onChange={(e) => setPaymentForm({ ...paymentForm, whtCertificateNumber: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowPaymentModal(false)} disabled={isSubmittingPayment}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={isSubmittingPayment}>
                {isSubmittingPayment ? 'Recording...' : 'Record Payment & Issue Receipt'}
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
              {selectedInvoice.status !== 'void_reversed' && ['super_admin', 'finance'].includes(effectiveRole || '') && (
                <button className="btn btn-danger" onClick={() => setShowVoidDialog(true)}>
                  <RotateCcw size={14} />
                  <span>Void / Issue Credit Note</span>
                </button>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto', alignItems: 'center' }}>
                {selectedInvoice.isApproved === false && effectiveRole === 'super_admin' && (
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      const approved = {
                        ...selectedInvoice,
                        isApproved: true,
                        approvedBy: userProfile?.displayName || 'CEO',
                        approvedAt: new Date().toISOString(),
                      };
                      dataService.saveInvoice(approved, userProfile?.email);
                      setSelectedInvoice(approved);
                      success('Invoice Approved by CEO', `Invoice ${selectedInvoice.invoiceNumber} is now certified for printing and dispatch.`);
                    }}
                  >
                    <span>Approve Invoice (CEO)</span>
                  </button>
                )}
                <button className="btn btn-secondary" onClick={() => downloadInvoice(selectedInvoice)}>
                  <DownloadIcon size={14} />
                  <span>Download PDF</span>
                </button>
                {selectedInvoice.balanceDue > 0 && selectedInvoice.status !== 'void_reversed' && !dataService.getPayments().some((p) => p.invoiceId === selectedInvoice.id) && (
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

            {/* Linked Challan Info (Change 40) */}
            {(() => {
              const linkedJobRecord = selectedInvoice.jobId ? dataService.getJobById(selectedInvoice.jobId) : undefined;
              if (!linkedJobRecord?.challanNumber) return null;
              return (
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--ikpm-blue-50)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Verified Service Challan (Change 40):</span>
                      <div style={{ fontWeight: 700, color: 'var(--ikpm-navy-900)' }}>#{linkedJobRecord.challanNumber}</div>
                    </div>
                    {linkedJobRecord.challanFileUrl && (
                      <a href={linkedJobRecord.challanFileUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-secondary">
                        View Signed Challan
                      </a>
                    )}
                  </div>
                </div>
              );
            })()}

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

            {(() => {
              const receipts = dataService.getPayments().filter((p) => p.invoiceId === selectedInvoice.id);
              if (!receipts.length) return null;
              return (
                <div>
                  <div className="section-title" style={{ marginTop: 0 }}>Receipts</div>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr><th>Receipt</th><th>Date</th><th>Mode</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr>
                      </thead>
                      <tbody>
                        {receipts.map((r) => (
                          <tr key={r.id}>
                            <td className="cell-title">{r.receiptNumber}</td>
                            <td>{formatDate(r.paymentDate)}</td>
                            <td style={{ textTransform: 'capitalize' }}>{r.paymentMode.replace(/_/g, ' ')}</td>
                            <td style={{ textAlign: 'right' }}>{formatPKR(r.cashAmountReceived)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="icon-btn" title="Download receipt PDF" onClick={() => downloadReceipt(r)}><DownloadIcon size={15} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        </Modal>
      )}

      {/* 1-Tap Send Overdue Reminder Modal */}
      {sendReminderInvoice && (
        <SendDocumentsModal
          isOpen={Boolean(sendReminderInvoice)}
          onClose={() => setSendReminderInvoice(null)}
          recipient={reminderRecipient(sendReminderInvoice)}
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
