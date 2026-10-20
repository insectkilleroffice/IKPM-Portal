// Finance, Invoices, Payments, Tax Separation, and Balances

import type { CustomerType } from './customer';

export type TaxJurisdiction =
  | 'sindh_srb'
  | 'punjab_pra'
  | 'islamabad_ict'
  | 'kpk_kpra'
  | 'balochistan_bra';

export type InvoiceStatus =
  | 'draft'
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

export interface Invoice {
  id: string;
  invoiceNumber: string;
  invoiceType: 'standard_service' | 'statutory_sales_tax_invoice';
  jobId?: string;
  contractId?: string;
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
  creditNoteId?: string;
  creditNoteReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentReceipt {
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
