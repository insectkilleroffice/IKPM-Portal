// Finance, Invoices, Payments, Tax Separation, and Balances

import type { CustomerType } from './customer';
import type { FolderMeta } from './folders';

export type TaxJurisdiction =
  | 'fbr_sales_tax'
  | 'fbr_cash'
  | 'sindh_srb'
  | 'punjab_pra'
  | 'islamabad_ict'
  | 'kpk_kpra'
  | 'balochistan_bra';

/**
 * Invoice life cycle: Finance saves a `draft` → submits it (`pending_approval`) → an admin / super admin
 * reviews, may edit, and approves: the invoice gets its final number, is `posted` and emailed to the client.
 * An admin may instead reject it (`rejected`) back to Finance with a reason; Finance edits and resubmits.
 */
export type InvoiceStatus =
  | 'draft'
  | 'pending_approval'
  | 'rejected'
  | 'posted'
  | 'partially_paid'
  | 'paid'
  | 'void_reversed';

export interface InvoiceLineItem {
  id: string;
  description: string;
  serviceCategory: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRatePercent: number;
  taxAmount: number;
  totalWithTax: number;
  /** Service visit this line bills (monthly contract invoices have one line per visit). */
  jobId?: string;
}

export interface CustomerWithholdingTax {
  isApplicable: boolean;
  ratePercent: number;
  amountDeducted: number;
  certificateNumber?: string;
  certificateDate?: string;
  sectionCode: string;
  notes?: string;
}

/**
 * Which of the company's two accounts bills the work:
 * 'tax'  = Sales Tax Invoice (our NTN / STRN, provincial sales tax, tax bank account), mostly corporate;
 * 'cash' = Cash Memo (no tax lines, cash / second bank account), mostly residential.
 * Older invoices have no value and count as 'tax'.
 */
export type BillingAccount = 'tax' | 'cash';

/** Draft-stage invoices: not final, no invoice number yet, not sent, cannot take payments. */
export const isUnpostedInvoice = (inv: Pick<Invoice, 'status' | 'isPosted'>) =>
  !inv.isPosted && ['draft', 'pending_approval', 'rejected'].includes(inv.status);

export const billingAccountOf =(inv: Pick<Invoice, 'billingAccount' | 'invoiceType'>): BillingAccount =>
  inv.billingAccount || (inv.invoiceType === 'cash_memo' ? 'cash' : 'tax');

