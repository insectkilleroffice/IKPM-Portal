// Contract billing cycle: how often a contract is invoiced. Set on the proposal, copied to the contract.
// 0 (or unset) = calendar month; QUARTERLY (90) = every 3 months from the contract start date;
// otherwise every N days from the start date (e.g. 15 → 1–15, 16–30, …).
// At the end of each cycle the client gets one statement of all the job invoices in it.

export interface BillingPeriod {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD, inclusive
}

/** Special value: every 3 calendar months from the contract start date. */
export const QUARTERLY = 90;

export const BILLING_CYCLE_PRESETS: { days: number; label: string }[] = [
  { days: 0, label: 'Monthly (calendar month)' },
  { days: QUARTERLY, label: 'Quarterly (every 3 months)' },
  { days: 15, label: 'Every 15 days' },
  { days: 30, label: 'Every 30 days' },
  { days: 7, label: 'Every week' },
];

export function billingCycleLabel(days?: number): string {
  if (!days) return 'Monthly (calendar month)';
  return BILLING_CYCLE_PRESETS.find((p) => p.days === days)?.label ?? `Every ${days} days`;
}

/** Short phrase for documents, e.g. "15-day" or "monthly". */
export const billingCycleShort = (days?: number) => (!days ? 'monthly' : days === QUARTERLY ? 'quarterly' : `${days}-day`);

// Date-only maths in UTC, so a local time zone never shifts a date by a day
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * 86400000));
const monthEnd = (iso: string) => {
  const d = toDate(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};
/** Day before the same date 3 months later (1 Jan → 31 Mar), clamped to month ends (30 Nov → 27 Feb). */
const quarterEnd = (iso: string) => {
  const d = toDate(iso);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1));
  const lastOfTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const same = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastOfTarget)));
  return toIso(new Date(same.getTime() - 86400000));
};

/**
 * Billing periods of a contract that have started on or before `upTo`, clipped to the contract's
 * start and last day of service.
 */
export function billingPeriods(startDate: string, lastDay: string, cycleDays: number | undefined, upTo: string): BillingPeriod[] {
  const out: BillingPeriod[] = [];
  const stop = lastDay < upTo ? lastDay : upTo;
  let start = startDate;
  for (let guard = 0; start <= stop && guard < 1000; guard++) {
    const rawEnd = cycleDays === QUARTERLY ? quarterEnd(start) : cycleDays && cycleDays > 0 ? addDays(start, cycleDays - 1) : monthEnd(start);
    const end = rawEnd < lastDay ? rawEnd : lastDay;
    out.push({ start, end });
    start = addDays(end, 1);
  }
  return out;
}
