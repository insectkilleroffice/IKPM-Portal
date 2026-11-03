import React from 'react';
import { BILLING_CYCLE_PRESETS } from '../../lib/billingCycle';

/** Billing cycle picker: calendar month, every 15 / 30 days, every week, or any number of days. */
export const BillingCycleInput: React.FC<{ value: number; onChange: (days: number) => void }> = ({ value, onChange }) => {
  const isPreset = BILLING_CYCLE_PRESETS.some((p) => p.days === value);
  return (
    <div style={{ display: 'flex', gap: '0.4rem' }}>
      <select className="form-select" value={isPreset ? String(value) : 'custom'}
        onChange={(e) => onChange(e.target.value === 'custom' ? (value > 0 && !isPreset ? value : 10) : Number(e.target.value))}>
        {BILLING_CYCLE_PRESETS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
        <option value="custom">Other (number of days)</option>
      </select>
      {!isPreset && (
        <input type="number" min={1} max={365} className="form-input" style={{ width: 80 }} value={value}
          onChange={(e) => onChange(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} aria-label="Days per billing cycle" />
      )}
    </div>
  );
};
