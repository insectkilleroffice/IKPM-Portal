import React from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { emptyPlanItem, planFromPreset, SERVICE_PLAN_PRESETS, type ServicePlanItem, type ServicePlanPreset } from '../../lib/proposalPlan';

interface Props {
  preset?: ServicePlanPreset;
  items: ServicePlanItem[];
  onPresetChange: (preset: ServicePlanPreset) => void;
  onChange: (items: ServicePlanItem[]) => void;
}

const FREQUENCY_SUGGESTIONS = ['Once per week', 'Twice per week', 'Twice per month', 'Once per month', 'Every service visit', 'Monthly', 'Quarterly', 'As required'];

/** The "Monthly IPM Service Plan" table: start from a preset, then edit every row. */
export const ServicePlanEditor: React.FC<Props> = ({ preset, items, onPresetChange, onChange }) => {
  const set = (i: number, patch: Partial<ServicePlanItem>) => onChange(items.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      <div className="form-group">
        <label className="form-label">Start from a preset</label>
        <div className="chip-row" style={{ marginBottom: 0 }}>
          {(Object.keys(SERVICE_PLAN_PRESETS) as ServicePlanPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`chip ${preset === p ? 'chip-on' : ''}`}
              onClick={() => {
                onPresetChange(p);
                onChange(planFromPreset(p));
              }}
            >
              {SERVICE_PLAN_PRESETS[p].label}
            </button>
          ))}
        </div>
      </div>

      <datalist id="plan-frequencies">
        {FREQUENCY_SUGGESTIONS.map((f) => <option key={f} value={f} />)}
      </datalist>

      <div className="plan-rows">
        {items.map((row, i) => (
          <div key={row.id} className="plan-row">
            <span className="plan-row-no">{i + 1}</span>
            <input className="form-input" value={row.service} placeholder="Service (e.g. Rodent trap monitoring & cleaning)" aria-label={`Service ${i + 1}`} onChange={(e) => set(i, { service: e.target.value })} />
            <input className="form-input" value={row.frequency} placeholder="Frequency" list="plan-frequencies" aria-label={`Frequency ${i + 1}`} onChange={(e) => set(i, { frequency: e.target.value })} />
            <div className="plan-row-actions">
              <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
              <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
              <button type="button" className="icon-btn" onClick={() => onChange(items.filter((_, idx) => idx !== i))} aria-label="Remove row"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-sm btn-secondary" style={{ marginTop: '0.5rem' }} onClick={() => onChange([...items, emptyPlanItem()])}>
        <Plus size={14} /> Add row
      </button>
    </div>
  );
};

export default ServicePlanEditor;
