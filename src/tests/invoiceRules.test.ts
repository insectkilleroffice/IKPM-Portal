// Invoice rules: a visit is billed at its share of the monthly charge, only done visits can be
// invoiced, and cancelled contracts are settled by the super admin only.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract, ServiceJob } from '../types/operations';
import type { Invoice } from '../types/finance';

const db = { contracts: [] as Contract[], jobs: [] as ServiceJob[], invoices: [] as Invoice[] };
vi.mock('../services/dataService', () => ({
  dataService: {
    getContractById: (id: string) => db.contracts.find((c) => c.id === id),
    getContracts: () => db.contracts,
    getJobs: (customerId?: string) => db.jobs.filter((j) => !customerId || j.customerId === customerId),
    getAllInvoices: () => db.invoices,
    getInvoices: () => db.invoices.filter((i) => i.isPosted),
    billedJobIds: () => new Set(db.invoices.filter((i) => i.status !== 'void_reversed').flatMap((i) => i.jobIds ?? [])),
    getProposals: () => [],
    getProposalById: () => undefined,
    getApprovals: () => [],
  },
}));
vi.mock('../lib/pdfGenerator', () => ({ pdfGenerator: {} }));
vi.mock('../features/documents/fileGenerated', () => ({ fileGenerated: vi.fn() }));
vi.mock('../services/outreachService', () => ({ sendOutreach: vi.fn(), isValidEmail: () => true }));

const { visitPrice, billableVisits, settlementBill, createSettlementInvoice, createMonthlyInvoice, monthlyBillFor, periodBillsUpTo } = await import('../features/invoices/monthlyBilling');

const contract = (p: Partial<Contract> = {}): Contract => ({
  id: 'CT-1', contractType: 'amc_recurring', customerType: 'company', customerId: 'CO-1', customerName: 'Shan Foods',
  siteIds: [], startDate: '2026-01-01', endDate: '2026-12-31', frequency: 'weekly', totalContractValue: 0,
  billingTerm: 'monthly_billing', serviceScope: '', warrantyPeriodMonths: 0, totalJobsScheduled: 0, totalJobsCompleted: 0,
  status: 'active', renewalAlertDate: '', monthlyRate: 40000, taxMode: 'exclusive', taxPercent: 15, serviceVisitsPerMonth: 4,
  createdAt: '', updatedAt: '2026-11-12T00:00:00Z', ...p,
} as Contract);
const job = (id: string, date: string, done = true): ServiceJob => ({
  id, contractId: 'CT-1', customerId: 'CO-1', customerType: 'company', customerName: 'Shan Foods', scheduledDate: date,
  status: done ? 'completed' : 'scheduled', supervisorVerification: done ? { isVerified: true } : undefined, serviceType: 'IPM', siteName: 'Main',
} as unknown as ServiceJob);
const user = { uid: 'u1', email: 'fin@ikpm.pk', name: 'Finance' };

beforeEach(() => {
  db.contracts = [contract()];
  db.jobs = [job('J1', '2026-11-03'), job('J2', '2026-11-10'), job('J3', '2026-11-17', false), job('J4', '2026-11-24', false)];
  db.invoices = [];
});

describe('a separate visit invoice charges only that visit\'s cost', () => {
  it('contract visit = monthly charge ÷ visits, not the whole monthly rate', () => {
    expect(visitPrice(db.jobs[0]).amount).toBe(10000);
    expect(visitPrice(db.jobs[0]).fixed).toBe(true);
  });

  it('completed jobs list: done, quality-checked and not invoiced yet (contract visits included)', () => {
    expect(billableVisits('CO-1').map((j) => j.id)).toEqual(['J1', 'J2']);
    db.invoices = [{ id: 'INV-1', status: 'posted', isPosted: true, jobIds: ['J1'], lineItems: [] } as unknown as Invoice];
    expect(billableVisits('CO-1').map((j) => j.id)).toEqual(['J2']);
  });

  it('a 15-day cycle: one invoice per period with every visit done in it', () => {
    db.contracts = [contract({ startDate: '2026-11-01', billingCycleDays: 15 })];
    db.jobs = [job('J1', '2026-11-03'), job('J2', '2026-11-10'), job('J3', '2026-11-17'), job('J4', '2026-11-24', false)];
    const bills = periodBillsUpTo('2026-12-01', false);
    expect(bills.map((b) => [b.period.start, b.period.end, b.lines.map((l) => l.jobId)])).toEqual([
      ['2026-11-01', '2026-11-15', ['J1', 'J2']],
      ['2026-11-16', '2026-11-30', ['J3']],
    ]);
    expect(bills[0].total).toBe(20000);
    expect(bills[1].waiting).toBe(1);
  });

  it('running periods are left out unless asked for', () => {
    db.contracts = [contract({ startDate: '2026-11-01', billingCycleDays: 30 })];
    expect(periodBillsUpTo('2026-11-20', false)).toHaveLength(0);
    expect(periodBillsUpTo('2026-11-20', true)[0].lines.map((l) => l.jobId)).toEqual(['J1', 'J2']);
  });

  it('monthly billing follows the visits done and what is already invoiced', () => {
    db.invoices = [{ id: 'INV-1', status: 'posted', isPosted: true, jobIds: ['J1'], subtotal: 10000, lineItems: [] } as unknown as Invoice];
    const bill = monthlyBillFor(db.contracts[0], '2026-11', 'visits_done');
    expect(bill.lines.map((l) => l.jobId)).toEqual(['J2']);
    expect(bill.total).toBe(10000);
  });
});

describe('cancelled contracts', () => {
  const cancelled = () => contract({ status: 'cancelled', cancellation: { category: 'client_request', reason: 'Outlet closed', effectiveDate: '2026-11-12', requestedBy: '', requestedByName: '', requestedAt: '', cancelledAt: '' } });
  beforeEach(() => {
    db.contracts = [cancelled()];
    db.jobs = [job('J1', '2026-11-03'), job('J2', '2026-11-10')];
  });

  it('their visits are not offered for normal invoicing, and monthly invoicing refuses them', async () => {
    expect(billableVisits('CO-1')).toHaveLength(0);
    await expect(createMonthlyInvoice(monthlyBillFor(db.contracts[0], '2026-11', 'visits_done'), user)).rejects.toThrow(/super admin/);
  });

  it('settlement offers done services only, or the full month', () => {
    expect(settlementBill(db.contracts[0], 'visits_done').total).toBe(20000);
    expect(settlementBill(db.contracts[0], 'full_month').total).toBe(40000);
  });

  it('only the super admin creates the final invoice', async () => {
    await expect(createSettlementInvoice(db.contracts[0], 'full_month', user, false)).rejects.toThrow(/Only the super admin/);
  });
});
