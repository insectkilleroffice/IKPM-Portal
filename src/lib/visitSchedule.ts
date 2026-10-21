// Contract visit schedule (Step 14): service + follow-up pairs per branch across the tenure.
// Pure, so it is unit-tested; the schedule modal lets staff edit every date before confirming.

export type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night_shift';

export interface ScheduleBranch {
  id: string;
  name: string;
  closingTime?: string;
  windowStart?: string;
  windowEnd?: string;
}

export interface PlannedVisit {
  key: string;
  branchId: string;
  branchName: string;
  date: string;
  kind: 'service' | 'follow_up';
  /** Key of the service visit a follow-up belongs to (and vice versa). */
  pairKey?: string;
  timeSlot: TimeSlot;
  windowStart?: string;
  windowEnd?: string;
  closingTime?: string;
  pcoId?: string;
  pcoName?: string;
}

export interface PlanInput {
  start: string;
  end: string;
  serviceVisitsPerMonth: number;
  followUpVisitsPerMonth: number;
  branches: ScheduleBranch[];
  skipSundays?: boolean;
  holidays?: string[];
  /** Days between a service visit and its follow-up (default 3). */
  followUpGapDays?: number;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

const minutes = (hhmm?: string) => {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

/** Slot from the branch's visit window, else after closing time, else morning. */
export function slotFor(b: Pick<ScheduleBranch, 'closingTime' | 'windowStart'>): TimeSlot {
  const at = minutes(b.windowStart) ?? minutes(b.closingTime);
  if (at === undefined) return 'morning';
  if (at < 12 * 60) return b.windowStart ? 'morning' : 'night_shift'; // closing after midnight
  if (at < 17 * 60) return 'afternoon';
  if (at < 21 * 60) return 'evening';
  return 'night_shift';
}

/** Next working day on or after `date` (skips Sundays / holidays when configured). */
export function workingDay(date: string, opts: Pick<PlanInput, 'skipSundays' | 'holidays'>): string {
  let d = date;
  for (let i = 0; i < 14; i++) {
    const sunday = parse(d).getDay() === 0;
    if (!(opts.skipSundays && sunday) && !opts.holidays?.includes(d)) return d;
    d = addDays(d, 1);
  }
  return d;
}

/** Visits per month as a whole number per month (0.5 → every other month, ⅓ → quarterly). */
const visitsIn = (perMonth: number, monthIndex: number) => {
  if (perMonth >= 1) return Math.round(perMonth);
  if (perMonth <= 0) return 0;
  const every = Math.round(1 / perMonth);
  return monthIndex % every === 0 ? 1 : 0;
};

export function planVisits(input: PlanInput): PlannedVisit[] {
  const out: PlannedVisit[] = [];
  const gap = input.followUpGapDays ?? 3;
  const start = parse(input.start);
  const end = input.end.slice(0, 10);
  input.branches.forEach((b, bi) => {
    const slot = slotFor(b);
    // Branches are staggered by a day so one team can cover them
    const stagger = bi % 3;
    for (let mi = 0; ; mi++) {
      const monthStart = new Date(start.getFullYear(), start.getMonth() + mi, mi === 0 ? start.getDate() : 1);
      if (ymd(monthStart) > end) break;
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      const span = monthEnd.getDate() - monthStart.getDate() + 1;
      const n = visitsIn(input.serviceVisitsPerMonth, mi);
      const f = Math.min(n, visitsIn(input.followUpVisitsPerMonth, mi));
      for (let i = 0; i < n; i++) {
        const offset = Math.floor((i * span) / n) + stagger;
        const date = workingDay(ymd(new Date(monthStart.getFullYear(), monthStart.getMonth(), monthStart.getDate() + Math.min(offset, span - 1))), input);
        if (date > end) continue;
        const key = `${b.id}:${date}:s`;
        const base = { branchId: b.id, branchName: b.name, timeSlot: slot, windowStart: b.windowStart, windowEnd: b.windowEnd, closingTime: b.closingTime };
        const visit: PlannedVisit = { ...base, key, date, kind: 'service' };
        out.push(visit);
        if (i < f) {
          const fuDate = workingDay(addDays(date, gap), input);
          if (fuDate <= end) {
            const fuKey = `${b.id}:${fuDate}:f`;
            visit.pairKey = fuKey;
            out.push({ ...base, key: fuKey, date: fuDate, kind: 'follow_up', pairKey: key });
          }
        }
      }
    }
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.branchName.localeCompare(b.branchName));
}

/** Visits that double-book a PCO: same person, same date and slot (against each other and existing jobs). */
export function pcoConflicts(
  visits: Pick<PlannedVisit, 'key' | 'date' | 'timeSlot' | 'pcoId'>[],
  existing: { id: string; scheduledDate: string; timeSlot: string; assignedTechnicianIds: string[]; status?: string }[]
): Set<string> {
  const taken = new Map<string, string>();
  existing
    .filter((j) => j.status !== 'cancelled')
    .forEach((j) => j.assignedTechnicianIds.forEach((uid) => taken.set(`${uid}|${j.scheduledDate.slice(0, 10)}|${j.timeSlot}`, j.id)));
  const bad = new Set<string>();
  const seen = new Map<string, string>();
  visits.forEach((v) => {
    if (!v.pcoId) return;
    const k = `${v.pcoId}|${v.date}|${v.timeSlot}`;
    if (taken.has(k)) bad.add(v.key);
    const other = seen.get(k);
    if (other) {
      bad.add(v.key);
      bad.add(other);
    } else seen.set(k, v.key);
  });
  return bad;
}

/** Visits per month from the contract (proposal plan), falling back to its frequency. */
export function visitsPerMonth(c: { serviceVisitsPerMonth?: number; followUpVisitsPerMonth?: number; frequency?: string }) {
  const byFreq: Record<string, number> = { weekly: 4, fortnightly: 2, monthly: 1, bi_monthly: 0.5, quarterly: 1 / 3, one_off: 1 };
  return { service: c.serviceVisitsPerMonth ?? byFreq[c.frequency ?? 'monthly'] ?? 1, followUp: c.followUpVisitsPerMonth ?? 0 };
}
