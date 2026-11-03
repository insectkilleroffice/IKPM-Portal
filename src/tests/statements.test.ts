// Client statements: a job invoice per visit, one statement per contract billing period,
// approved as a whole, and payments settling invoices oldest first.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract, ServiceJob } from '../types/operations';
import type { ClientStatement, Invoice, PaymentReceipt } from '../types/finance';

const db = { contracts: [] as Contract[], jobs: [] as ServiceJob[], invoices: [] as Invoice[], statements: [] as ClientStatement[], payments: [] as PaymentReceipt[], seq: 0 };
const upsert = <T extends { id: string }>(list: T[], item: T) => { const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list[i] = item; else list.push(item); return item; };
vi.mock('../services/dataService', () => ({
  dataService: {
    getContractById: (id: string) => db.contracts.find((c) => c.id === id),
    getContracts: () => db.contracts,
    getJobs: (customerId?: string) => db.jobs.filter((j) => !customerId || j.customerId === customerId),
    getJobById: (id: string) => db.jobs.find((j) => j.id === id),
    getAllInvoices: () => db.invoices,
    getInvoices: (customerId?: string) => db.invoices.filter((i) => i.isPosted && (!customerId || i.customerId === customerId)),
    getInvoiceById: (id: string) => db.invoices.find((i) => i.id === id),
    saveInvoice: (i: Invoice) => upsert(db.invoices, { ...i }),
    billedJobIds: () => new Set(db.invoices.filter((i) => i.status !== 'void_reversed').flatMap((i) => [...(i.jobIds ?? []), ...(i.jobId ? [i.jobId] : [])])),
    getStatements: () => db.statements,
    getStatementById: (id: string) => db.statements.find((s) => s.id === id),
    saveStatement: (s: ClientStatement) => upsert(db.statements, { ...s }),
    getPayments: () => db.payments,
    recordPayment: (p: PaymentReceipt) => {
      const inv = db.invoices.find((i) => i.id === p.invoiceId)!;
      inv.amountPaid += p.cashAmountReceived;
      inv.customerWhtTotal += p.customerWhtDeducted.amountDeducted;
      inv.balanceDue = Math.round((inv.grossPayable - inv.amountPaid - inv.customerWhtTotal) * 100) / 100;
      inv.status = inv.balanceDue <= 0 ? 'paid' : 'partially_paid';
      db.payments.push(p);
      return p;
    },
    newRecordId: async (prefix: string) => `${prefix}-${++db.seq}`,
    nextSequence: async () => ++db.seq,
    maxSeqOf: () => 0,
    getCompanyById: () => ({ legalCompanyName: 'Shan Foods', headOfficeAddress: 'Karachi', ntn: '123', province: 'Sindh' }),
    getBranchById: () => undefined,
    getClientById: () => undefined,
    getSites: () => [],
    getTaxRules: () => [],
    getProposals: () => [],
    getProposalById: () => undefined,
    getApprovals: () => [],
  },
}));
vi.mock('../lib/pdfGenerator', () => ({ pdfGenerator: {} }));
vi.mock('../features/documents/fileGenerated', () => ({ fileGenerated: vi.fn() }));
vi.mock('../services/outreachService', () => ({ sendOutreach: vi.fn(), isValidEmail: () => true }));

const { periodBillsUpTo, createBulkInvoices, createJobInvoices } = await import('../features/invoices/monthlyBilling');
const S = await import('../features/invoices/statements');

const actor = { uid: 'u_admin', email: 'admin@ikpm.pk', name: 'Admin', businessEmail: 'admin@ikpm.pk' };
const finance = { uid: 'u_fin', email: 'fin@ikpm.pk', name: 'Finance' };
const contract = (p: Partial<Contract> = {}): Contract => ({
  id: 'CT-1', contractType: 'amc_recurring', customerType: 'company', customerId: 'CO-1', customerName: 'Shan Foods',
  siteIds: [], startDate: '2026-11-01', endDate: '2027-10-31', frequency: 'weekly', totalContractValue: 0,
  billingTerm: 'monthly_billing', serviceScope: '', warrantyPeriodMonths: 0, totalJobsScheduled: 0, totalJobsCompleted: 0,
  status: 'active', renewalAlertDate: '', monthlyRate: 40000, taxMode: 'exclusive', taxPercent: 15, serviceVisitsPerMonth: 4,
  billingCycleDays: 15, createdAt: '', updatedAt: '', ...p,
} as Contract);
const job = (id: string, date: string): ServiceJob => ({
  id, contractId: 'CT-1', customerId: 'CO-1', customerType: 'company', customerName: 'Shan Foods', scheduledDate: date,
  status: 'completed', supervisorVerification: { isVerified: true }, serviceType: 'IPM', siteName: 'Main',
} as unknown as ServiceJob);

beforeEach(() => {
  Object.assign(db, { contracts: [contract()], invoices: [], statements: [], payments: [], seq: 0 });
  db.jobs = [job('J1', '2026-11-03'), job('J2', '2026-11-10'), job('J3', '2026-11-17')];
});

