// "Add old client" form: automatic visit schedule, checks, and saving old visits / invoices / payments.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = { companies: [] as any[], clients: [] as any[], branches: [] as any[], sites: [] as any[], contracts: [] as any[], jobs: [] as any[], invoices: [] as any[], challans: [] as any[], seq: 0 };
const upsert = (list: any[], x: any) => { const i = list.findIndex((y) => y.id === x.id); if (i >= 0) list[i] = x; else list.push(x); return x; };
vi.mock('../services/dataService', () => ({
  dataService: {
    getCompanies: () => db.companies, getClients: () => db.clients, getBranches: () => db.branches, getSites: () => db.sites,
    getContracts: () => db.contracts, getContractById: (id: string) => db.contracts.find((c) => c.id === id),
    getJobs: () => db.jobs, getJobById: (id: string) => db.jobs.find((j) => j.id === id), getAllInvoices: () => db.invoices,
    getStaff: () => [{ uid: 'u_sup', email: 'sup@ikpm.pk', displayName: 'Bilal', role: 'team_leader', isActive: true }],
    getTeamLeaders: () => [{ uid: 'u_sup', email: 'sup@ikpm.pk', displayName: 'Bilal', role: 'team_leader', isActive: true }],
    challanNumberUsedBy: (n: string) => (n === 'CH-OLD' ? 'JOB-X' : undefined),
    newRecordId: async (prefix: string) => `${prefix}-${++db.seq}`, nextSequence: async () => ++db.seq, maxSeqOf: () => 0,
    saveCompany: (x: any) => upsert(db.companies, x), saveClient: (x: any) => upsert(db.clients, x), saveBranch: (x: any) => upsert(db.branches, x),
    saveSite: (x: any) => upsert(db.sites, x), saveContract: (x: any) => upsert(db.contracts, x), saveJob: (x: any) => upsert(db.jobs, x),
    saveInvoice: (x: any) => upsert(db.invoices, x), saveChallan: (x: any) => upsert(db.challans, x), logAudit: vi.fn(),
  },
}));

const F = await import('../features/customers/oldClient');
const user = { uid: 'u_ceo', email: 'ceo@ikpm.pk', name: 'CEO' };
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

beforeEach(() => { Object.assign(db, { companies: [], clients: [], branches: [], sites: [], contracts: [], jobs: [], invoices: [], challans: [], seq: 0 }); });

const companyDraft = () => {
  let d = F.blankDraft('company');
  d = { ...d, name: 'Shan Foods', phone: '03001234567', address: 'Korangi', city: 'Karachi' };
  d.sites[0] = { ...d.sites[0], name: 'Plant', propertyType: 'factory' };
  d.contracts[0] = { ...d.contracts[0], start: day(-90), end: day(90), monthlyRate: '40000', taxPercent: '15', visitsPerMonth: '2', supervisorUid: 'u_sup', services: 'Cockroach control' };
  return F.withSchedule(d, d.contracts[0].key);
};

describe('old client: schedule', () => {
  it('schedules visits from start to end; past = done, future = upcoming', () => {
    const d = companyDraft();
    const t = F.today();
    expect(d.visits.length).toBeGreaterThanOrEqual(10);
    expect(d.visits.every((v) => v.date >= d.contracts[0].start && v.date <= d.contracts[0].end)).toBe(true);
    expect(d.visits.filter((v) => v.date <= t).every((v) => v.done)).toBe(true);
    expect(d.visits.every((v) => v.supervisorUid === 'u_sup')).toBe(true);
  });

  it('a cancelled contract is scheduled only up to its cancel date; one-time = its visits', () => {
    const d = companyDraft();
    const k = { ...d.contracts[0], status: 'cancelled' as const, cancelledOn: day(-30), cancelReason: 'Moved to a competitor' };
    expect(F.scheduleDates(k).every((x) => x <= day(-30))).toBe(true);
    const oneTime = { ...k, status: 'running' as const, type: 'one_time' as const, start: day(-5), end: day(-5), visitsPerMonth: '1' };
    expect(F.scheduleDates(oneTime)).toHaveLength(new Date(`${day(-5)}T00:00:00Z`).getUTCDay() === 0 ? 0 : 1);
  });

  it('checks: missing details, phone already in the portal, invoice paid more than total', () => {
    expect(F.checkDraft(F.blankDraft('residential')).client).toContain('Client name is missing');
    db.clients = [{ id: 'CL-1', fullName: 'Old Ahmed', primaryPhone: '+923001234567' }];
    expect(F.checkDraft(companyDraft()).client.join()).toContain('already in the portal');
    db.clients = [];
    let d = companyDraft();
    const past = d.visits.filter((v) => v.date <= F.today());
    d = { ...d, visits: d.visits.map((v) => (v.key === past[0].key ? { ...v, invoiceNo: 'SF-1' } : v)) };
    d = { ...d, invoices: F.syncInvoices(d) };
    d.invoices['sf-1'] = { ...d.invoices['sf-1'], pay: 'part', paid: '999999', touched: true };
    expect(F.checkDraft(d).invoices.join()).toContain('paid must be between');
  });
});

