import { describe, expect, it } from 'vitest';
import { billingPeriods, billingCycleLabel } from '../lib/billingCycle';

describe('billing cycles', () => {
  it('calendar month by default', () => {
    expect(billingPeriods('2026-01-10', '2026-12-31', undefined, '2026-03-05')).toEqual([
      { start: '2026-01-10', end: '2026-01-31' },
      { start: '2026-02-01', end: '2026-02-28' },
      { start: '2026-03-01', end: '2026-03-31' },
    ]);
  });
  it('every 15 days from the contract start, stopping at its last day', () => {
    expect(billingPeriods('2026-11-01', '2026-11-20', 15, '2026-12-31')).toEqual([
      { start: '2026-11-01', end: '2026-11-15' },
      { start: '2026-11-16', end: '2026-11-20' },
    ]);
    expect(billingCycleLabel(15)).toBe('Every 15 days');
    expect(billingCycleLabel(10)).toBe('Every 10 days');
  });
});

describe('quarterly cycle', () => {
  it('every 3 months from the contract start', () => {
    expect(billingPeriods('2026-01-01', '2026-12-31', 90, '2026-05-01')).toEqual([
      { start: '2026-01-01', end: '2026-03-31' },
      { start: '2026-04-01', end: '2026-06-30' },
    ]);
    expect(billingPeriods('2026-11-15', '2027-12-31', 90, '2026-12-01')).toEqual([{ start: '2026-11-15', end: '2027-02-14' }]);
  });
});
