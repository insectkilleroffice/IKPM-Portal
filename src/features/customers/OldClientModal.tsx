// "Add old client" (super admin): a client served before the portal, step by step.
// 1 Client & sites · 2 Contracts · 3 Visits (scheduled automatically, editable) · 4 Old invoices & payments · 5 Review

import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDataStore } from '../../hooks/useDataStore';
import { formatDate, formatPKR } from '../../lib/formatters';
import { BILLING_CYCLE_PRESETS } from '../../lib/billingCycle';
import {
  addVisit, blankContract, blankDraft, checkDraft, draftSummary, invoiceGroups, newSite, num, saveOldClient, scheduleDates, supervisors, syncInvoices, today, withSchedule,
  type DraftContract, type DraftInvoice, type DraftSite, type DraftVisit, type OldClientDraft, type OldClientKind, type PropertyType, type Province,
} from './oldClient';

const STEPS = ['Client & sites', 'Contracts', 'Visits', 'Old invoices & payments', 'Review'] as const;
const KINDS: { kind: OldClientKind; label: string; hint: string }[] = [
  { kind: 'company', label: 'B2B · Company', hint: 'Company with branches, tax invoices' },
  { kind: 'individual', label: 'B2C · Individual', hint: 'A person with a shop, clinic or office' },
  { kind: 'residential', label: 'Residential', hint: 'Home or flat' },
];
const PROVINCES: { v: Province; l: string }[] = [{ v: 'Sindh', l: 'Sindh' }, { v: 'Punjab', l: 'Punjab' }, { v: 'Islamabad_ICT', l: 'Islamabad' }, { v: 'KPK', l: 'KPK' }, { v: 'Balochistan', l: 'Balochistan' }];
const PROPERTIES: { v: PropertyType; l: string }[] = [
  { v: 'residential_house', l: 'House' }, { v: 'apartment', l: 'Apartment / flat' }, { v: 'commercial_office', l: 'Office / shop' }, { v: 'restaurant_kitchen', l: 'Restaurant / bakery' },
  { v: 'factory', l: 'Factory' }, { v: 'warehouse', l: 'Warehouse' }, { v: 'hospital', l: 'Hospital / clinic' }, { v: 'school', l: 'School' },
];

const Field: React.FC<{ label: string; children: React.ReactNode; wide?: boolean }> = ({ label, children, wide }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, gridColumn: wide ? '1 / -1' : undefined, fontSize: '0.8rem', fontWeight: 600 }}>
    {label}{children}
  </label>
);
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.6rem' };
const Problems: React.FC<{ list: string[] }> = ({ list }) => (list.length ? <div className="error-hint">{list.map((p) => <div key={p}>{p}</div>)}</div> : null);

/** What the automatic schedule of a contract depends on; a change re-schedules it. */
const scheduleSig = (k: DraftContract) => [k.type, k.start, k.end, k.visitsPerMonth, k.status, k.cancelledOn].join('|');

