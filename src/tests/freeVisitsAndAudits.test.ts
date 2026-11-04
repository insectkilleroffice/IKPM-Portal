// Free re-service / warranty visits are never invoiced; standard price list; random audit pick.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract, ServiceJob } from '../types/operations';

const db = { contracts: [] as Contract[], jobs: [] as ServiceJob[], audits: [] as { contractId?: string; scheduledDate: string; status: string }[], complaints: [] as { contractId?: string; customerId: string; status: string }[] };
vi.mock('../services/dataService', () => ({
  dataService: {
    getContractById: (id: string) => db.contracts.find((c) => c.id === id),
    getContracts: () => db.contracts,
    getJobs: (customerId?: string) => db.jobs.filter((j) => !customerId || j.customerId === customerId),
    getAllInvoices: () => [], getInvoices: () => [], billedJobIds: () => new Set<string>(),
    getProposals: () => [], getProposalById: () => undefined, getApprovals: () => [], getStatements: () => [],
    getAudits: () => db.audits, getComplaints: () => db.complaints,
  },
}));
vi.mock('../services/companyProfile', () => ({
  companyProfile: { get: () => ({ auditIntervalDays: 30, priceList: [{ service: 'termite treatment', price: 25000 }, { service: 'termite', price: 1 }] }) },
}));
vi.mock('../lib/pdfGenerator', () => ({ pdfGenerator: {} }));
vi.mock('../features/documents/fileGenerated', () => ({ fileGenerated: vi.fn() }));
vi.mock('../services/outreachService', () => ({ sendOutreach: vi.fn(), isValidEmail: () => true }));

const { billableVisits, visitPrice } = await import('../features/invoices/monthlyBilling');
const { auditCandidates, randomAuditPick } = await import('../features/audits/audits');

const job = (p: Partial<ServiceJob>): ServiceJob => ({
  id: 'J', customerId: 'CL-1', customerType: 'individual', customerName: 'Ali', scheduledDate: '2026-11-01',
  status: 'completed', supervisorVerification: { isVerified: true }, serviceType: 'Cockroach treatment', ...p,
} as unknown as ServiceJob);
const contract = (id: string, p: Partial<Contract> = {}): Contract => ({
  id, customerId: `CO-${id}`, customerName: id, customerType: 'company', status: 'active', startDate: '2026-01-01', endDate: '2027-12-31', ...p,
} as Contract);

beforeEach(() => { db.contracts = []; db.jobs = []; db.audits = []; db.complaints = []; });

describe('free visits', () => {
  it('complaint re-service and warranty visits are never in Completed jobs', () => {
    db.jobs = [job({ id: 'J1' }), job({ id: 'J2', complaintId: 'CMP-1' }), job({ id: 'J3', freeOfCharge: true, freeOfChargeReason: 'Warranty call-back' })];
    expect(billableVisits().map((j) => j.id)).toEqual(['J1']);
    expect(visitPrice(db.jobs[2])).toMatchObject({ amount: 0, fixed: true });
  });

  it('one-off jobs use the standard price list (longest matching name)', () => {
    expect(visitPrice(job({ serviceType: 'Termite treatment – villa' }))).toMatchObject({ amount: 25000, fixed: false });
  });
});

describe('random audits', () => {
  it('picks among sites due: never audited, overdue, or with open complaints', () => {
    db.contracts = [contract('A'), contract('B'), contract('C')];
    const today = new Date().toISOString().slice(0, 10);
    db.audits = [{ contractId: 'B', scheduledDate: today, status: 'verified' }, { contractId: 'C', scheduledDate: today, status: 'verified' }];
    db.complaints = [{ contractId: 'C', customerId: 'CO-C', status: 'open' }];
    const due = auditCandidates().map((c) => c.contract.id);
    expect(due).toEqual(['A', 'C']); // B was audited today and has no complaint
    expect(['A', 'C']).toContain(randomAuditPick(() => 0.99)!.contract.id);
  });
});
