import { baseRoleOf, canApproveInvoices } from '../../lib/permissions';
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
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
import { formatPKR, formatDate, formatNTN } from '../../lib/formatters';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { SendDocumentsModal } from '../../features/outreach/SendDocumentsModal';
import { billingAccountOf, isUnpostedInvoice, jobIdsOf, type Invoice, type PaymentReceipt } from '../../types/finance';
import { InvoiceDraftModal } from '../../features/invoices/InvoiceDraftModal';
import { billableVisits } from '../../features/invoices/monthlyBilling';
import { CompletedJobsTab } from '../../features/invoices/CompletedJobsTab';
import { PaymentsTab } from '../../features/invoices/PaymentsTab';
import { BulkInvoiceModal, BULK_STATUS_LABELS } from '../../features/invoices/BulkInvoiceModal';
import { statementAmounts } from '../../features/invoices/statements';
import { sendBlocker } from '../../features/invoices/invoiceWorkflow';
import { InvoiceSendModal } from '../../features/invoices/InvoiceSendModal';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { usePdfAction } from '../../hooks/usePdfAction';
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

  const [showVoidDialog, setShowVoidDialog] = useState(false);
  // Three tabs: completed jobs to invoice, invoices (individual + bulk), payments
  const [tab, setTab] = useState<'jobs' | 'invoices' | 'payments'>(() => {
    const t = searchParams.get('tab');
    if (t === 'invoices' || t === 'payments' || t === 'jobs') return t;
    return searchParams.get('invoice') ? 'invoices' : 'jobs';
  });
  const [payTarget, setPayTarget] = useState<string | undefined>(undefined);
  const [bulkOpen, setBulkOpen] = useState<string | null>(null);
  const [sendReminderInvoice, setSendReminderInvoice] = useState<Invoice | null>(null);
  // Approved invoice being sent to the client (email / WhatsApp)
  const [sendInvoice, setSendInvoice] = useState<Invoice | null>(null);

  const isApprover = canApproveInvoices(effectiveRole);
  // Invoices only reach the client by email from the portal. The owner (super admin) alone may keep a copy.
  const canDownload = baseRoleOf(effectiveRole) === 'super_admin';

  // Includes drafts and invoices waiting for approval (other screens see approved invoices only)
  const invoices = dataService.getAllInvoices();
  // Waiting for an admin: individual invoices and bulk invoices
  const toApprove = invoices.filter((i) => i.status === 'pending_approval' && !i.statementId).length
    + dataService.getStatements().filter((st) => st.status === 'pending_approval').length;
  // Handle ?invoice=ID from search hits (Change 40 & 45)
  useEffect(() => {
    const invParam = searchParams.get('invoice');
    if (invParam) {
      const found = invoices.find((i) => i.id === invParam || i.invoiceNumber === invParam);
      if (found) setSelectedInvoice(found);
    }
  }, [searchParams, invoices.length]);

  // ?fromJob=ID (the job's "Create Invoice" step): open Create Invoice with that visit ticked,
  // or show the invoice it is already on
  const fromJobId = searchParams.get('fromJob');
  useEffect(() => {
    if (!fromJobId) return;
    const existing = dataService.getInvoiceForJob(fromJobId);
    if (existing && existing.status !== 'void_reversed') {
      warning('Already invoiced', `Job ${fromJobId} is on invoice ${existing.invoiceNumber}.`);
      setTab('invoices');
      if (existing.statementId) setBulkOpen(existing.statementId);
      else setSelectedInvoice(existing);
      return;
    }
    setTab('jobs');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromJobId]);

  const todayIso = new Date().toISOString().split('T')[0];
  const filteredInvoices = invoices.filter((i) => {
    if (i.statementId) return false; // shown inside its bulk invoice
    const q = searchQuery.toLowerCase();
    const matchSearch =
      i.invoiceNumber.toLowerCase().includes(q) ||
      i.customerName.toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q);
    if (!matchSearch) return false;

    if (statusFilter === 'all') return true;
    if (statusFilter === 'overdue') return !isUnpostedInvoice(i) && i.balanceDue > 0 && i.status !== 'void_reversed' && i.dueDate < todayIso;
    return i.status === statusFilter;
  });

  // Bulk invoices in the same list, with the same filters
  const bulkRows = dataService.getStatements().filter((st) => {
    const q = searchQuery.toLowerCase();
    if (q && !st.statementNumber.toLowerCase().includes(q) && !st.customerName.toLowerCase().includes(q) && !st.id.toLowerCase().includes(q)) return false;
    const a = statementAmounts(st);
    if (statusFilter === 'all') return st.status !== 'cancelled';
    if (statusFilter === 'overdue') return st.status === 'approved' && a.totalDue > 0 && st.dueDate < todayIso;
    if (statusFilter === 'void_reversed') return st.status === 'cancelled';
    if (statusFilter === 'paid') return st.status === 'approved' && a.payState === 'paid';
    if (statusFilter === 'partially_paid') return st.status === 'approved' && a.payState === 'partly_paid';
    if (statusFilter === 'posted') return st.status === 'approved' && a.payState === 'unpaid';
    return st.status === statusFilter;
  });

  /** Record a payment: the Payments tab, with this invoice chosen. */
  const goPay = (target: string) => { setPayTarget(target); setSelectedInvoice(null); setBulkOpen(null); setTab('payments'); };

  const handleOpenPayment = (inv: Invoice) => {
    if (inv.status === 'paid' || inv.balanceDue <= 0) {
      warning('Invoice Already Settled', `Invoice ${inv.invoiceNumber} is already fully paid and settled.`);
      return;
    }
    goPay(`inv:${inv.id}`);
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
      </div>

      <div className="chip-row" style={{ marginBottom: '1.25rem' }}>
        {([
          ['jobs', `Completed jobs (${billableVisits().length})`],
          ['invoices', isApprover && toApprove ? `Invoices (${toApprove} to approve)` : 'Invoices'],
          ['payments', 'Payments'],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${tab === k ? 'chip-on' : ''}`} style={{ fontSize: '0.9rem', padding: '0.45rem 1rem' }}
            onClick={() => { setTab(k); if (k !== 'payments') setPayTarget(undefined); if (k === 'invoices' && isApprover && toApprove) setStatusFilter('pending_approval'); }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'jobs' && <CompletedJobsTab preselectJobId={fromJobId || undefined} onCreated={() => { setStatusFilter('pending_approval'); setTab('invoices'); }} />}
      {tab === 'payments' && <PaymentsTab key={payTarget || 'none'} preselect={payTarget} />}

      {tab === 'invoices' && (<>
      {/* KPI stat cards */}
      {(() => {
        const todayStr = new Date().toISOString().split('T')[0];
        const monthStr = todayStr.slice(0, 7);
        const live = invoices.filter((i) => i.status !== 'void_reversed' && !isUnpostedInvoice(i));
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
          {(['all', 'draft', 'pending_approval', 'rejected', 'overdue', 'posted', 'partially_paid', 'paid', 'void_reversed'] as const).map((st) => (
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
              <th>Customer / Branch</th>
              <th>Issue / Due Date</th>
              <th>Account</th>
              <th>Gross Payable</th>
              <th>Received</th>
              <th>Balance Due</th>
              <th>Status</th>
              <th>Next Action</th>
            </tr>
          </thead>
          <tbody>
            {bulkRows.map((st) => {
              const a = statementAmounts(st);
              const overdue = st.status === 'approved' && a.totalDue > 0 && st.dueDate < todayIso;
              const statusText = st.status === 'approved' ? (a.payState === 'paid' ? 'Paid' : a.payState === 'partly_paid' ? 'Partly paid' : 'Approved') : BULK_STATUS_LABELS[st.status];
              return (
                <tr key={st.id} style={{ cursor: 'pointer' }} onClick={() => setBulkOpen(st.id)}>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{st.statementNumber.startsWith('DRAFT-') ? 'Draft' : st.statementNumber}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>Bulk · {st.invoiceIds.length} job(s) · {formatDate(st.periodStart)} – {formatDate(st.periodEnd)}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{st.customerName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{st.branchName || (st.customerType === 'company' ? 'Head office' : 'Residential')}</div>
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>
                    <div>{formatDate(st.issueDate)}</div>
                    <div style={{ color: overdue ? 'var(--ikpm-rose-500)' : 'var(--text-muted)', fontSize: '0.72rem', fontWeight: overdue ? 700 : 400 }}>Due: {formatDate(st.dueDate)} {overdue ? '(OVERDUE)' : ''}</div>
                  </td>
                  <td><span className="badge-status badge-navy">Bulk</span></td>
                  <td style={{ fontWeight: 700 }}>{formatPKR(a.periodTotal)}</td>
                  <td style={{ color: 'var(--ikpm-emerald-600)', fontWeight: 600 }}>{formatPKR(a.paid)}</td>
                  <td style={{ fontWeight: 800, color: a.totalDue > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>{formatPKR(st.status === 'approved' ? a.totalDue : a.periodTotal)}</td>
                  <td><span className="badge-status badge-slate">{statusText}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      {st.status === 'approved' && a.totalDue > 0 && (
                        <button className="btn btn-primary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', whiteSpace: 'nowrap' }} onClick={() => goPay(`bulk:${st.id}`)}>
                          <DollarSign size={12} /> <span>Record payment</span>
                        </button>
                      )}
                      <button className="btn btn-secondary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }} onClick={() => setBulkOpen(st.id)}>
                        {st.status === 'pending_approval' && isApprover ? 'Review' : 'Open'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredInvoices.map((inv) => {
              const unposted = isUnpostedInvoice(inv);
              const isOverdue = !unposted && new Date(inv.dueDate) < new Date() && inv.balanceDue > 0 && inv.status !== 'void_reversed';

              return (
                <tr key={inv.id}>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{inv.invoiceNumber}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)', fontFamily: 'monospace' }}>
                      {inv.id} {inv.periodStart ? `• ${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd || inv.periodStart)} · ${jobIdsOf(inv).length} visit(s)` : inv.jobId ? `• Job: ${inv.jobId}` : ''}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{inv.customerName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{inv.branchName || (inv.customerType === 'company' ? 'Head office' : 'Residential')}</div>
                    {inv.customerNtn && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>NTN: {formatNTN(inv.customerNtn)}</div>}
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>
                    <div>{formatDate(inv.issueDate)}</div>
                    <div style={{ color: isOverdue ? 'var(--ikpm-rose-500)' : 'var(--text-muted)', fontSize: '0.72rem', fontWeight: isOverdue ? 700 : 400 }}>
                      Due: {formatDate(inv.dueDate)} {isOverdue ? '(OVERDUE)' : ''}
                    </div>
                  </td>
                  <td>
                    {billingAccountOf(inv) === 'cash'
                      ? <span className="badge-status badge-amber">Cash memo</span>
                      : <span className="badge-status badge-slate">Tax · {String(inv.jurisdiction ?? '').replace(/_.*$/, '').toUpperCase()}</span>}
                  </td>
                  <td style={{ fontWeight: 700 }}>{formatPKR(inv.grossPayable)}</td>
                  <td style={{ color: 'var(--ikpm-emerald-600)', fontWeight: 600 }}>
                    {formatPKR(inv.amountPaid)}
                    {(inv.customerWhtTotal || 0) > 0 && <div style={{ color: '#92400E', fontSize: '0.72rem', fontWeight: 400 }}>WHT {formatPKR(inv.customerWhtTotal)}</div>}
                  </td>
                  <td style={{ fontWeight: 800, color: inv.balanceDue > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                    {formatPKR(inv.balanceDue)}
                  </td>
                  <td><StatusBadge status={inv.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      {(() => {
                        if (unposted) {
                          return (
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: inv.status === 'rejected' ? '#DC2626' : 'var(--ikpm-amber-600)' }}>
                              {inv.statementId ? 'On statement (awaiting approval)' : inv.status === 'pending_approval' ? 'Awaiting approval' : inv.status === 'rejected' ? 'Returned' : 'Draft'}
                            </span>
                          );
                        }
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
                              <span>Record payment</span>
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

                      {canDownload && !unposted && (
                        <button className="icon-btn" title="Download invoice PDF (super admin only)" onClick={() => downloadInvoice(inv)}>
                          <DownloadIcon size={15} />
                        </button>
                      )}
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
                        onClick={() => setSelectedInvoice(inv)}
                      >
                        {unposted ? (inv.status === 'pending_approval' && isApprover ? 'Review' : 'Open') : 'Details'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!bulkRows.length && !filteredInvoices.length && (
              <tr><td colSpan={9} className="cell-sub" style={{ textAlign: 'center', padding: '1.25rem' }}>No invoices{statusFilter !== 'all' ? ' with this status' : ''}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </>)}

      {bulkOpen && (
        <BulkInvoiceModal
          statementId={bulkOpen}
          onClose={() => setBulkOpen(null)}
          onOpenInvoice={(id) => { const inv = dataService.getInvoiceById(id); if (inv) { setBulkOpen(null); setSelectedInvoice(inv); } }}
          onPay={(id) => goPay(`bulk:${id}`)}
        />
      )}

      {sendInvoice && (
        <InvoiceSendModal
          invoice={sendInvoice}
          onClose={() => setSendInvoice(null)}
          onSent={(sent) => { if (selectedInvoice?.id === sent.id) setSelectedInvoice(sent as Invoice); }}
        />
      )}

      {/* Drafts / waiting for approval / returned: edit, submit, approve or reject */}
      {selectedInvoice && isUnpostedInvoice(selectedInvoice) && (
        <InvoiceDraftModal
          key={`${selectedInvoice.id}_${selectedInvoice.status}`}
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onDone={(inv) => setSelectedInvoice(isUnpostedInvoice(inv) ? null : inv)}
        />
      )}

      {/* Modal: View Invoice Details */}
      {selectedInvoice && !isUnpostedInvoice(selectedInvoice) && (
        <Modal
          isOpen={Boolean(selectedInvoice)}
          onClose={() => setSelectedInvoice(null)}
          title={`Invoice: ${selectedInvoice.invoiceNumber}`}
          subtitle={billingAccountOf(selectedInvoice) === 'cash' ? 'Cash Memo • Cash account (no tax)' : `Sales Tax Invoice • Jurisdiction: ${selectedInvoice.jurisdiction.toUpperCase()}`}
          maxWidth="680px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              {selectedInvoice.status !== 'void_reversed' && ['super_admin', 'finance'].includes(baseRoleOf(effectiveRole) ?? '') && (
                <button className="btn btn-danger" onClick={() => setShowVoidDialog(true)}>
                  <RotateCcw size={14} />
                  <span>Void / Issue Credit Note</span>
                </button>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto', alignItems: 'center' }}>
                {selectedInvoice.status !== 'void_reversed' && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setSendInvoice(selectedInvoice)}
                    disabled={Boolean(sendBlocker(selectedInvoice))}
                    title={sendBlocker(selectedInvoice) || 'Send the invoice to the client by email or WhatsApp'}
                  >
                    <Send size={14} />
                    <span>{selectedInvoice.sentAt ? 'Resend to client' : 'Send to client'}</span>
                  </button>
                )}
                {canDownload && (
                  <button className="btn btn-secondary" onClick={() => downloadInvoice(selectedInvoice)} title="Super admin only">
                    <DownloadIcon size={14} />
                    <span>Download PDF</span>
                  </button>
                )}
                {selectedInvoice.balanceDue > 0 && selectedInvoice.status !== 'void_reversed' && !selectedInvoice.statementId && (
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

            {/* Approval and delivery trail */}
            <div className="cell-sub" style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {selectedInvoice.approvedAt && (
                <span>✓ Approved by {selectedInvoice.approvedBy} on {formatDate(selectedInvoice.approvedAt)}{selectedInvoice.submittedByName ? ` · prepared by ${selectedInvoice.submittedByName}` : ''}</span>
              )}
              {selectedInvoice.approverChanges && <span>Approver changes: {selectedInvoice.approverChanges}</span>}
              {selectedInvoice.sentAt
                ? <span style={{ color: 'var(--ikpm-emerald-600)' }}>✉ Sent {selectedInvoice.sentVia === 'whatsapp' ? 'on WhatsApp' : selectedInvoice.sentVia && selectedInvoice.sentVia !== 'email_auto' ? 'by email' : 'by email (automatic)'} to {selectedInvoice.sentTo} on {formatDate(selectedInvoice.sentAt)} by {selectedInvoice.sentByName}</span>
                : selectedInvoice.status !== 'void_reversed' && (
                  <span style={{ color: '#B45309' }}>Not sent to the client yet. Press "Send to client".</span>
                )}
            </div>

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
                            <td style={{ textTransform: 'capitalize' }}>{String(r.paymentMode ?? '').replace(/_/g, ' ')}</td>
                            <td style={{ textAlign: 'right' }}>{formatPKR(r.cashAmountReceived)}</td>
                            <td style={{ textAlign: 'right' }}>
                              {canDownload && <button className="icon-btn" title="Download receipt PDF (super admin only)" onClick={() => downloadReceipt(r)}><DownloadIcon size={15} /></button>}
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
