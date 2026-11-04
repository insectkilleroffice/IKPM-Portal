import React, { useState, useSyncExternalStore } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { companyProfile } from '../../services/companyProfile';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';

/**
 * Standard prices for one-off jobs that have no proposal price. When a completed job's service
 * contains the name below (e.g. "Termite treatment"), that price is suggested on the invoice.
 */
export const PriceListCard: React.FC = () => {
  const live = useSyncExternalStore(companyProfile.subscribe, companyProfile.get);
  const { userProfile, isSuperAdmin } = useAuth();
  const { success, error } = useNotification();
  const [rows, setRows] = useState(() => (live.priceList ?? []).map((r) => ({ ...r })));
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<{ service: string; price: number }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    const clean = rows.map((r) => ({ service: r.service.trim(), price: Math.max(0, Number(r.price) || 0) })).filter((r) => r.service);
    setBusy(true);
    try {
      await companyProfile.save({ ...companyProfile.get(), priceList: clean }, userProfile?.email || '');
      setRows(clean);
      success('Price list saved', `${clean.length} standard price(s).`);
    } catch (err) {
      error('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="cell-sub" style={{ marginBottom: '0.6rem' }}>
        Used for one-off jobs without a proposal price: if a job's service contains the name, its price is suggested on the invoice (before tax). Finance can still change it.
      </p>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 32px', gap: '0.5rem', marginBottom: '0.4rem' }}>
          <input className="form-input" value={r.service} disabled={!isSuperAdmin} placeholder="e.g. Cockroach gel treatment – 2 bed flat" onChange={(e) => set(i, { service: e.target.value })} />
          <input type="number" min={0} className="form-input" value={r.price} disabled={!isSuperAdmin} onChange={(e) => set(i, { price: Number(e.target.value) })} />
          {isSuperAdmin && <button type="button" className="icon-btn" title="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
        </div>
      ))}
      {!rows.length && <div className="cell-sub" style={{ marginBottom: '0.5rem' }}>No standard prices yet.</div>}
      {isSuperAdmin && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setRows([...rows, { service: '', price: 0 }])}><Plus size={13} /> Add price</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save price list'}</button>
        </div>
      )}
    </div>
  );
};
