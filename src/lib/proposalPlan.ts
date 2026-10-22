// Monthly IPM service plan proposals (the "QTE" quotation format): service-plan presets,
// tenure dates and monthly pricing with tax exclusive / inclusive. Pure, so it is unit-tested
// and shared by the proposal builder, the PDF and contract creation.
//
// The default wording below is a starting point the sales team edits per client; replace it
// with your standard quotation text under Settings when it differs.

export interface ServicePlanItem {
  id: string;
  service: string;
  frequency: string;
}

export type ServicePlanPreset = 'commercial_kitchen' | 'factory' | 'general_ipm';

export interface ScopeSection {
  key: string; // 'A' | 'B' | 'C' ...
  title: string;
  body: string;
}

interface PresetDef {
  label: string;
  items: Omit<ServicePlanItem, 'id'>[];
  serviceVisitsPerMonth: number;
  followUpVisitsPerMonth: number;
}

const ONCE_A_WEEK = 'Once per week';
const EVERY_SERVICE = 'Every service visit';

/** Starting points for the Monthly IPM Service Plan table; every row stays editable. */
export const SERVICE_PLAN_PRESETS: Record<ServicePlanPreset, PresetDef> = {
  commercial_kitchen: {
    label: 'Commercial kitchen / restaurant',
    serviceVisitsPerMonth: 4,
    followUpVisitsPerMonth: 4,
    items: [
      { service: 'Fumigation: cold fogging (ULV) / Knapsack sprayer', frequency: ONCE_A_WEEK },
      { service: 'Rodent trap monitoring & cleaning', frequency: EVERY_SERVICE },
      { service: 'Rodent glue board change', frequency: EVERY_SERVICE },
      { service: 'Cockroach gel application', frequency: EVERY_SERVICE },
      { service: 'Lizard night activity', frequency: 'Once per month' },
      { service: 'EFK (electric fly killer) cleaning', frequency: EVERY_SERVICE },
      { service: 'Follow-up visit', frequency: ONCE_A_WEEK },
      { service: 'Risk assessment', frequency: 'Quarterly' },
      { service: 'Supervisor visit', frequency: 'Monthly' },
      { service: 'Entomologist visit', frequency: 'Monthly' },
    ],
  },
  factory: {
    label: 'Factory / warehouse',
    serviceVisitsPerMonth: 4,
    followUpVisitsPerMonth: 2,
    items: [
      { service: 'Fumigation: cold fogging (ULV) / Knapsack sprayer', frequency: ONCE_A_WEEK },
      { service: 'Rodent trap monitoring & cleaning', frequency: EVERY_SERVICE },
      { service: 'Rodent glue board change', frequency: EVERY_SERVICE },
      { service: 'EFK (electric fly killer) cleaning', frequency: EVERY_SERVICE },
      { service: 'Follow-up visit', frequency: 'Twice per month' },
      { service: 'Risk assessment', frequency: 'Quarterly' },
      { service: 'Supervisor visit', frequency: 'Monthly' },
      { service: 'Entomologist visit', frequency: 'Monthly' },
    ],
  },
  general_ipm: {
    label: 'General IPM (office / residence)',
    serviceVisitsPerMonth: 2,
    followUpVisitsPerMonth: 1,
    items: [
      { service: 'Fumigation: cold fogging (ULV) / Knapsack sprayer', frequency: 'Twice per month' },
      { service: 'Cockroach gel application', frequency: EVERY_SERVICE },
      { service: 'Rodent trap monitoring & cleaning', frequency: EVERY_SERVICE },
      { service: 'Follow-up visit', frequency: 'Once per month' },
      { service: 'Supervisor visit', frequency: 'Monthly' },
    ],
  },
};

