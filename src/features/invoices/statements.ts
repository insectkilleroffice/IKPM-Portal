// Client statements: the billing flow for contracts.
//
//  1. Each visit done (and quality-checked) gets its own job invoice: services, date, site, its
//     cost (monthly charge ÷ that month's visits) and sales tax. Job invoices are not approved or
//     sent one by one.
//  2. At the end of each billing period of the contract (15 days, 30 days, monthly, quarterly… as
//     set on the proposal / contract) Finance prepares ONE statement for the client: that period's
//     job invoices plus any earlier unpaid balance. It goes to an admin for approval.
//  3. Approving the statement finalises its job invoices (they get their numbers) and the statement
//     (IKPM-ST-…). It is then sent to the client (email / WhatsApp).
//  4. A payment recorded on the statement settles its invoices, oldest first (earlier unpaid
//     balance before this period). Part payments carry to the next statement.

import { dataService } from '../../services/dataService';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { fileGenerated } from '../documents/fileGenerated';
import { sendOutreach, isValidEmail } from '../../services/outreachService';
import { outreachEnv } from '../../config/env';
import { formatDate, formatPKR } from '../../lib/formatters';
import { billingCycleLabel } from '../../lib/billingCycle';
import { isUnpostedInvoice, type ClientStatement, type Invoice, type PaymentReceipt } from '../../types/finance';
import type { PortalDocument } from '../../types/document';
import { channelBlocker, invoiceOwner, nextInvoiceNumber, recalcInvoice, recordCollectedCash, type Actor, type InvoiceSendChannel } from './invoiceWorkflow';
import { accountFor, customerDetails, defaultTaxRate, saveDraftInvoice, type InvoiceUser, type PeriodBill } from './monthlyBilling';

const round2 = (n: number) => Math.round(n * 100) / 100;
const nowIso = () => new Date().toISOString();

export const STATEMENT_STATUS_LABELS: Record<ClientStatement['status'], string> = {
  draft: 'Draft',
  pending_approval: 'Waiting for approval',
  rejected: 'Returned to Finance',
  approved: 'Approved',
  cancelled: 'Cancelled',
};

/** The statement's job invoices (current versions). */
export const statementInvoices = (st: ClientStatement): Invoice[] =>
  st.invoiceIds.map((id) => dataService.getInvoiceById(id)).filter(Boolean) as Invoice[];

/** Earlier unpaid invoices carried on the statement (current versions). */
export const previousInvoices = (st: ClientStatement): Invoice[] =>
  st.previousInvoiceIds.map((id) => dataService.getInvoiceById(id)).filter(Boolean) as Invoice[];

/** Live amounts: what this period comes to, what is still owed, and the paid state. */
export function statementAmounts(st: ClientStatement) {
  const current = statementInvoices(st).filter((i) => i.status !== 'void_reversed');
  const previous = previousInvoices(st).filter((i) => i.status !== 'void_reversed');
  const subtotal = round2(current.reduce((s, i) => s + i.subtotal, 0));
  const taxTotal = round2(current.reduce((s, i) => s + i.taxTotal, 0));
  const periodTotal = round2(current.reduce((s, i) => s + i.grossPayable, 0));
  const periodDue = round2(current.reduce((s, i) => s + (isUnpostedInvoice(i) ? i.grossPayable : i.balanceDue), 0));
  const previousDue = round2(previous.reduce((s, i) => s + i.balanceDue, 0));
  const totalDue = round2(periodDue + previousDue);
  const paid = round2(current.reduce((s, i) => s + (i.amountPaid || 0) + (i.customerWhtTotal || 0), 0));
  const payState: 'unpaid' | 'partly_paid' | 'paid' = st.status !== 'approved' ? 'unpaid' : totalDue <= 0 ? 'paid' : paid > 0 ? 'partly_paid' : 'unpaid';
  return { subtotal, taxTotal, periodTotal, periodDue, previousDue, totalDue, paid, payState, current, previous };
}

/** Approved invoices of the client (same branch) still unpaid, from before this period. */
function earlierUnpaid(bill: PeriodBill): Invoice[] {
  const c = bill.contract;
  return dataService.getInvoices(c.customerId)
    .filter((i) => i.status !== 'void_reversed' && i.balanceDue > 0 && (i.branchId || '') === (c.branchId || '') && i.issueDate < bill.period.start)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
}

