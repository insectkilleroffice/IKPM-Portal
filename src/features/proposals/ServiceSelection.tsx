import React from 'react';
import { Plus, X } from 'lucide-react';
import { PestPicker } from '../../components/common/PestPicker';
import { FREQUENCY_LIST_ID, formulasText, mergeRatsAndMice, TREATMENT_PRESETS, treatmentLabel } from '../../lib/treatments';
import type { FormulaLine } from '../../lib/proposalPlan';

const SERVICE_OPTIONS = TREATMENT_PRESETS.map((t) => ({ value: t, label: t }));

interface Props<T> {
  rows: T[];
  onChange: (rows: T[]) => void;
  /**
   * Field names on a row: the service, its formulas (list), the formulas as one line of text
   * (kept in step for PDFs and older screens) and its frequency.
   */
  fields: { name: keyof T; formulas: keyof T; formulaText: keyof T; frequency: keyof T };
  /** A new row for a service picked in the selector. */
  make: (service: string) => T;
  label?: string;
  /** Extra columns per service (e.g. quantity and rate on one-time treatments). */
  extraHead?: string[];
  extra?: (row: T, set: (patch: Partial<T>) => void) => React.ReactNode;
  /** Show "formula required" on services without one (after a save attempt, or always). */
  showMissing?: boolean;
}

/**
 * Step 1: select the services (type to search the standard list, or type any other service and
 * press Enter). Step 2: each selected service gets one or more formulas (formula required, brand
 * optional) and its frequency. Rats control + Mice control together become "Rats & mice control".
 * Needs <TreatmentDatalists /> on the page for the frequency suggestions.
 */
export function ServiceSelection<T>({ rows, onChange, fields, make, label = 'Services', extraHead = [], extra, showMissing = true }: Props<T>) {
  const nameOf = (r: T) => String(r[fields.name] ?? '');
  // Older proposals kept the formulas as one line of text
  const formulasOf = (r: T): FormulaLine[] => {
    const list = r[fields.formulas] as unknown as FormulaLine[] | undefined;
    if (list?.length) return list;
    const text = String(r[fields.formulaText] ?? '').trim();
    // Always at least one formula line to fill in
    return [{ formula: text, brand: '' }];
  };
  const merge = (list: T[]) => mergeRatsAndMice(list, nameOf, (r, name) => ({ ...r, [fields.name]: name }));
  const selected = rows.map(nameOf).filter((n) => n.trim());

  const pick = (names: string[]) => {
    const kept = rows.filter((r) => names.includes(nameOf(r)));
    const added = names.filter((n) => !rows.some((r) => nameOf(r) === n)).map((n) => ({ ...make(n), [fields.formulas]: [{ formula: '', brand: '' }] }) as T);
    onChange(merge([...kept, ...added]));
  };
  const set = (i: number, patch: Partial<T>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const setFormulas = (i: number, list: FormulaLine[]) =>
    set(i, { [fields.formulas]: list, [fields.formulaText]: formulasText(list) } as Partial<T>);

  const cols = `minmax(0, 1fr) minmax(0, 2fr) minmax(0, 0.9fr)${extraHead.map(() => ' 90px').join('')} 28px`;

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <PestPicker
        value={selected}
        onChange={pick}
        options={SERVICE_OPTIONS}
        placeholder="Select services, e.g. Cockroach control, Termite treatment…"
      />

      {rows.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: '0.5rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            <span>Service</span>
            <span>Formula <span className="required">*</span> · Brand <span style={{ fontWeight: 400 }}>(optional)</span></span>
            <span>Frequency</span>
            {extraHead.map((h) => <span key={h}>{h}</span>)}
            <span />
          </div>
          {rows.map((r, i) => {
            const formulas = formulasOf(r);
            const missing = showMissing && !formulas.some((f) => f.formula.trim());
            return (
              <div
                key={`${nameOf(r)}_${i}`}
                style={{ display: 'grid', gridTemplateColumns: cols, gap: '0.5rem', alignItems: 'start', padding: '0.45rem 0', borderTop: i ? '1px solid var(--border-subtle)' : undefined }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem', overflowWrap: 'anywhere', paddingTop: '0.55rem' }}>{treatmentLabel(nameOf(r)) || '—'}</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {formulas.map((f, fi) => (
                    <div key={fi} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) 24px', gap: '0.3rem', alignItems: 'center' }}>
                      <input
                        className="form-input"
                        placeholder="Formula, e.g. Fipronil 2.5%"
                        aria-label={`Formula ${fi + 1} for ${nameOf(r)}`}
                        aria-invalid={missing && fi === 0}
                        style={missing && fi === 0 ? { borderColor: 'var(--ikpm-rose-500, #F43F5E)' } : undefined}
                        value={f.formula}
                        onChange={(e) => setFormulas(i, formulas.map((x, xi) => (xi === fi ? { ...x, formula: e.target.value } : x)))}
                      />
                      <input
                        className="form-input"
                        placeholder="Brand (optional)"
                        aria-label={`Brand ${fi + 1} for ${nameOf(r)}`}
                        value={f.brand ?? ''}
                        onChange={(e) => setFormulas(i, formulas.map((x, xi) => (xi === fi ? { ...x, brand: e.target.value } : x)))}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Remove formula"
                        disabled={formulas.length === 1}
                        onClick={() => setFormulas(i, formulas.filter((_, xi) => xi !== fi))}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0.15rem 0.4rem' }} onClick={() => setFormulas(i, [...formulas, { formula: '', brand: '' }])}>
                      <Plus size={11} /> Add formula
                    </button>
                    {missing && <span style={{ fontSize: '0.72rem', color: 'var(--ikpm-rose-600, #E11D48)' }}>Formula required</span>}
                  </div>
                </div>

                <input
                  className="form-input"
                  list={FREQUENCY_LIST_ID}
                  placeholder="e.g. Once per month"
                  aria-label={`Frequency for ${nameOf(r)}`}
                  value={String(r[fields.frequency] ?? '')}
                  onChange={(e) => set(i, { [fields.frequency]: e.target.value } as Partial<T>)}
                />
                {extra?.(r, (patch) => set(i, patch))}
                <button type="button" className="icon-btn" style={{ marginTop: '0.35rem' }} aria-label={`Remove ${nameOf(r)}`} onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ServiceSelection;
