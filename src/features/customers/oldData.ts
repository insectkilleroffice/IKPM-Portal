// Old visits / invoices / payments of an old client (used by the "Add old client" form, oldClient.ts):
// - Done + no invoice   → normal billing (Invoices → Completed jobs; cancelled contract → settlement)
// - Done + invoice no.  → an approved old invoice billing those visits, with what was paid
// - Not done            → the visit is cancelled ("not done, old record")

import { dataService } from '../../services/dataService';
import { contractValueBeforeTax, monthlyCharge } from '../invoices/monthlyBilling';
import type { Invoice } from '../../types/finance';
import type { ServiceJob } from '../../types/operations';

export interface OldDataClient { id: string; name: string; type: 'company' | 'individual'; pending: number }

/** Clients with imported visits still waiting for this form. */
export function oldDataClients(): OldDataClient[] {
  const pending = new Map<string, number>();
  dataService.getJobs().forEach((j) => { if (j.oldDataPending) pending.set(j.customerId, (pending.get(j.customerId) ?? 0) + 1); });
  const out: OldDataClient[] = [];
  dataService.getCompanies().forEach((c) => { if (pending.has(c.id)) out.push({ id: c.id, name: c.legalCompanyName, type: 'company', pending: pending.get(c.id)! }); });
  dataService.getClients().forEach((c) => { if (pending.has(c.id)) out.push({ id: c.id, name: c.fullName, type: 'individual', pending: pending.get(c.id)! }); });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const oldDataVisits = (customerId: string): ServiceJob[] =>
  dataService.getJobs().filter((j) => j.customerId === customerId && j.oldDataPending).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Suggested charge of one visit before tax, and the contract's tax %, from its contract. */
export function suggestedVisitCharge(job: ServiceJob): { base: number; taxPercent: number } {
  const c = job.contractId ? dataService.getContractById(job.contractId) : undefined;
  if (!c) return { base: 0, taxPercent: 0 };
  const taxPercent = c.taxPercent ?? 0;
  const live = dataService.getJobs().filter((j) => j.contractId === c.id && j.status !== 'cancelled' && j.visitKind !== 'follow_up');
  const charge = monthlyCharge(c);
  if (charge) {
    const month = job.scheduledDate.slice(0, 7);
    const inMonth = live.filter((j) => j.scheduledDate.startsWith(month)).length;
    return { base: round2(charge.base / Math.max(1, c.serviceVisitsPerMonth || 0, inMonth)), taxPercent };
  }
  return { base: round2(contractValueBeforeTax(c) / Math.max(1, live.length)), taxPercent };
}

/** Suggested invoice total (incl. tax) and tax for a set of visits. */
export function suggestedInvoice(jobs: ServiceJob[]): { total: number; tax: number } {
  let base = 0;
  let tax = 0;
  jobs.forEach((j) => { const s = suggestedVisitCharge(j); base += s.base; tax += (s.base * s.taxPercent) / 100; });
  return { total: round2(base + tax), tax: round2(tax) };
}

export interface OldVisitAnswer { jobId: string; done: boolean; invoiceNo: string }
export interface OldInvoiceAnswer { number: string; date: string; total: number; tax: number; paid: number; paidOn?: string }

/** Problems that stop saving (empty = ok). */
export function checkOldData(visits: OldVisitAnswer[], invoices: OldInvoiceAnswer[]): string[] {
  const problems: string[] = [];
  const existing = new Set(dataService.getAllInvoices().map((i) => i.invoiceNumber.trim().toLowerCase()));
  for (const inv of invoices) {
    const n = inv.number.trim();
    if (existing.has(n.toLowerCase())) problems.push(`Invoice No. ${n} is already in the portal`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.date)) problems.push(`${n}: invoice date is missing`);
    if (!(inv.total > 0)) problems.push(`${n}: enter the invoice total`);
    if (inv.tax < 0 || inv.tax > inv.total) problems.push(`${n}: tax must be between 0 and the total`);
    if (inv.paid < 0 || inv.paid > inv.total) problems.push(`${n}: paid must be between 0 and the total`);
  }
  visits.filter((v) => !v.done && v.invoiceNo.trim()).forEach((v) => problems.push(`Visit ${v.jobId} is marked not done but has invoice ${v.invoiceNo}`));
  return problems;
}

export interface OldDataResult { done: number; notDone: number; invoices: number; toBill: number }

