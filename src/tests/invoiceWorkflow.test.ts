// Invoice approval workflow: totals, validation, approver change log and job next-action.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/dataService', () => ({ dataService: {} }));
vi.mock('../lib/pdfGenerator', () => ({ pdfGenerator: {} }));
vi.mock('../features/documents/fileGenerated', () => ({ fileGenerated: vi.fn() }));
vi.mock('../services/outreachService', () => ({ sendOutreach: vi.fn(), isValidEmail: (e?: string) => Boolean(e && e.includes('@')) }));

const { recalcInvoice, invoiceProblems, describeChanges } = await import('../features/invoices/invoiceWorkflow');
import { isUnpostedInvoice, type Invoice, type InvoiceLineItem } from '../types/finance';
import { getJobNextAction } from '../lib/workflow';
import type { ServiceJob } from '../types/operations';

const line = (p: Partial<InvoiceLineItem> = {}): InvoiceLineItem => ({
  id: `li_${Math.random()}`, description: 'Monthly IPM service', serviceCategory: 'Pest control',
  quantity: 1, unitPrice: 10000, amount: 0, taxRatePercent: 15, taxAmount: 0, totalWithTax: 0, ...p,
});

const draft = (p: Partial<Invoice> = {}): Invoice => ({
  id: 'INV-1', invoiceNumber: 'DRAFT-INV-1', invoiceType: 'statutory_sales_tax_invoice', billingAccount: 'tax',
  customerType: 'company', customerId: 'CO-1', customerName: 'Acme', billingAddress: 'Karachi',
  issueDate: '2026-11-01', dueDate: '2026-11-30', jurisdiction: 'sindh_srb', lineItems: [line()],
  subtotal: 0, taxTotal: 0, grossPayable: 0, amountPaid: 0, customerWhtTotal: 0, balanceDue: 0,
  status: 'pending_approval', isPosted: false, createdAt: '', updatedAt: '', ...p,
});

describe('invoice approval workflow', () => {
  it('recalculates lines and totals', () => {
    const inv = recalcInvoice(draft({ lineItems: [line(), line({ quantity: 2, unitPrice: 2500, taxRatePercent: 0 })] }));
    expect(inv.subtotal).toBe(15000);
    expect(inv.taxTotal).toBe(1500);
    expect(inv.grossPayable).toBe(16500);
    expect(inv.balanceDue).toBe(16500);
  });

  it('cash memos never carry tax', () => {
    const inv = recalcInvoice(draft({ billingAccount: 'cash', invoiceType: 'cash_memo' }));
    expect(inv.taxTotal).toBe(0);
    expect(inv.grossPayable).toBe(10000);
  });

  it('blocks empty lines, zero totals and a due date before the issue date', () => {
    expect(invoiceProblems(recalcInvoice(draft()))).toEqual([]);
    expect(invoiceProblems(recalcInvoice(draft({ lineItems: [line({ unitPrice: 0 })] }))).length).toBeGreaterThan(0);
    expect(invoiceProblems(recalcInvoice(draft({ dueDate: '2026-10-01' })))).toContain('The due date cannot be before the issue date.');
  });

  it('records what the approver changed', () => {
    const before = recalcInvoice(draft());
    const after = recalcInvoice(before, [line({ unitPrice: 9000 })]);
    const changes = describeChanges(before, after);
    expect(changes).toMatch(/Lines edited/);
    expect(changes).toMatch(/Total/);
    expect(describeChanges(before, before)).toBe('');
  });

  it('drafts are not final; posted invoices are', () => {
    expect(isUnpostedInvoice({ status: 'pending_approval', isPosted: false })).toBe(true);
    expect(isUnpostedInvoice({ status: 'rejected', isPosted: false })).toBe(true);
    expect(isUnpostedInvoice({ status: 'posted', isPosted: true })).toBe(false);
  });

  it('a job whose invoice waits for approval cannot take a payment yet', () => {
    const job = { status: 'completed', supervisorVerification: { isVerified: true } } as unknown as ServiceJob;
    const next = getJobNextAction(job, recalcInvoice(draft()));
    expect(next.isBlocked).toBe(true);
    expect(next.label).toBe('Invoice awaiting approval');
  });
});
