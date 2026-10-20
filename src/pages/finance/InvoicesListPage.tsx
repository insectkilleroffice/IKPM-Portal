import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { formatPKR, formatDate, formatNTN, generatePermanentId } from '../../lib/formatters';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { Invoice, PaymentReceipt, TaxJurisdiction } from '../../types/finance';

export const InvoicesListPage: React.FC = () => {
  const navigate = useNavigate();
  const { success, error, warning } = useNotification();
  const { userProfile, effectiveRole } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [showNewInvoiceModal, setShowNewInvoiceModal] = useState(false);

  // Payment Form State
  const [paymentForm, setPaymentForm] = useState({
    amountReceived: 0,
    paymentMode: 'bank_transfer' as const,
    bankReferenceNo: '',
    bankName: 'Meezan Bank Ltd',
    // Customer Withholding Tax (WHT) Certificate details (Receivable Asset)
    hasWhtDeduction: false,
    whtRatePercent: 3, // e.g. 3% active filer WHT Section 153
    whtAmount: 0,
    whtCertificateNumber: '',
  });

  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const invoices = dataService.getInvoices();

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

      {/* Statutory Disclaimer Notice Banner (Section 5 Requirement) */}
      <div
        style={{
          padding: '0.9rem 1.25rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderLeft: '4px solid var(--ikpm-navy-700)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.75rem',
        }}
      >
        <AlertCircle size={20} color="var(--ikpm-navy-700)" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <strong>Statutory Accounting & Tax Integrity Notice:</strong> This module manages operational customer billing,
          receivables, provincial sales tax calculations (SRB / PRA / FBR), and customer withholding tax certificates (Section 153).
          Customer WHT deducted from IKPM invoices is tracked strictly as an advance tax receivable and kept separate from supplier WHT payables.
          Formal statutory accounts require validation by a certified chartered accountant.
        </div>
      </div>

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Invoices & Receivables Management</h1>
          <p className="page-subtitle">
            Sales tax invoices, payment allocation, WHT deduction tracking, and immutable audit logs.
          </p>
        </div>

        <button className="btn btn-primary" onClick={() => navigate('/finance/tax-rules')}>
          <FileCheck2 size={16} />
          <span>Configurable Tax Rules</span>
        </button>
      </div>

      {/* Filter Tabs */}
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
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{inv.invoiceNumber}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)', fontFamily: 'monospace' }}>
                    {inv.id}
                  </div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{inv.customerName}</div>
                  {inv.customerNtn && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>NTN: {formatNTN(inv.customerNtn)}</div>}
                </td>
                <td>{inv.branchName || 'Company HQ'}</td>
                <td style={{ fontSize: '0.8rem' }}>
                  <div>{formatDate(inv.issueDate)}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Due: {formatDate(inv.dueDate)}</div>
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
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {inv.balanceDue > 0 && inv.status !== 'void_reversed' && (
                      <button
                        className="btn btn-primary"
                        style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
                        onClick={() => handleOpenPayment(inv)}
                      >
                        Receive Payment
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
            ))}
          </tbody>
        </table>
      </div>

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
                  <option value="bank_transfer">Online Bank Transfer / RTGS</option>
                  <option value="cross_cheque">Cross Cheque</option>
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
                  placeholder="e.g. FT-202609012"
                  value={paymentForm.bankReferenceNo}
                  onChange={(e) => setPaymentForm({ ...paymentForm, bankReferenceNo: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Deposited Bank Account</label>
                <input
                  type="text"
                  className="form-input"
                  value={paymentForm.bankName}
                  onChange={(e) => setPaymentForm({ ...paymentForm, bankName: e.target.value })}
                />
              </div>
            </div>

            {/* Customer Withholding Tax (WHT) Deduction Section */}
            <div
              style={{
                backgroundColor: 'var(--ikpm-amber-50)',
                border: '1px solid #FCD34D',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                marginTop: '0.75rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                  type="checkbox"
                  id="whtCheck"
                  checked={paymentForm.hasWhtDeduction}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    const calculatedWht = checked ? (selectedInvoice.subtotal * paymentForm.whtRatePercent) / 100 : 0;
                    setPaymentForm({
                      ...paymentForm,
                      hasWhtDeduction: checked,
                      whtAmount: calculatedWht,
                      amountReceived: Math.max(0, selectedInvoice.balanceDue - calculatedWht),
                    });
                  }}
                />
                <label htmlFor="whtCheck" style={{ fontWeight: 700, fontSize: '0.85rem', color: '#92400E', cursor: 'pointer' }}>
                  Customer Deducted Withholding Tax (Section 153 WHT Certificate)
                </label>
              </div>

              {paymentForm.hasWhtDeduction && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.5fr', gap: '0.75rem' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>WHT Rate %</label>
                    <input
                      type="number"
                      className="form-input"
                      style={{ height: '32px', fontSize: '0.8rem' }}
                      value={paymentForm.whtRatePercent}
                      onChange={(e) => {
                        const rate = Number(e.target.value);
                        const calculatedWht = (selectedInvoice.subtotal * rate) / 100;
                        setPaymentForm({
                          ...paymentForm,
                          whtRatePercent: rate,
                          whtAmount: calculatedWht,
                          amountReceived: Math.max(0, selectedInvoice.balanceDue - calculatedWht),
                        });
                      }}
                    />
                  </div>

                  <div>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>WHT Amount (PKR)</label>
                    <input
                      type="number"
                      className="form-input"
                      style={{ height: '32px', fontSize: '0.8rem' }}
                      value={paymentForm.whtAmount}
                      onChange={(e) => setPaymentForm({ ...paymentForm, whtAmount: Number(e.target.value) })}
                    />
                  </div>

                  <div>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>WHT CPR / Cert #</label>
                    <input
                      type="text"
                      className="form-input"
                      style={{ height: '32px', fontSize: '0.8rem' }}
                      placeholder="e.g. IT-2026-90812"
                      value={paymentForm.whtCertificateNumber}
                      onChange={(e) => setPaymentForm({ ...paymentForm, whtCertificateNumber: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowPaymentModal(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Record Authorized Receipt
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: View Invoice Details & Authorized Reversal */}
      {selectedInvoice && !showPaymentModal && (
        <Modal
          isOpen={Boolean(selectedInvoice)}
          onClose={() => setSelectedInvoice(null)}
          title={`Invoice ${selectedInvoice.invoiceNumber}`}
          subtitle={`Client: ${selectedInvoice.customerName} • Jurisdiction: ${selectedInvoice.jurisdiction.toUpperCase()}`}
          maxWidth="680px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              {selectedInvoice.status !== 'void_reversed' && (
                <button
                  className="btn btn-danger"
                  style={{ fontSize: '0.8rem' }}
                  onClick={() => setShowVoidDialog(true)}
                >
                  <RotateCcw size={14} />
                  <span>Reverse / Void via Credit Note</span>
                </button>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                <button className="btn btn-secondary" onClick={() => setSelectedInvoice(null)}>
                  Close
                </button>
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