/**
 * Prepares the statement for one contract billing period: a job invoice for every visit done in
 * it, and the statement grouping them, submitted for approval.
 */
export async function prepareStatement(bill: PeriodBill, user: InvoiceUser): Promise<ClientStatement> {
  const c = bill.contract;
  if (c.status === 'cancelled') throw new Error(`${c.id} is cancelled: only the super admin settles it.`);
  if (!bill.lines.length) throw new Error(`${c.id}: no done visits in ${formatDate(bill.period.start)} – ${formatDate(bill.period.end)}.`);
  const id = await dataService.newRecordId('ST', 'statement', dataService.getStatements().map((s) => s.id), 'client_statements');
  const taxRate = defaultTaxRate(c.customerType, c.customerId, c.branchId, c);
  const invoices: Invoice[] = [];
  for (const line of bill.lines) {
    invoices.push(await saveDraftInvoice({
      customerType: c.customerType,
      customerId: c.customerId,
      branchId: c.branchId,
      account: accountFor(c),
      taxRate,
      lines: [line],
      dueDays: c.paymentTermsDays,
      notes: `Visit invoice under contract ${c.id}; billed on statement for ${formatDate(bill.period.start)} – ${formatDate(bill.period.end)}.`,
      extra: { contractId: c.id, statementId: id, periodStart: bill.period.start, periodEnd: bill.period.end, billingBasis: 'visits_done' },
      user,
      submit: false,
    }));
  }
  const previous = earlierUnpaid(bill);
  const cust = customerDetails(c.customerType, c.customerId, c.branchId, c.customerName);
  const ts = nowIso();
  const statement: ClientStatement = {
    id,
    statementNumber: `DRAFT-${id}`,
    contractId: c.id,
    customerType: c.customerType,
    customerId: c.customerId,
    customerName: cust.name || c.customerName,
    branchId: c.branchId,
    branchName: c.branchName,
    billingAddress: cust.address,
    periodStart: bill.period.start,
    periodEnd: bill.period.end,
    billingCycleDays: c.billingCycleDays ?? 0,
    invoiceIds: invoices.map((i) => i.id),
    subtotal: round2(invoices.reduce((s, i) => s + i.subtotal, 0)),
    taxTotal: round2(invoices.reduce((s, i) => s + i.taxTotal, 0)),
    periodTotal: round2(invoices.reduce((s, i) => s + i.grossPayable, 0)),
    previousInvoiceIds: previous.map((i) => i.id),
    previousBalance: round2(previous.reduce((s, i) => s + i.balanceDue, 0)),
    issueDate: ts.slice(0, 10),
    dueDate: new Date(Date.now() + (c.paymentTermsDays || 15) * 86400000).toISOString().slice(0, 10),
    status: 'pending_approval',
    submittedBy: user.uid,
    submittedByName: user.name,
    submittedAt: ts,
    notes: `${billingCycleLabel(c.billingCycleDays)} statement under contract ${c.id}.`,
    createdAt: ts,
    updatedAt: ts,
  };
  return dataService.saveStatement(statement, user.email);
}

/** Totals refreshed from its job invoices (an approver may have adjusted them). */
function withTotals(st: ClientStatement): ClientStatement {
  const a = statementAmounts(st);
  return { ...st, subtotal: a.subtotal, taxTotal: a.taxTotal, periodTotal: a.periodTotal, updatedAt: nowIso() };
}