export interface Invoice extends FolderMeta {
  id: string;
  invoiceNumber: string;
  invoiceType: 'standard_service' | 'statutory_sales_tax_invoice' | 'cash_memo';
  billingAccount?: BillingAccount;
  jobId?: string;
  /** All visits billed by this invoice (monthly contract invoices bill several). */
  jobIds?: string[];
  contractId?: string;
  /** Billing period of a monthly contract invoice (YYYY-MM-DD). */
  periodStart?: string;
  periodEnd?: string;
  /** How a monthly invoice was worked out: visits done in the month, or the full month's charge. */
  billingBasis?: 'visits_done' | 'full_month';
  /** Final invoice of a cancelled contract (created by the super admin only). */
  isSettlement?: boolean;
  /** Client's purchase order / vendor number (from the contract). */
  poNumber?: string;
  /** Amount owed from before the portal (Add old client). No tax; own number series OB-YYYY-NNNN. */
  isOpeningBalance?: boolean;
  /** Set on records created by Customers → Add old client. */
  importBatchId?: string;
  /** The invoice PDF in the client's folder, reused for every send. */
  pdfDocumentId?: string;
  /** Job invoice that is approved and sent with a client statement (not on its own). */
  statementId?: string;
  /** How it was last sent: automatic email, WhatsApp, Gmail or Outlook. */
  sentVia?: 'email_auto' | 'whatsapp' | 'email_gmail' | 'email_outlook';
  customerType: CustomerType;
  customerId: string;
  customerName: string;
  customerNtn?: string;
  customerStrn?: string;
  branchId?: string;
  branchName?: string;
  billingAddress: string;
  issueDate: string;
  dueDate: string;
  jurisdiction: TaxJurisdiction;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxTotal: number;
  grossPayable: number;
  amountPaid: number;
  customerWhtTotal: number;
  balanceDue: number;
  status: InvoiceStatus;
  isPosted: boolean;
  postedAt?: string;
  postedBy?: string;
  isApproved?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  // ---- Approval workflow (drafts only)
  submittedBy?: string;
  submittedByName?: string;
  submittedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  /** What the approver changed before approving, e.g. "Amount 50,000 → 45,000". */
  approverChanges?: string;
  // ---- Delivery: invoices only leave the portal by being emailed to the client
  sentAt?: string;
  sentTo?: string;
  sentByName?: string;
  sendError?: string;
  receivingPhotoUrl?: string;
  receivedAt?: string;
  receivedByName?: string;
  isDelivered?: boolean;
  /** Credit note number issued when the invoice was voided, e.g. IKPM-CN-2026-0001. */
  creditNoteId?: string;
  creditNoteDate?: string;
  creditNoteBy?: string;
  creditNoteReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentReceipt extends FolderMeta {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  branchId?: string;
  paymentDate: string;
  paymentMode: 'bank_transfer' | 'cross_cheque' | 'pay_order' | 'online_portal' | 'cash';
  bankReferenceNo?: string;
  bankName?: string;
  chequeNumber?: string;
  chequeClearanceDate?: string;
  cashAmountReceived: number;
  customerWhtDeducted: CustomerWithholdingTax;
  totalCreditApplied: number;
  recordedBy: string;
  recordedByName: string;
  isReversed?: boolean;
  reversalReason?: string;
  paymentEvidenceUrl?: string;
  createdAt: string;
}

export interface SupplierWithholdingTax {
  isApplicable: boolean;
  ratePercent: number;
  amountDeducted: number;
  fbrChallanNumber?: string;
  challanDepositDate?: string;
  isDepositedToTreasury: boolean;
  sectionCode: string;
}

export interface SupplierBill {
  id: string;
  supplierName: string;
  supplierNtn?: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  category: 'chemicals' | 'safety_gear' | 'equipment' | 'fuel' | 'office' | 'subcontractor';
  grossAmount: number;
  salesTaxAmount: number;
  supplierWhtPayable: SupplierWithholdingTax;
  netAmountPayable: number;
  amountPaid: number;
  status: 'unpaid' | 'partially_paid' | 'paid' | 'cancelled';
  createdAt: string;
}

export interface TaxRuleConfig {
  id: string;
  jurisdiction: TaxJurisdiction;
  jurisdictionTitle: string;
  serviceType: string;
  standardSalesTaxPercent: number;
  reducedRatePercent?: number;
  whtActiveFilerPercent: number;
  whtNonFilerPercent: number;
  officialLegalReference: string;
  effectiveDate: string;
  verifiedByAccountant: boolean;
  reviewedDate?: string;
  reviewedByName?: string;
  isCurrent: boolean;
}

export interface ClientLedgerEntry {
  id: string;
  date: string;
  transactionType: 'invoice' | 'payment_cash' | 'wht_certificate' | 'credit_note' | 'opening_balance';
  referenceId: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

/** Every job an invoice bills (single-job invoices and monthly multi-job invoices). */
export const jobIdsOf = (inv: Pick<Invoice, 'jobId' | 'jobIds' | 'lineItems'>): string[] =>
  Array.from(new Set([inv.jobId, ...(inv.jobIds ?? []), ...(inv.lineItems ?? []).map((l) => l.jobId)].filter(Boolean) as string[]));

// ---------- Client statements: one per contract billing period ----------

/**
 * A client statement groups the job invoices of one contract billing period (15 days, 30 days,
 * monthly, quarterly… as set on the contract). It is what the admin approves and what is sent to
 * the client; approving it finalises its job invoices. A payment recorded on it settles them,
 * oldest first. Sales tax is on the job invoices; the statement is their summary.
 */
export type StatementStatus = 'draft' | 'pending_approval' | 'rejected' | 'approved' | 'cancelled';

export interface ClientStatement {
  id: string;
  /** DRAFT-… until approved, then IKPM-ST-2026-0001. */
  statementNumber: string;
  /** Set when every job on it is under one contract. */
  contractId?: string;
  customerType: CustomerType;
  customerId: string;
  customerName: string;
  branchId?: string;
  branchName?: string;
  billingAddress: string;
  periodStart: string;
  periodEnd: string;
  billingCycleDays?: number;
  /** Client's purchase order / vendor number (from the contract). */
  poNumber?: string;
  /** Job invoices on this statement. */
  invoiceIds: string[];
  subtotal: number;
  taxTotal: number;
  /** Total of this period's job invoices. */
  periodTotal: number;
  /** Earlier approved invoices of the client still unpaid when the statement was made. */
  previousInvoiceIds: string[];
  previousBalance: number;
  issueDate: string;
  dueDate: string;
  status: StatementStatus;
  submittedBy?: string;
  submittedByName?: string;
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  sentAt?: string;
  sentTo?: string;
  sentVia?: 'email_auto' | 'whatsapp' | 'email_gmail' | 'email_outlook';
  sentByName?: string;
  pdfDocumentId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
