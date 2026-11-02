import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, AlertTriangle } from 'lucide-react';
import { WORK_KIND_COLOR, WORK_KIND_LABEL, type WorkItem } from '../../lib/myWork';

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Strip of today's work (and anything overdue) for the signed-in person. */
export const TodayWorkBar: React.FC<{ items: WorkItem[]; compact?: boolean }> = ({ items, compact }) => {
  const today = todayStr();
  const todays = items.filter((w) => w.date === today);
  const overdue = items.filter((w) => w.date < today && !w.done);
  const open = todays.filter((w) => !w.done).length;

  return (
    <div className="card" style={{ padding: '0.85rem 1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: todays.length || overdue.length ? '0.6rem' : 0 }}>
        <CalendarCheck size={18} color="var(--ikpm-emerald-600)" />
        <strong>Today's work</strong>
        <span className="cell-sub">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
        <span className="badge badge-teal">{open} to do</span>
        {todays.length - open > 0 && <span className="badge badge-slate">{todays.length - open} done</span>}
        {overdue.length > 0 && (
          <span className="badge badge-rose" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={12} /> {overdue.length} overdue
          </span>
        )}
        {compact && <Link to="/my-calendar" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>Open my calendar →</Link>}
      </div>
      {todays.length === 0 && overdue.length === 0 ? (
        <div className="cell-sub">Nothing scheduled for you today.</div>
      ) : (
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: 2 }}>
          {[...overdue, ...todays].slice(0, compact ? 8 : 50).map((w) => (
            <Link
              key={w.id}
              to={w.link}
              style={{
                flex: '0 0 220px', textDecoration: 'none', color: 'inherit',
                border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${WORK_KIND_COLOR[w.kind]}`,
                borderRadius: 8, padding: '0.45rem 0.6rem', background: w.done ? 'var(--bg-surface-alt, #F8FAFC)' : 'var(--bg-surface, #fff)',
                opacity: w.done ? 0.65 : 1,
              }}
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: WORK_KIND_COLOR[w.kind], textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {WORK_KIND_LABEL[w.kind]}{w.time ? ` · ${w.time}` : ''}{w.date < today && !w.done ? ' · overdue' : ''}{w.done ? ' · done' : ''}
              </div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.title}</div>
              <div className="cell-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.detail}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
