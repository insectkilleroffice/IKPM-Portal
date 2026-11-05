import { describe, expect, it } from 'vitest';
import { inDateRange } from '../lib/dateRange';

describe('inDateRange', () => {
  it('includes both ends of the range', () => {
    expect(inDateRange('2026-11-01', '2026-11-01', '2026-11-30')).toBe(true);
    expect(inDateRange('2026-11-30', '2026-11-01', '2026-11-30')).toBe(true);
    expect(inDateRange('2026-12-01', '2026-11-01', '2026-11-30')).toBe(false);
    expect(inDateRange('2026-10-31', '2026-11-01', '2026-11-30')).toBe(false);
  });

  it('with no end date, means the start date only', () => {
    expect(inDateRange('2026-11-05', '2026-11-05', '')).toBe(true);
    expect(inDateRange('2026-11-06', '2026-11-05', '')).toBe(false);
  });

  it('with only an end date, means that date only', () => {
    expect(inDateRange('2026-11-05', '', '2026-11-05')).toBe(true);
    expect(inDateRange('2026-11-04', '', '2026-11-05')).toBe(false);
  });

  it('shows everything when both are empty', () => {
    expect(inDateRange('2026-11-05', '', '')).toBe(true);
  });

  it('still works when the dates are entered the wrong way round', () => {
    expect(inDateRange('2026-11-15', '2026-11-30', '2026-11-01')).toBe(true);
    expect(inDateRange('2026-12-15', '2026-11-30', '2026-11-01')).toBe(false);
  });
});
