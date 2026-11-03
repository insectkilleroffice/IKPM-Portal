// One bulk invoice: the job invoices inside it, admin approval (approving it finalises them all),
// sending it to the client, and recording payments (on the Payments tab).

import React, { useState } from 'react';
import { CheckCircle2, Download, Receipt, RotateCcw, Send, XCircle } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDataStore } from '../../hooks/useDataStore';
import { usePdfAction } from '../../hooks/usePdfAction';
import { baseRoleOf, canApproveInvoices, canEditModule } from '../../lib/permissions';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { formatDate, formatPKR } from '../../lib/formatters';
import { dataService } from '../../services/dataService';
import { InvoiceSendModal } from './InvoiceSendModal';
import { sendBlocker } from './invoiceWorkflow';
import { approveStatement, cancelStatement, rejectStatement, resubmitStatement, statementAmounts } from './statements';

export const BULK_STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  rejected: 'Returned to Finance',
  approved: 'Approved',
  cancelled: 'Cancelled',
} as const;

export const BulkInvoiceModal: React.FC<{
  statementId: string;
  onClose: () => void;
  onOpenInvoice: (id: string) => void;
  onPay: (statementId: string) => void;
}> = ({ statementId, onClose, onOpenInvoice, onPay }) => {
  useDataStore();
  const st = dataService.getStatementById(statementId);
  const { userProfile, effectiveRole } = useAuth();
  const { success, warning, error } = useNotification();
  const pdf = usePdfAction();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'view' | 'reject' | 'cancel'>('view');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  if (!st) return null;

  const actor = {
    uid: userProfile?.uid || '', email: userProfile?.email || 'admin',
    name: userProfile?.displayName || userProfile?.email || 'Staff', businessEmail: userProfile?.businessEmail || userProfile?.email || '',
  };
  const a = statementAmounts(st);
  const isSuperAdmin = baseRoleOf(effectiveRole) === 'super_admin';
  const isApprover = canApproveInvoices(effectiveRole);
  const canFinance = canEditModule(effectiveRole, 'invoices') || isApprover;
  const ownSubmission = st.submittedBy === userProfile?.uid;
  const canDecide = isApprover && st.status === 'pending_approval' && (isSuperAdmin || !ownSubmission);
  const number = st.statementNumber.startsWith('DRAFT-') ? 'Draft bulk invoice' : st.statementNumber;

  const run = async (label: string, fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      error(label, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => !busy && onClose()}
      title={`${number} — ${st.customerName}`}
      subtitle={`Bulk invoice · ${a.current.length} job(s) · ${formatDate(st.periodStart)} – ${formatDate(st.periodEnd)} · ${BULK_STATUS_LABELS[st.status]}`}
      maxWidth="880px"
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', width: '100%', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
          {isSuperAdmin && st.status === 'approved' && (
            <button className="btn btn-ghost" disabled={pdf.busy === st.id} onClick={() => pdf.run(st.id, () => pdfGenerator.generateStatementPDF(st))} title="Super admin only">
              <Download size={14} /> PDF
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {canFinance && ['pending_approval', 'rejected', 'draft'].includes(st.status) && (
              <button className="btn btn-secondary" disabled={busy} onClick={() => { setMode('cancel'); setReason(''); }}>Cancel</button>
            )}
            {canFinance && st.status === 'rejected' && (
              <button className="btn btn-primary" disabled={busy} onClick={() => run('Could not resubmit', () => { resubmitStatement(st, actor); success('Resubmitted', 'Sent back for approval.'); })}>
                <RotateCcw size={14} /> Resubmit for approval
              </button>
            )}
            {canDecide && (
              <>
                <button className="btn btn-danger" disabled={busy} onClick={() => { setMode('reject'); setReason(''); }}><XCircle size={14} /> Reject</button>
                <button className="btn btn-primary" style={{ backgroundColor: 'var(--ikpm-emerald-600)' }} disabled={busy}
                  onClick={() => run('Could not approve', async () => {
                    const { notes } = await approveStatement(st, actor);
                    success('Invoice approved', `${a.current.length} job invoice(s) are final. Next: Send to client.${notes.length ? ` ${notes.join('; ')}.` : ''}`);
                  })}>
                  <CheckCircle2 size={14} /> {busy ? 'Approving…' : 'Approve'}
                </button>
              </>
            )}
            {st.status === 'approved' && canFinance && (
              <>
                {a.totalDue > 0 && (
                  <button className="btn btn-secondary" disabled={busy} onClick={() => onPay(st.id)}><Receipt size={14} /> Record payment</button>
                )}
                <button className="btn btn-primary" disabled={busy || Boolean(sendBlocker())} title={sendBlocker()} onClick={() => setSending(true)}>
                  <Send size={14} /> {st.sentAt ? 'Resend to client' : 'Send to client'}
                </button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', fontSize: '0.85rem' }}>
        {st.status === 'rejected' && st.rejectionReason && (
          <div style={{ padding: '0.6rem 0.75rem', backgroundColor: 'var(--ikpm-rose-100)', color: '#991B1B', borderRadius: 'var(--radius-md)' }}>
            <strong>Returned by {st.rejectedBy}:</strong> {st.rejectionReason}
          </div>
        )}
        {isApprover && st.status === 'pending_approval' && ownSubmission && !isSuperAdmin && (
          <div className="empty-hint">You created this invoice, so another admin or the super admin approves it.</div>
        )}
        <div className="cell-sub">
          Created by {st.submittedByName || '—'}{st.submittedAt ? ` on ${formatDate(st.submittedAt)}` : ''}
          {st.contractId ? ` · contract ${st.contractId}` : ''}
          {st.approvedBy ? ` · approved by ${st.approvedBy} on ${formatDate(st.approvedAt!)}` : ''}
          {st.sentAt ? ` · sent ${st.sentVia === 'whatsapp' ? 'on WhatsApp' : 'by email'} to ${st.sentTo} on ${formatDate(st.sentAt)}` : ''}
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead><tr><th>Job invoice</th><th>Job / services</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Balance</th><th /></tr></thead>
            <tbody>
              {a.current.map((inv) => (
                <tr key={inv.id}>
                  <td className="cell-title">{inv.invoiceNumber.startsWith('DRAFT-') ? 'Draft' : inv.invoiceNumber}</td>
                  <td>{inv.lineItems.map((l) => l.description).join('; ')}</td>
                  <td style={{ textAlign: 'right' }}>{formatPKR(inv.grossPayable)}</td>
                  <td style={{ textAlign: 'right' }}>{st.status === 'approved' ? formatPKR(inv.balanceDue) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => onOpenInvoice(inv.id)}>{isApprover && st.status === 'pending_approval' ? 'Adjust' : 'Open'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pricing-summary" style={{ textAlign: 'right' }}>
          <div>Total: {formatPKR(a.periodTotal)} <span className="cell-sub">({formatPKR(a.subtotal)} + tax {formatPKR(a.taxTotal)})</span></div>
          {a.paid > 0 && <div>Received: - {formatPKR(a.paid)}</div>}
          <div className="pricing-grand">Balance due: {formatPKR(a.totalDue)}</div>
        </div>

        {(mode === 'reject' || mode === 'cancel') && (
          <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label className="form-label">{mode === 'reject' ? 'What should Finance correct?' : 'Why cancel? (its jobs go back to Completed jobs)'} *</label>
            <textarea className="form-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-sm btn-danger" disabled={!reason.trim() || busy}
                onClick={() => run(mode === 'reject' ? 'Could not reject' : 'Could not cancel', () => {
                  if (mode === 'reject') { rejectStatement(st, reason, actor); warning('Returned to Finance', reason); }
                  else { cancelStatement(st, reason, actor); success('Bulk invoice cancelled', 'Its jobs can be invoiced again.'); onClose(); }
                  setMode('view');
                })}>
                {mode === 'reject' ? 'Return to Finance' : 'Cancel invoice'}
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => setMode('view')}>Back</button>
            </div>
          </div>
        )}
      </div>
      {sending && <InvoiceSendModal statement={st} onClose={() => setSending(false)} onSent={() => setSending(false)} />}
    </Modal>
  );
};