/** Saves the answers for one client. */
export async function saveOldData(customerId: string, visits: OldVisitAnswer[], invoices: OldInvoiceAnswer[], user: { uid: string; email: string; name: string }): Promise<OldDataResult> {
  const problems = checkOldData(visits, invoices);
  if (problems.length) throw new Error(problems.join('\n'));
  const ts = new Date().toISOString();
  const result: OldDataResult = { done: 0, notDone: 0, invoices: 0, toBill: 0 };

  // 1. Visits
  for (const v of visits) {
    const job = dataService.getJobById(v.jobId);
    if (!job) continue;
    if (!v.done) {
      dataService.saveJob({ ...job, status: 'cancelled', cancellationReasonCode: 'other', cancellationReason: 'Not done (old record, checked in Old data)', oldDataPending: false, updatedAt: ts }, user.email);
      result.notDone++;
      continue;
    }
    dataService.saveJob({
      ...job, status: 'completed', oldDataPending: false, updatedAt: ts,
      supervisorVerification: job.supervisorVerification ?? { isVerified: true, supervisorId: user.uid, supervisorName: `${user.name} (old record)`, verifiedAt: `${job.scheduledDate}T12:00:00.000Z`, qcRating: 'satisfactory', supervisorNotes: 'Old visit confirmed in Old data' },
    }, user.email);
    result.done++;
    if (!v.invoiceNo.trim()) result.toBill++;
  }

  // 2. Old invoices, each billing the done visits that carry its number
  const company = dataService.getCompanies().find((c) => c.id === customerId);
  const person = dataService.getClients().find((c) => c.id === customerId);
  for (const o of invoices) {
    const jobs = visits.filter((v) => v.done && v.invoiceNo.trim().toLowerCase() === o.number.trim().toLowerCase())
      .map((v) => dataService.getJobById(v.jobId)).filter((j): j is ServiceJob => Boolean(j));
    const id = await dataService.newRecordId('INV', 'invoice', dataService.getAllInvoices().map((x) => x.id), 'invoices');
    const sub = round2(o.total - o.tax);
    const balance = round2(o.total - o.paid);
    // Split the amount over its visits (in proportion to the suggested charge, else equally)
    const weights = jobs.map((j) => suggestedVisitCharge(j).base);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const share = (i: number) => (jobs.length ? (wSum > 0 ? weights[i] / wSum : 1 / jobs.length) : 1);
    const lines = (jobs.length ? jobs : [undefined]).map((j, i) => {
      const amount = round2(sub * share(i));
      const taxAmount = round2(o.tax * share(i));
      return {
        id: `li_${id}_${i}`, description: j ? `${(j.visitServices ?? []).join(', ') || j.serviceType} — visit ${j.scheduledDate}${j.siteName ? ` at ${j.siteName}` : ''}` : 'Services before the portal',
        serviceCategory: 'Pest control services', quantity: 1, unitPrice: amount, amount, taxRatePercent: sub > 0 ? round2((o.tax / sub) * 100) : 0, taxAmount,
        totalWithTax: round2(amount + taxAmount), ...(j ? { jobId: j.id } : {}),
      };
    });
    const first = jobs[0];
    const inv: Invoice = {
      id, invoiceNumber: o.number.trim(), invoiceType: 'standard_service', billingAccount: o.tax > 0 || company ? 'tax' : 'cash',
      jobIds: jobs.map((j) => j.id), ...(jobs.length === 1 ? { jobId: jobs[0].id } : {}),
      customerType: company ? 'company' : 'individual', customerId, customerName: company?.legalCompanyName ?? person?.fullName ?? first?.customerName ?? '',
      customerNtn: company?.ntn, customerStrn: company?.strn, branchId: first?.branchId, branchName: first?.branchName,
      billingAddress: company?.headOfficeAddress ?? person?.residentialAddress ?? first?.siteAddress ?? '',
      issueDate: o.date, dueDate: o.date, jurisdiction: 'sindh_srb', lineItems: lines,
      subtotal: sub, taxTotal: o.tax, grossPayable: o.total, amountPaid: o.paid, customerWhtTotal: 0, balanceDue: balance,
      status: balance <= 0 ? 'paid' : o.paid > 0 ? 'partially_paid' : 'posted',
      isPosted: true, postedAt: ts, postedBy: user.name, isApproved: true, approvedBy: user.name, approvedAt: ts,
      notes: [`Invoice issued before the portal (old record).`, o.paid ? `PKR ${o.paid.toLocaleString()} paid before the portal${o.paidOn ? ` (${o.paidOn})` : ''}.` : ''].filter(Boolean).join(' '),
      createdAt: ts, updatedAt: ts, ...(first?.importBatchId ? { importBatchId: first.importBatchId } : {}),
    } as Invoice;
    dataService.saveInvoice(inv, user.email);
    result.invoices++;
  }

  dataService.logAudit({
    userId: user.uid, userEmail: user.email, action: 'update', entityType: 'client', entityId: customerId, entityTitle: 'Old data',
    details: `Old data: ${result.done} visit(s) done, ${result.notDone} not done, ${result.invoices} old invoice(s), ${result.toBill} visit(s) left to invoice`,
  });
  return result;
}
