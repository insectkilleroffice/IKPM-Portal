// Completed jobs waiting to be invoiced (done + quality-checked, not invoiced yet).
// Tick jobs, then: "Invoice individually" (one invoice per job) or "Bulk invoice" (one invoice per
// client for all the ticked jobs, each job keeping its own invoice inside). Both go for approval.

import React, { useMemo, useState } from 'react';
import { FileStack, Receipt } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDataStore } from '../../hooks/useDataStore';
import { baseRoleOf } from '../../lib/permissions';
import { billingCycleLabel, billingPeriods } from '../../lib/billingCycle';
import { formatDate, formatPKR } from '../../lib/formatters';
import { dataService } from '../../services/dataService';
import {
  billableVisits, cancelledContractsToSettle, createBulkInvoices, createJobInvoices, visitPrice, visitServicesOf, type MonthlyBill,
} from './monthlyBilling';

const today = () => new Date().toISOString().slice(0, 10);

export const CompletedJobsTab: React.FC<{ preselectJobId?: string; onCreated: () => void }> = ({ preselectJobId, onCreated }) => {
  const store = useDataStore();
  const version = store.getVersion();
  const { userProfile, effectiveRole } = useAuth();
  const { success, warning, error } = useNotification();
  const isSuperAdmin = baseRoleOf(effectiveRole) === 'super_admin';

  const all = useMemo(() => billableVisits(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]);
  const prices = useMemo(() => {
    const cache = new Map<string, MonthlyBill>();
    return new Map(all.map((j) => [j.id, visitPrice(j, cache)]));
  }, [all]);

  const preJob = preselectJobId ? all.find((j) => j.id === preselectJobId) : undefined;
  const [clientId, setClientId] = useState(preJob?.customerId || '');
  const [contractId, setContractId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preJob ? [preJob.id] : []));
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const clients = useMemo(() => {
    const m = new Map<string, string>();
    all.forEach((j) => m.set(j.customerId, j.customerName));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);
  const contracts = useMemo(() => {
    const ids = Array.from(new Set(all.filter((j) => (!clientId || j.customerId === clientId) && j.contractId).map((j) => j.contractId!)));
    return ids.map((id) => dataService.getContractById(id)).filter(Boolean) as NonNullable<ReturnType<typeof dataService.getContractById>>[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, clientId, version]);
  const contract = contractId ? contracts.find((c) => c.id === contractId) : undefined;
  // The contract's billing periods (15 days, monthly, quarterly… as set on it), newest first
  const periods = contract ? billingPeriods(contract.startDate, contract.endDate, contract.billingCycleDays, today()).reverse() : [];

  const shown = all.filter((j) =>
    (!clientId || j.customerId === clientId)
    && (!contractId || j.contractId === contractId)
    && (!from || j.scheduledDate >= from)
    && (!to || j.scheduledDate <= to));
  const amountOf = (id: string) => amounts[id] ?? prices.get(id)?.amount ?? 0;
  const chosen = shown.filter((j) => picked.has(j.id));
  const total = chosen.reduce((s, j) => s + amountOf(j.id), 0);
  const zero = chosen.filter((j) => !(amountOf(j.id) > 0));
  // A bulk invoice never mixes clients
  const clientCount = new Set(chosen.map((j) => j.customerId)).size;

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const allShownPicked = shown.length > 0 && shown.every((j) => picked.has(j.id));

  const create = async (bulk: boolean) => {
    if (!chosen.length) return warning('Nothing ticked', 'Tick the completed jobs to invoice.');
    if (zero.length) return warning('Charge missing', `Enter a charge for: ${zero.map((j) => j.id).join(', ')}.`);
    setBusy(true);
    try {
      const user = { uid: userProfile?.uid || '', email: userProfile?.email || 'admin', name: userProfile?.displayName || 'Finance' };
      const items = chosen.map((job) => ({ job, amount: amountOf(job.id) }));
      if (bulk) {
        if (clientCount > 1) return warning('One client per bulk invoice', 'The ticked jobs belong to more than one client. Choose a client in the filter, or use Invoice individually.');
        const made = await createBulkInvoices(items, user);
        success('Bulk invoice sent for approval', `${made[0].customerName}: ${chosen.length} job(s), each with its own invoice inside. An admin approves, then you send it to the client.`);
      } else {
        const made = await createJobInvoices(items, user);
        success(`${made.length} invoice(s) sent for approval`, 'One per job. An admin approves each, then you send it to the client.');
      }
      setPicked(new Set());
      onCreated();
    } catch (err) {
      error('Could not create the invoice', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toSettle = isSuperAdmin ? cancelledContractsToSettle() : [];

  return (
    <div>
      {toSettle.length > 0 && (
        <div className="info-hint" style={{ marginBottom: '0.75rem' }}>
          {toSettle.length} cancelled contract(s) to settle ({toSettle.map((c) => c.customerName).join(', ')}): open the contract and use <strong>Cancellation settlement</strong>.
        </div>
      )}

      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Client</label>
          <select className="form-select" value={clientId} onChange={(e) => { setClientId(e.target.value); setContractId(''); }}>
            <option value="">All clients ({all.length} jobs)</option>
            {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        {contracts.length > 0 && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Contract</label>
            <select className="form-select" value={contractId} onChange={(e) => setContractId(e.target.value)}>
              <option value="">Any</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.customerName}</option>)}
            </select>
          </div>
        )}
        {contract && periods.length > 0 && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Billing period ({billingCycleLabel(contract.billingCycleDays).toLowerCase()})</label>
            <select className="form-select" value={`${from}|${to}`} onChange={(e) => { const [f, t] = e.target.value.split('|'); setFrom(f); setTo(t); }}>
              <option value="|">All dates</option>
              {periods.map((p) => <option key={p.start} value={`${p.start}|${p.end}`}>{formatDate(p.start)} – {formatDate(p.end)}</option>)}
            </select>
          </div>
        )}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">From</label>
          <input type="date" className="form-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">To</label>
          <input type="date" className="form-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(clientId || contractId || from || to) && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setClientId(''); setContractId(''); setFrom(''); setTo(''); }}>Clear</button>
        )}
      </div>

      {!shown.length ? (
        <div className="empty-hint">No completed jobs waiting to be invoiced{clientId || from || to ? ' for these filters' : ''}.</div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={allShownPicked} title="Tick all shown"
                    onChange={() => setPicked(allShownPicked ? new Set([...picked].filter((id) => !shown.some((j) => j.id === id))) : new Set([...picked, ...shown.map((j) => j.id)]))} />
                </th>
                <th>Date</th>
                <th>Client / site</th>
                <th>Services done</th>
                <th style={{ textAlign: 'right', width: 170 }}>Charge (before tax)</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => {
                const p = prices.get(j.id)!;
                return (
                  <tr key={j.id} onClick={() => toggle(j.id)} style={{ cursor: 'pointer' }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={picked.has(j.id)} onChange={() => toggle(j.id)} /></td>
                    <td>{formatDate(j.scheduledDate)}<div className="cell-sub">{j.id}</div></td>
                    <td>
                      <div className="cell-title">{j.customerName}</div>
                      <div className="cell-sub">{[j.branchName || j.siteName, j.contractId && `Contract ${j.contractId}`].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>{visitServicesOf(j)}</td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      {p.fixed
                        ? <strong>{formatPKR(p.amount)}</strong>
                        : <input type="number" min={0} className="form-input" style={{ textAlign: 'right' }} value={amountOf(j.id)}
                            onChange={(e) => setAmounts({ ...amounts, [j.id]: Math.max(0, Number(e.target.value)) })} />}
                      <div className="cell-sub">{p.source}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ position: 'sticky', bottom: 0, marginTop: '1rem', padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <strong>{chosen.length} job(s) ticked · {formatPKR(total)}</strong>
        {chosen.length > 0 && <span className="cell-sub">{clientCount} client(s){zero.length ? ` · ${zero.length} without a charge` : ''}</span>}
        {clientCount > 1 && <span className="cell-sub" style={{ color: '#B45309' }}>Bulk invoice needs one client: choose a client in the filter.</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" disabled={busy || !chosen.length} onClick={() => create(false)}
            title="One invoice per ticked job">
            <Receipt size={14} /> {busy ? 'Working…' : `Invoice individually (${chosen.length})`}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !chosen.length || clientCount > 1} onClick={() => create(true)}
            title={clientCount > 1 ? 'A bulk invoice is for one client only: choose a client in the filter' : 'One invoice for all ticked jobs of this client (e.g. a month); each job keeps its own invoice inside'}>
            <FileStack size={14} /> {busy ? 'Working…' : 'Bulk invoice'}
          </button>
        </div>
      </div>
    </div>
  );
};