describe('old client: saving', () => {
  it('creates the client, done + not done visits, old invoices with payments, upcoming visits', async () => {
    let d = companyDraft();
    const t = F.today();
    const past = d.visits.filter((v) => v.date <= t);
    const future = d.visits.filter((v) => v.date > t);
    // first two past visits on invoice SF-1 (part paid), third not done, the rest done without invoice
    d = { ...d, visits: d.visits.map((v) =>
      v.key === past[0].key || v.key === past[1].key ? { ...v, invoiceNo: 'SF-1' } : v.key === past[2].key ? { ...v, done: false } : v) };
    d = { ...d, invoices: F.syncInvoices(d) };
    expect(F.num(d.invoices['sf-1'].total)).toBeGreaterThan(0);
    d.invoices['sf-1'] = { ...d.invoices['sf-1'], total: '46000', tax: '6000', pay: 'part', paid: '20000', paidOn: past[1].date, touched: true };
    expect(Object.values(F.checkDraft(d)).flat()).toEqual([]);

    const { customerId, summary } = await F.saveOldClient(d, user);
    expect(db.companies[0]).toMatchObject({ id: customerId, legalCompanyName: 'Shan Foods' });
    expect(db.branches).toHaveLength(1);
    expect(db.contracts[0]).toMatchObject({ status: 'active', monthlyRate: 40000, billingCycleDays: 0 });
    expect(db.jobs).toHaveLength(past.length - 1 + future.length); // the not-done visit is not created
    expect(db.jobs.filter((j) => j.status === 'completed')).toHaveLength(past.length - 1);
    expect(db.jobs.every((j) => !j.oldDataPending)).toBe(true);
    expect(db.jobs.filter((j) => j.status === 'scheduled').every((j) => j.assignedTeamLeaderId === 'u_sup')).toBe(true);
    const inv = db.invoices.find((i) => i.invoiceNumber === 'SF-1');
    expect(inv).toMatchObject({ status: 'partially_paid', amountPaid: 20000, balanceDue: 26000, isApproved: true });
    expect(inv.jobIds).toHaveLength(2);
    expect(summary).toMatchObject({ invoices: 1, toInvoice: past.length - 3, notDone: 1 });
  });

  it('cancelled contract is saved cancelled with its reason', async () => {
    let d = companyDraft();
    d.contracts[0] = { ...d.contracts[0], status: 'cancelled', cancelledOn: day(-20), cancelReason: 'Shop closed' };
    d = F.withSchedule(d, d.contracts[0].key);
    await F.saveOldClient(d, user);
    expect(db.contracts[0]).toMatchObject({ status: 'cancelled', cancellation: { category: 'business_closed', effectiveDate: day(-20) } });
    expect(db.jobs.every((j) => j.scheduledDate <= day(-20))).toBe(true);
  });

  it('residential client: one-time job, home site, no tax', async () => {
    let d = F.blankDraft('residential');
    d = { ...d, name: 'Ahmed Raza', phone: '03331234567', address: 'House 12, DHA', city: 'Lahore', province: 'Punjab' };
    d.contracts[0] = { ...d.contracts[0], type: 'one_time', start: day(-12), end: day(-8), value: '35000', services: 'Termite treatment' };
    d = F.withSchedule(d, d.contracts[0].key);
    expect(d.visits).toHaveLength(1);
    d = { ...d, visits: d.visits.map((v) => ({ ...v, invoiceNo: 'CM-1' })) };
    d = { ...d, invoices: F.syncInvoices(d) };
    expect(d.invoices['cm-1']).toMatchObject({ total: '35000', tax: '0' });
    await F.saveOldClient(d, user);
    expect(db.clients[0]).toMatchObject({ fullName: 'Ahmed Raza', type: 'individual' });
    expect(db.sites[0]).toMatchObject({ siteName: 'Home', propertyType: 'residential_house' });
    expect(db.invoices[0]).toMatchObject({ invoiceNumber: 'CM-1', status: 'paid', balanceDue: 0 });
  });
});
