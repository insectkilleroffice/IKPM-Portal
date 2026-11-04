// Payments: record money received against an invoice (individual or bulk). A bulk invoice's payment
// settles the job invoices inside it, oldest first. All receipts are listed below.

import React, { useMemo, useState } from 'react';
import { Receipt } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDataStore } from '../../hooks/useDataStore';
import { canEditModule } from '../../lib/permissions';
import { formatDate, formatPKR } from '../../lib/formatters';
import { dataService } from '../../services/dataService';
import type { PaymentReceipt } from '../../types/finance';
import { recordInvoicePayment, recordStatementPayment, statementAmounts } from './statements';

/** "inv:ID" (individual invoice) or "bulk:ID" (bulk invoice). */
export type PayTarget = string;

export const PaymentsTab: React.FC<{ preselect?: PayTarget }> = ({ preselect }) => {
  const store = useDataStore();
  const version = store.getVersion();
  const { userProfile, effectiveRole } = useAuth();
  const { success, error } = useNotification();
  const canRecord = canEditModule(effectiveRole, 'invoices');

  // Approved invoices still owed: bulk invoices, and individual invoices that aren't inside one
  const owed = useMemo(() => {
    const bulk = dataService.getStatements().filter((s) => s.status === 'approved')
      .map((s) => ({ key: `bulk:${s.id}`, number: s.statementNumber, client: s.customerName, date: s.issueDate, due: statementAmounts(s).totalDue, label: `Bulk · ${s.invoiceIds.length} job(s)` }))
      .filter((x) => x.due > 0);
    const single = dataService.getInvoices().filter((i) => !i.statementId && i.status !== 'void_reversed' && i.balanceDue > 0)
      .map((i) => ({ key: `inv:${i.id}`, number: i.invoiceNumber, client: i.customerName, date: i.issueDate, due: i.balanceDue, label: 'Invoice' }));
    return [...bulk, ...single].sort((a, b) => a.client.localeCompare(b.client) || a.date.localeCompare(b.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const [target, setTarget] = useState<PayTarget>(preselect || '');
  const sel = owed.find((o) => o.key === target);
  const [amount, setAmount] = useState<number | ''>('');
  const [mode, setMode] = useState<PaymentReceipt['paymentMode']>('bank_transfer');
  const [reference, setReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [hasWht, setHasWht] = useState(false);
  const [wht, setWht] = useState(0);
  const [cert, setCert] = useState('');
  const [busy, setBusy] = useState(false);
  const cash = amount === '' ? 0 : amount;
  const credit = cash + (hasWht ? wht : 0);
  const problems = [
    !sel && 'Choose the invoice.',
    !(credit > 0) && 'Enter the amount received.',
    sel && credit > sel.due + 0.01 && `More than the balance (${formatPKR(sel.due)}).`,
    mode !== 'cash' && !reference.trim() && (mode === 'cross_cheque' ? 'Enter the cheque number.' : 'Enter the bank / transfer reference.'),
  ].filter(Boolean) as string[];

  const save = async () => {
    if (problems.length || !sel) return;
    setBusy(true);
    try {
      const actor = { uid: userProfile?.uid || '', email: userProfile?.email || 'admin', name: userProfile?.displayName || 'Finance', businessEmail: userProfile?.businessEmail || userProfile?.email || '' };
      const pay = { cash, wht: hasWht ? wht : 0, whtCertificateNumber: hasWht ? cert.trim() || undefined : undefined, mode, reference: reference.trim() || undefined, bankName: bankName.trim() || undefined, date };
      const [kind, id] = sel.key.split(':');
      const receipts = kind === 'bulk'
        ? await recordStatementPayment(dataService.getStatementById(id)!, pay, actor)
        : await recordInvoicePayment(dataService.getInvoiceById(id)!, pay, actor);
      success('Payment recorded', `${formatPKR(credit)} on ${sel.number}${receipts.length > 1 ? `, settling ${receipts.length} job invoices oldest first` : ''}.`);
      setTarget(''); setAmount(''); setReference(''); setBankName(''); setHasWht(false); setWht(0); setCert('');
    } catch (err) {
      error('Could not record the payment', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const receipts = dataService.getPayments().slice().sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || '') || b.createdAt.localeCompare(a.createdAt));

  return (
    <div>
      {canRecord && (
        <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
          <div className="card-title" style={{ marginBottom: '0.6rem' }}><Receipt size={15} /> Record payment</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.6rem', alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Invoice *</label>
              <select className="form-select" value={target} onChange={(e) => { setTarget(e.target.value); setAmount(''); }}>
                <option value="">{owed.length ? 'Choose an unpaid invoice…' : 'No approved invoices are owed'}</option>
                {owed.map((o) => <option key={o.key} value={o.key}>{o.client} — {o.number} ({o.label}) — owes {formatPKR(o.due)}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Amount received *</label>
              <input type="number" min={0} className="form-input" value={amount} placeholder={sel ? String(sel.due) : ''}
                onChange={(e) => setAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Paid by</label>
              <select className="form-select" value={mode} onChange={(e) => setMode(e.target.value as PaymentReceipt['paymentMode'])}>
                <option value="bank_transfer">Bank transfer</option><option value="cross_cheque">Cheque</option>
                <option value="pay_order">Pay order</option><option value="online_portal">Online / wallet</option><option value="cash">Cash</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {mode !== 'cash' && (
              <>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">{mode === 'cross_cheque' ? 'Cheque No. *' : 'Reference *'}</label>
                  <input className="form-input" value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Bank</label>
                  <input className="form-input" value={bankName} placeholder="e.g. Meezan Bank" onChange={(e) => setBankName(e.target.value)} />
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
            <label className="doc-check" style={{ margin: 0 }}>
              <input type="checkbox" checked={hasWht} onChange={(e) => setHasWht(e.target.checked)} />
              <span>Client deducted WHT</span>
            </label>
            {hasWht && (
              <>
                <input type="number" min={0} className="form-input" style={{ width: 130 }} placeholder="WHT amount" value={wht} onChange={(e) => setWht(Math.max(0, Number(e.target.value)))} />
                <input className="form-input" style={{ width: 170 }} placeholder="Certificate No." value={cert} onChange={(e) => setCert(e.target.value)} />
              </>
            )}
            {sel && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAmount(Math.round((sel.due - (hasWht ? wht : 0)) * 100) / 100)}>Full balance</button>}
            <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={busy || problems.length > 0} title={problems.join('\n')} onClick={save}>
              {busy ? 'Saving…' : `Record ${formatPKR(credit)}`}
            </button>
          </div>
          {problems.length > 0 && credit > 0 && <div className="cell-sub" style={{ color: '#B45309', marginTop: 6 }}>{problems.join(' ')}</div>}
        </div>
      )}

      {/* Cash handover: cash Supervisors collected on site that Finance has not recorded as received */}
      {(() => {
        const received = (jobId: string) => dataService.getPayments().some((p) => p.paymentMode === 'cash' && (p.bankReferenceNo || '').includes(`job ${jobId}`));
        const pending = dataService.getJobs().filter((j) => (j.cashCollection?.amount || 0) > 0 && !j.cashCollection?.receivedByFinanceAt && !received(j.id));
        if (!pending.length) return null;
        const bySup = new Map<string, { name: string; total: number; jobs: typeof pending }>();
        pending.forEach((j) => {
          const key = j.cashCollection!.collectedByUid || j.cashCollection!.collectedByName || '?';
          const cur = bySup.get(key) ?? { name: j.cashCollection!.collectedByName || 'Supervisor', total: 0, jobs: [] };
          cur.total += j.cashCollection!.amount;
          cur.jobs.push(j);
          bySup.set(key, cur);
        });
        return (
          <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem', borderLeft: '4px solid var(--ikpm-amber-500, #F59E0B)' }}>
            <div className="card-title" style={{ marginBottom: '0.25rem' }}>Cash with Supervisors — {formatPKR(pending.reduce((s, j) => s + j.cashCollection!.amount, 0))}</div>
            <div className="cell-sub" style={{ marginBottom: '0.6rem' }}>Collected from clients on site, not yet handed over and recorded. It is recorded automatically when the job's invoice is approved.</div>
            <table className="data-table">
              <thead><tr><th>Supervisor</th><th style={{ textAlign: 'center' }}>Jobs</th><th>Oldest</th><th style={{ textAlign: 'right' }}>Cash held</th></tr></thead>
              <tbody>
                {[...bySup.values()].sort((a, b) => b.total - a.total).map((s) => (
                  <tr key={s.name}>
                    <td className="cell-title">{s.name}<div className="cell-sub">{s.jobs.map((j) => `${j.id} (${j.customerName})`).join(', ')}</div></td>
                    <td style={{ textAlign: 'center' }}>{s.jobs.length}</td>
                    <td>{formatDate(s.jobs.map((j) => j.cashCollection!.collectedAt).sort()[0])}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatPKR(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Receipt</th><th>Client</th><th>Invoice</th><th>Paid by</th><th style={{ textAlign: 'right' }}>Received</th><th style={{ textAlign: 'right' }}>WHT</th></tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr><td colSpan={7} className="cell-sub" style={{ textAlign: 'center', padding: '1.25rem' }}>No payments recorded yet.</td></tr>
            ) : receipts.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(r.paymentDate)}</td>
                <td className="cell-title">{r.receiptNumber}</td>
                <td>{r.customerName}</td>
                <td>{r.invoiceNumber}{r.bankReferenceNo ? <div className="cell-sub">{r.bankReferenceNo}</div> : null}</td>
                <td style={{ textTransform: 'capitalize' }}>{String(r.paymentMode ?? '').replace(/_/g, ' ')}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatPKR(r.cashAmountReceived)}</td>
                <td style={{ textAlign: 'right' }}>
                  {r.customerWhtDeducted?.amountDeducted ? formatPKR(r.customerWhtDeducted.amountDeducted) : '—'}
                  {r.customerWhtDeducted?.amountDeducted > 0 && (r.customerWhtDeducted.certificateNumber
                    ? <div className="cell-sub">Cert. {r.customerWhtDeducted.certificateNumber}</div>
                    : canRecord && (
                      <button type="button" className="btn btn-sm btn-ghost" style={{ color: '#B45309' }} onClick={() => {
                        const cert = window.prompt(`WHT certificate number for ${r.receiptNumber}`);
                        if (!cert) return;
                        try { dataService.addWhtCertificate(r.id, cert, userProfile?.email); success('Certificate added', cert); }
                        catch (err) { error('Could not add', err instanceof Error ? err.message : String(err)); }
                      }}>Certificate pending — add</button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
