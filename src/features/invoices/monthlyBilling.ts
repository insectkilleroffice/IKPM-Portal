// Monthly contract billing: the contract's monthly charge is divided over that month's service
// visits (cost per visit = monthly charge ÷ visits), and one invoice bills a contract for a month.
//
// Running contracts are billed on visits done. A cancelled contract is settled by the super admin
// (done services only, or the full month), after Finance reports on it. Two ways to bill a month:
//  - 'visits_done': only visits that are completed and passed the quality check, each at its share.
//  - 'full_month':  the whole monthly charge: every visit of the month at its share, plus a
//                   "balance" line for visits that did not take place (e.g. a contract cancelled
//                   mid-month that is still owed for the full month).
// Visits already on another invoice are never billed again, and a month is never billed above its
// monthly charge. Generated invoices are drafts that go to an admin for approval.

import { dataService } from '../../services/dataService';
import { planPricing } from '../../lib/proposalPlan';
import { provinceToJurisdiction } from '../../lib/workflow';
import { taxRateFor } from '../../lib/taxRates';
import { formatDate, formatPKR } from '../../lib/formatters';
import { CONTRACT_CANCEL_CATEGORY_LABELS, type Contract, type ServiceJob } from '../../types/operations';
import { jobIdsOf, type BillingAccount, type ClientStatement, type Invoice, type InvoiceLineItem, type TaxJurisdiction } from '../../types/finance';
import { draftNumber, recalcInvoice } from './invoiceWorkflow';
import { billingCycleLabel, billingPeriods, type BillingPeriod } from '../../lib/billingCycle';

export type BillingBasis = 'visits_done' | 'full_month';

const round2 = (n: number) => Math.round(n * 100) / 100;
const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

/** Visit is done for billing: completed and passed the quality check. */
export const isBillableVisit = (j: Pick<ServiceJob, 'status' | 'supervisorVerification'>) =>
  j.status === 'completed' && Boolean(j.supervisorVerification?.isVerified);

