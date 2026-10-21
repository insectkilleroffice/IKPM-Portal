// Records are filed into folders on create, and a lead's files follow it to the customer account.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(() => ({})),
  where: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  setDoc: vi.fn(() => Promise.resolve()),
  writeBatch: vi.fn(() => ({ set: vi.fn(), update: vi.fn(), commit: vi.fn(() => Promise.resolve()) })),
}));
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/cloudinary', () => ({ deleteFromCloudinary: vi.fn(() => Promise.resolve()) }));

const { dataService } = await import('../services/dataService');
import type { Lead } from '../types/crm';
import type { OutreachLog, PortalDocument } from '../types/document';
import type { Invoice } from '../types/finance';

const EMAIL = 'tester@ikpm.pk';
let n = 0;
const newLead = (): Lead =>
  dataService.createLead({
    title: `Folder Lead ${++n}`,
    companyName: `Folder Lead ${n}`,
    customerType: 'company',
    source: 'referral',
    city: 'Karachi',
    area: 'Saddar',
    propertyAddress: 'Plot 2',
    contacts: [{ id: 'c1', name: 'Sara', phone: `0321${String(2000000 + n)}`, isPrimary: true }],
    contactName: '',
    phone: '',
    pestIssues: [],
    stage: 'new',
  } as unknown as Lead, EMAIL);

const doc = (owner: PortalDocument['owner'], extra: Partial<PortalDocument> = {}): PortalDocument => ({
  id: `DOC-${Math.random().toString(36).slice(2)}`,
  title: 'File',
  category: 'other',
  owner,
  file: { url: 'https://x', fileName: 'a.pdf', fileSize: 1, fileType: 'application/pdf', storage: 'cloudinary' },
  uploadedBy: EMAIL,
  uploadedByName: 'Tester',
  uploadedAt: '2026-04-10T10:00:00Z',
  ...extra,
});

beforeEach(() => {
  dataService.setSession(null);
  dataService.setSession({ uid: 'u1', email: EMAIL, name: 'Tester', role: 'super_admin', dataScope: 'company' });
});

describe('auto-filing', () => {
  it('files library documents in the Company (IKPM) area', () => {
    const d = dataService.saveDocument(doc({ kind: 'library' }, { category: 'msds_chemical' }), EMAIL);
    expect(d).toMatchObject({ ownerScope: 'company', fileCategory: 'msds', folderPath: '/Company (IKPM)/MSDS Library' });
    expect(d.clientId).toBeUndefined();
  });

  it("files a lead's documents and outreach under the lead until it becomes a customer", () => {
    const lead = newLead();
    const d = dataService.saveDocument(doc({ kind: 'lead', id: lead.id }, { fileCategory: 'risk_assessment' }), EMAIL);
    expect(d).toMatchObject({ ownerScope: 'client', clientId: lead.id, folderPath: `/Clients/${lead.companyName}__${lead.id}/Leads & Inspections` });

    const log = {
      id: `OUT-${n}`, channel: 'whatsapp', mode: 'link', status: 'opened', recipientName: 'Sara', recipient: '0321', message: 'hi',
      documentIds: [], attachmentUrls: [], related: { kind: 'lead', id: lead.id, title: lead.title }, sentBy: EMAIL, sentByName: 'Tester', sentAt: '2026-04-10',
    } as OutreachLog;
    dataService.logOutreach(log);
    expect(log).toMatchObject({ ownerScope: 'client', clientId: lead.id, fileCategory: 'correspondence' });

    // Becoming a customer moves both, without changing the files themselves
    const { customerId } = dataService.ensureLeadCustomer(lead.id, EMAIL);
    const movedDoc = dataService.getDocumentById(d.id)!;
    expect(movedDoc.clientId).toBe(customerId);
    expect(movedDoc.folderPath).toBe(`/Clients/${lead.companyName}__${customerId}/Leads & Inspections`);
    expect(movedDoc.file.url).toBe('https://x');
    expect(dataService.getOutreachLogs({ kind: 'lead', id: lead.id })[0].clientId).toBe(customerId);
    expect(dataService.getAuditLogs('document', lead.id).some((a) => a.details.includes(`to client ${customerId}`))).toBe(true);

    // New files for the lead now go straight to the customer's folders
    const later = dataService.saveDocument(doc({ kind: 'lead', id: lead.id }, { fileCategory: 'sop' }), EMAIL);
    expect(later.folderPath).toBe(`/Clients/${lead.companyName}__${customerId}/Documents`);
  });

  it('files invoices by year and keeps folder fields on later edits', () => {
    const company = dataService.getCompanies()[0] ?? (() => {
      const l = newLead();
      const { customerId } = dataService.ensureLeadCustomer(l.id, EMAIL);
      return dataService.getCompanyById(customerId)!;
    })();
    const inv = {
      id: `INV-T-${n}`, invoiceNumber: `INV-T-${n}`, invoiceType: 'standard_service', customerType: 'company', customerId: company.id, customerName: company.legalCompanyName,
      billingAddress: '', issueDate: '2026-07-01', dueDate: '2026-07-16', jurisdiction: 'sindh_srb', lineItems: [], subtotal: 0, taxTotal: 0, grossPayable: 0, amountPaid: 0,
      customerWhtTotal: 0, balanceDue: 0, status: 'draft', isPosted: false, createdAt: '2026-07-01', updatedAt: '2026-07-01',
    } as unknown as Invoice;
    dataService.saveInvoice(inv, EMAIL);
    const saved = dataService.getInvoiceById(inv.id)!;
    expect(saved.folderPath).toMatch(/\/Clients\/.+__.+\/Invoices\/2026$/);
    expect(saved.fileCategory).toBe('invoice');

    // An edit made from an object without folder fields keeps them
    const { folderPath, ownerScope, clientId, fileCategory, ...withoutFolder } = saved;
    void folderPath; void ownerScope; void clientId; void fileCategory;
    dataService.saveInvoice({ ...(withoutFolder as Invoice), notes: 'edited' }, EMAIL);
    expect(dataService.getInvoiceById(inv.id)!.folderPath).toBe(saved.folderPath);
  });

  it('moveDocument changes the subfolder but never the client', () => {
    const a = newLead();
    const b = newLead();
    const { customerId: ca } = dataService.ensureLeadCustomer(a.id, EMAIL);
    const { customerId: cb } = dataService.ensureLeadCustomer(b.id, EMAIL);
    const d = dataService.saveDocument(doc({ kind: 'company', id: ca }), EMAIL);
    expect(d.folderPath).toMatch(/\/Documents$/);

    const moved = dataService.moveDocument(d.id, { fileCategory: 'contract' }, EMAIL);
    expect(moved.folderPath).toMatch(/\/Contracts$/);
    expect(dataService.getAuditLogs('document', d.id).some((x) => x.details.startsWith('Moved'))).toBe(true);

    expect(() => dataService.moveDocument(d.id, { owner: { kind: 'company', id: cb } }, EMAIL)).toThrow(/another client/);
    expect(() => dataService.moveDocument(d.id, { owner: { kind: 'library' } }, EMAIL)).toThrow(/Company \(IKPM\)/);
  });

  it('uploadScopeFor matches the record folder', () => {
    expect(dataService.uploadScopeFor({ kind: 'library' }, 'sop')).toEqual({ ownerScope: 'company', clientId: undefined, category: 'sop' });
    const l = newLead();
    expect(dataService.uploadScopeFor({ kind: 'lead', id: l.id }, 'risk_assessment')).toEqual({ ownerScope: 'client', clientId: l.id, category: 'risk_assessment' });
  });
});
