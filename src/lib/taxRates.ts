// Sales tax lookups. Rates always come from the tax_rules collection (maintained by finance under
// Tax rules); the built-in getStandardTaxRate() is only a fallback when no current rule exists.

import type { TaxJurisdiction, TaxRuleConfig } from '../types/finance';
import { getStandardTaxRate, provinceToJurisdiction } from './workflow';

export interface TaxRate {
  jurisdiction: TaxJurisdiction;
  percent: number;
  title: string;
  /** False when no current tax rule was found and the fallback rate was used. */
  fromRules: boolean;
}

/** Current standard rate for a jurisdiction from the tax rules. */
export function taxRateFor(rules: TaxRuleConfig[], jurisdiction: TaxJurisdiction): TaxRate {
  const rule = rules
    .filter((r) => r.jurisdiction === jurisdiction && r.isCurrent)
    .sort((a, b) => (b.effectiveDate || '').localeCompare(a.effectiveDate || ''))[0];
  if (rule) return { jurisdiction, percent: rule.standardSalesTaxPercent, title: rule.jurisdictionTitle, fromRules: true };
  return { jurisdiction, percent: getStandardTaxRate(jurisdiction), title: jurisdiction, fromRules: false };
}

/** Jurisdiction from where the service is delivered (branch, else head office / residence province or city). */
export function jurisdictionFor(place: { province?: string; city?: string } | undefined): TaxJurisdiction {
  return provinceToJurisdiction(place?.province || place?.city);
}