/** Monthly charge before tax, and after tax, from the contract. Undefined when the contract has no price. */
export function monthlyCharge(c: Contract): { base: number; total: number; taxPercent: number } | undefined {
  const taxPercent = c.taxPercent ?? 0;
  if (c.monthlyRate && c.monthlyRate > 0) {
    const p = planPricing({ monthlyRate: c.monthlyRate, taxMode: c.taxMode ?? 'exclusive', taxPercent, tenureMonths: 1 });
    return { base: p.monthlyBase, total: p.monthlyTotal, taxPercent };
  }
  if (c.totalContractValue > 0) {
    const months = c.tenureMonths || Math.max(1, Math.round((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / (30.44 * 86400000)));
    const base = round2(c.totalContractValue / months);
    return { base, total: round2(base * (1 + taxPercent / 100)), taxPercent };
  }
  return undefined;
}

export interface MonthlyLine {
  jobId?: string;
  description: string;
  amount: number;
  done: boolean;
}

export interface MonthlyBill {
  contract: Contract;
  month: string;
  periodStart: string;
  periodEnd: string;
  /** Monthly charge on the account billed (before tax for the tax account; agreed total for cash). */
  monthlyAmount: number;
  visitsInMonth: number;
  visitsDone: number;
  /** Visits the monthly charge is divided by: the visits in the month, or the contract's planned visits if more. */
  divisor: number;
  /** Monthly charge ÷ divisor. */
  perVisit: number;
  alreadyBilled: number;
  lines: MonthlyLine[];
  total: number;
  /** Why nothing (or not everything) can be billed. */
  notes: string[];
}

/**
 * What to bill a contract for a month. Pure apart from its inputs, so it is easy to test.
 * `billed` = job ids already on a live invoice; `billedAmount` = amount already invoiced for this month.
 */
export function computeMonthlyBill(input: {
  contract: Contract;
  jobs: ServiceJob[];
  month: string; // YYYY-MM
  basis: BillingBasis;
  account: BillingAccount;
  billed: Set<string>;
  billedAmount: number;
}): MonthlyBill {
  const { contract: c, month, basis, account, billed, billedAmount } = input;
  const end = [lastDay(month), c.endDate, c.status === 'cancelled' ? c.cancellation?.effectiveDate : undefined]
    .filter(Boolean).sort()[0] as string;
  const start = [`${month}-01`, c.startDate].sort()[1];
  const notes: string[] = [];
  const charge = monthlyCharge(c);
  const empty = { contract: c, month, periodStart: start, periodEnd: end, monthlyAmount: 0, visitsInMonth: 0, visitsDone: 0, divisor: 0, perVisit: 0, alreadyBilled: billedAmount, lines: [], total: 0, notes };
  if (!charge) return { ...empty, notes: ['The contract has no monthly rate or contract value.'] };
  if (start > end) return { ...empty, notes: ['The contract was not running in this month.'] };

  const monthlyAmount = account === 'cash' ? charge.total : charge.base;
  // Service visits of the month (follow-up visits are part of the service and not charged separately)
  const visits = input.jobs
    .filter((j) => j.contractId === c.id && j.scheduledDate >= `${month}-01` && j.scheduledDate <= lastDay(month)
      && j.status !== 'cancelled' && j.visitKind !== 'follow_up')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const planned = Math.round(c.serviceVisitsPerMonth || 0);
  const divisor = Math.max(1, planned, visits.length);
  const perVisit = round2(monthlyAmount / divisor);
  const remaining = round2(Math.max(0, monthlyAmount - billedAmount));

  const open = visits.filter((j) => !billed.has(j.id));
  const toBill = basis === 'visits_done' ? open.filter(isBillableVisit) : open;
  const waiting = open.filter((j) => !isBillableVisit(j));
  if (basis === 'visits_done' && waiting.length) {
    notes.push(`${waiting.length} visit(s) not done or not yet quality-checked: billed once verified.`);
  }

  const lines: MonthlyLine[] = [];
  let left = remaining;
  toBill.forEach((j) => {
    const amount = round2(Math.min(perVisit, left));
    if (amount <= 0) return;
    left = round2(left - amount);
    const done = isBillableVisit(j);
    lines.push({
      jobId: j.id,
      description: `${j.visitServices?.length ? j.visitServices.join(', ') : j.serviceType} — visit ${formatDate(j.scheduledDate)}${j.siteName ? ` at ${j.siteName}` : ''}${done ? '' : ` (${String(j.status ?? '').replace(/_/g, ' ')})`} · Job ${j.id}`,
      amount,
      done,
    });
  });
  // Full month: the rest of the monthly charge (visits that did not happen, rounding)
  if (basis === 'full_month' && left > 0) {
    const missing = Math.max(0, divisor - visits.length);
    lines.push({
      description: c.status === 'cancelled'
        ? `Balance of monthly service charge (${formatDate(start)} – ${formatDate(lastDay(month))}) — contract cancelled`
        : `Balance of monthly service charge${missing ? ` (${missing} planned visit(s) not scheduled)` : ''}`,
      amount: left,
      done: false,
    });
    left = 0;
  }
  if (billedAmount >= monthlyAmount) notes.push('This month is already fully invoiced.');
  else if (!lines.length && basis === 'visits_done' && !waiting.length) notes.push('No visits to bill in this month.');

  return {
    contract: c,
    month,
    periodStart: start,
    periodEnd: end,
    monthlyAmount,
    visitsInMonth: visits.length,
    visitsDone: visits.filter(isBillableVisit).length,
    divisor,
    perVisit,
    alreadyBilled: billedAmount,
    lines,
    total: round2(lines.reduce((s, l) => s + l.amount, 0)),
    notes,
  };
}

/** Companies bill from the tax account, individuals from the cash account (as single invoices do). */
export const accountFor = (c: Pick<Contract, 'customerType'>): BillingAccount => (c.customerType === 'company' ? 'tax' : 'cash');

/** Amount (before tax) already invoiced for this contract's month: monthly invoices plus single-visit invoices. */
export function billedAmountFor(contract: Contract, month: string): number {
  const monthJobs = new Set(dataService.getJobs().filter((j) => j.contractId === contract.id && j.scheduledDate.startsWith(month)).map((j) => j.id));
  return round2(
    dataService.getAllInvoices()
      .filter((i) => i.status !== 'void_reversed' && i.status !== 'rejected')
      .filter((i) => (i.contractId === contract.id && i.periodStart?.startsWith(month) && !i.isSettlement) || jobIdsOf(i).some((id) => monthJobs.has(id)))
      .reduce((s, i) => s + i.subtotal, 0)
  );
}

/** The month's bill for a contract, from the data store. */
export function monthlyBillFor(contract: Contract, month: string, basis: BillingBasis): MonthlyBill {
  return computeMonthlyBill({
    contract,
    jobs: dataService.getJobs(),
    month,
    basis,
    account: accountFor(contract),
    billed: dataService.billedJobIds(),
    billedAmount: billedAmountFor(contract, month),
  });
}

/**
 * Contracts that ran during a month (and have a price), for the monthly billing run.
 * Cancelled contracts are left out: they are settled by the super admin (see settlementBill).
 */
export function contractsForMonth(month: string): Contract[] {
  const first = `${month}-01`;
  const last = lastDay(month);
  return dataService.getContracts().filter((c) => {
    if (c.status === 'cancelled' || !monthlyCharge(c) || (c.status === 'renewed' && c.endDate < first)) return false;
    return c.startDate <= last && c.endDate >= first;
  });
}

// ---------------------------------------------------------------------------
// Visit pricing: what one done visit costs
// ---------------------------------------------------------------------------

/** The services done on a visit (as recorded on the job, else the client's contract plan). */
export function visitServicesOf(job: ServiceJob): string {
  if (job.visitServices?.length) return job.visitServices.join(', ');
  const plan = job.contractId ? dataService.getContractById(job.contractId)?.servicePlan : undefined;
  if (plan?.length) return plan.map((r) => r.service).join(', ');
  return job.serviceType;
}

export const visitDescription = (job: ServiceJob) =>
  `${visitServicesOf(job)} — visit ${formatDate(job.scheduledDate)}${job.siteName ? ` at ${job.siteName}` : ''} · Job ${job.id}`;

export interface VisitPrice {
  amount: number;
  /** Where the amount comes from, shown next to it. */
  source: string;
  /** Amount comes from the contract / cash collected and cannot be changed when creating the invoice. */
  fixed: boolean;
}

/**
 * Price of one done visit: contract visits cost the monthly charge ÷ the month's visits (never more
 * than what is left of that month); other visits use the cash collected on site or the accepted proposal.
 * `cache` reuses each contract-month calculation across several visits.
 */
export function visitPrice(job: ServiceJob, cache = new Map<string, MonthlyBill>()): VisitPrice {
  const contract = job.contractId ? dataService.getContractById(job.contractId) : undefined;
  if (contract && monthlyCharge(contract)) {
    if (job.visitKind === 'follow_up') return { amount: 0, source: 'Follow-up visit: included in the monthly charge', fixed: true };
    const month = job.scheduledDate.slice(0, 7);
    const key = `${contract.id}|${month}`;
    const bill = cache.get(key) ?? monthlyBillFor(contract, month, 'visits_done');
    cache.set(key, bill);
    const line = bill.lines.find((l) => l.jobId === job.id);
    if (line) return { amount: line.amount, source: `${contract.id}: ${formatPKR(bill.monthlyAmount)} a month ÷ ${bill.divisor} visits`, fixed: true };
    return { amount: 0, source: bill.notes[0] || 'This month is already fully invoiced', fixed: true };
  }
  if (job.customerType !== 'company' && job.cashCollection?.amount) {
    return { amount: job.cashCollection.amount, source: 'Cash collected on site', fixed: true };
  }
  const proposal = (job.proposalId ? dataService.getProposalById(job.proposalId) : undefined)
    ?? dataService.getProposals().find((p) => p.customerId === job.customerId && p.status === 'accepted');
  if (proposal) return { amount: round2(proposal.subtotal - (proposal.discountAmount || 0)), source: `Proposal ${proposal.id}`, fixed: false };
  return { amount: 0, source: 'No agreed price: enter the visit charge', fixed: false };
}

/** Visit of a running, priced contract: billed on its contract's period invoice, never alone. */
export function isPeriodBilledJob(job: Pick<ServiceJob, 'contractId'>): boolean {
  const c = job.contractId ? dataService.getContractById(job.contractId) : undefined;
  return Boolean(c && c.status !== 'cancelled' && monthlyCharge(c));
}

export const isCancelledContractJob = (job: Pick<ServiceJob, 'contractId'>) =>
  Boolean(job.contractId && dataService.getContractById(job.contractId)?.status === 'cancelled');

/**
 * Visits that can go on an invoice: done and quality-checked, not billed yet, and not under a
 * cancelled contract (those are settled by the super admin).
 */
export function billableVisits(customerId?: string): ServiceJob[] {
  const billed = dataService.billedJobIds();
  return dataService.getJobs(customerId)
    .filter((j) => isBillableVisit(j) && !billed.has(j.id) && !isCancelledContractJob(j)
      && !(j.visitKind === 'follow_up' && j.contractId))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
}

// ---------------------------------------------------------------------------
// Cancelled contracts: Finance reports, the super admin settles
// ---------------------------------------------------------------------------

export type SettlementChoice = 'visits_done' | 'full_month' | 'no_charge';

export const SETTLEMENT_LABELS: Record<SettlementChoice, string> = {
  visits_done: 'Done services only',
  full_month: 'Full month',
  no_charge: 'No further charge',
};

export const cancellationDate = (c: Contract) => c.cancellation?.effectiveDate || c.updatedAt.slice(0, 10);

/**
 * Final bill of a cancelled contract: every done visit not invoiced yet (any month up to the last day
 * of service) at its share, and with 'full_month' the rest of the cancellation month's charge too.
 */
export function settlementBill(contract: Contract, basis: BillingBasis): MonthlyBill {
  const eff = cancellationDate(contract);
  const effMonth = eff.slice(0, 7);
  const billed = dataService.billedJobIds();
  const jobs = dataService.getJobs();
  const doneMonths = jobs
    .filter((j) => j.contractId === contract.id && isBillableVisit(j) && !billed.has(j.id) && j.visitKind !== 'follow_up' && j.scheduledDate <= eff)
    .map((j) => j.scheduledDate.slice(0, 7));
  const months = Array.from(new Set([...doneMonths, ...(basis === 'full_month' ? [effMonth] : [])])).sort();
  const bills = months.map((m) => computeMonthlyBill({
    contract,
    jobs,
    month: m,
    basis: m === effMonth ? basis : 'visits_done',
    account: accountFor(contract),
    billed,
    billedAmount: billedAmountFor(contract, m),
  }));
  const last = bills.find((b) => b.month === effMonth) ?? bills[bills.length - 1];
  const lines = bills.flatMap((b) => b.lines);
  return {
    contract,
    month: effMonth,
    periodStart: bills[0]?.periodStart ?? eff,
    periodEnd: eff,
    monthlyAmount: last?.monthlyAmount ?? 0,
    visitsInMonth: last?.visitsInMonth ?? 0,
    visitsDone: bills.reduce((s, b) => s + b.visitsDone, 0),
    divisor: last?.divisor ?? 0,
    perVisit: last?.perVisit ?? 0,
    alreadyBilled: bills.reduce((s, b) => s + b.alreadyBilled, 0),
    lines,
    total: round2(lines.reduce((s, l) => s + l.amount, 0)),
    notes: Array.from(new Set(bills.flatMap((b) => b.notes))),
  };
}

/** Approved invoices of a contract the client still owes on. */
export function unpaidInvoicesOf(contract: Contract): Invoice[] {
  const jobIds = new Set(dataService.getJobs().filter((j) => j.contractId === contract.id).map((j) => j.id));
  return dataService.getInvoices().filter((i) => i.status !== 'void_reversed' && i.balanceDue > 0
    && (i.contractId === contract.id || jobIdsOf(i).some((id) => jobIds.has(id))));
}

/** Settlement reports (and decisions) of a cancelled contract, newest first. */
export const settlementReportsOf = (contractId: string) =>
  dataService.getApprovals().filter((a) => a.type === 'contract_settlement' && a.entityId === contractId);

/** 'open' = nothing yet, 'reported' = Finance's report waits for the super admin, 'settled' = decided. */
export function settlementStatus(contract: Contract): 'open' | 'reported' | 'settled' {
  const reports = settlementReportsOf(contract.id);
  if (reports.some((a) => a.status === 'approved')) return 'settled';
  if (dataService.getAllInvoices().some((i) => i.isSettlement && i.contractId === contract.id && i.status !== 'void_reversed' && i.status !== 'rejected')) return 'settled';
  if (reports.some((a) => a.status === 'pending')) return 'reported';
  return 'open';
}

/** Cancelled contracts still to be settled. */
export const cancelledContractsToSettle = () =>
  dataService.getContracts().filter((c) => c.status === 'cancelled' && monthlyCharge(c) && settlementStatus(c) !== 'settled');

// ---------------------------------------------------------------------------
// Building draft invoices
// ---------------------------------------------------------------------------

export interface InvoiceUser {
  uid: string;
  email: string;
  name: string;
}

export function customerDetails(customerType: Contract['customerType'], customerId: string, branchId?: string, fallbackName = '') {
  if (customerType === 'company') {
    const co = dataService.getCompanyById(customerId);
    const br = branchId ? dataService.getBranchById(branchId) : undefined;
    return {
      name: co?.legalCompanyName || fallbackName,
      ntn: co?.ntn as string | undefined,
      strn: co?.strn as string | undefined,
      address: br?.physicalAddress || co?.headOfficeAddress || fallbackName,
      branchName: br?.branchName,
      province: (dataService.getSites(customerId, branchId)[0]?.province || br?.province || co?.province) as string | undefined,
    };
  }
  const cl = dataService.getClientById(customerId);
  return {
    name: cl?.fullName || fallbackName,
    ntn: undefined as string | undefined,
    strn: undefined as string | undefined,
    address: cl?.residentialAddress || '',
    branchName: undefined as string | undefined,
    province: (dataService.getSites(customerId)[0]?.province || cl?.province) as string | undefined,
  };
}

/** Default sales tax for a customer: the contract's rate, else the province's current rate. */
export function defaultTaxRate(customerType: Contract['customerType'], customerId: string, branchId?: string, contract?: Contract): number {
  if (contract?.taxPercent !== undefined) return contract.taxPercent;
  const prov = customerDetails(customerType, customerId, branchId).province || 'Sindh';
  return taxRateFor(dataService.getTaxRules(), provinceToJurisdiction(prov) as TaxJurisdiction).percent;
}

/** Saves a draft invoice made of visit / charge lines; submitted for approval unless `submit` is false. */
export async function saveDraftInvoice(args: {
  customerType: Contract['customerType'];
  customerId: string;
  branchId?: string;
  account: BillingAccount;
  taxRate: number;
  lines: { description: string; amount: number; jobId?: string }[];
  dueDays?: number;
  issueDate?: string;
  dueDate?: string;
  notes?: string;
  extra?: Partial<Invoice>;
  user: InvoiceUser;
  submit?: boolean;
}): Promise<Invoice> {
  const lines = args.lines.filter((l) => l.amount > 0);
  if (!lines.length) throw new Error('Nothing to invoice: every line is zero.');
  const isCash = args.account === 'cash';
  const cust = customerDetails(args.customerType, args.customerId, args.branchId);
  const jurisdiction = provinceToJurisdiction(cust.province || 'Sindh') as TaxJurisdiction;
  const taxRate = isCash ? 0 : args.taxRate;
  const id = await dataService.newRecordId('INV', 'invoice', dataService.getAllInvoices().map((i) => i.id), 'invoices');
  const ts = new Date().toISOString();
  const submit = args.submit !== false;
  const jobIds = lines.map((l) => l.jobId).filter(Boolean) as string[];
  const lineItems: InvoiceLineItem[] = lines.map((l, i) => ({
    id: `li_${id}_${i}`,
    description: l.description,
    serviceCategory: isCash ? 'Pest control service' : 'Pest Control Services (Tariff 9822.3000)',
    quantity: 1,
    unitPrice: l.amount,
    amount: l.amount,
    taxRatePercent: taxRate,
    taxAmount: 0,
    totalWithTax: 0,
    ...(l.jobId ? { jobId: l.jobId } : {}),
  }));
  const invoice = recalcInvoice({
    id,
    invoiceNumber: draftNumber(id),
    invoiceType: isCash ? 'cash_memo' : 'statutory_sales_tax_invoice',
    billingAccount: args.account,
    jobIds,
    ...(jobIds.length === 1 ? { jobId: jobIds[0] } : {}),
    customerType: args.customerType,
    customerId: args.customerId,
    customerName: cust.name,
    customerNtn: isCash ? undefined : cust.ntn,
    customerStrn: isCash ? undefined : cust.strn,
    branchId: args.branchId,
    branchName: cust.branchName,
    billingAddress: cust.address,
    issueDate: args.issueDate || ts.slice(0, 10),
    dueDate: args.dueDate || new Date(Date.now() + (args.dueDays || 15) * 86400000).toISOString().slice(0, 10),
    jurisdiction,
    lineItems,
    subtotal: 0,
    taxTotal: 0,
    grossPayable: 0,
    amountPaid: 0,
    customerWhtTotal: 0,
    balanceDue: 0,
    notes: args.notes,
    status: submit ? 'pending_approval' : 'draft',
    isPosted: false,
    isApproved: false,
    ...(submit ? { submittedBy: args.user.uid, submittedByName: args.user.name, submittedAt: ts } : {}),
    ...args.extra,
    createdAt: ts,
    updatedAt: ts,
  } as Invoice);
  dataService.saveInvoice(invoice, args.user.email);
  return invoice;
}

const cancelNoteOf = (c: Contract) => c.cancellation
  ? `Contract cancelled (${CONTRACT_CANCEL_CATEGORY_LABELS[c.cancellation.category] || c.cancellation.category}): ${c.cancellation.reason}. Last service day ${formatDate(c.cancellation.effectiveDate)}.`
  : 'Contract cancelled.';

/** Monthly invoice of a running contract (visits done in the month). Cancelled contracts are refused. */
export async function createMonthlyInvoice(bill: MonthlyBill, user: InvoiceUser): Promise<Invoice> {
  const c = bill.contract;
  if (c.status === 'cancelled') throw new Error(`${c.id} is cancelled: only the super admin settles it.`);
  if (!bill.lines.length) throw new Error(`${c.id}: ${bill.notes[0] || 'nothing to bill'}`);
  const monthLabel = new Date(`${bill.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return saveDraftInvoice({
    customerType: c.customerType,
    customerId: c.customerId,
    branchId: c.branchId,
    account: accountFor(c),
    taxRate: defaultTaxRate(c.customerType, c.customerId, c.branchId, c),
    lines: bill.lines,
    dueDays: c.paymentTermsDays,
    notes: `Monthly service charges for ${monthLabel} under contract ${c.id}: PKR ${bill.monthlyAmount.toLocaleString()} a month ÷ ${bill.divisor} visit(s) = PKR ${bill.perVisit.toLocaleString()} per visit.`,
    extra: { contractId: c.id, periodStart: bill.periodStart, periodEnd: bill.periodEnd, billingBasis: 'visits_done' },
    user,
  });
}

/** Final invoice of a cancelled contract. Super admin only (also enforced by the database rules). */
export async function createSettlementInvoice(contract: Contract, basis: BillingBasis, user: InvoiceUser, isSuperAdmin: boolean): Promise<Invoice> {
  if (!isSuperAdmin) throw new Error('Only the super admin can invoice a cancelled contract.');
  if (contract.status !== 'cancelled') throw new Error(`${contract.id} is not cancelled.`);
  const bill = settlementBill(contract, basis);
  if (!bill.lines.length) throw new Error(bill.notes[0] || 'Nothing left to bill on this contract.');
  return saveDraftInvoice({
    customerType: contract.customerType,
    customerId: contract.customerId,
    branchId: contract.branchId,
    account: accountFor(contract),
    taxRate: defaultTaxRate(contract.customerType, contract.customerId, contract.branchId, contract),
    lines: bill.lines,
    dueDays: contract.paymentTermsDays,
    notes: `Final invoice (${SETTLEMENT_LABELS[basis]}) for contract ${contract.id}, ${formatDate(bill.periodStart)} – ${formatDate(bill.periodEnd)}. ${cancelNoteOf(contract)}`,
    extra: { contractId: contract.id, periodStart: bill.periodStart, periodEnd: bill.periodEnd, billingBasis: basis, isSettlement: true },
    user,
  });
}

// ---------------------------------------------------------------------------
// Contract billing by cycle: one invoice per contract per billing period (set on the proposal:
// calendar month, every 15 / 30 days, …) covering every visit done in that period.
// ---------------------------------------------------------------------------

export interface PeriodBill {
  contract: Contract;
  period: BillingPeriod;
  /** The period is over (its last day is before the billing date). */
  finished: boolean;
  lines: MonthlyLine[];
  total: number;
  /** Visits in the period not done or not quality-checked yet. */
  waiting: number;
}

/** A contract's billing periods up to `upTo` that have done visits not invoiced yet. */
export function periodBillsFor(contract: Contract, upTo: string, includeCurrent: boolean, cache = new Map<string, MonthlyBill>()): PeriodBill[] {
  if (contract.status === 'cancelled' || !monthlyCharge(contract)) return [];
  const billed = dataService.billedJobIds();
  const jobs = dataService.getJobs().filter((j) => j.contractId === contract.id && j.status !== 'cancelled' && j.visitKind !== 'follow_up');
  return billingPeriods(contract.startDate, contract.endDate, contract.billingCycleDays, upTo).flatMap((period) => {
    const finished = period.end < upTo;
    if (!finished && !includeCurrent) return [];
    const visits = jobs.filter((j) => j.scheduledDate >= period.start && j.scheduledDate <= period.end).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
    const lines = visits
      .filter((j) => isBillableVisit(j) && !billed.has(j.id))
      .map((j) => ({ jobId: j.id, description: visitDescription(j), amount: visitPrice(j, cache).amount, done: true }))
      .filter((l) => l.amount > 0);
    const waiting = visits.filter((j) => !isBillableVisit(j)).length;
    if (!lines.length) return [];
    return [{ contract, period, finished, lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)), waiting }];
  });
}

/** Every running contract's periods to invoice up to a date (one invoice each). */
export function periodBillsUpTo(upTo: string, includeCurrent: boolean, contractId?: string): PeriodBill[] {
  const cache = new Map<string, MonthlyBill>();
  return dataService.getContracts()
    .filter((c) => !contractId || c.id === contractId)
    .flatMap((c) => periodBillsFor(c, upTo, includeCurrent, cache));
}

/** Draft invoice (sent for approval) for one contract billing period. */
export async function createPeriodInvoice(bill: PeriodBill, user: InvoiceUser): Promise<Invoice> {
  const c = bill.contract;
  if (c.status === 'cancelled') throw new Error(`${c.id} is cancelled: only the super admin settles it.`);
  if (!bill.lines.length) throw new Error(`${c.id}: no done visits to invoice in this period.`);
  const charge = monthlyCharge(c);
  return saveDraftInvoice({
    customerType: c.customerType,
    customerId: c.customerId,
    branchId: c.branchId,
    account: accountFor(c),
    taxRate: defaultTaxRate(c.customerType, c.customerId, c.branchId, c),
    lines: bill.lines,
    dueDays: c.paymentTermsDays,
    notes: `Service charges for ${formatDate(bill.period.start)} – ${formatDate(bill.period.end)} under contract ${c.id} (invoiced ${billingCycleLabel(c.billingCycleDays).toLowerCase()}): ${bill.lines.length} visit(s) done, each charged at the monthly charge${charge ? ` of PKR ${(accountFor(c) === 'cash' ? charge.total : charge.base).toLocaleString()}` : ''} ÷ that month's visits.`,
    extra: { contractId: c.id, periodStart: bill.period.start, periodEnd: bill.period.end, billingBasis: 'visits_done' },
    user,
  });
}

