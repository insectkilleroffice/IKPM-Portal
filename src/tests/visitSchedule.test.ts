import { describe, expect, it } from 'vitest';
import { pcoConflicts, planVisits, slotFor, visitsPerMonth, workingDay } from '../lib/visitSchedule';

const branches = [{ id: 'B1', name: 'Dunkin Johar', closingTime: '23:00' }];

describe('planVisits', () => {
  it('creates service + follow-up pairs per month within the tenure', () => {
    const v = planVisits({ start: '2026-11-01', end: '2026-12-31', serviceVisitsPerMonth: 2, followUpVisitsPerMonth: 2, branches });
    expect(v.filter((x) => x.kind === 'service').map((x) => x.date)).toEqual(['2026-11-01', '2026-11-16', '2026-12-01', '2026-12-16']);
    expect(v.filter((x) => x.kind === 'follow_up').map((x) => x.date)).toEqual(['2026-11-04', '2026-11-19', '2026-12-04', '2026-12-19']);
    const first = v.find((x) => x.date === '2026-11-01')!;
    expect(v.find((x) => x.key === first.pairKey)?.pairKey).toBe(first.key);
    expect(first.timeSlot).toBe('night_shift');
  });

  it('skips Sundays and holidays when configured', () => {
    // 1 Nov 2026 is a Sunday
    const v = planVisits({ start: '2026-11-01', end: '2026-11-30', serviceVisitsPerMonth: 1, followUpVisitsPerMonth: 0, branches, skipSundays: true, holidays: ['2026-11-02'] });
    expect(v.map((x) => x.date)).toEqual(['2026-11-03']);
    expect(workingDay('2026-11-01', { skipSundays: false })).toBe('2026-11-01');
  });

  it('handles visits less often than monthly', () => {
    const v = planVisits({ start: '2026-01-01', end: '2026-12-31', serviceVisitsPerMonth: 1 / 3, followUpVisitsPerMonth: 0, branches });
    expect(v.map((x) => x.date)).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']);
    expect(visitsPerMonth({ frequency: 'fortnightly' })).toEqual({ service: 2, followUp: 0 });
  });
});

describe('slots and double booking', () => {
  it('picks the slot from the window or closing time', () => {
    expect(slotFor({ windowStart: '09:00' })).toBe('morning');
    expect(slotFor({ closingTime: '18:00' })).toBe('evening');
    expect(slotFor({ closingTime: '01:00' })).toBe('night_shift');
    expect(slotFor({})).toBe('morning');
  });

  it('flags a PCO booked twice in the same slot', () => {
    const bad = pcoConflicts(
      [
        { key: 'a', date: '2026-11-03', timeSlot: 'night_shift', pcoId: 'p1' },
        { key: 'b', date: '2026-11-03', timeSlot: 'night_shift', pcoId: 'p1' },
        { key: 'c', date: '2026-11-04', timeSlot: 'night_shift', pcoId: 'p1' },
        { key: 'd', date: '2026-11-05', timeSlot: 'morning', pcoId: 'p1' },
      ],
      [{ id: 'J1', scheduledDate: '2026-11-05', timeSlot: 'morning', assignedTechnicianIds: ['p1'] }]
    );
    expect([...bad].sort()).toEqual(['a', 'b', 'd']);
  });
});