describe('client statements', () => {
  it('one statement per 15-day period, with a job invoice per visit', async () => {
    const bills = periodBillsUpTo('2026-12-01', false);
    expect(bills).toHaveLength(2);
    const st = await S.prepareStatement(bills[0], finance);
    expect(st.status).toBe('pending_approval');
    expect(st.invoiceIds).toHaveLength(2);
    expect(S.statementInvoices(st).every((i) => i.statementId === st.id && i.status === 'draft')).toBe(true);
    expect(st.periodTotal).toBe(23000); // 2 visits × 10,000 + 15% tax
  });

  it('approving the statement finalises its job invoices; payment settles them oldest first', async () => {
    const st = await S.prepareStatement(periodBillsUpTo('2026-12-01', false)[0], finance);
    const { statement } = await S.approveStatement(st, actor);
    expect(statement.statementNumber).toMatch(/^IKPM-BI-\d{4}-\d{4}$/);
    const invs = S.statementInvoices(statement);
    expect(invs.every((i) => i.isPosted && i.status === 'posted' && /^IKPM-TX-/.test(i.invoiceNumber))).toBe(true);

    // Part payment: first invoice paid in full, the second partly; WHT shared
    const receipts = await S.recordStatementPayment(statement, { cash: 14000, wht: 1000, mode: 'bank_transfer', reference: 'TRX1', date: '2026-11-20' }, actor);
    expect(receipts).toHaveLength(2);
    expect(S.statementInvoices(statement).map((i) => i.status)).toEqual(['paid', 'partially_paid']);
    expect(S.statementAmounts(statement).totalDue).toBe(8000);
    expect(receipts.reduce((s, r) => s + r.customerWhtDeducted.amountDeducted, 0)).toBe(1000);
    await expect(S.recordStatementPayment(statement, { cash: 9000, wht: 0, mode: 'cash', date: '2026-11-21' }, actor)).rejects.toThrow(/more than/);
  });

  it('the next statement carries the earlier unpaid balance', async () => {
    const [first, second] = periodBillsUpTo('2026-12-01', false);
    const { statement } = await S.approveStatement(await S.prepareStatement(first, finance), actor);
    const next = await S.prepareStatement(second, finance);
    expect(next.previousInvoiceIds).toEqual(statement.invoiceIds);
    expect(next.previousBalance).toBe(23000);
  });

  it('record payment by client: settles their unpaid invoices oldest first', async () => {
    const [first, second] = periodBillsUpTo('2026-12-01', false);
    await S.approveStatement(await S.prepareStatement(first, finance), actor);
    await S.approveStatement(await S.prepareStatement(second, finance), actor);
    expect(S.clientUnpaidInvoices('CO-1').reduce((s, i) => s + i.balanceDue, 0)).toBe(34500);
    const receipts = await S.recordClientPayment('CO-1', { cash: 23000, wht: 0, mode: 'cash', date: '2026-12-05' }, actor);
    expect(receipts).toHaveLength(2);
    expect(S.clientUnpaidInvoices('CO-1').map((i) => i.balanceDue)).toEqual([11500]);
    await expect(S.recordClientPayment('CO-1', { cash: 20000, wht: 0, mode: 'cash', date: '2026-12-05' }, actor)).rejects.toThrow(/more than/);
  });

  it('individually: one invoice per job, each sent for approval', async () => {
    const made = await createJobInvoices(db.jobs.slice(0, 2).map((job) => ({ job, amount: 10000 })), finance);
    expect(made).toHaveLength(2);
    expect(made.every((i) => i.status === 'pending_approval' && !i.statementId && i.jobIds?.length === 1)).toBe(true);
  });

  it('in bulk: one bulk invoice per client with each job invoice inside, approved as one', async () => {
    const made = await createBulkInvoices(db.jobs.map((job) => ({ job, amount: 10000 })), finance);
    expect(made).toHaveLength(1);
    expect(made[0].invoiceIds).toHaveLength(3);
    expect(made[0].periodStart).toBe('2026-11-03');
    expect(made[0].periodEnd).toBe('2026-11-17');
    expect(S.statementInvoices(made[0]).every((i) => i.statementId === made[0].id && i.status === 'draft')).toBe(true);
    const { statement } = await S.approveStatement(made[0], actor);
    expect(S.statementInvoices(statement).every((i) => i.isPosted)).toBe(true);
    await S.recordStatementPayment(statement, { cash: 34500, wht: 0, mode: 'cash', date: '2026-11-20' }, actor);
    expect(S.statementAmounts(statement).payState).toBe('paid');
  });

  it('a bulk invoice never merges two clients', async () => {
    const other = { ...job('J9', '2026-11-05'), customerId: 'CO-2', customerName: 'Other Ltd' } as ServiceJob;
    await expect(createBulkInvoices([{ job: db.jobs[0], amount: 10000 }, { job: other, amount: 5000 }], finance)).rejects.toThrow(/one client only/);
    expect(db.statements).toHaveLength(0);
    expect(db.invoices).toHaveLength(0);
  });

  it('cancelling before approval frees the visits to be billed again', async () => {
    const st = await S.prepareStatement(periodBillsUpTo('2026-12-01', false)[0], finance);
    expect(periodBillsUpTo('2026-12-01', false)).toHaveLength(1);
    S.cancelStatement(st, 'Wrong period', actor);
    expect(periodBillsUpTo('2026-12-01', false)).toHaveLength(2);
    await expect(S.approveStatement(db.statements[0], actor)).rejects.toThrow(/waiting for approval/);
  });
});
