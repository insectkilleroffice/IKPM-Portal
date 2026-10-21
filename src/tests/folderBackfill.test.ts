import { describe, expect, it } from 'vitest';
import { lookupsFrom, planBackfill, reportMarkdown } from '../lib/folderBackfill';

const lookups = lookupsFrom({
  companies: [{ id: 'CO-1', legalCompanyName: 'Paracha Textile Mills' }],
  clients: [{ id: 'CL-1', fullName: 'Ahmed Raza' }],
  leads: [
    { id: 'LD-1', title: 'Urban Edible', companyName: 'Urban Edible', customerType: 'company' },
    { id: 'LD-2', title: 'Dunkin', customerType: 'company', existingCustomerId: 'CO-1' },
  ],
  branches: [{ id: 'BR-1', companyId: 'CO-1', branchName: 'Johar' }],
  proposals: [{ id: 'P-1', customerId: 'CO-1', customerType: 'company', customerName: 'Paracha Textile Mills' }],
  invoices: [{ id: 'INV-1', customerType: 'company' }],
});

const doc = (id: string, owner: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, title: id, category: 'other', owner, file: {}, uploadedAt: '2026-03-04T10:00:00Z', ...extra,
});

describe('planBackfill', () => {
  const report = planBackfill(
    {
      documents: [
        doc('D-lib', { kind: 'library' }, { category: 'msds_chemical' }),
        doc('D-co', { kind: 'company', id: 'CO-1' }, { folder: 'agreements' }),
        doc('D-br', { kind: 'branch', id: 'BR-1' }, { fileCategory: 'layout' }),
        doc('D-lead', { kind: 'lead', id: 'LD-1' }),
        doc('D-lead-won', { kind: 'lead', id: 'LD-2' }),
        doc('D-gone', { kind: 'branch', id: 'BR-404' }),
        doc('D-removed', { kind: 'company', id: 'CO-1' }, { removed: true }),
        doc('D-filed', { kind: 'company', id: 'CO-1' }, { folderPath: '/Clients/X__CO-1/Documents', ownerScope: 'client', clientId: 'CO-1' }),
        doc('D-conflict', { kind: 'company', id: 'CO-1' }, { clientId: 'CO-999' }),
        doc('D-partial', { kind: 'client', id: 'CL-1' }, { fileCategory: 'certificate', clientType: 'individual' }),
      ],
      invoices: [
        { id: 'INV-1', customerId: 'CO-1', customerType: 'company', customerName: 'Paracha', issueDate: '2025-12-30', isPosted: true },
        { id: 'INV-2', customerName: 'No id' },
      ],
      payments: [{ id: 'PAY-1', customerId: 'CO-1', invoiceId: 'INV-1', paymentDate: '2026-01-10' }],
      proposals: [{ id: 'P-2', leadId: 'LD-1', createdAt: '2026-02-01' }],
      service_jobs: [{ id: 'J-1', customerId: 'CO-1', branchId: 'BR-1', scheduledDate: '2026-04-15' }],
      outreach_logs: [
        { id: 'O-1', related: { kind: 'proposal', id: 'P-1' }, sentAt: '2026-02-02' },
        { id: 'O-2', related: { kind: 'proposal', id: 'P-404' }, sentAt: '2026-02-02' },
        { id: 'O-3', related: { kind: 'company', id: 'ad-hoc' }, sentAt: '2026-02-02' },
      ],
      document_packs: [{ id: 'PK-1', name: 'Tender pack' }],
      contracts: [{ id: 'C-1', customerId: 'CO-404', customerName: 'Old Client', startDate: '2025-01-01' }],
    },
    lookups,
    { now: '2026-10-21T00:00:00Z' }
  );
  const change = (c: string, id: string) => report.changes.find((x) => x.collection === c && x.id === id)?.patch;

  it('files company-library documents in the Company (IKPM) area', () => {
    expect(change('documents', 'D-lib')).toEqual({ ownerScope: 'company', fileCategory: 'msds', folderPath: '/Company (IKPM)/MSDS Library' });
  });

  it('derives client, branch and dated folders from existing links', () => {
    expect(change('documents', 'D-co')?.folderPath).toBe('/Clients/Paracha Textile Mills__CO-1/Contracts');
    expect(change('documents', 'D-br')).toMatchObject({ clientId: 'CO-1', branchId: 'BR-1', folderPath: '/Clients/Paracha Textile Mills__CO-1/Branches/Johar__BR-1/Documents' });
    expect(change('invoices', 'INV-1')?.folderPath).toBe('/Clients/Paracha Textile Mills__CO-1/Invoices/2025');
    expect(change('payments', 'PAY-1')).toMatchObject({ clientType: 'company', folderPath: '/Clients/Paracha Textile Mills__CO-1/Payments' });
    expect(change('service_jobs', 'J-1')?.folderPath).toBe('/Clients/Paracha Textile Mills__CO-1/Branches/Johar__BR-1/Service Reports/2026/04');
    expect(change('outreach_logs', 'O-1')).toMatchObject({ clientId: 'CO-1', fileCategory: 'correspondence' });
    expect(change('outreach_logs', 'O-3')).toMatchObject({ ownerScope: 'company' });
    expect(change('document_packs', 'PK-1')).toMatchObject({ ownerScope: 'company' });
  });

  it("keeps a lead's records under the lead until it is a customer, then under the customer", () => {
    expect(change('documents', 'D-lead')).toMatchObject({ clientId: 'LD-1', folderPath: '/Clients/Urban Edible__LD-1/Leads & Inspections' });
    expect(change('proposals', 'P-2')).toMatchObject({ clientId: 'LD-1' });
    expect(change('documents', 'D-lead-won')).toMatchObject({ clientId: 'CO-1' });
  });

  it('reports what it cannot resolve instead of guessing', () => {
    const ids = report.unresolved.map((u) => `${u.collection}/${u.id}`);
    expect(ids).toEqual(expect.arrayContaining(['documents/D-gone', 'invoices/INV-2', 'outreach_logs/O-2']));
    expect(report.unresolved.find((u) => u.id === 'D-gone')?.reason).toMatch(/branch BR-404 not found/);
    expect(change('documents', 'D-gone')).toBeUndefined();
  });

  it('never overwrites existing values; conflicts are reported and left alone', () => {
    expect(change('documents', 'D-conflict')).toBeUndefined();
    expect(report.conflicts).toContainEqual({ collection: 'documents', id: 'D-conflict', field: 'clientId', existing: 'CO-999', computed: 'CO-1' });
    // Only missing fields are written; the existing category decides the subfolder
    expect(change('documents', 'D-partial')).toEqual({ ownerScope: 'client', clientId: 'CL-1', folderPath: '/Clients/Ahmed Raza__CL-1/Documents' });
  });

  it('skips filed and removed records', () => {
    expect(report.summary.documents).toMatchObject({ total: 10, alreadyFiled: 1, skippedRemoved: 1, conflicts: 1, unresolved: 1, toUpdate: 6 });
  });

  it('warns when the client record no longer exists but still files by id', () => {
    expect(change('contracts', 'C-1')?.folderPath).toBe('/Clients/Old Client__CO-404/Contracts');
    expect(report.warnings.some((w) => w.id === 'C-1')).toBe(true);
  });

  it('is idempotent: applying the plan and planning again changes nothing', () => {
    const applied = (list: Record<string, unknown>[], c: string) => list.map((r) => ({ ...r, ...(change(c, r.id as string) ?? {}) })) as { id: string }[];
    const again = planBackfill(
      { documents: applied([doc('D-co', { kind: 'company', id: 'CO-1' }, { folder: 'agreements' })], 'documents'), invoices: applied([{ id: 'INV-1', customerId: 'CO-1', issueDate: '2025-12-30' }], 'invoices') },
      lookups
    );
    expect(again.changes).toEqual([]);
    expect(again.totals.alreadyFiled).toBe(2);
  });

  it('renders a markdown summary', () => {
    const md = reportMarkdown(report);
    expect(md).toContain('| documents | 10 | 1 | 6 | 1 | 1 | 1 |');
    expect(md).toContain('## Unresolved (not changed)');
  });
});
