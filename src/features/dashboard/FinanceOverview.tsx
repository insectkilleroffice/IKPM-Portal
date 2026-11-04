// Finance overview on the admin dashboard: what was invoiced (with amounts), what was collected
// against which invoice, what is owed / overdue, what waits for approval or to be invoiced, and a
// six-month invoiced-vs-collected trend. Every number links to the Invoices page.

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, FileStack, Receipt, Wallet } from 'lucide-react';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { canApproveInvoices } from '../../lib/permissions';
import { formatDate, formatPKR } from '../../lib/formatters';
import { dataService } from '../../services/dataService';
import { billableVisits, visitPrice, type MonthlyBill } from '../invoices/monthlyBilling';
import { isUnpostedInvoice } from '../../types/finance';

type Period = 'this_month' | 'last_month' | 'this_year';
const PERIOD_LABELS: Record<Period, string> = { this_month: 'This month', last_month: 'Last month', this_year: 'This year' };

// Categorical slots 1 and 2 of the validated chart palette (blue / orange)
const INVOICED_COLOR = '#2a78d6';
const COLLECTED_COLOR = '#eb6834';

const monthKey = (iso: string) => iso.slice(0, 7);
const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

function periodRange(p: Period): [string, string] {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (p === 'this_year') return [`${y}-01-01`, `${y}-12-31`];
  const start = new Date(Date.UTC(y, p === 'last_month' ? m - 1 : m, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return [iso(start), iso(end)];
}

const Tile: React.FC<{ title: string; value: string; sub?: string; icon: React.ReactNode; tone?: 'bad' | 'warn' | 'good'; onClick?: () => void }> = ({ title, value, sub, icon, tone, onClick }) => (
  <div className="kpi-card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
    <div>
      <div className="kpi-title">{title}</div>
      <div className="kpi-value" style={{ fontSize: '1.35rem', color: tone === 'bad' ? '#DC2626' : undefined }}>{value}</div>
      {sub && <div className="cell-sub">{sub}</div>}
    </div>
    <div className="kpi-icon" style={{ backgroundColor: tone === 'bad' ? '#FEE2E2' : tone === 'warn' ? '#FEF3C7' : tone === 'good' ? '#D1FAE5' : '#E0E7FF', color: tone === 'bad' ? '#DC2626' : tone === 'warn' ? '#B45309' : tone === 'good' ? 'var(--ikpm-emerald-600)' : 'var(--ikpm-navy-700)' }}>
      {icon}
    </div>
  </div>
);

export const FinanceOverview: React.FC = () => {
  const store = useDataStore();
  const version = store.getVersion();
  const navigate = useNavigate();
  const { effectiveRole } = useAuth();
  const [period, setPeriod] = useState<Period>('this_month');
  const [hover, setHover] = useState<string | null>(null);
  const isApprover = canApproveInvoices(effectiveRole);
  const go = (tab: 'jobs' | 'invoices' | 'payments', extra = '') => navigate(`/finance/invoices?tab=${tab}${extra}`);

  const d = useMemo(() => {
    const [from, to] = periodRange(period);
    const today = new Date().toISOString().slice(0, 10);
    const all = dataService.getAllInvoices();
    const posted = dataService.getInvoices().filter((i) => i.status !== 'void_reversed');
    const payments = dataService.getPayments();
    const inPeriod = posted.filter((i) => i.issueDate >= from && i.issueDate <= to);
    const paidInPeriod = payments.filter((p) => p.paymentDate >= from && p.paymentDate <= to);
    const statements = dataService.getStatements();
    const pendingSingles = all.filter((i) => i.status === 'pending_approval' && !i.statementId);
    const pendingBulk = statements.filter((s) => s.status === 'pending_approval');
    const cache = new Map<string, MonthlyBill>();
    const ready = billableVisits();
    const received = (jobId: string) => payments.some((p) => p.paymentMode === 'cash' && (p.bankReferenceNo || '').includes(`job ${jobId}`));
    const cashHeld = dataService.getJobs().filter((j) => (j.cashCollection?.amount || 0) > 0 && !j.cashCollection?.receivedByFinanceAt && !received(j.id));

    // Who owes the most
    const owed = new Map<string, { name: string; balance: number; overdue: number }>();
    posted.filter((i) => i.balanceDue > 0).forEach((i) => {
      const cur = owed.get(i.customerId) ?? { name: i.customerName, balance: 0, overdue: 0 };
      cur.balance += i.balanceDue;
      if (i.dueDate < today) cur.overdue += i.balanceDue;
      owed.set(i.customerId, cur);
    });

    // Last six months: invoiced vs collected
    const months: string[] = [];
    const now = new Date();
    for (let k = 5; k >= 0; k--) months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
    const trend = months.map((m) => ({
      month: m,
      invoiced: posted.filter((i) => monthKey(i.issueDate) === m).reduce((s, i) => s + i.grossPayable, 0),
      collected: payments.filter((p) => monthKey(p.paymentDate) === m).reduce((s, p) => s + p.cashAmountReceived + (p.customerWhtDeducted?.amountDeducted || 0), 0),
    }));

    return {
      invoiced: inPeriod.reduce((s, i) => s + i.grossPayable, 0),
      invoicedCount: inPeriod.length,
      collected: paidInPeriod.reduce((s, p) => s + p.cashAmountReceived, 0),
      wht: paidInPeriod.reduce((s, p) => s + (p.customerWhtDeducted?.amountDeducted || 0), 0),
      receiptCount: paidInPeriod.length,
      outstanding: posted.reduce((s, i) => s + i.balanceDue, 0),
      overdue: posted.filter((i) => i.balanceDue > 0 && i.dueDate < today),
      pendingCount: pendingSingles.length + pendingBulk.length,
      pendingAmount: pendingSingles.reduce((s, i) => s + i.grossPayable, 0) + pendingBulk.reduce((s, b) => s + b.periodTotal, 0),
      returned: all.filter((i) => i.status === 'rejected' && !i.statementId).length + statements.filter((s) => s.status === 'rejected').length,
      readyCount: ready.length,
      readyValue: ready.reduce((s, j) => s + visitPrice(j, cache).amount, 0),
      cashHeld: cashHeld.reduce((s, j) => s + (j.cashCollection?.amount || 0), 0),
      cashJobs: cashHeld.length,
      notSent: posted.filter((i) => !i.statementId && !i.sentAt && !isUnpostedInvoice(i)).length + statements.filter((s) => s.status === 'approved' && !s.sentAt).length,
      recentInvoices: posted.slice().sort((a, b) => (b.postedAt || b.issueDate).localeCompare(a.postedAt || a.issueDate)).slice(0, 8),
      recentPayments: payments.slice().sort((a, b) => (b.paymentDate + b.createdAt).localeCompare(a.paymentDate + a.createdAt)).slice(0, 8),
      debtors: [...owed.values()].sort((a, b) => b.balance - a.balance).slice(0, 5),
      trend,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, version]);

  const max = Math.max(1, ...d.trend.flatMap((t) => [t.invoiced, t.collected]));
  const overdueTotal = d.overdue.reduce((s, i) => s + i.balanceDue, 0);

  return (
    <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '1rem', color: 'var(--ikpm-navy-900)' }}><Wallet size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} />Finance</strong>
        <div className="chip-row" style={{ marginBottom: 0 }}>
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button key={p} type="button" className={`chip ${period === p ? 'chip-on' : ''}`} onClick={() => setPeriod(p)}>{PERIOD_LABELS[p]}</button>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => go('invoices')}>Open invoices</button>
      </div>

      {/* Headline numbers */}
      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <Tile title={`Invoiced · ${PERIOD_LABELS[period].toLowerCase()}`} value={formatPKR(d.invoiced)} sub={`${d.invoicedCount} approved invoice(s)`} icon={<Receipt size={20} />} onClick={() => go('invoices')} />
        <Tile title={`Collected · ${PERIOD_LABELS[period].toLowerCase()}`} value={formatPKR(d.collected)} sub={`${d.receiptCount} receipt(s)${d.wht ? ` · WHT ${formatPKR(d.wht)}` : ''}`} icon={<CheckCircle2 size={20} />} tone="good" onClick={() => go('payments')} />
        <Tile title="Outstanding (all)" value={formatPKR(d.outstanding)} sub={overdueTotal ? `${formatPKR(overdueTotal)} overdue (${d.overdue.length})` : 'Nothing overdue'} icon={<AlertTriangle size={20} />} tone={overdueTotal ? 'bad' : undefined} onClick={() => go('invoices')} />
        <Tile title={isApprover ? 'Waiting for your approval' : 'Waiting for approval'} value={String(d.pendingCount)} sub={`${formatPKR(d.pendingAmount)}${d.returned ? ` · ${d.returned} returned to Finance` : ''}`} icon={<Clock size={20} />} tone={d.pendingCount ? 'warn' : undefined} onClick={() => go('invoices')} />
      </div>
      <div className="cell-sub" style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => go('jobs')}><FileStack size={13} /> {d.readyCount} completed job(s) ready to invoice · {formatPKR(d.readyValue)}</button>
        {d.notSent > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => go('invoices')}>{d.notSent} approved invoice(s) not sent to the client yet</button>}
        {d.cashHeld > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => go('payments')}>{formatPKR(d.cashHeld)} cash with Supervisors ({d.cashJobs} job(s))</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        {/* Six-month trend: invoiced vs collected (one axis, PKR) */}
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.25rem' }}>Invoiced vs collected — last 6 months</div>
          <div style={{ display: 'flex', gap: '0.9rem', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: INVOICED_COLOR, marginRight: 4 }} />Invoiced</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: COLLECTED_COLOR, marginRight: 4 }} />Collected</span>
          </div>
          <div role="img" aria-label="Invoiced and collected per month, last six months" style={{ display: 'flex', alignItems: 'flex-end', gap: '0.6rem', height: 150, borderBottom: '1px solid var(--border-subtle)', padding: '0 0.25rem' }}>
            {d.trend.map((t) => (
              <div key={t.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', position: 'relative' }}
                onMouseEnter={() => setHover(t.month)} onMouseLeave={() => setHover(null)}>
                {hover === t.month && (
                  <div style={{ position: 'absolute', bottom: '100%', marginBottom: 4, background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '0.35rem 0.5rem', fontSize: '0.72rem', whiteSpace: 'nowrap', zIndex: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', color: 'var(--text-primary)' }}>
                    <strong>{monthName(t.month)}</strong><br />Invoiced {formatPKR(t.invoiced)}<br />Collected {formatPKR(t.collected)}
                  </div>
                )}
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                  <div style={{ width: '38%', maxWidth: 18, height: `${(t.invoiced / max) * 100}%`, minHeight: t.invoiced ? 2 : 0, background: INVOICED_COLOR, borderRadius: '4px 4px 0 0' }} />
                  <div style={{ width: '38%', maxWidth: 18, height: `${(t.collected / max) * 100}%`, minHeight: t.collected ? 2 : 0, background: COLLECTED_COLOR, borderRadius: '4px 4px 0 0' }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', padding: '0.2rem 0.25rem 0' }}>
            {d.trend.map((t) => <div key={t.month} style={{ flex: 1, textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{monthName(t.month)}<br />{compact(t.invoiced)}</div>)}
          </div>
        </div>

        {/* Who owes the most */}
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.4rem' }}>Top balances owed</div>
          {!d.debtors.length ? <div className="cell-sub">Nobody owes anything.</div> : (
            <table className="data-table">
              <tbody>
                {d.debtors.map((x) => (
                  <tr key={x.name}>
                    <td className="cell-title">{x.name}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatPKR(x.balance)}{x.overdue > 0 && <div className="cell-sub" style={{ color: '#DC2626' }}>{formatPKR(x.overdue)} overdue</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
        {/* Recent invoices with amounts */}
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.4rem' }}>Recent invoices</div>
          {!d.recentInvoices.length ? <div className="cell-sub">No approved invoices yet.</div> : (
            <table className="data-table">
              <thead><tr><th>Invoice</th><th>Client</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
              <tbody>
                {d.recentInvoices.map((i) => (
                  <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => go('invoices', `&invoice=${i.id}`)}>
                    <td className="cell-title">{i.invoiceNumber}<div className="cell-sub">{formatDate(i.issueDate)}</div></td>
                    <td>{i.customerName}</td>
                    <td style={{ textAlign: 'right' }}>{formatPKR(i.grossPayable)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: i.balanceDue > 0 ? (i.dueDate < new Date().toISOString().slice(0, 10) ? '#DC2626' : undefined) : 'var(--ikpm-emerald-600)' }}>
                      {i.balanceDue > 0 ? formatPKR(i.balanceDue) : 'Paid'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent payments, against their invoices */}
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.4rem' }}>Recent payments</div>
          {!d.recentPayments.length ? <div className="cell-sub">No payments recorded yet.</div> : (
            <table className="data-table">
              <thead><tr><th>Date</th><th>Client · invoice</th><th>Paid by</th><th style={{ textAlign: 'right' }}>Received</th></tr></thead>
              <tbody>
                {d.recentPayments.map((p) => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => go('payments')}>
                    <td>{formatDate(p.paymentDate)}</td>
                    <td>{p.customerName}<div className="cell-sub">{p.invoiceNumber} · {p.receiptNumber}</div></td>
                    <td style={{ textTransform: 'capitalize' }}>{String(p.paymentMode ?? '').replace(/_/g, ' ')}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatPKR(p.cashAmountReceived)}{p.customerWhtDeducted?.amountDeducted ? <div className="cell-sub">+ WHT {formatPKR(p.customerWhtDeducted.amountDeducted)}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
