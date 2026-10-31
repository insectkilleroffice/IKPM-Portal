import React from 'react';
import type { Employee } from '../../types/hr';

interface Props {
  /** The Supervisor's own PCOs (HR employees). */
  pcos: Employee[];
  /** Selected employee ids. */
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Employee ids to highlight (e.g. double-booked). */
  flagged?: string[];
  /** All active PCOs: enables "+ Add PCO from another team" for borrowed staff. */
  otherPcos?: Employee[];
}

/**
 * Tick-boxes for the PCOs in a Supervisor's team. PCOs have no portal login: the Supervisor
 * coordinates them in person / on WhatsApp and records here who was planned or who did the work.
 */
export const PcoTicks: React.FC<Props> = ({ pcos, selected, onChange, flagged, otherPcos }) => {
  const own = new Set(pcos.map((p) => p.id));
  // Borrowed PCOs already selected stay visible even though they're in another team
  const borrowed = (otherPcos ?? []).filter((p) => !own.has(p.id) && selected.includes(p.id));
  const shown = [...pcos, ...borrowed];
  const addable = (otherPcos ?? []).filter((p) => !own.has(p.id) && !selected.includes(p.id));
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected.filter((x) => x !== id), id] : selected.filter((x) => x !== id));

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem 0.75rem', alignItems: 'center' }}>
      {shown.length === 0 && (
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          No PCOs in this team yet. Set their Supervisor on the HR Employees page.
        </span>
      )}
      {shown.map((p) => {
        const isFlagged = flagged?.includes(p.id);
        return (
          <label
            key={p.id}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', cursor: 'pointer', color: isFlagged ? '#DC2626' : undefined, fontWeight: isFlagged ? 700 : undefined }}
            title={isFlagged ? 'Already booked in this time slot' : p.id}
          >
            <input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
            <span>{p.name}{own.has(p.id) ? '' : ' (other team)'}</span>
          </label>
        );
      })}
      {addable.length > 0 && (
        <select
          className="form-select"
          style={{ height: '28px', fontSize: '0.75rem', width: 'auto' }}
          value=""
          onChange={(e) => e.target.value && toggle(e.target.value, true)}
        >
          <option value="">+ Add PCO from another team</option>
          {addable.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
    </div>
  );
};
