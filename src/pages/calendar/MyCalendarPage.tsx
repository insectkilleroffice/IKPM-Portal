import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { TodayWorkBar } from '../../features/calendar/TodayWorkBar';
import { myWorkItems, seesAllWork, WORK_KIND_COLOR, WORK_KIND_LABEL, type WorkItem, type WorkKind } from '../../lib/myWork';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Personal calendar for every role: today's work, a month view, and the work of any chosen day. */
export const MyCalendarPage: React.FC = () => {
  const store = useDataStore();
  const { userProfile, effectiveRole } = useAuth();
  const canSeeAll = seesAllWork(effectiveRole);
  const [onlyMine, setOnlyMine] = useState(!canSeeAll);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(iso(new Date()));
  const [kinds, setKinds] = useState<Set<WorkKind>>(new Set());

  const all = useMemo(
    () => myWorkItems(
      { uid: userProfile?.uid || '', role: effectiveRole },
      { leads: store.getLeads(), jobs: store.getJobs(), invoices: store.getInvoices() },
      onlyMine
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.getVersion(), userProfile?.uid, effectiveRole, onlyMine]
  );
  const items = kinds.size ? all.filter((w) => kinds.has(w.kind)) : all;
  const presentKinds = Array.from(new Set(all.map((w) => w.kind)));
  const byDate = useMemo(() => {
    const m = new Map<string, WorkItem[]>();
    items.forEach((w) => m.set(w.date, [...(m.get(w.date) ?? []), w]));
    return m;
  }, [items]);

  // Month grid starting on Monday
  const first = new Date(month);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = iso(new Date());
  const dayItems = byDate.get(selected) ?? [];
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'My Calendar' }]} />
      <div className="page-header">
        <div className="page-title-wrap">
          <h1>My Calendar</h1>
          <p className="page-subtitle">Your meetings, inspections, service visits, follow-ups and due dates — today and date by date.</p>
        </div>
        {canSeeAll && (
          <div className="chip-row" style={{ marginBottom: 0 }}>
            <button type="button" className={`chip ${onlyMine ? 'chip-on' : ''}`} onClick={() => setOnlyMine(true)}>Only mine</button>
            <button type="button" className={`chip ${!onlyMine ? 'chip-on' : ''}`} onClick={() => setOnlyMine(false)}>All operations</button>
          </div>
        )}
      </div>

      <TodayWorkBar items={items} />

      {presentKinds.length > 1 && (
        <div className="chip-row" style={{ marginBottom: '0.75rem' }}>
          {presentKinds.map((k) => {
            const on = kinds.has(k);
            return (
              <button key={k} type="button" className={`chip ${on ? 'chip-on' : ''}`}
                onClick={() => setKinds((prev) => { const n = new Set(prev); if (on) n.delete(k); else n.add(k); return n; })}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: WORK_KIND_COLOR[k], display: 'inline-block' }} /> {WORK_KIND_LABEL[k]}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)', gap: '1rem', alignItems: 'start' }}>
        <div className="card" style={{ padding: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
            <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
            <strong>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</strong>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(today); }}>Today</button>
              <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={18} /></button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
            {WEEKDAYS.map((w) => <div key={w} className="cell-sub" style={{ textAlign: 'center', fontWeight: 700 }}>{w}</div>)}
            {cells.map((d) => {
              const key = iso(d);
              const list = byDate.get(key) ?? [];
              const inMonth = d.getMonth() === month.getMonth();
              const isSel = key === selected;
              const overdue = key < today && list.some((w) => !w.done);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(key)}
                  style={{
                    minHeight: 64, textAlign: 'left', padding: '0.3rem 0.35rem', borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${isSel ? 'var(--ikpm-emerald-500, #10B981)' : 'var(--border-subtle)'}`,
                    background: isSel ? 'var(--ikpm-emerald-50, #ECFDF5)' : key === today ? '#F0F9FF' : 'var(--bg-surface, #fff)',
                    opacity: inMonth ? 1 : 0.45,
                  }}
                >
                  <div style={{ fontSize: '0.78rem', fontWeight: key === today ? 800 : 600, color: overdue ? '#DC2626' : undefined }}>{d.getDate()}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                    {list.slice(0, 6).map((w) => (
                      <span key={w.id} title={`${WORK_KIND_LABEL[w.kind]}: ${w.title}`}
                        style={{ width: 8, height: 8, borderRadius: 4, background: WORK_KIND_COLOR[w.kind], opacity: w.done ? 0.35 : 1 }} />
                    ))}
                    {list.length > 6 && <span style={{ fontSize: '0.65rem' }}>+{list.length - 6}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: '0.85rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.6rem' }}>
            {new Date(selected + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            <span className="cell-sub" style={{ marginLeft: 6 }}>{dayItems.length} item{dayItems.length === 1 ? '' : 's'}</span>
          </div>
          {dayItems.length === 0 ? (
            <div className="cell-sub">Nothing scheduled.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {dayItems.map((w) => (
                <Link key={w.id} to={w.link} style={{ textDecoration: 'none', color: 'inherit', borderLeft: `4px solid ${WORK_KIND_COLOR[w.kind]}`, padding: '0.35rem 0.6rem', background: 'var(--bg-surface-alt, #F8FAFC)', borderRadius: 6, opacity: w.done ? 0.6 : 1 }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: WORK_KIND_COLOR[w.kind], textTransform: 'uppercase' }}>
                    {WORK_KIND_LABEL[w.kind]}{w.time ? ` · ${w.time}` : ''}{w.done ? ' · done' : w.date < today ? ' · overdue' : ''}
                  </div>
                  <div style={{ fontWeight: 600 }}>{w.title}</div>
                  <div className="cell-sub">{w.detail}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MyCalendarPage;
