// Cancelled contract settlement.
// Finance cannot invoice a cancelled contract: it submits a settlement report (what is owed, unpaid
// invoices, its recommendation and reasons) to the super admin. Only the super admin decides and
// creates the final invoice: done services only, or the full month; or settles with no charge.

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileWarning, Receipt, Send } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDataStore } from '../../hooks/useDataStore';
import { baseRoleOf } from '../../lib/permissions';
import { dataService } from '../../services/dataService';
import { formatDate, formatPKR } from '../../lib/formatters';
import { CONTRACT_CANCEL_CATEGORY_LABELS, type Contract } from '../../types/operations';
import type { Approval } from '../../types/approvals';
import {
  cancellationDate, createSettlementInvoice, SETTLEMENT_LABELS, settlementBill, settlementReportsOf,
  settlementStatus, unpaidInvoicesOf, type SettlementChoice,
} from './monthlyBilling';

const newApprovalId = () => `AP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

export const CancellationSettlementModal: React.FC<{ contract: Contract; onClose: () => void }> = ({ contract: c, onClose }) => {
  const store = useDataStore();
  const version = store.getVersion();
  const navigate = useNavigate();
  const { userProfile, effectiveRole } = useAuth();
  const { success, warning, error } = useNotification();
  const isSuperAdmin = baseRoleOf(effectiveRole) === 'super_admin';

  const { done, full, unpaid, reports, status } = useMemo(() => ({
    done: settlementBill(c, 'visits_done'),
    full: settlementBill(c, 'full_month'),
    unpaid: unpaidInvoicesOf(c),
    reports: settlementReportsOf(c.id),
    status: settlementStatus(c),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [c.id, version]);
  const pendingReport = reports.find((r) => r.status === 'pending');
  const decided = reports.find((r) => r.status === 'approved');

  const [choice, setChoice] = useState<SettlementChoice>(pendingReport?.settlementBasis || 'visits_done');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const totalOf = (k: SettlementChoice) => (k === 'visits_done' ? done.total : k === 'full_month' ? full.total : 0);
  const taxPct = c.customerType === 'company' ? c.taxPercent ?? 0 : 0;
  const unpaidTotal = unpaid.reduce((s, i) => s + i.balanceDue, 0);
  const user = { uid: userProfile?.uid || '', email: userProfile?.email || 'admin', name: userProfile?.displayName || 'Staff' };

  const summary = () => [
    `Cancelled ${formatDate(cancellationDate(c))} (${c.cancellation ? CONTRACT_CANCEL_CATEGORY_LABELS[c.cancellation.category] : 'no reason recorded'}).`,
    `Done services not invoiced: ${done.lines.length} visit(s), ${formatPKR(done.total)}. Full month: ${formatPKR(full.total)}.`,
    `Unpaid invoices: ${unpaid.length} (${formatPKR(unpaidTotal)}).`,
  ].join(' ');

  // Finance: report to the super admin
  const submitReport = () => {
    if (!note.trim()) return warning('Reason required', 'Explain the situation and why you recommend this option.');
    const ts = new Date().toISOString();
    const report: Approval = {
      id: newApprovalId(),
      type: 'contract_settlement',
      entityType: 'contract',
      entityId: c.id,
      entityTitle: `Settlement: ${c.id} — ${c.customerName}`,
      ownerUid: user.uid,
      requestedBy: user.email,
      requestedByName: user.name,
      requestedAt: ts,
      reason: `${note.trim()} — Recommends: ${SETTLEMENT_LABELS[choice]}. ${summary()}`,
      amount: totalOf(choice),
      settlementBasis: choice,
      status: 'pending',
      updatedAt: ts,
    };
    dataService.saveApproval(report, user.email);
    success('Settlement report sent', 'The super admin decides and creates the final invoice.');
    onClose();
  };

  // Super admin: decide (invoice or no charge)
  const decide = async () => {
    if (!isSuperAdmin) return;
    if (choice !== 'no_charge' && !totalOf(choice)) return warning('Nothing to invoice', 'Choose "No further charge", or another option.');
    setBusy(true);
    try {
      const ts = new Date().toISOString();
      const inv = choice === 'no_charge' ? undefined : await createSettlementInvoice(c, choice, user, true);
      const decision: Partial<Approval> = {
        status: 'approved',
        decidedBy: user.email,
        decidedByName: user.name,
        decidedAt: ts,
        decisionNote: `${SETTLEMENT_LABELS[choice]}${inv ? ` — invoice draft ${inv.id} (${formatPKR(inv.grossPayable)})` : ''}${note.trim() ? `: ${note.trim()}` : ''}`,
        settlementDecision: choice,
        ...(inv ? { settlementInvoiceId: inv.id } : {}),
        updatedAt: ts,
      };
      const open = reports.filter((r) => r.status === 'pending');
      if (open.length) open.forEach((r) => dataService.saveApproval({ ...r, ...decision } as Approval, user.email));
      else dataService.saveApproval({
        id: newApprovalId(), type: 'contract_settlement', entityType: 'contract', entityId: c.id,
        entityTitle: `Settlement: ${c.id} — ${c.customerName}`, ownerUid: user.uid, requestedBy: user.email, requestedByName: user.name,
        requestedAt: ts, reason: summary(), amount: totalOf(choice), ...decision,
      } as Approval, user.email);
      if (inv) {
        success('Final invoice created', `${formatPKR(inv.grossPayable)} for ${c.customerName}. Review and approve it to send it to the client.`);
        onClose();
        navigate(`/finance/invoices?invoice=${inv.id}`);
      } else {
        success('Settled without charge', `${c.id} is closed with no further invoice.`);
        onClose();
      }
    } catch (err) {
      error('Could not settle the contract', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const options: SettlementChoice[] = ['visits_done', 'full_month', 'no_charge'];

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Cancellation settlement — ${c.id}`}
      subtitle={`${c.customerName}${c.branchName ? ` · ${c.branchName}` : ''}`}
      maxWidth="820px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
          {status !== 'settled' && isSuperAdmin && (
            <button className="btn btn-primary" onClick={decide} disabled={busy}>
              <Receipt size={15} /> <span>{busy ? 'Working…' : choice === 'no_charge' ? 'Settle with no charge' : `Create final invoice · ${formatPKR(totalOf(choice) * (1 + taxPct / 100))}`}</span>
            </button>
          )}
          {status === 'open' && !isSuperAdmin && (
            <button className="btn btn-primary" onClick={submitReport} disabled={!note.trim()}>
              <Send size={15} /> <span>Submit report to super admin</span>
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
        <div style={{ padding: '0.75rem', backgroundColor: 'var(--ikpm-rose-100)', color: '#991B1B', borderRadius: 'var(--radius-md)' }}>
          <strong><FileWarning size={14} /> Cancelled{c.cancellation ? ` — ${CONTRACT_CANCEL_CATEGORY_LABELS[c.cancellation.category]}` : ''}.</strong>{' '}
          {c.cancellation?.reason} Last service day {formatDate(cancellationDate(c))}.
          {c.cancellation && <div className="cell-sub">Requested by {c.cancellation.requestedByName}{c.cancellation.approvedByName ? ` · approved by ${c.cancellation.approvedByName}` : ''}</div>}
        </div>

        <div>
          <div className="section-title" style={{ marginTop: 0 }}>Done services not invoiced yet ({done.lines.length})</div>
          {done.lines.length ? done.lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '2px 0' }}><span>{l.description}</span><strong>{formatPKR(l.amount)}</strong></div>
          )) : <div className="cell-sub">None — every done visit is already invoiced.</div>}
          {full.total > done.total && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '2px 0', color: 'var(--text-muted)' }}>
              <span>Full month adds: rest of the {new Date(`${full.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} charge</span>
              <strong>{formatPKR(full.total - done.total)}</strong>
            </div>
          )}
        </div>

        <div>
          <div className="section-title" style={{ marginTop: 0 }}>Unpaid invoices ({unpaid.length}) · {formatPKR(unpaidTotal)}</div>
          {unpaid.length ? unpaid.map((i) => (
            <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <span>{i.invoiceNumber} · due {formatDate(i.dueDate)}</span><strong>{formatPKR(i.balanceDue)}</strong>
            </div>
          )) : <div className="cell-sub">Nothing outstanding.</div>}
        </div>

        {reports.length > 0 && (
          <div>
            <div className="section-title" style={{ marginTop: 0 }}>Settlement reports</div>
            {reports.map((r) => (
              <div key={r.id} style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', marginBottom: 6 }}>
                <div><strong>{r.requestedByName}</strong> · {formatDate(r.requestedAt)} · {r.status === 'pending' ? 'waiting for the super admin' : r.status}</div>
                <div>{r.reason}</div>
                {r.decisionNote && <div className="cell-sub">Decision by {r.decidedByName}: {r.decisionNote}</div>}
              </div>
            ))}
          </div>
        )}

        {status === 'settled' ? (
          <div className="info-hint">Settled{decided?.settlementDecision ? `: ${SETTLEMENT_LABELS[decided.settlementDecision]}` : ''}. Nothing more to do here.</div>
        ) : !isSuperAdmin && status === 'reported' ? (
          <div className="info-hint">Your report is with the super admin. Only the super admin can invoice a cancelled contract.</div>
        ) : (
          <>
            <div>
              <div className="form-label">{isSuperAdmin ? 'Decision' : 'Your recommendation'}</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {options.map((k) => (
                  <label key={k} className="doc-check" style={{ border: `2px solid ${choice === k ? 'var(--ikpm-emerald-500, #10B981)' : 'var(--border-subtle)'}`, borderRadius: 8, padding: '0.45rem 0.7rem' }}>
                    <input type="radio" name="settle" checked={choice === k} onChange={() => setChoice(k)} />
                    <span><strong>{SETTLEMENT_LABELS[k]}</strong><span className="cell-sub" style={{ display: 'block' }}>{k === 'no_charge' ? 'Close with no further invoice' : `${formatPKR(totalOf(k))} before tax`}</span></span>
                  </label>
                ))}
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">{isSuperAdmin ? 'Decision note' : <>Report: reason and details <span className="required">*</span></>}</label>
              <textarea className="form-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={isSuperAdmin ? 'Optional' : 'e.g. Client closed the outlet on the 12th; notice was given late; agreed in the meeting to bill the full month'} />
            </div>
            {isSuperAdmin && choice !== 'no_charge' && (
              <div className="cell-sub">The final invoice is created as a draft with the cancellation reason on it. Review and approve it to send it to the client.</div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