// ---------------------------------------------------------------------------
// Invoices from completed jobs: individually (one invoice per job) or in bulk (one bulk invoice per
// client, with each job's own invoice inside it). Both go to an admin for approval.
// ---------------------------------------------------------------------------

export interface JobCharge {
  job: ServiceJob;
  amount: number;
}

/** One invoice per job, each submitted for approval. */
export async function createJobInvoices(items: JobCharge[], user: InvoiceUser): Promise<Invoice[]> {
  const out: Invoice[] = [];
  for (const { job, amount } of items) {
    const contract = job.contractId ? dataService.getContractById(job.contractId) : undefined;
    out.push(await saveDraftInvoice({
      customerType: job.customerType,
      customerId: job.customerId,
      branchId: job.branchId,
      account: accountFor(job),
      taxRate: defaultTaxRate(job.customerType, job.customerId, job.branchId, contract),
      lines: [{ description: visitDescription(job), amount, jobId: job.id }],
      dueDays: contract?.paymentTermsDays,
      extra: job.contractId ? { contractId: job.contractId } : {},
      user,
      submit: true,
    }));
  }
  return out;
}

/**
 * Bulk invoice: the jobs of ONE client (never merged across clients) on one invoice, with an
 * individual invoice per job inside it, submitted for approval as one. Jobs of several branches of
 * the same company may go together.
 */
