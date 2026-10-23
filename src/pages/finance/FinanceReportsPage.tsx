import React from 'react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { formatPKR } from '../../lib/formatters';
import { dataService } from '../../services/dataService';
import { useDataStore } from '../../hooks/useDataStore';

const JUR_LABEL: Record<string, string> = {
  sindh_srb: 'Sindh (SRB)',
  punjab_pra: 'Punjab (PRA)',
  islamabad_ict: 'Islamabad ICT',
  kpk_kpra: 'KPK (KPRA)',
  balochistan_bra: 'Balochistan (BRA)',
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

export const FinanceReportsPage: React.FC = () => {
  useDataStore();

  const invoices = dataService.getInvoices();
  const live = invoices.filter((i) => i.status !== 'void_reversed');

  const today = new Date().toISOString().split('T')[0];

  // ---- KPIs ----
  const totalBilled = live.reduce((s, i) => s + i.grossPayable, 0);
  const totalCollected = live.reduce((s, i) => s + i.amountPaid, 0);
  const totalOutstanding = live.reduce((s, i) => s + i.balanceDue, 0);
  const totalOverdue = live.filter((i) => i.balanceDue > 0 && i.dueDate < today).reduce((s, i) => s + i.balanceDue, 0);
  const totalTax = live.reduce((s, i) => s + i.taxTotal, 0);
  const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;

  // ---- Monthly revenue (last 6 months) ----
  const now = new Date();
  const months: string[] = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthly = months.map((ym) => {
    const batch = live.filter((i) => i.issueDate.startsWith(ym));
    return {
      ym,
      billed: batch.reduce((s, i) => s + i.grossPayable, 0),
      collected: batch.reduce((s, i) => s + i.amountPaid, 0),
      count: batch.length,
    };
  });

  // ---- Aging buckets ----
  const aging = [
    { label: '0–30 days', min: 0, max: 30 },
    { label: '31–60 days', min: 31, max: 60 },
    { label: '61–90 days', min: 61, max: 90 },
    { label: '90+ days', min: 91, max: Infinity },
  ].map(({ label, min, max }) => {
    const batch = live.filter((i) => {
      if (i.balanceDue <= 0) return false;
      const days = Math.floor((new Date(today).getTime() - new Date(i.dueDate).getTime()) / 86400000);
      if (days < 0) return false; // not yet due
      return days >= min && days <= max;
    });
    return { label, amount: batch.reduce((s, i) => s + i.balanceDue, 0), count: batch.length };
  });

  // ---- Jurisdiction breakdown ----
  const jurMap: Record<string, { billed: number; tax: number; count: number }> = {};
  live.forEach((i) => {
    if (!jurMap[i.jurisdiction]) jurMap[i.jurisdiction] = { billed: 0, tax: 0, count: 0 };
    jurMap[i.jurisdiction].billed += i.grossPayable;
    jurMap[i.jurisdiction].tax += i.taxTotal;
    jurMap[i.jurisdiction].count += 1;
  });

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Accounts', path: '/finance/invoices' }, { label: 'Finance Reports' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Finance Reports</h1>
          <p className="page-subtitle">Revenue, collections, ageing and tax jurisdiction summary</p>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total billed', value: formatPKR(totalBilled), sub: `${live.length} invoices`, color: 'var(--text-primary)' },
          { label: 'Collected', value: formatPKR(totalCollected), sub: `${collectionRate}% collection rate`, color: 'var(--ikpm-emerald-600)' },
          { label: 'Outstanding', value: formatPKR(totalOutstanding), sub: `${formatPKR(totalOverdue)} overdue`, color: totalOutstanding > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' },
          { label: 'Tax collected (PST)', value: formatPKR(totalTax), sub: 'All jurisdictions', color: 'var(--text-primary)' },
          { label: 'WHT deducted', value: formatPKR(live.reduce((s, i) => s + (i.customerWhtTotal || 0), 0)), sub: 'Customer withholding tax', color: '#92400E' },
          { label: 'Voided invoices', value: String(invoices.filter((i) => i.status === 'void_reversed').length), sub: 'Credit notes issued', color: 'var(--text-muted)' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="card" style={{ padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.25rem' }}>{label}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
        {/* Monthly revenue */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div className="section-title" style={{ marginTop: 0, marginBottom: '0.75rem' }}>Revenue — last 6 months</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Invoiced</th>
                <th style={{ textAlign: 'right' }}>Collected</th>
                <th style={{ textAlign: 'right' }}>#</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map(({ ym, billed, collected, count }) => (
                <tr key={ym}>
                  <td style={{ fontWeight: 600 }}>{monthLabel(ym)}</td>
                  <td style={{ textAlign: 'right' }}>{formatPKR(billed)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ikpm-emerald-600)' }}>{formatPKR(collected)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Aging + jurisdiction */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Aging */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div className="section-title" style={{ marginTop: 0, marginBottom: '0.75rem' }}>Overdue ageing</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>#</th>
                </tr>
              </thead>
              <tbody>
                {aging.map(({ label, amount, count }) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td style={{ textAlign: 'right', color: amount > 0 ? 'var(--ikpm-rose-500)' : 'var(--text-muted)', fontWeight: amount > 0 ? 700 : 400 }}>{formatPKR(amount)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Jurisdiction */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div className="section-title" style={{ marginTop: 0, marginBottom: '0.75rem' }}>Tax jurisdiction breakdown</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Jurisdiction</th>
                  <th style={{ textAlign: 'right' }}>Tax collected</th>
                  <th style={{ textAlign: 'right' }}>#</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(jurMap).sort((a, b) => b[1].tax - a[1].tax).map(([jur, { tax, count }]) => (
                  <tr key={jur}>
                    <td><span className="badge-status badge-slate">{JUR_LABEL[jur] ?? jur}</span></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatPKR(tax)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{count}</td>
                  </tr>
                ))}
                {Object.keys(jurMap).length === 0 && (
                  <tr><td colSpan={3} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No invoices yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