let seq = 0;
const newId = () => `sp_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export const planFromPreset = (preset: ServicePlanPreset): ServicePlanItem[] =>
  SERVICE_PLAN_PRESETS[preset].items.map((i) => ({ ...i, id: newId() }));

export const emptyPlanItem = (): ServicePlanItem => ({ id: newId(), service: '', frequency: '' });

export const DOCUMENTATION_OPTIONS = [
  'Service reports after every visit',
  'Mechanical trap & glue station monitoring sheets',
  'Quarterly risk assessment report',
  'Quarterly trend analysis',
  'Pest management layout (device map)',
  'MSDS of all chemicals used',
  'Technician certificates',
];

export const DEFAULT_EXCLUSIONS = 'Termite control and bird control are not included in this proposal.';

export const DEFAULT_DEVICE_OWNERSHIP =
  'Mechanical devices (rodent traps, glue / bait stations, EFKs) installed at the premises are purchased and owned by the client. Glue boards and bait refills are not included in the monthly charges.';

export const DEFAULT_SCOPE_SECTIONS: ScopeSection[] = [
  { key: 'A', title: 'Crawling & flying insects', body: 'Control of cockroaches, ants, flies, mosquitoes and other crawling and flying insects through fogging, spraying and gel baiting in all agreed areas.' },
  { key: 'B', title: 'Rodent control', body: 'Rodent control through mechanical traps and glue / bait stations, with monitoring and cleaning on every service visit.' },
  { key: 'C', title: 'Monitoring, inspection & reporting', body: 'Regular inspection of the premises, monitoring sheets for every device, service reports after every visit and a periodic risk assessment with recommendations.' },
];

export const DEFAULT_TERMS: string[] = [
  'Services are carried out in line with the Monthly IPM Service Plan below.',
  'The client provides access to all areas to be treated at the agreed service times.',
  'Hygiene, proofing and structural recommendations in our reports are carried out by the client.',
  'Only registered chemicals are used, applied by trained technicians following their MSDS.',
  'Additional visits requested outside the plan are charged separately.',
  'Either party may end the agreement with 30 days written notice.',
  'Charges are reviewed at renewal.',
  'Exclusions and device ownership are as stated in this proposal.',
];

export const DEFAULT_COVER_LETTER =
  'Thank you for the opportunity to inspect your premises. {{companyName}} is pleased to submit this proposal for Integrated Pest Management (IPM) services at {{clientName}}. The proposal covers the scope of services, our terms, the monthly service plan and the charges for the agreed tenure.';

// ---------------------------------------------------------------------------
// Dates & money
// ---------------------------------------------------------------------------

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** First day of next month (default tenure start). */
export function defaultTenureStart(from: Date = new Date()): string {
  return ymd(new Date(from.getFullYear(), from.getMonth() + 1, 1));
}

/** Tenure end: the day before the same date `months` later (1 Jan + 12 months → 31 Dec). */
export function tenureEnd(start: string, months: number): string {
  const [y, m, d] = start.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d || !months || months < 1) return start.slice(0, 10);
  // Clamp to the target month's last day (31 Jan + 1 month → end 27/28 Feb)
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const end = new Date(target.getFullYear(), target.getMonth(), Math.min(d, lastDay));
  end.setDate(end.getDate() - 1);
  return ymd(end);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PlanPricing {
  /** Monthly charge before tax. */
  monthlyBase: number;
  monthlyTax: number;
  /** What the client pays per month. */
  monthlyTotal: number;
  /** Tenure totals (after discount). */
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
}

/**
 * Monthly rate → tenure totals. With taxMode 'inclusive' the rate already contains sales tax;
 * with 'exclusive' tax is added on top. The tax percent comes from tax_rules, never hard-coded.
 */
export function planPricing(input: { monthlyRate: number; taxMode: 'exclusive' | 'inclusive'; taxPercent: number; tenureMonths: number; discountPercent?: number }): PlanPricing {
  const rate = Math.max(0, input.monthlyRate || 0);
  const t = Math.max(0, input.taxPercent || 0) / 100;
  const months = Math.max(1, Math.round(input.tenureMonths || 1));
  const monthlyBase = input.taxMode === 'inclusive' ? rate / (1 + t) : rate;
  const subtotal = monthlyBase * months;
  const discountAmount = (subtotal * Math.max(0, input.discountPercent || 0)) / 100;
  const taxAmount = (subtotal - discountAmount) * t;
  return {
    monthlyBase: round2(monthlyBase),
    monthlyTax: round2(monthlyBase * t),
    monthlyTotal: round2(input.taxMode === 'inclusive' ? rate : rate * (1 + t)),
    subtotal: round2(subtotal),
    discountAmount: round2(discountAmount),
    taxAmount: round2(taxAmount),
    totalAmount: round2(subtotal - discountAmount + taxAmount),
  };
}

/** Contract visit frequency from the number of service visits per month. */
export function frequencyForVisits(visitsPerMonth?: number): 'weekly' | 'fortnightly' | 'monthly' | 'bi_monthly' | 'quarterly' {
  const v = visitsPerMonth ?? 1;
  if (v >= 4) return 'weekly';
  if (v >= 2) return 'fortnightly';
  if (v >= 1) return 'monthly';
  if (v >= 0.5) return 'bi_monthly';
  return 'quarterly';
}
