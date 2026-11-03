// Draft invoice editor and approval screen.
// Finance: edit a draft (or a rejected one) and submit it for approval.
// Admin / super admin: review, edit if needed, then approve (final number + emailed to the client) or reject.

import React, { useMemo, useState } from 'react';
import { CheckCircle2, Plus, Save, Send, Trash2, XCircle } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { canApproveInvoices, canEditModule, baseRoleOf } from '../../lib/permissions';
import { formatDate, formatPKR } from '../../lib/formatters';
import { dataService } from '../../services/dataService';
import { billingAccountOf, type Invoice, type InvoiceLineItem } from '../../types/finance';
import { approveInvoice, describeChanges, invoiceProblems, recalcInvoice, type Actor } from './invoiceWorkflow';

const STATUS_TEXT: Record<string, string> = {
  draft: 'Draft — not yet submitted',
  pending_approval: 'Waiting for admin approval',
  rejected: 'Returned to Finance',
};

export const InvoiceDraftModal: React.FC<{
  invoice: Invoice;
  onClose: () => void;
  onDone: (inv: Invoice) => void;
}> = ({ invoice, onClose, onDone }) => {
  const { userProfile, effectiveRole } = useAuth();
  const { success, warning, error } = useNotification();
  const [draft, setDraft] = useState<Invoice>(() => recalcInvoice(invoice));
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const isCash = billingAccountOf(draft) === 'cash';
  const uid = userProfile?.uid || '';
  const isApprover = canApproveInvoices(effectiveRole);
  const isSuperAdmin = baseRoleOf(effectiveRole) === 'super_admin';
  const canEditDrafts = canEditModule(effectiveRole, 'invoices') || isApprover;
  const ownSubmission = Boolean(invoice.submittedBy && invoice.submittedBy === uid);

  // A job invoice on a client statement is approved and sent with the statement, not on its own
  const onStatement = Boolean(invoice.statementId);
  const statementNo = onStatement ? dataService.getStatementById(invoice.statementId!)?.statementNumber : undefined;
  // Finance edits drafts / returned invoices; approvers edit what is waiting for them
  const financeStage = (invoice.status === 'draft' || invoice.status === 'rejected') && !onStatement;
  const canEdit = canEditDrafts && (financeStage || ((invoice.status === 'pending_approval' || onStatement) && isApprover));
  // Lines come from done visits: Finance can't add, remove or reprice them; the approver can (and it is logged)
  const canEditLines = canEdit && isApprover;
  // Nobody approves their own submission, except the super admin
  const canApprove = !onStatement && isApprover && (isSuperAdmin || !ownSubmission)
    && (invoice.status === 'pending_approval' || (isSuperAdmin && financeStage));

  const actor: Actor = {
    uid,
    email: userProfile?.email || 'admin',
    name: userProfile?.displayName || userProfile?.email || 'Admin',
    businessEmail: userProfile?.businessEmail || userProfile?.email || '',
  };

  const problems = useMemo(() => invoiceProblems(draft), [draft]);
  const changes = describeChanges(invoice, draft);

  const setLine = (id: string, patch: Partial<InvoiceLineItem>) =>
    setDraft((d) => recalcInvoice(d, d.lineItems.map((l) => (l.id === id ? { ...l, ...patch } : l))));
  const addLine = () =>
    setDraft((d) => recalcInvoice(d, [...d.lineItems, {
      id: `li_${Date.now()}`,
      description: '',
      serviceCategory: d.lineItems[0]?.serviceCategory || (isCash ? 'Pest control service' : 'Pest Control Services (Tariff 9822.3000)'),
      quantity: 1,
      unitPrice: 0,
      amount: 0,
      taxRatePercent: isCash ? 0 : d.lineItems[0]?.taxRatePercent ?? 0,
      taxAmount: 0,
      totalWithTax: 0,
    }]));
  const removeLine = (id: string) => setDraft((d) => recalcInvoice(d, d.lineItems.filter((l) => l.id !== id)));

  const save = (next: Invoice, message: [string, string]) => {
    const saved = { ...next, updatedAt: new Date().toISOString() };
    dataService.saveInvoice(saved, actor.email);
    success(...message);
    onDone(saved);
  };

  const handleSaveDraft = () => save(draft, ['Draft saved', `${draft.invoiceNumber} saved.`]);

  const handleSubmit = () => {
    if (problems.length) return warning('Please correct the invoice', problems.join(' '));
    save({
      ...draft,
      status: 'pending_approval',
      submittedBy: uid,
      submittedByName: actor.name,
      submittedAt: new Date().toISOString(),
    }, ['Submitted for approval', 'An admin will review it. It is sent to the client only after approval.']);
  };

  const handleReject = () => {
    if (!rejectReason.trim()) return warning('Reason required', 'Tell Finance what to correct.');
    save({
      ...draft,
      status: 'rejected',
      rejectedBy: actor.name,
      rejectedAt: new Date().toISOString(),
      rejectionReason: rejectReason.trim(),
    }, ['Invoice returned to Finance', rejectReason.trim()]);
  };

  const handleApprove = async () => {
    if (problems.length) return warning('Please correct the invoice', problems.join(' '));
    setBusy('approve');
    try {
      const { invoice: done, cashNote, cashError } = await approveInvoice(invoice, draft, actor);
      success('Invoice approved', `${done.invoiceNumber} is final.${cashNote ? ` ${cashNote}.` : ''} Next: press "Send to client".`);
      if (cashError) warning('Cash not recorded', cashError);
      onDone(done);
    } catch (err) {
      error('Could not approve the invoice', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${isCash ? 'Cash memo' : 'Invoice'} draft — ${invoice.customerName}`}
      subtitle={`${STATUS_TEXT[invoice.status] || invoice.status}${invoice.submittedByName ? ` · submitted by ${invoice.submittedByName}${invoice.submittedAt ? ` on ${formatDate(invoice.submittedAt)}` : ''}` : ''}`}
      maxWidth="860px"
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', width: '100%', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={Boolean(busy)}>Close</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {canEdit && (
              <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={Boolean(busy)}>
                <Save size={14} /> <span>Save changes</span>
              </button>
            )}
            {canEdit && financeStage && (
              <button className="btn btn-primary" onClick={handleSubmit} disabled={Boolean(busy) || problems.length > 0} title={problems.join('\n')}>
                <Send size={14} /> <span>Submit for approval</span>
              </button>
            )}
            {canApprove && !rejecting && invoice.status === 'pending_approval' && (
              <button className="btn btn-danger" onClick={() => setRejecting(true)} disabled={Boolean(busy)}>
                <XCircle size={14} /> <span>Reject</span>
              </button>
            )}
            {canApprove && (
              <button
                className="btn btn-primary"
                style={{ backgroundColor: 'var(--ikpm-emerald-600)' }}
                onClick={handleApprove}
                disabled={Boolean(busy) || problems.length > 0}
                title={problems.join('\n')}
              >
                <CheckCircle2 size={14} /> <span>{busy === 'approve' ? 'Approving…' : 'Approve invoice'}</span>
              </button>
            )}
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
        {onStatement && (
          <div className="info-hint">
            This visit invoice is on statement {statementNo?.startsWith('DRAFT-') ? '(draft)' : statementNo}. It is approved and sent with the statement{isApprover ? '; you can adjust it here, then approve the statement' : ''}.
          </div>
        )}
        {invoice.status === 'rejected' && invoice.rejectionReason && (
          <div style={{ padding: '0.75rem', backgroundColor: 'var(--ikpm-rose-100)', color: '#991B1B', borderRadius: 'var(--radius-md)' }}>
            <strong>Returned by {invoice.rejectedBy || 'admin'}:</strong> {invoice.rejectionReason}
          </div>
        )}
        {isApprover && invoice.status === 'pending_approval' && ownSubmission && !isSuperAdmin && (
          <div className="empty-hint">You submitted this invoice, so another admin or the super admin must approve it.</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Bill to</span>
            <div style={{ fontWeight: 700 }}>{draft.customerName}{draft.branchName ? ` — ${draft.branchName}` : ''}</div>
            <div className="cell-sub">{draft.billingAddress}</div>
            <div className="cell-sub">{isCash ? 'Cash memo (no tax)' : `Sales tax invoice · ${draft.jurisdiction.toUpperCase()}`}{draft.jobId ? ` · Job ${draft.jobId}` : ''}</div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Issue date</label>
            <input type="date" className="form-input" disabled={!canEdit} value={draft.issueDate}
              onChange={(e) => setDraft({ ...draft, issueDate: e.target.value })} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Due date</label>
            <input type="date" className="form-input" disabled={!canEdit} min={draft.issueDate} value={draft.dueDate}
              onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '45%' }}>Description</th>
                <th style={{ width: 70 }}>Qty</th>
                <th>Rate (PKR)</th>
                {!isCash && <th style={{ width: 80 }}>Tax %</th>}
                <th style={{ textAlign: 'right' }}>Total</th>
                {canEditLines && <th />}
              </tr>
            </thead>
            <tbody>
              {draft.lineItems.map((li) => (
                <tr key={li.id}>
                  <td>
                    <input className="form-input" disabled={!canEditLines} value={li.description}
                      onChange={(e) => setLine(li.id, { description: e.target.value })} />
                  </td>
                  <td>
                    <input type="number" min={1} className="form-input" disabled={!canEditLines} value={li.quantity}
                      onChange={(e) => setLine(li.id, { quantity: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input type="number" min={0} className="form-input" disabled={!canEditLines} value={li.unitPrice}
                      onChange={(e) => setLine(li.id, { unitPrice: Number(e.target.value) })} />
                  </td>
                  {!isCash && (
                    <td>
                      <input type="number" min={0} max={100} className="form-input" disabled={!canEditLines} value={li.taxRatePercent}
                        onChange={(e) => setLine(li.id, { taxRatePercent: Number(e.target.value) })} />
                    </td>
                  )}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatPKR(li.totalWithTax)}</td>
                  {canEditLines && (
                    <td>
                      <button className="icon-btn" title="Remove line" disabled={draft.lineItems.length <= 1} onClick={() => removeLine(li.id)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEditLines && (
          <button className="btn btn-sm btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={addLine}>
            <Plus size={13} /> <span>Add line</span>
          </button>
        )}

        {canEdit && !canEditLines && (
          <div className="cell-sub">Lines are the costs of the done visits and can't be changed by Finance. An admin can adjust them when approving.</div>
        )}
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div>Subtotal: {formatPKR(draft.subtotal)}</div>
          {!isCash && <div>Sales tax: {formatPKR(draft.taxTotal)}</div>}
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>Total: {formatPKR(draft.grossPayable)}</div>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Notes (printed on the invoice)</label>
          <textarea className="form-input" rows={2} disabled={!canEdit} value={draft.notes || ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </div>

        {isApprover && invoice.status === 'pending_approval' && changes && (
          <div className="cell-sub">Your changes (kept on the invoice record): {changes}</div>
        )}
        {canApprove && (
          <div className="cell-sub">On approval the invoice gets its final number. You then send it to the client with "Send to client" (email or WhatsApp). No copy is downloaded.</div>
        )}

        {rejecting && (
          <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label className="form-label">What should Finance correct? <span className="required">*</span></label>
            <textarea className="form-input" rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-sm btn-danger" onClick={handleReject} disabled={!rejectReason.trim()}>Return to Finance</button>
              <button className="btn btn-sm btn-secondary" onClick={() => { setRejecting(false); setRejectReason(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
