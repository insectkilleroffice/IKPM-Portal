// Monthly contract billing: monthly charge ÷ the month's visits, billed once, never above the month.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/dataService', () => ({ dataService: {} }));
vi.mock('../lib/pdfGenerator', () => ({ pdfGenerator: {} }));
vi.mock('../features/documents/fileGenerated', () => ({ fileGenerated: vi.fn() }));
vi.mock('../services/outreachService', () => ({ sendOutreach: vi.fn(), isValidEmail: () => true }));

const { computeMonthlyBill, monthlyCharge } = await import('../features/invoices/monthlyBilling');
import type { Contract, ServiceJob } from '../types/operations';

const contract = (p: Partial<Contract> = {}): Contract => ({
  id: 'CT-1', contractType: 'amc_recurring', customerType: 'company', customerId: 'CO-1', customerName: 'Shan Foods',
  siteIds: [], startDate: '2026-01-01', endDate: '2026-12-31', frequency: 'weekly', totalContractValue: 0,
  billingTerm: 'monthly_billing', serviceScope: '', warrantyPeriodMonths: 0, totalJobsScheduled: 0, totalJobsCompleted: 0,
  status: 'active', renewalAlertDate: '', monthlyRate: 40000, taxMode: 'exclusive', taxPercent: 15, serviceVisitsPerMonth: 4,
  createdAt: '', updatedAt: '', ...p,
} as Contract);

let n = 0;
const job = (date: string, done = true, p: Partial<ServiceJob> = {}): ServiceJob => ({
  id: `J${++n}`, contractId: 'CT-1', scheduledDate: date, status: done ? 'completed' : 'scheduled',
  supervisorVerification: done ? { isVerified: true } : undefined, serviceType: 'IPM service', siteName: 'Main', ...p,
} as unknown as ServiceJob);

const bill = (c: Contract, jobs: ServiceJob[], basis: 'visits_done' | 'full_month' = 'visits_done', billed = new Set<string>(), billedAmount = 0) =>
  computeMonthlyBill({ contract: c, jobs, month: '2026-11', basis, account: 'tax', billed, billedAmount });

describe('monthly contract billing', () => {
  it('divides the monthly charge over the month\'s visits', () => {
    const jobs = [job('2026-11-03'), job('2026-11-10'), job('2026-11-17'), job('2026-11-24')];
    const b = bill(contract(), jobs);
    expect(b.perVisit).toBe(10000);
    expect(b.lines).toHaveLength(4);
    expect(b.total).toBe(40000);
  });

  it('a 5-visit month splits the same monthly charge five ways', () => {
    const jobs = ['03', '10', '17', '24', '30'].map((d) => job(`2026-11-${d}`));
    const b = bill(contract(), jobs);
    expect(b.perVisit).toBe(8000);
    expect(b.total).toBe(40000);
  });

  it('visits done: bills only completed and verified visits', () => {
    const jobs = [job('2026-11-03'), job('2026-11-10'), job('2026-11-17', false), job('2026-11-24', false)];
    const b = bill(contract(), jobs);
    expect(b.total).toBe(20000);
    expect(b.notes.join(' ')).toMatch(/2 visit\(s\) not done/);
  });

  it('full month: bills the whole charge, with a balance line for visits that did not happen', () => {
    const c = contract({ status: 'cancelled', cancellation: { category: 'client_request', reason: 'Closing', effectiveDate: '2026-11-12', requestedBy: '', requestedByName: '', requestedAt: '', cancelledAt: '' } });
    const jobs = [job('2026-11-03'), job('2026-11-10')];
    const b = bill(c, jobs, 'full_month');
    expect(b.total).toBe(40000);
    expect(b.lines.at(-1)?.description).toMatch(/Balance .* contract cancelled/);
    expect(b.periodEnd).toBe('2026-11-12');
  });

  it('never bills a visit twice or the month above its charge', () => {
    const jobs = [job('2026-11-03'), job('2026-11-10'), job('2026-11-17'), job('2026-11-24')];
    const first = bill(contract(), jobs.slice(0, 2));
    expect(first.total).toBe(20000);
    const billed = new Set(first.lines.map((l) => l.jobId!));
    const second = bill(contract(), jobs, 'full_month', billed, 20000);
    expect(second.lines.map((l) => l.jobId)).toEqual([jobs[2].id, jobs[3].id]);
    expect(second.total).toBe(20000);
    expect(bill(contract(), jobs, 'full_month', new Set(jobs.map((j) => j.id)), 40000).total).toBe(0);
  });

  it('ignores cancelled visits and follow-ups, and uses the tax-exclusive monthly amount', () => {
    const jobs = [job('2026-11-03'), job('2026-11-05', true, { visitKind: 'follow_up' }), job('2026-11-10', false, { status: 'cancelled' })];
    expect(bill(contract(), jobs).lines).toHaveLength(1);
    expect(monthlyCharge(contract({ monthlyRate: 46000, taxMode: 'inclusive', taxPercent: 15 }))?.base).toBe(40000);
  });
});
