import { describe, expect, it } from 'vitest';
import { DEFAULT_COVER_LETTER, defaultTenureStart, frequencyForVisits, planFromPreset, planPricing, SERVICE_PLAN_PRESETS, tenureEnd } from '../lib/proposalPlan';

describe('tenure dates', () => {
  it('ends the day before the same date N months later', () => {
    expect(tenureEnd('2026-01-01', 12)).toBe('2026-12-31');
    expect(tenureEnd('2026-11-01', 12)).toBe('2027-10-31');
    expect(tenureEnd('2026-03-15', 6)).toBe('2026-09-14');
    expect(tenureEnd('2026-01-01', 1)).toBe('2026-01-31');
  });

  it('handles month ends and leap years', () => {
    expect(tenureEnd('2026-01-31', 1)).toBe('2026-02-27');
    expect(tenureEnd('2027-03-01', 12)).toBe('2028-02-29');
  });

  it('defaults the start to the first of next month', () => {
    expect(defaultTenureStart(new Date(2026, 9, 21))).toBe('2026-11-01');
    expect(defaultTenureStart(new Date(2026, 11, 5))).toBe('2027-01-01');
  });
});

describe('planPricing', () => {
  it('adds tax on top when exclusive', () => {
    const p = planPricing({ monthlyRate: 100000, taxMode: 'exclusive', taxPercent: 15, tenureMonths: 12 });
    expect(p).toMatchObject({ monthlyBase: 100000, monthlyTax: 15000, monthlyTotal: 115000, subtotal: 1200000, taxAmount: 180000, totalAmount: 1380000 });
  });

  it('takes tax out of the rate when inclusive', () => {
    const p = planPricing({ monthlyRate: 115000, taxMode: 'inclusive', taxPercent: 15, tenureMonths: 12 });
    expect(p.monthlyBase).toBe(100000);
    expect(p.monthlyTotal).toBe(115000);
    expect(p.totalAmount).toBe(1380000);
  });

  it('applies a discount before tax', () => {
    const p = planPricing({ monthlyRate: 50000, taxMode: 'exclusive', taxPercent: 10, tenureMonths: 2, discountPercent: 10 });
    expect(p).toMatchObject({ subtotal: 100000, discountAmount: 10000, taxAmount: 9000, totalAmount: 99000 });
  });

  it('handles zero tax and bad input', () => {
    expect(planPricing({ monthlyRate: 1000, taxMode: 'exclusive', taxPercent: 0, tenureMonths: 0 }).totalAmount).toBe(1000);
    expect(planPricing({ monthlyRate: -5, taxMode: 'inclusive', taxPercent: 15, tenureMonths: 3 }).totalAmount).toBe(0);
  });
});

describe('presets', () => {
  it('give editable rows with unique ids', () => {
    const rows = planFromPreset('commercial_kitchen');
    expect(rows.length).toBe(SERVICE_PLAN_PRESETS.commercial_kitchen.items.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows[0]).toMatchObject({ frequency: 'Once per week' });
    expect(rows.find((r) => r.service === 'Risk assessment')?.frequency).toBe('Quarterly');
  });

  it('map visits per month to a contract frequency', () => {
    expect(frequencyForVisits(4)).toBe('weekly');
    expect(frequencyForVisits(2)).toBe('fortnightly');
    expect(frequencyForVisits(1)).toBe('monthly');
    expect(frequencyForVisits(undefined)).toBe('monthly');
  });
});

describe('DEFAULT_COVER_LETTER', () => {
  it('does not contain price or tenure date placeholders', () => {
    expect(DEFAULT_COVER_LETTER).not.toContain('{{monthlyRate}}');
    expect(DEFAULT_COVER_LETTER).not.toContain('{{tenureMonths}}');
    expect(DEFAULT_COVER_LETTER).not.toContain('{{tenureStart}}');
  });
});
