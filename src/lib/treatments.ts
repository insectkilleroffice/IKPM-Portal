// Standard treatments offered in proposals (monthly IPM plan and one-time treatment). Every
// treatment field suggests these while typing and also accepts any other treatment typed in.

export const TREATMENT_PRESETS = [
  'General pest control',
  'Rats control',
  'Mice control',
  'Rats & mice control',
  'Cockroach control',
  'Flea & ticks control',
  'Bed bugs control',
  'Termite treatment (pre-construction)',
  'Termite treatment (post-construction)',
  'Beetle treatment',
] as const;

/** One-time treatment types (a proposal may combine several). */
export const TREATMENT_TYPES = [
  { value: 'general_ipm', label: 'General pest control' },
  { value: 'termite_proofing', label: 'Termite proofing' },
  { value: 'bedbug_eradication', label: 'Bedbug treatment' },
  { value: 'rodent_control', label: 'Rodent control' },
  { value: 'commercial_kitchen', label: 'Commercial kitchen' },
  { value: 'fumigation_export', label: 'Fumigation (cargo / warehouse)' },
  { value: 'cockroach_gel', label: 'Cockroach gel' },
] as const;

export const treatmentTypeLabel = (v: string) => TREATMENT_TYPES.find((t) => t.value === v)?.label ?? v.replace(/_/g, ' ');

export const FREQUENCY_SUGGESTIONS = [
  'One-time',
  'Once per week',
  'Twice per week',
  'Once per month',
  'Twice per month',
  'Every service visit',
  'Monthly',
  'Quarterly',
  'As required',
];

/** Treatment ids saved by older proposals, shown by name. */
const LEGACY_LABELS: Record<string, string> = {
  general_fumigation: 'General fumigation',
  cockroach_gel: 'Cockroach gel treatment',
  rodent_control: 'Rodent control (bait stations)',
  termite_treatment: 'Termite treatment',
  bedbug_treatment: 'Bedbug treatment',
  mosquito_fogging: 'Mosquito / fly fogging',
  ant_treatment: 'Ant treatment',
  stored_grain_pest: 'Stored grain pest control',
  snake_reptile: 'Snake / reptile control',
  monitoring_visit: 'Monitoring visit',
  other: 'Other',
};

export const treatmentLabel = (v: string | undefined) => (v ? LEGACY_LABELS[v] ?? v : '');

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();
const isRats = (s: string | undefined) => /^rats?\s+control$/.test(norm(s));
const isMice = (s: string | undefined) => /^mice\s+control$/.test(norm(s));

/**
 * "Rats control" and "Mice control" on the same list become one "Rats & mice control" row
 * (kept where the first of the two was, with its formula / frequency).
 */
export function mergeRatsAndMice<T>(rows: T[], get: (r: T) => string | undefined, set: (r: T, name: string) => T): T[] {
  const ri = rows.findIndex((r) => isRats(get(r)));
  const mi = rows.findIndex((r) => isMice(get(r)));
  if (ri < 0 || mi < 0) return rows;
  const keep = Math.min(ri, mi);
  const drop = Math.max(ri, mi);
  return rows.filter((_, i) => i !== drop).map((r, i) => (i === keep ? set(r, 'Rats & mice control') : r));
}

/** A formula as printed: "Fipronil 2.5% (Termidor)", or just the formula without a brand. */
export const formulaText = (f: { formula: string; brand?: string }) =>
  `${f.formula.trim()}${f.brand?.trim() ? ` (${f.brand.trim()})` : ''}`;

/** All formulas of a service as one line, e.g. "Fipronil (Termidor), Imidacloprid". */
export const formulasText = (list: { formula: string; brand?: string }[] | undefined) =>
  (list ?? []).filter((f) => f.formula.trim()).map(formulaText).join(', ');

/** Drops blank formula lines before saving (formulaKey: the field holding the formulas as text). */
export function withCleanFormulas<T extends { formulas?: { formula: string; brand?: string }[] }>(row: T, formulaKey: keyof T): T {
  if (!row.formulas) return row;
  const formulas = row.formulas
    .filter((f) => f.formula.trim())
    .map((f) => ({ formula: f.formula.trim(), ...(f.brand?.trim() ? { brand: f.brand.trim() } : {}) }));
  return { ...row, formulas, [formulaKey]: formulasText(formulas) };
}

/** Services that still need a formula (every selected service must name at least one). */
export function servicesMissingFormula<T>(rows: T[], name: (r: T) => string, formulas: (r: T) => { formula: string }[] | undefined): string[] {
  return rows
    .filter((r) => name(r).trim() && !(formulas(r) ?? []).some((f) => f.formula.trim()))
    .map((r) => treatmentLabel(name(r)));
}

/** Shared <datalist> ids, rendered once by TreatmentDatalists. */
export const TREATMENT_LIST_ID = 'ikpm-treatment-presets';
export const FREQUENCY_LIST_ID = 'ikpm-frequency-presets';
