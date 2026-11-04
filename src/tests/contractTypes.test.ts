// One-time job contracts are billed once for their full value; AMC values are never taxed twice.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract, ServiceJob } from '../types/operations';

const db = { contracts: [] as Contract[], jobs: [] as ServiceJob[] };
vi.mock('../services/dataService', () => ({
  dataService: {
    getContractById: (id: string) => db.contracts.find((c) => c.id === id),
    getContracts: () => db.contracts,
    getJobs: () => db.jobs,
    getAllInvoices: () => [], getInvoices: () => [], billedJobIds: () => new Set<string>(),
    getProposals: () => [], getProposalById: () => undefined, getApprovals: () => [], getStatements: () => [],
  },
}));
vi.mock('../services/companyProfile', () => ({ companyProfile: { get: () => ({}) } }));
vi.mock('../lib/pdfGenerator', () => ({ pdfGenerator: {} }));
vi.mock('../features/documents/fileGenerated', () => ({ fileGenerated: vi.fn() }));
vi.mock('../services/outreachService', () => ({ sendOutreach: vi.fn(), isValidEmail: () => true }));

const { monthlyCharge, contractValueBeforeTax, visitPrice, isPeriodBilledJob } = await import('../features/invoices/monthlyBilling');

const contract = (p: Partial<Contract>): Contract => ({
  id: 'CT-1', customerId: 'CL-1', customerType: 'individual', customerName: 'Ali', status: 'active',
  startDate: '2026-11-01', endDate: '2027-10-31', frequency: 'monthly', contractType: 'amc_recurring', taxPercent: 15, ...p,
} as Contract);
const job = (id: string, p: Partial<ServiceJob> = {}): ServiceJob => ({
  id, contractId: 'CT-1', customerId: 'CL-1', customerType: 'individual', scheduledDate: '2026-11-05',
  status: 'completed', supervisorVerification: { isVerified: true }, serviceType: 'Termite proofing', ...p,
} as unknown as ServiceJob);

beforeEach(() => { db.contracts = []; db.jobs = []; });

describe('contract types', () => {
  it('a one-time job contract is not monthly: billed once for its full value before tax', () => {
    const c = contract({ contractType: 'one_time', frequency: 'one_off', endDate: '2026-11-05', totalContractValue: 34500, valueBeforeTax: 30000 });
    db.contracts = [c];
    db.jobs = [job('J1')];
    expect(monthlyCharge(c)).toBeUndefined();
    expect(isPeriodBilledJob(db.jobs[0])).toBe(false);
    expect(visitPrice(db.jobs[0])).toMatchObject({ amount: 30000, fixed: true });
  });

  it('without a stored before-tax value, the tax is taken out of the total (never taxed twice)', () => {
    expect(contractValueBeforeTax({ totalContractValue: 115000, taxPercent: 15 })).toBe(100000);
    const amc = contract({ totalContractValue: 138000, taxPercent: 15, tenureMonths: 12 });
    expect(monthlyCharge(amc)).toMatchObject({ base: 10000, total: 11500 });
  });
});