export const OldClientModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useDataStore(); // re-render when staff profiles / roles arrive, so the Supervisor lists fill in
  const { userProfile } = useAuth();
  const { success, error } = useNotification();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<OldClientDraft>(() => blankDraft('company'));
  const [sigs, setSigs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNo, setBulkNo] = useState('');
  const [bulkSup, setBulkSup] = useState('');
  const [busy, setBusy] = useState(false);
  const sups = supervisors();
  const t = today();

  const set = (patch: Partial<OldClientDraft>) => setD((x) => ({ ...x, ...patch }));
  const setSite = (key: string, patch: Partial<DraftSite>) => setD((x) => ({ ...x, sites: x.sites.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  const setContract = (key: string, patch: Partial<DraftContract>) => setD((x) => ({ ...x, contracts: x.contracts.map((k) => (k.key === key ? { ...k, ...patch } : k)) }));
  const setVisit = (key: string, patch: Partial<DraftVisit>) => setD((x) => ({ ...x, visits: x.visits.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));
  const setInvoice = (k: string, patch: Partial<DraftInvoice>) => setD((x) => ({ ...x, invoices: { ...x.invoices, [k]: { ...x.invoices[k], ...patch, touched: true } } }));

  // Entering Visits: schedule every contract that is new or whose dates / visits changed
  useEffect(() => {
    if (step !== 2) return;
    let next = d;
    const s = { ...sigs };
    d.contracts.forEach((k) => { if (s[k.key] !== scheduleSig(k)) { next = withSchedule(next, k.key); s[k.key] = scheduleSig(k); } });
    if (next !== d) { setD(next); setSigs(s); }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the invoice rows in step with the numbers typed on visits
  const groups = invoiceGroups(d);
  const groupKey = groups.map(([k, , vs]) => `${k}:${vs.length}`).join(',');
  useEffect(() => { setD((x) => ({ ...x, invoices: syncInvoices(x) })); }, [groupKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = checkDraft(d);
  const stepProblems = [problems.client, problems.contracts, problems.visits, problems.invoices, Object.values(problems).flat()][step];
  const sum = draftSummary(d);

  const pickKind = (kind: OldClientKind) => { setD(blankDraft(kind)); setSigs({}); };
  const save = async () => {
    setBusy(true);
    try {
      const r = await saveOldClient(d, { uid: userProfile?.uid || '', email: userProfile?.email || 'admin', name: userProfile?.displayName || 'Super admin' });
      success('Old client added', `${d.name}: ${r.summary.done} old visit(s), ${r.summary.invoices} old invoice(s), ${r.summary.upcoming} upcoming visit(s).`);
      onClose();
    } catch (e) {
      error('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const bulk = (patch: Partial<DraftVisit>) => setD((x) => ({ ...x, visits: x.visits.map((v) => (selected.has(v.key) ? { ...v, ...patch } : v)) }));
  const months = Array.from(new Set(d.visits.filter((v) => v.date <= t).map((v) => v.date.slice(0, 7))));

  return (
    <Modal isOpen onClose={() => !busy && onClose()} title="Add old client" maxWidth="1150px"
      subtitle="A client you served before the portal: details, contracts, old visits, old invoices and what was paid."
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', width: '100%', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          {step > 0 && <button className="btn btn-secondary" onClick={() => setStep(step - 1)} disabled={busy}><ArrowLeft size={14} /> Back</button>}
          <span className="cell-sub" style={{ marginLeft: '0.5rem' }}>Step {step + 1} of {STEPS.length}: {STEPS[step]}</span>
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={stepProblems.length > 0} onClick={() => setStep(step + 1)}>Next <ArrowRight size={14} /></button>
          ) : (
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={busy || stepProblems.length > 0} onClick={save}><Save size={14} /> {busy ? 'Saving…' : 'Save old client'}</button>
          )}
        </div>
      }>
      <div style={{ display: 'flex', gap: 6, marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => (
          <span key={s} className={`badge ${i === step ? 'badge-primary' : ''}`} style={{ padding: '0.25rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: i === step ? 'var(--ikpm-emerald-600)' : 'var(--surface-muted, #eef1f4)', color: i === step ? '#fff' : 'inherit' }}>
            {i + 1}. {s}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
        {/* 1. Client & sites */}
        {step === 0 && (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {KINDS.map((k) => (
                <button key={k.kind} type="button" className={`btn ${d.kind === k.kind ? 'btn-primary' : 'btn-secondary'}`} title={k.hint} onClick={() => pickKind(k.kind)}>{k.label}</button>
              ))}
            </div>
            <div style={grid}>
              <Field label={d.kind === 'company' ? 'Company name *' : 'Client name *'}><input className="form-input" value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              {d.kind === 'company' && <Field label="Contact person"><input className="form-input" value={d.contact} onChange={(e) => set({ contact: e.target.value })} /></Field>}
              <Field label="Phone *"><input className="form-input" value={d.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="03xx xxxxxxx" /></Field>
              <Field label="Email"><input className="form-input" value={d.email} onChange={(e) => set({ email: e.target.value })} /></Field>
              <Field label="Address *" wide><input className="form-input" value={d.address} onChange={(e) => set({ address: e.target.value })} /></Field>
              <Field label="Area"><input className="form-input" value={d.area} onChange={(e) => set({ area: e.target.value })} /></Field>
              <Field label="City *"><input className="form-input" value={d.city} onChange={(e) => set({ city: e.target.value })} /></Field>
              <Field label="Province">
                <select className="form-input" value={d.province} onChange={(e) => set({ province: e.target.value as Province })}>{PROVINCES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}</select>
              </Field>
              {d.kind !== 'residential' && <Field label="NTN"><input className="form-input" value={d.ntn} onChange={(e) => set({ ntn: e.target.value })} /></Field>}
              {d.kind === 'company' && <Field label="STRN"><input className="form-input" value={d.strn} onChange={(e) => set({ strn: e.target.value })} /></Field>}
              <Field label="Client now">
                <select className="form-input" value={d.former ? 'former' : 'active'} onChange={(e) => set({ former: e.target.value === 'former' })}>
                  <option value="active">Active client</option><option value="former">Former client (no longer served)</option>
                </select>
              </Field>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>{d.kind === 'company' ? 'Branches / sites' : 'Site'}</div>
              {d.sites.map((s) => (
                <div key={s.key} style={{ ...grid, alignItems: 'end', marginBottom: '0.5rem' }}>
                  <Field label="Name *"><input className="form-input" value={s.name} onChange={(e) => setSite(s.key, { name: e.target.value })} placeholder={d.kind === 'company' ? 'e.g. Korangi Plant' : 'e.g. Home, Shop'} /></Field>
                  <Field label="Address (empty = client address)"><input className="form-input" value={s.address} onChange={(e) => setSite(s.key, { address: e.target.value })} /></Field>
                  <Field label="Area"><input className="form-input" value={s.area} onChange={(e) => setSite(s.key, { area: e.target.value })} /></Field>
                  <Field label="Property type">
                    <select className="form-input" value={s.propertyType} onChange={(e) => setSite(s.key, { propertyType: e.target.value as PropertyType })}>{PROPERTIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}</select>
                  </Field>
                  {d.sites.length > 1 && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setD((x) => ({ ...x, sites: x.sites.filter((y) => y.key !== s.key), contracts: x.contracts.map((k) => (k.siteKey === s.key ? { ...k, siteKey: x.sites.find((y) => y.key !== s.key)!.key } : k)) }))}>
                      <Trash2 size={13} /> Remove
                    </button>
                  )}
                </div>
              ))}
              {d.kind === 'company' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ sites: [...d.sites, newSite()] })}><Plus size={13} /> Add branch</button>}
            </div>
          </>
        )}

        {/* 2. Contracts */}
        {step === 1 && (
          <>
            {d.contracts.map((k, i) => (
              <div key={k.key} className="card" style={{ padding: '0.8rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong>Contract {i + 1}</strong>
                  {d.contracts.length > 1 && (
                    <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setD((x) => ({ ...x, contracts: x.contracts.filter((y) => y.key !== k.key), visits: x.visits.filter((v) => v.contractKey !== k.key) }))}>
                      <Trash2 size={13} /> Remove
                    </button>
                  )}
                </div>
                <div style={grid}>
                  <Field label="Site">
                    <select className="form-input" value={k.siteKey} onChange={(e) => setContract(k.key, { siteKey: e.target.value })}>{d.sites.map((s) => <option key={s.key} value={s.key}>{s.name || '(no name)'}</option>)}</select>
                  </Field>
                  <Field label="Type">
                    <select className="form-input" value={k.type} onChange={(e) => setContract(k.key, { type: e.target.value as DraftContract['type'] })}>
                      <option value="amc_recurring">AMC (monthly plan)</option><option value="one_time">One-time job</option>
                    </select>
                  </Field>
                  <Field label="Start date *"><input type="date" className="form-input" value={k.start} onChange={(e) => setContract(k.key, { start: e.target.value, end: k.type === 'one_time' && !k.end ? e.target.value : k.end })} /></Field>
                  <Field label="End date *"><input type="date" className="form-input" value={k.end} onChange={(e) => setContract(k.key, { end: e.target.value })} /></Field>
                  {k.type === 'amc_recurring'
                    ? <Field label="Monthly rate (PKR) *"><input className="form-input" inputMode="decimal" value={k.monthlyRate} onChange={(e) => setContract(k.key, { monthlyRate: e.target.value })} /></Field>
                    : <Field label="Contract value (PKR, incl. tax) *"><input className="form-input" inputMode="decimal" value={k.value} onChange={(e) => setContract(k.key, { value: e.target.value })} /></Field>}
                  <Field label={k.type === 'one_time' ? 'Number of visits' : 'Visits per month'}><input className="form-input" inputMode="numeric" value={k.visitsPerMonth} onChange={(e) => setContract(k.key, { visitsPerMonth: e.target.value })} /></Field>
                  {d.kind !== 'residential' && <Field label="Tax %"><input className="form-input" inputMode="decimal" value={k.taxPercent} onChange={(e) => setContract(k.key, { taxPercent: e.target.value })} /></Field>}
                  {d.kind !== 'residential' && k.type === 'amc_recurring' && (
                    <Field label="Rate includes tax?">
                      <select className="form-input" value={k.taxInclusive ? 'yes' : 'no'} onChange={(e) => setContract(k.key, { taxInclusive: e.target.value === 'yes' })}><option value="no">No, tax added</option><option value="yes">Yes</option></select>
                    </Field>
                  )}
                  {k.type === 'amc_recurring' && (
                    <Field label="Invoice every">
                      <select className="form-input" value={k.cycle} onChange={(e) => setContract(k.key, { cycle: Number(e.target.value) })}>
                        {BILLING_CYCLE_PRESETS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label="Services (comma separated)" wide><input className="form-input" value={k.services} onChange={(e) => setContract(k.key, { services: e.target.value })} placeholder="Cockroach control, Rodent control" /></Field>
                  {d.kind === 'company' && <Field label="Client PO no."><input className="form-input" value={k.po} onChange={(e) => setContract(k.key, { po: e.target.value })} /></Field>}
                  <Field label="Supervisor (for its visits)">
                    <select className="form-input" value={k.supervisorUid} onChange={(e) => setContract(k.key, { supervisorUid: e.target.value })}>
                      <option value="">{sups.length ? '—' : 'No Supervisor found (Team & Access)'}</option>{sups.map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select className="form-input" value={k.status} onChange={(e) => setContract(k.key, { status: e.target.value as DraftContract['status'] })}>
                      <option value="running">Running</option><option value="ended">Ended (finished)</option><option value="cancelled">Cancelled</option>
                    </select>
                  </Field>
                  {k.status === 'cancelled' && (
                    <>
                      <Field label="Cancelled on (last service day) *"><input type="date" className="form-input" value={k.cancelledOn} onChange={(e) => setContract(k.key, { cancelledOn: e.target.value })} /></Field>
                      <Field label="Cancellation reason *" wide><input className="form-input" value={k.cancelReason} onChange={(e) => setContract(k.key, { cancelReason: e.target.value })} placeholder="e.g. Moved to a competitor, shop closed, moving abroad" /></Field>
                    </>
                  )}
                </div>
                <div className="cell-sub" style={{ marginTop: 6 }}>{scheduleDates(k).length} visit(s) will be scheduled from the start to the {k.status === 'cancelled' ? 'cancel date' : 'end date'} (Sundays skipped). You can edit them in the next step.</div>
              </div>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ contracts: [...d.contracts, blankContract(d.kind, d.sites[d.sites.length - 1].key)] })}><Plus size={13} /> Add contract</button>
          </>
        )}

        {/* 3. Visits */}
        {step === 2 && (
          <>
            <div className="info-hint">Visits are scheduled from each contract's dates. Past visits start as <strong>Done</strong>: change any that did not happen to <strong>Not done</strong> (they are not saved), and type the <strong>old invoice no.</strong> on the visits it billed. Done visits with no invoice go to Invoices → Completed jobs.</div>
            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="cell-sub">{selected.size} selected</span>
              <select className="form-input" style={{ width: 150 }} value="" onChange={(e) => setSelected(new Set(d.visits.filter((v) => v.date.startsWith(e.target.value) && v.date <= t).map((v) => v.key)))}>
                <option value="">Select a month…</option>{months.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input className="form-input" style={{ width: 140 }} placeholder="Old invoice no." value={bulkNo} onChange={(e) => setBulkNo(e.target.value)} />
              <button type="button" className="btn btn-secondary btn-sm" disabled={!selected.size} onClick={() => bulk({ invoiceNo: bulkNo })}>Set invoice no.</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!selected.size} onClick={() => bulk({ done: true })}>Done</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!selected.size} onClick={() => bulk({ done: false, invoiceNo: '' })}>Not done</button>
              <select className="form-input" style={{ width: 150 }} value={bulkSup} onChange={(e) => setBulkSup(e.target.value)}>
                <option value="">Supervisor…</option>{sups.map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
              </select>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!selected.size || !bulkSup} onClick={() => bulk({ supervisorUid: bulkSup })}>Set Supervisor</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!selected.size} onClick={() => { setD((x) => ({ ...x, visits: x.visits.filter((v) => !selected.has(v.key)) })); setSelected(new Set()); }}><Trash2 size={13} /> Delete</button>
            </div>
            {d.contracts.map((k, i) => {
              const vs = d.visits.filter((v) => v.contractKey === k.key);
              const site = d.sites.find((s) => s.key === k.siteKey)?.name;
              const all = vs.length > 0 && vs.every((v) => selected.has(v.key));
              return (
                <div key={k.key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <strong>Contract {i + 1}{site ? ` · ${site}` : ''}</strong>
                    <span className="cell-sub">{formatDate(k.start)} – {formatDate(k.end)} · {vs.filter((v) => v.date <= t).length} past · {vs.filter((v) => v.date > t).length} upcoming</span>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setD((x) => addVisit(x, k.key, t))}><Plus size={13} /> Add visit</button>
                    <button type="button" className="btn btn-secondary btn-sm" title="Replace this contract's visits with the automatic schedule (your changes to them are lost)"
                      onClick={() => { if (window.confirm('Re-schedule this contract? Your changes to its visits are replaced.')) { setD((x) => withSchedule(x, k.key)); setSigs((s) => ({ ...s, [k.key]: scheduleSig(k) })); } }}>
                      <RefreshCw size={13} /> Re-schedule
                    </button>
                  </div>
                  <div className="table-container" style={{ maxHeight: 300, overflow: 'auto' }}>
                    <table className="data-table">
                      <thead><tr>
                        <th style={{ width: 28 }}><input type="checkbox" checked={all} onChange={() => setSelected((s) => { const n = new Set(s); vs.forEach((v) => (all ? n.delete(v.key) : n.add(v.key))); return n; })} /></th>
                        <th>Date</th><th>Status</th><th>Old invoice no.</th><th>Challan no.</th><th>Supervisor</th><th />
                      </tr></thead>
                      <tbody>
                        {vs.map((v) => {
                          const past = v.date <= t;
                          return (
                            <tr key={v.key} style={past && !v.done ? { opacity: 0.5 } : undefined}>
                              <td><input type="checkbox" checked={selected.has(v.key)} onChange={() => toggle(v.key)} /></td>
                              <td><input type="date" className="form-input" value={v.date} onChange={(e) => setVisit(v.key, { date: e.target.value, done: e.target.value <= t ? v.done : false })} /></td>
                              <td>
                                {past ? (
                                  <select className="form-input" value={v.done ? 'done' : 'no'} onChange={(e) => setVisit(v.key, { done: e.target.value === 'done', invoiceNo: e.target.value === 'done' ? v.invoiceNo : '' })}>
                                    <option value="done">Done</option><option value="no">Not done</option>
                                  </select>
                                ) : <span className="cell-sub">Upcoming</span>}
                              </td>
                              <td>{past && v.done ? <input className="form-input" style={{ width: 130 }} placeholder="not invoiced" value={v.invoiceNo} onChange={(e) => setVisit(v.key, { invoiceNo: e.target.value })} /> : <span className="cell-sub">—</span>}</td>
                              <td><input className="form-input" style={{ width: 110 }} value={v.challan} onChange={(e) => setVisit(v.key, { challan: e.target.value })} /></td>
                              <td>
                                <select className="form-input" value={v.supervisorUid} onChange={(e) => setVisit(v.key, { supervisorUid: e.target.value })}>
                                  <option value="">{sups.length ? '—' : 'No Supervisor found (Team & Access)'}</option>{sups.map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
                                </select>
                              </td>
                              <td><button type="button" className="btn btn-secondary btn-sm" title="Delete visit" onClick={() => setD((x) => ({ ...x, visits: x.visits.filter((y) => y.key !== v.key) }))}><Trash2 size={13} /></button></td>
                            </tr>
                          );
                        })}
                        {vs.length === 0 && <tr><td colSpan={7} className="cell-sub">No visits. Check the contract dates, or add a visit.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* 4. Old invoices & payments */}
        {step === 3 && (
          <>
            {groups.length === 0
              ? <div className="info-hint">No old invoice numbers were typed on the visits. All done visits will go to Invoices → Completed jobs. Go back to add invoice numbers, or add an opening balance below.</div>
              : (
                <div className="table-container">
                  <table className="data-table">
                    <thead><tr><th>Invoice no.</th><th>Visits</th><th>Date</th><th>Total (incl. tax)</th><th>Tax</th><th>Payment</th><th>Paid on</th><th>Still due</th></tr></thead>
                    <tbody>
                      {groups.map(([k, label, vs]) => {
                        const f = d.invoices[k];
                        if (!f) return null;
                        const total = num(f.total);
                        const paid = f.pay === 'paid' ? total : f.pay === 'part' ? num(f.paid) : 0;
                        return (
                          <tr key={k}>
                            <td style={{ fontWeight: 700 }}>{label}</td>
                            <td title={vs.map((v) => v.date).join(', ')}>{vs.length}</td>
                            <td><input type="date" className="form-input" value={f.date} onChange={(e) => setInvoice(k, { date: e.target.value })} /></td>
                            <td><input className="form-input" style={{ width: 110 }} inputMode="decimal" value={f.total} onChange={(e) => setInvoice(k, { total: e.target.value })} /></td>
                            <td><input className="form-input" style={{ width: 90 }} inputMode="decimal" value={f.tax} onChange={(e) => setInvoice(k, { tax: e.target.value })} /></td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <select className="form-input" value={f.pay} onChange={(e) => setInvoice(k, { pay: e.target.value as DraftInvoice['pay'] })}>
                                  <option value="paid">Paid in full</option><option value="part">Part paid</option><option value="unpaid">Not paid</option>
                                </select>
                                {f.pay === 'part' && <input className="form-input" style={{ width: 100 }} placeholder="Paid" inputMode="decimal" value={f.paid} onChange={(e) => setInvoice(k, { paid: e.target.value })} />}
                              </div>
                            </td>
                            <td>{f.pay !== 'unpaid' && <input type="date" className="form-input" value={f.paidOn} onChange={(e) => setInvoice(k, { paidOn: e.target.value })} />}</td>
                            <td style={{ fontWeight: 700 }}>{formatPKR(Math.max(0, total - paid))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            <div className="cell-sub">Totals are suggested from the contract rate; change them to what the old invoice says. What is still due stays open in Invoices → Payments.</div>
            <div className="card" style={{ padding: '0.8rem 1rem' }}>
              <strong>Opening balance (optional)</strong>
              <div className="cell-sub" style={{ marginBottom: '0.4rem' }}>Only for an old amount you cannot tie to invoices above (no tax). Don't enter the same money twice.</div>
              <div style={grid}>
                <Field label="Amount (PKR)"><input className="form-input" inputMode="decimal" value={d.openingBalance} onChange={(e) => set({ openingBalance: e.target.value })} /></Field>
                <Field label="As of"><input type="date" className="form-input" value={d.openingAsOf} onChange={(e) => set({ openingAsOf: e.target.value })} /></Field>
                <Field label="Note"><input className="form-input" value={d.openingNote} onChange={(e) => set({ openingNote: e.target.value })} placeholder="e.g. balance of 2025 contract" /></Field>
              </div>
            </div>
          </>
        )}

        {/* 5. Review */}
        {step === 4 && (
          <>
            <div className="kpi-grid">
              {[
                ['Client', d.name || '—'],
                ['Sites / contracts', `${sum.sites} / ${sum.contracts}`],
                ['Old visits done', `${sum.done}${sum.notDone ? ` (${sum.notDone} not done, not saved)` : ''}`],
                ['Upcoming visits', String(sum.upcoming)],
                ['Old invoices', `${sum.invoices} · ${formatPKR(sum.invoiced)}`],
                ['Still due', formatPKR(sum.due)],
                ['Done, to invoice now', String(sum.toInvoice)],
              ].map(([a, b]) => (
                <div key={a} className="kpi-card"><div><div className="kpi-title">{a}</div><div className="kpi-value" style={{ fontSize: '1.1rem' }}>{b}</div></div></div>
              ))}
            </div>
            <div className="cell-sub">
              Saving creates the client, its {d.kind === 'company' ? 'branches' : 'site'}, contracts and visits. Old invoices are saved approved with what was paid; anything still due appears in Invoices → Payments.
              {sum.toInvoice > 0 && ` ${sum.toInvoice} done visit(s) without an invoice appear in Invoices → Completed jobs${d.contracts.some((k) => k.status === 'cancelled') ? ' (cancelled contract: the super admin settles them)' : ''}.`}
            </div>
          </>
        )}

        <Problems list={stepProblems} />
      </div>
    </Modal>
  );
};