export async function createBulkInvoices(items: JobCharge[], user: InvoiceUser): Promise<ClientStatement[]> {
  if (!items.length) throw new Error('Tick the jobs to invoice.');
  const clientIds = new Set(items.map((it) => it.job.customerId));
  if (clientIds.size > 1) {
    throw new Error(`A bulk invoice is for one client only. The ticked jobs belong to ${clientIds.size} clients: choose one client.`);
  }
  const groups = new Map<string, JobCharge[]>([[items[0].job.customerId, items]]);
  const out: ClientStatement[] = [];
  for (const group of groups.values()) {
    const first = group[0].job;
    const branchIds = Array.from(new Set(group.map((g) => g.job.branchId || '')));
    const oneBranch = branchIds.length === 1 ? branchIds[0] || undefined : undefined;
    const contractIds = Array.from(new Set(group.map((g) => g.job.contractId || '')));
    const contract = contractIds.length === 1 && contractIds[0] ? dataService.getContractById(contractIds[0]) : undefined;
    const id = await dataService.newRecordId('ST', 'statement', dataService.getStatements().map((s) => s.id), 'client_statements');
    const invoices: Invoice[] = [];
    for (const { job, amount } of group.sort((a, b) => a.job.scheduledDate.localeCompare(b.job.scheduledDate))) {
      const jobContract = job.contractId ? dataService.getContractById(job.contractId) : undefined;
      invoices.push(await saveDraftInvoice({
        customerType: job.customerType,
        customerId: job.customerId,
        branchId: job.branchId,
        account: accountFor(job),
        taxRate: defaultTaxRate(job.customerType, job.customerId, job.branchId, jobContract),
        lines: [{ description: visitDescription(job), amount, jobId: job.id }],
        dueDays: jobContract?.paymentTermsDays,
        notes: 'Job invoice; approved and sent with its bulk invoice.',
        extra: { ...(job.contractId ? { contractId: job.contractId } : {}), statementId: id },
        user,
        submit: false,
      }));
    }
    const dates = group.map((g) => g.job.scheduledDate).sort();
    const cust = customerDetails(first.customerType, first.customerId, oneBranch, first.customerName);
    const ts = new Date().toISOString();
    out.push(dataService.saveStatement({
      id,
      statementNumber: `DRAFT-${id}`,
      ...(contract ? { contractId: contract.id, billingCycleDays: contract.billingCycleDays ?? 0 } : {}),
      customerType: first.customerType,
      customerId: first.customerId,
      customerName: cust.name || first.customerName,
      branchId: oneBranch,
      branchName: oneBranch ? first.branchName : undefined,
      billingAddress: cust.address,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      invoiceIds: invoices.map((i) => i.id),
      subtotal: Math.round(invoices.reduce((s, i) => s + i.subtotal, 0) * 100) / 100,
      taxTotal: Math.round(invoices.reduce((s, i) => s + i.taxTotal, 0) * 100) / 100,
      periodTotal: Math.round(invoices.reduce((s, i) => s + i.grossPayable, 0) * 100) / 100,
      previousInvoiceIds: [],
      previousBalance: 0,
      issueDate: ts.slice(0, 10),
      dueDate: new Date(Date.now() + ((contract?.paymentTermsDays) || 15) * 86400000).toISOString().slice(0, 10),
      status: 'pending_approval',
      submittedBy: user.uid,
      submittedByName: user.name,
      submittedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    }, user.email));
  }
  return out;
}