/** Admin / super admin approval: job invoices get their numbers and are posted; then the statement. */
export async function approveStatement(st: ClientStatement, actor: Actor): Promise<{ statement: ClientStatement; notes: string[] }> {
  if (st.status !== 'pending_approval') throw new Error('Only a statement waiting for approval can be approved.');
  const notes: string[] = [];
  const ts = nowIso();
  for (const inv of statementInvoices(st)) {
    if (!isUnpostedInvoice(inv)) continue;
    const ready = recalcInvoice(inv);
    const posted: Invoice = {
      ...ready,
      invoiceNumber: await nextInvoiceNumber(ready),
      status: 'posted',
      isPosted: true,
      postedAt: ts,
      postedBy: st.submittedByName || actor.name,
      isApproved: true,
      approvedBy: actor.name,
      approvedAt: ts,
      issueDate: st.issueDate,
      dueDate: st.dueDate,
      updatedAt: ts,
    };
    dataService.saveInvoice(posted, actor.email);
    try {
      const cash = await recordCollectedCash(posted, actor);
      if (cash) notes.push(cash);
    } catch (err) {
      notes.push(`Cash not recorded for ${posted.invoiceNumber}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const year = new Date().getFullYear();
  const prefix = `IKPM-BI-${year}-`;
  const seq = await dataService.nextSequence(`statement_${year}`,
    dataService.maxSeqOf(dataService.getStatements().filter((s) => s.statementNumber.startsWith(prefix)).map((s) => s.statementNumber)));
  const approved: ClientStatement = {
    ...withTotals(st),
    statementNumber: `${prefix}${String(seq).padStart(4, '0')}`,
    status: 'approved',
    approvedBy: actor.name,
    approvedAt: ts,
  };
  return { statement: dataService.saveStatement(approved, actor.email), notes };
}

export function rejectStatement(st: ClientStatement, reason: string, actor: Actor): ClientStatement {
  if (!reason.trim()) throw new Error('Tell Finance what to correct.');
  return dataService.saveStatement({ ...st, status: 'rejected', rejectedBy: actor.name, rejectedAt: nowIso(), rejectionReason: reason.trim(), updatedAt: nowIso() }, actor.email);
}

/** Finance sends a returned statement back for approval (after the corrections). */
export function resubmitStatement(st: ClientStatement, actor: Actor): ClientStatement {
  return dataService.saveStatement({ ...withTotals(st), status: 'pending_approval', submittedBy: actor.uid, submittedByName: actor.name, submittedAt: nowIso() }, actor.email);
}

/** Cancels a statement before approval: its draft job invoices are voided, so the visits can be billed again. */
export function cancelStatement(st: ClientStatement, reason: string, actor: Actor): ClientStatement {
  if (st.status === 'approved') throw new Error('An approved statement cannot be cancelled. Void its invoices with a credit note instead.');
  for (const inv of statementInvoices(st)) {
    if (!isUnpostedInvoice(inv)) continue;
    dataService.saveInvoice({ ...inv, status: 'void_reversed', creditNoteReason: `Statement cancelled before approval: ${reason}`, balanceDue: 0, updatedAt: nowIso() }, actor.email);
  }
  return dataService.saveStatement({ ...st, status: 'cancelled', notes: `${st.notes || ''} Cancelled: ${reason}`.trim(), updatedAt: nowIso() }, actor.email);
}

export interface StatementPayment {
  cash: number;
  wht: number;
  whtRatePercent?: number;
  whtCertificateNumber?: string;
  mode: PaymentReceipt['paymentMode'];
  reference?: string;
  bankName?: string;
  date: string;
}

/**
 * Applies one payment to invoices oldest first, one receipt per invoice. Cash and withholding tax
 * are shared in proportion. `label` is added to each receipt's reference (e.g. the statement number).
 */
async function applyPaymentOldestFirst(invoices: Invoice[], pay: StatementPayment, actor: Actor, label: string, what: string): Promise<PaymentReceipt[]> {
  const cash = round2(Math.max(0, pay.cash));
  const wht = round2(Math.max(0, pay.wht));
  const credit = round2(cash + wht);
  if (!(credit > 0)) throw new Error('Enter the amount received.');
  const targets = invoices
    .filter((i) => !isUnpostedInvoice(i) && i.status !== 'void_reversed' && i.balanceDue > 0)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
  const due = round2(targets.reduce((s, i) => s + i.balanceDue, 0));
  if (!targets.length) throw new Error('Nothing is owed: there are no unpaid approved invoices.');
  if (credit > due + 0.01) throw new Error(`The payment (${formatPKR(credit)}) is more than ${what} (${formatPKR(due)}).`);

  const receipts: PaymentReceipt[] = [];
  let leftCash = cash;
  let leftWht = wht;
  for (const inv of targets) {
    const leftCredit = round2(leftCash + leftWht);
    if (leftCredit <= 0) break;
    const portion = round2(Math.min(inv.balanceDue, leftCredit));
    const isLast = portion >= leftCredit;
    const whtPart = isLast ? leftWht : round2(Math.min(leftWht, (portion * wht) / credit));
    const cashPart = isLast ? leftCash : round2(Math.min(leftCash, portion - whtPart));
    leftCash = round2(leftCash - cashPart);
    leftWht = round2(leftWht - whtPart);
    const id = await dataService.newRecordId('REC', 'receipt', dataService.getPayments().map((r) => r.id), 'payments');
    const receipt: PaymentReceipt = {
      id,
      receiptNumber: id,
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customerName: inv.customerName,
      branchId: inv.branchId,
      paymentDate: pay.date,
      paymentMode: pay.mode,
      bankReferenceNo: [pay.mode === 'cross_cheque' ? undefined : pay.reference, label].filter(Boolean).join(' · ') || undefined,
      chequeNumber: pay.mode === 'cross_cheque' ? pay.reference : undefined,
      bankName: pay.mode === 'cash' ? undefined : pay.bankName,
      cashAmountReceived: cashPart,
      customerWhtDeducted: {
        isApplicable: whtPart > 0,
        ratePercent: whtPart > 0 ? pay.whtRatePercent || 0 : 0,
        amountDeducted: whtPart,
        certificateNumber: pay.whtCertificateNumber,
        sectionCode: 'Section 153(1)(b) - Services',
      },
      totalCreditApplied: round2(cashPart + whtPart),
      recordedBy: actor.email,
      recordedByName: actor.name,
      createdAt: nowIso(),
    };
    dataService.recordPayment(receipt, actor.email);
    receipts.push(receipt);
  }
  return receipts;
}

/**
 * Records one payment on a statement and settles its invoices oldest first (earlier unpaid
 * invoices, then this period's), one receipt per invoice. Returns the receipts made.
 */
export async function recordStatementPayment(st: ClientStatement, pay: StatementPayment, actor: Actor): Promise<PaymentReceipt[]> {
  if (st.status !== 'approved') throw new Error('Approve the statement before recording payments on it.');
  const receipts = await applyPaymentOldestFirst([...previousInvoices(st), ...statementInvoices(st)], pay, actor, `Invoice ${st.statementNumber}`, "the invoice's balance");
  dataService.saveStatement({ ...st, updatedAt: nowIso() }, actor.email);
  return receipts;
}

/** A client's approved invoices still owed (optionally one branch), oldest first. */
export function clientUnpaidInvoices(customerId: string, branchId?: string): Invoice[] {
  return dataService.getInvoices(customerId)
    .filter((i) => i.status !== 'void_reversed' && i.balanceDue > 0 && (branchId === undefined || (i.branchId || '') === branchId))
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
}

/** The simple way: one payment from a client settles their unpaid invoices, oldest first. */
export async function recordClientPayment(customerId: string, pay: StatementPayment, actor: Actor, branchId?: string): Promise<PaymentReceipt[]> {
  return applyPaymentOldestFirst(clientUnpaidInvoices(customerId, branchId), pay, actor, '', "the client's balance");
}

// ---------------------------------------------------------------------------
// Sending (approved statements only)
// ---------------------------------------------------------------------------

/** Billing contact of the statement's client / branch. */
export function statementRecipient(st: ClientStatement): { name: string; email?: string; phone?: string } {
  if (st.customerType === 'company') {
    const br = st.branchId ? dataService.getBranchById(st.branchId) : undefined;
    const co = dataService.getCompanyById(st.customerId);
    if (br && isValidEmail(br.branchEmail)) return { name: br.branchManagerName || st.customerName, email: br.branchEmail, phone: br.branchManagerPhone || br.branchPhone };
    return { name: co?.primaryContact.fullName || st.customerName, email: co?.primaryContact.email, phone: co?.primaryContact.mobile };
  }
  const cl = dataService.getClientById(st.customerId);
  return { name: cl?.fullName || st.customerName, email: cl?.email, phone: cl?.primaryPhone };
}

export function statementMessage(st: ClientStatement, recipientName: string, actor: Actor): { subject: string; message: string } {
  const a = statementAmounts(st);
  const first = recipientName.split(' ')[0] || 'Sir/Madam';
  return {
    subject: `${outreachEnv.companyName} — Invoice ${st.statementNumber} (${formatDate(st.periodStart)} – ${formatDate(st.periodEnd)})`,
    message: [
      `Dear ${first},`,
      '',
      `Please find invoice ${st.statementNumber} for the services from ${formatDate(st.periodStart)} to ${formatDate(st.periodEnd)}: ${a.current.length} job(s) totalling ${formatPKR(a.periodTotal)}.`,
      ...(a.previousDue > 0 ? [`Earlier unpaid balance: ${formatPKR(a.previousDue)}.`] : []),
      `Total due: ${formatPKR(a.totalDue)}, by ${formatDate(st.dueDate)}.`,
      '',
      'For any query, simply reply to this message.',
      '',
      'Regards,',
      actor.name,
      outreachEnv.companyName,
      [actor.businessEmail, outreachEnv.companyPhone, outreachEnv.companyWebsite].filter(Boolean).join(' | '),
    ].join('\n'),
  };
}

/** The statement PDF (summary + each visit invoice) in the client's Invoices folder, made once. */
async function statementFile(st: ClientStatement, actor: Actor): Promise<PortalDocument> {
  const existing = st.pdfDocumentId ? dataService.getDocumentById(st.pdfDocumentId) : undefined;
  if (existing && existing.file.storage === 'cloudinary') return existing;
  const blob = await pdfGenerator.statementPDFBlob(st);
  const doc = await fileGenerated(blob, {
    owner: invoiceOwner(st as unknown as Invoice),
    category: 'invoice',
    title: `Bulk Invoice - ${st.statementNumber} (${formatDate(st.periodStart)} – ${formatDate(st.periodEnd)})`,
    fileName: `Invoice_${st.statementNumber}.pdf`,
    subPath: st.id,
    user: { email: actor.email, displayName: actor.name },
    noLocalDownload: true,
  });
  if (!doc || doc.file.storage !== 'cloudinary') throw new Error('The statement PDF could not be uploaded to file storage, so it was not sent.');
  dataService.saveStatement({ ...(dataService.getStatementById(st.id) || st), pdfDocumentId: doc.id, updatedAt: nowIso() }, actor.email);
  return doc;
}

/** Sends an approved statement to the client and marks it (and its invoices) as sent. */
export async function sendStatementToClient(st: ClientStatement, actor: Actor, opts: {
  channel: InvoiceSendChannel; name: string; email?: string; phone?: string; subject: string; message: string;
  linkWindow?: Window | null; emailWindow?: Window | null;
}): Promise<ClientStatement> {
  if (st.status !== 'approved') throw new Error('Only an approved statement can be sent to the client.');
  const blocker = channelBlocker(opts.channel);
  if (blocker) throw new Error(blocker);
  const isWhatsApp = opts.channel === 'whatsapp';
  if (isWhatsApp && !opts.phone?.trim()) throw new Error("Enter the client's WhatsApp number.");
  if (!isWhatsApp && !isValidEmail(opts.email)) throw new Error('Enter a valid client email address.');
  const doc = await statementFile(st, actor);
  const owner = st.branchId
    ? { kind: 'branch' as const, id: st.branchId }
    : { kind: st.customerType === 'company' ? ('company' as const) : ('client' as const), id: st.customerId };
  const [result] = await sendOutreach({
    channels: [isWhatsApp ? 'whatsapp' : 'email'],
    recipientName: opts.name,
    phone: opts.phone,
    email: opts.email,
    subject: opts.subject,
    message: opts.message,
    documents: [doc],
    related: { kind: owner.kind, id: owner.id, title: `Invoice ${st.statementNumber}` },
    sender: { email: actor.email, name: actor.name, businessEmail: actor.businessEmail },
    emailVia: opts.channel === 'email_gmail' ? 'gmail' : opts.channel === 'email_outlook' ? 'outlook' : 'api',
    linkWindow: opts.linkWindow,
    emailWindow: opts.emailWindow,
    noLinksInBody: opts.channel === 'email_auto',
  });
  if (!result?.ok) throw new Error(result?.error || 'The message could not be sent.');
  const ts = nowIso();
  const sentTo = isWhatsApp ? opts.phone : opts.email;
  for (const inv of statementInvoices(st)) {
    dataService.saveInvoice({ ...inv, sentAt: ts, sentTo, sentByName: actor.name, sentVia: opts.channel, sendError: '', updatedAt: ts }, actor.email);
  }
  const latest = dataService.getStatementById(st.id) || st;
  return dataService.saveStatement({ ...latest, sentAt: ts, sentTo, sentVia: opts.channel, sentByName: actor.name, updatedAt: ts }, actor.email);
}

/** Records a payment on one (individual) approved invoice. */
export async function recordInvoicePayment(inv: Invoice, pay: StatementPayment, actor: Actor): Promise<PaymentReceipt[]> {
  if (isUnpostedInvoice(inv)) throw new Error('Approve the invoice before recording payments on it.');
  return applyPaymentOldestFirst([inv], pay, actor, '', "the invoice's balance");
}
