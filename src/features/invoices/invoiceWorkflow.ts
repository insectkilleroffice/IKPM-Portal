// Invoice approval workflow: Finance drafts → admin / super admin approves (may edit first) →
// the invoice gets its final number, is posted, and is emailed straight to the client.
// Invoices never leave the portal any other way: no copy is downloaded to anyone's computer.

import { dataService } from '../../services/dataService';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { fileGenerated } from '../documents/fileGenerated';
import { sendOutreach, isValidEmail } from '../../services/outreachService';
import { integrations, outreachEnv } from '../../config/env';
import { formatDate, formatPKR, generatePermanentId } from '../../lib/formatters';
import { billingAccountOf, isUnpostedInvoice, jobIdsOf, type Invoice, type InvoiceLineItem } from '../../types/finance';
import type { DocumentOwner, PortalDocument } from '../../types/document';

export interface Actor {
  uid: string;
  email: string;
  name: string;
  /** Address the client sees the email from. */
  businessEmail: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Recomputes every line and the totals. Cash memos carry no tax. */
export function recalcInvoice(inv: Invoice, lineItems: InvoiceLineItem[] = inv.lineItems): Invoice {
  const isCash = billingAccountOf(inv) === 'cash';
  const lines = lineItems.map((li) => {
    const quantity = Number(li.quantity) || 0;
    const unitPrice = Number(li.unitPrice) || 0;
    const amount = round2(quantity * unitPrice);
    const taxRatePercent = isCash ? 0 : Number(li.taxRatePercent) || 0;
    const taxAmount = round2((amount * taxRatePercent) / 100);
    return { ...li, quantity, unitPrice, amount, taxRatePercent, taxAmount, totalWithTax: round2(amount + taxAmount) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  const grossPayable = round2(subtotal + taxTotal);
  return {
    ...inv,
    lineItems: lines,
    subtotal,
    taxTotal,
    grossPayable,
    balanceDue: round2(grossPayable - (inv.amountPaid || 0) - (inv.customerWhtTotal || 0)),
  };
}

/** Problems that stop a draft being submitted or approved. */
export function invoiceProblems(inv: Invoice): string[] {
  return [
    !inv.lineItems.length && 'Add at least one line.',
    inv.lineItems.some((l) => !l.description.trim()) && 'Every line needs a description.',
    inv.lineItems.some((l) => !(l.quantity > 0) || !(l.unitPrice > 0)) && 'Every line needs a quantity and a rate above 0.',
    inv.lineItems.some((l) => l.taxRatePercent < 0 || l.taxRatePercent > 100) && 'Tax rate must be between 0 and 100%.',
    !(inv.grossPayable > 0) && 'The invoice total must be more than 0.',
    inv.dueDate < inv.issueDate && 'The due date cannot be before the issue date.',
  ].filter(Boolean) as string[];
}

/** Plain-language list of what the approver changed, kept on the invoice and in the audit log. */
export function describeChanges(before: Invoice, after: Invoice): string {
  const out: string[] = [];
  if (before.issueDate !== after.issueDate) out.push(`Issue date ${formatDate(before.issueDate)} → ${formatDate(after.issueDate)}`);
  if (before.dueDate !== after.dueDate) out.push(`Due date ${formatDate(before.dueDate)} → ${formatDate(after.dueDate)}`);
  const lineKey = (l: InvoiceLineItem) => `${l.description}|${l.quantity}|${l.unitPrice}|${l.taxRatePercent}`;
  if (before.lineItems.map(lineKey).join('§') !== after.lineItems.map(lineKey).join('§')) {
    out.push(`Lines edited (${before.lineItems.length} → ${after.lineItems.length})`);
  }
  if (before.grossPayable !== after.grossPayable) out.push(`Total ${formatPKR(before.grossPayable)} → ${formatPKR(after.grossPayable)}`);
  if ((before.notes || '') !== (after.notes || '')) out.push('Notes edited');
  return out.join('; ');
}

/** Safe counter per account and year: IKPM-TX-2026-0001 (tax) / IKPM-CM-2026-0001 (cash memo). */
export async function nextInvoiceNumber(inv: Invoice): Promise<string> {
  const series = billingAccountOf(inv) === 'cash' ? 'CM' : 'TX';
  const year = new Date().getFullYear();
  const prefix = `IKPM-${series}-${year}-`;
  const seq = await dataService.nextSequence(`invoice_${series.toLowerCase()}_${year}`,
    dataService.maxSeqOf(dataService.getAllInvoices().filter((i) => i.invoiceNumber.startsWith(prefix)).map((i) => i.invoiceNumber)));
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export const draftNumber = (id: string) => `DRAFT-${id}`;

export const invoiceOwner = (inv: Invoice): DocumentOwner =>
  inv.branchId
    ? { kind: 'branch', id: inv.branchId }
    : inv.customerType === 'company'
      ? { kind: 'company', id: inv.customerId }
      : { kind: 'client', id: inv.customerId };

/** Billing contact: branch email, else company primary contact, else the individual client. */
export function invoiceRecipient(inv: Invoice): { name: string; email?: string; phone?: string } {
  if (inv.customerType === 'company') {
    const br = inv.branchId ? dataService.getBranchById(inv.branchId) : undefined;
    const co = dataService.getCompanyById(inv.customerId);
    if (br && isValidEmail(br.branchEmail)) {
      return { name: br.branchManagerName || inv.customerName, email: br.branchEmail, phone: br.branchManagerPhone || br.branchPhone };
    }
    return { name: co?.primaryContact.fullName || inv.customerName, email: co?.primaryContact.email, phone: co?.primaryContact.mobile };
  }
  const cl = dataService.getClientById(inv.customerId);
  return { name: cl?.fullName || inv.customerName, email: cl?.email, phone: cl?.primaryPhone };
}

/**
 * How an approved invoice can reach the client. Nothing is downloaded to anyone's computer:
 * - 'email_auto': emailed from the server with the PDF attached (needs the outreach server)
 * - 'whatsapp' / 'email_gmail' / 'email_outlook': a message opens with a link to the invoice PDF
 *   (stored in the client's folder), and the staff member presses Send.
 */
export type InvoiceSendChannel = 'email_auto' | 'whatsapp' | 'email_gmail' | 'email_outlook';

export const SEND_CHANNEL_LABELS: Record<InvoiceSendChannel, string> = {
  email_auto: 'Email automatically from the portal (PDF attached)',
  whatsapp: 'WhatsApp (message with the invoice link)',
  email_gmail: 'Gmail / Google Workspace (email with the invoice link)',
  email_outlook: 'Outlook / Microsoft 365 (email with the invoice link)',
};

/** Why a channel can't be used right now (undefined = it can). */
export function channelBlocker(channel: InvoiceSendChannel): string | undefined {
  if (!integrations.cloudinary) return 'File storage (Cloudinary) is not configured, so there is no invoice PDF to send.';
  if (channel === 'email_auto' && !integrations.outreachApi) return 'Automatic email is not set up on the server (VITE_OUTREACH_API_URL).';
  return undefined;
}

/** Why an approved invoice can't be sent at all (undefined = at least one way works). */
export function sendBlocker(_inv?: Invoice): string | undefined {
  return integrations.cloudinary ? undefined : 'File storage (Cloudinary) is not configured, so the invoice PDF cannot be sent. Set it up, or ask the super admin.';
}

/** The invoice PDF in the client's Invoices folder (made once, reused for every send). */
export async function invoiceFile(inv: Invoice, actor: Actor): Promise<PortalDocument> {
  const existing = inv.pdfDocumentId ? dataService.getDocumentById(inv.pdfDocumentId) : undefined;
  if (existing && existing.file.storage === 'cloudinary') return existing;
  const isCash = billingAccountOf(inv) === 'cash';
  const blob = await pdfGenerator.invoicePDFBlob(inv);
  const doc = await fileGenerated(blob, {
    owner: invoiceOwner(inv),
    category: 'invoice',
    title: `${isCash ? 'Cash Memo' : 'Sales Tax Invoice'} - ${inv.invoiceNumber}`,
    fileName: `Invoice_${inv.invoiceNumber}.pdf`,
    subPath: inv.id,
    user: { email: actor.email, displayName: actor.name },
    noLocalDownload: true,
  });
  if (!doc || doc.file.storage !== 'cloudinary') throw new Error('The invoice PDF could not be uploaded to file storage, so it was not sent.');
  dataService.saveInvoice({ ...(dataService.getInvoiceById(inv.id) || inv), pdfDocumentId: doc.id, updatedAt: new Date().toISOString() }, actor.email);
  return doc;
}

/** Default subject and message for an invoice. */
export function invoiceMessage(inv: Invoice, recipientName: string, actor: Actor): { subject: string; message: string } {
  const isCash = billingAccountOf(inv) === 'cash';
  const first = recipientName.split(' ')[0] || 'Sir/Madam';
  if (inv.status === 'void_reversed') {
    const cn = inv.creditNoteId || 'Credit note';
    return {
      subject: `${outreachEnv.companyName} — ${cn} (reverses ${isCash ? 'cash memo' : 'invoice'} ${inv.invoiceNumber})`,
      message: [
        `Dear ${first},`,
        '',
        `Please find credit note ${cn}, which cancels ${isCash ? 'cash memo' : 'invoice'} ${inv.invoiceNumber} for ${formatPKR(inv.grossPayable)} in full.`,
        ...(inv.creditNoteReason ? [`Reason: ${inv.creditNoteReason}`] : []),
        '',
        'Regards,',
        actor.name,
        outreachEnv.companyName,
      ].join('\n'),
    };
  }
  return {
    subject: `${outreachEnv.companyName} — ${isCash ? 'Cash Memo' : 'Invoice'} ${inv.invoiceNumber}`,
    message: [
      `Dear ${first},`,
      '',
      `Please find ${isCash ? 'cash memo' : 'invoice'} ${inv.invoiceNumber} for ${formatPKR(inv.grossPayable)}, due by ${formatDate(inv.dueDate)}.`,
      ...(inv.periodStart ? [`Billing period: ${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd || inv.periodStart)}.`] : []),
      '',
      'For any query about this invoice, simply reply to this message.',
      '',
      'Regards,',
      actor.name,
      outreachEnv.companyName,
      [actor.businessEmail, outreachEnv.companyPhone, outreachEnv.companyWebsite].filter(Boolean).join(' | '),
    ].join('\n'),
  };
}

/**
 * Sends an approved invoice to the client on the chosen channel and records it on the invoice.
 * For WhatsApp / Gmail / Outlook, `linkWindow` / `emailWindow` must be opened by the click handler.
 */
export async function sendInvoiceToClient(inv: Invoice, actor: Actor, opts: {
  channel: InvoiceSendChannel;
  name: string;
  email?: string;
  phone?: string;
  subject: string;
  message: string;
  linkWindow?: Window | null;
  emailWindow?: Window | null;
}): Promise<Invoice> {
  if (isUnpostedInvoice(inv)) throw new Error('Only an approved invoice can be sent to the client.');
  const blocker = channelBlocker(opts.channel);
  if (blocker) throw new Error(blocker);
  const isWhatsApp = opts.channel === 'whatsapp';
  if (isWhatsApp && !opts.phone?.trim()) throw new Error('Enter the client\'s WhatsApp number.');
  if (!isWhatsApp && !isValidEmail(opts.email)) throw new Error('Enter a valid client email address.');

  const doc = await invoiceFile(inv, actor);
  const owner = inv.branchId
    ? { kind: 'branch' as const, id: inv.branchId }
    : { kind: inv.customerType === 'company' ? ('company' as const) : ('client' as const), id: inv.customerId };
  const [result] = await sendOutreach({
    channels: [isWhatsApp ? 'whatsapp' : 'email'],
    recipientName: opts.name,
    phone: opts.phone,
    email: opts.email,
    subject: opts.subject,
    message: opts.message,
    documents: [doc],
    related: { kind: owner.kind, id: owner.id, title: `Invoice ${inv.invoiceNumber}` },
    sender: { email: actor.email, name: actor.name, businessEmail: actor.businessEmail },
    emailVia: opts.channel === 'email_gmail' ? 'gmail' : opts.channel === 'email_outlook' ? 'outlook' : 'api',
    linkWindow: opts.linkWindow,
    emailWindow: opts.emailWindow,
    // Automatic email attaches the PDF; the other channels carry its link in the message
    noLinksInBody: opts.channel === 'email_auto',
  });
  if (!result?.ok) throw new Error(result?.error || 'The message could not be sent.');

  const latest = dataService.getInvoiceById(inv.id) || inv;
  const sent: Invoice = {
    ...latest,
    sentAt: new Date().toISOString(),
    sentTo: isWhatsApp ? opts.phone : opts.email,
    sentByName: actor.name,
    sentVia: opts.channel,
    sendError: '', // empty, not undefined: undefined fields are skipped on save, so an old error would stay
    updatedAt: new Date().toISOString(),
  };
  dataService.saveInvoice(sent, actor.email);
  return sent;
}

/** Cash the Supervisor already collected on site (for each visit on the invoice) is recorded once it is approved. */
export async function recordCollectedCash(inv: Invoice, actor: Actor): Promise<string | undefined> {
  const notes: string[] = [];
  for (const jobId of jobIdsOf(inv)) {
    const job = dataService.getJobById(jobId);
    const collected = job && job.customerType !== 'company' ? job.cashCollection : undefined;
    const current = dataService.getInvoiceById(inv.id) || inv;
    if (!collected?.amount || current.balanceDue <= 0) continue;
    const seq = await dataService.nextSequence('receipt', dataService.maxSeqOf(dataService.getPayments().map((r) => r.id)));
    const rid = generatePermanentId('REC', seq);
    const paid = Math.min(collected.amount, current.balanceDue);
    dataService.recordPayment({
      id: rid,
      receiptNumber: rid,
      invoiceId: inv.id,
      invoiceNumber: current.invoiceNumber,
      customerId: inv.customerId,
      customerName: inv.customerName,
      branchId: inv.branchId,
      paymentDate: collected.collectedAt.slice(0, 10),
      paymentMode: 'cash',
      bankReferenceNo: `Collected on site by ${collected.collectedByName || 'Supervisor'} (job ${jobId})`,
      cashAmountReceived: paid,
      customerWhtDeducted: { isApplicable: false, ratePercent: 0, amountDeducted: 0, sectionCode: '' },
      totalCreditApplied: paid,
      recordedBy: actor.email,
      recordedByName: actor.name,
      paymentEvidenceUrl: collected.receiptPhotoUrl,
      createdAt: new Date().toISOString(),
    }, actor.email);
    notes.push(`cash ${formatPKR(paid)} received from ${collected.collectedByName || 'the Supervisor'} (job ${jobId}) recorded`);
  }
  return notes.length ? notes.join('; ') : undefined;
}

export interface ApproveResult {
  invoice: Invoice;
  cashNote?: string;
  cashError?: string;
}

/**
 * Approves a draft (with the approver's edits already applied to `edited`): assigns the final
 * number, posts it and records any cash already collected on site. Sending it to the client is a
 * separate step afterwards (Send to client).
 */
export async function approveInvoice(original: Invoice, edited: Invoice, actor: Actor): Promise<ApproveResult> {
  const ready = recalcInvoice(edited);
  const problems = invoiceProblems(ready);
  if (problems.length) throw new Error(problems.join(' '));
  const ts = new Date().toISOString();
  const changes = describeChanges(original, ready);
  const posted: Invoice = {
    ...ready,
    invoiceNumber: await nextInvoiceNumber(ready),
    status: 'posted',
    isPosted: true,
    postedAt: ts,
    postedBy: original.submittedByName || actor.name,
    isApproved: true,
    approvedBy: actor.name,
    approvedAt: ts,
    approverChanges: changes || '',
    updatedAt: ts,
  };
  dataService.saveInvoice(posted, actor.email);

  let cashNote: string | undefined;
  let cashError: string | undefined;
  try {
    cashNote = await recordCollectedCash(posted, actor);
  } catch (err) {
    cashError = err instanceof Error ? err.message : String(err);
  }
  const invoice = dataService.getInvoiceById(posted.id) || posted;
  return { invoice, cashNote, cashError };
}
