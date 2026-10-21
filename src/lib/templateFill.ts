// Fills {{placeholders}} in editable document templates. Unknown placeholders are left as-is
// so a typo is visible on the document instead of silently disappearing.

export type TemplateVars = Record<string, string | number | undefined>;

export function fillTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key: string) => {
    const v = vars[key];
    return v === undefined || v === '' ? all : String(v);
  });
}

/** Placeholders the template editor lists. */
export const TEMPLATE_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'clientName', label: 'Client name' },
  { key: 'companyName', label: 'IKPM short name' },
  { key: 'siteName', label: 'Branch / site' },
  { key: 'monthlyRate', label: 'Monthly charges (PKR)' },
  { key: 'tenureMonths', label: 'Tenure (months)' },
  { key: 'tenureStart', label: 'Tenure start date' },
  { key: 'tenureEnd', label: 'Tenure end date' },
  { key: 'paymentTermsDays', label: 'Payment within (days)' },
  { key: 'taxMode', label: 'inclusive / exclusive (tax wording)' },
];
