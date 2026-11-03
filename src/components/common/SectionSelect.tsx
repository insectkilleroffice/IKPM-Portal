import React from 'react';

export interface SectionOption<T extends string> {
  value: T;
  label: string;
  /** Leave out sections the viewer may not open. */
  hidden?: boolean;
}

/** Dropdown that replaces a long row of tabs on record pages (customer, branch). */
export function SectionSelect<T extends string>({ value, onChange, options, children }: {
  value: T;
  onChange: (v: T) => void;
  options: SectionOption<T>[];
  /** Extra buttons shown next to the dropdown. */
  children?: React.ReactNode;
}) {
  const shown = options.filter((o) => !o.hidden);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', margin: '0.5rem 0 1.25rem' }}>
      <label className="form-label" htmlFor="section-select" style={{ margin: 0, whiteSpace: 'nowrap' }}>Show</label>
      <select
        id="section-select"
        className="form-select"
        style={{ width: 'auto', minWidth: 280, fontWeight: 600 }}
        value={shown.some((o) => o.value === value) ? value : shown[0]?.value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {shown.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {children}
    </div>
  );
}
