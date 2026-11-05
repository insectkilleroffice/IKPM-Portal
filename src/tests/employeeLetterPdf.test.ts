// Employee letters build as real PDFs for every kind, including letters issued before clause wording
// was saved on the letter. Particulars print as paragraphs; service areas print in the footer, and an uploaded background on every page.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmployeeLetter, EmployeeLetterKind } from '../types/hr';

vi.mock('../services/dataService', () => ({
  dataService: {
    getEmployeeById: () => ({ id: 'EMP-0007', phone: '03001234567' }),
    getEmployeePrivate: () => ({ id: 'EMP-0007', cnic: '42101-1234567-1', fatherName: 'Raza Ali', residentialAddress: 'Gulshan-e-Iqbal, Karachi' }),
  },
}));
vi.mock('../services/companyProfile', () => ({
  DEFAULT_BRAND_COLOR: '#0A0A0A',
  DEFAULT_ACCENT_COLOR: '#C8102E',
  companyProfile: { get: () => ({ legalName: 'Test Pest Management', shortName: 'TPM', tagline: 'Pest control', address: 'Karachi', serviceAreas: ['Faisalabad Hub', ' Lahore ', ''] }) },
}));
const tableHeads = vi.hoisted(() => [] as string[][]);
vi.mock('jspdf-autotable', async (original) => {
  const actual = await original<typeof import('jspdf-autotable')>();
  return {
    ...actual,
    autoTable: (doc: Parameters<typeof actual.autoTable>[0], options: Parameters<typeof actual.autoTable>[1]) => {
      tableHeads.push((options.head?.[0] ?? []) as string[]);
      return actual.autoTable(doc, options);
    },
  };
});
vi.mock('../services/documentTemplates', () => ({ documentTemplates: {} }));
vi.mock('../lib/firebase', () => ({ auth: {}, db: {}, storage: {} }));

const { pdfGenerator, pdfKit } = await import('../lib/pdfGenerator');
const { letterClauseSections } = await import('../features/hr/employmentTerms');
const { companyProfile } = await import('../services/companyProfile');

const terms = {
  designation: 'Entomologist', department: 'Quality Assurance', reportingTo: 'CEO', joiningDate: '2026-11-01',
  probationMonths: 2, probationEndDate: '2027-01-01', basicSalary: 60000,
  allowances: [{ label: 'Mobile package', amount: 2000 }], grossSalary: 62000,
  workingHours: '9:00 am to 6:00 pm, Monday to Saturday', noticeDaysProbation: 7, noticeDaysPermanent: 30, confirmationDate: '2027-01-02',
};
const letter = (kind: EmployeeLetterKind, frozen = true): EmployeeLetter => ({
  id: `EMP-0007_${kind}_1`, employeeId: 'EMP-0007', employeeName: 'Ali Raza', kind, refNo: 'IKPM/HR/XX/2026/0001', status: 'issued',
  terms: { ...terms, ...(frozen ? { clauseSections: letterClauseSections(kind, terms, 'entomologist') } : {}) },
  issuedAt: '2026-11-01T09:00:00.000Z', issuedBy: 'hr@test', issuedByName: 'HR Officer', createdAt: '', updatedAt: '',
});

beforeAll(() => {
  // No browser in tests: the logo fails to load, the same as a missing logo in the portal
  vi.stubGlobal('Image', class {
    onerror?: () => void;
    set src(_: string) { queueMicrotask(() => this.onerror?.()); }
  });
});

describe('employee letter PDFs', () => {
  (['offer_letter', 'employment_contract', 'probation_letter', 'confirmation_letter'] as EmployeeLetterKind[]).forEach((kind) => {
    it(`builds the ${kind.replace(/_/g, ' ')}`, async () => {
      expect((await pdfGenerator.employeeLetterPDFBlob(letter(kind))).size).toBeGreaterThan(1000);
    });
  });

  it('still builds letters issued before the wording was saved on them', async () => {
    expect((await pdfGenerator.employeeLetterPDFBlob(letter('employment_contract', false))).size).toBeGreaterThan(1000);
  });
});

describe('letter particulars', () => {
  (['offer_letter', 'employment_contract', 'probation_letter', 'confirmation_letter'] as EmployeeLetterKind[]).forEach((kind) => {
    it(`the ${kind.replace(/_/g, ' ')} has no particulars table`, async () => {
      tableHeads.length = 0;
      await pdfGenerator.employeeLetterPDFBlob(letter(kind));
      expect(tableHeads.flat()).not.toContain('Particulars');
      expect(tableHeads.flat().includes('Salary Component')).toBe(kind !== 'confirmation_letter');
    });
  });
});

describe('header and footer', () => {
  const printed = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]));

  it('service areas print in the footer, trimmed, without blanks, and not in the letterhead', async () => {
    const { b } = await pdfKit.builder('Test', 'REF-1');
    const text = vi.spyOn(b.doc, 'text');
    b.letterhead();
    expect(printed(text).join('|')).not.toMatch(/service areas/i);
    b.finish();
    expect(printed(text)).toContain('SERVICE AREAS');
    expect(printed(text)).toContain('Faisalabad Hub  ·  Lahore');
  });

  it('the footer no longer prints the document reference, page number or generated date', async () => {
    const { b } = await pdfKit.builder('Test', 'REF-1');
    const text = vi.spyOn(b.doc, 'text');
    b.finish();
    expect(printed(text).join('|')).not.toMatch(/REF-1|Page \d|Computer-generated/);
  });

  it('an uploaded background prints on every page, embedded once; without one nothing prints', async () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==';
    vi.stubGlobal('Image', class {
      naturalWidth = 700;
      naturalHeight = 260;
      onload?: () => void;
      set src(_: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: () => undefined }), toDataURL: () => pixel }) });
    pdfGenerator.clearImageCache();
    const backgrounds = async (watermarkUrl?: string) => {
      const { b } = await pdfKit.builder('Test', 'REF-1', undefined, { ...companyProfile.get(), watermarkUrl });
      b.doc.addPage();
      const addImage = vi.spyOn(b.doc, 'addImage');
      b.finish();
      return (addImage.mock.calls as unknown[][]).filter((c) => c[6] === 'page-background').length;
    };
    try {
      expect(await backgrounds('https://example.test/bg.png')).toBe(2);
      expect(await backgrounds()).toBe(0);
    } finally {
      vi.stubGlobal('Image', class { onerror?: () => void; set src(_: string) { queueMicrotask(() => this.onerror?.()); } });
      vi.stubGlobal('document', undefined);
      pdfGenerator.clearImageCache();
    }
  });
});

describe('pagination', () => {
  const start = async (y: number) => {
    const { b } = await pdfKit.builder('Test', 'REF-1');
    b.y = y;
    const pageOf = vi.fn();
    const text = vi.spyOn(b.doc, 'text').mockImplementation(function (this: unknown, ...args: unknown[]) {
      pageOf(String(args[0]), b.doc.getCurrentPageInfo().pageNumber);
      return b.doc;
    } as never);
    const pageFor = (t: string) => pageOf.mock.calls.find((c) => c[0] === t || String(c[0]).includes(t))?.[1];
    return { b, pageFor, text };
  };
  const rows = (n: number) => Array.from({ length: n }, (_, i) => [i + 1, `Row ${i + 1}`]);

  it('a heading moves to the next page with its content, never left alone at the bottom', async () => {
    const { b, pageFor } = await start(268);
    b.section('Heading');
    b.paragraph('Text under the heading.');
    expect(pageFor('HEADING')).toBe(2);
    expect(pageFor('Text under')).toBe(2);
  });

  it('a table that fits on a page moves whole, with its heading, and leaves nothing on the old page', async () => {
    const { b, pageFor } = await start(240);
    b.centeredHeading('Salary');
    b.table(['#', 'Item'], rows(8));
    expect(pageFor('SALARY')).toBe(2);
    expect(b.doc.getNumberOfPages()).toBe(2);
    expect(b.y).toBeLessThan(130);
  });

  it('a table too long for one page starts where it is and carries on', async () => {
    const { b } = await start(60);
    b.table(['#', 'Item'], rows(60));
    expect(b.doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(b.doc.getNumberOfPages()).toBeLessThanOrEqual(3);
  });

  it('room kept for totals moves the table with them', async () => {
    const { b } = await start(200);
    b.keepRoomBelowNextTable(60);
    b.table(['#', 'Item'], rows(2));
    expect(b.doc.getNumberOfPages()).toBe(2);
    b.totals([['Subtotal', 'PKR 1']], ['Total', 1]);
    expect(b.doc.getNumberOfPages()).toBe(2);
  });

  it('a paragraph stays whole, and can stay with the sign-off under it', async () => {
    const { b, pageFor } = await start(260);
    b.paragraph('Closing words before the signatures.', 9, undefined, true);
    b.signatures([{ label: 'Signer' }]);
    expect(pageFor('Closing words')).toBe(2);
    expect(pageFor('SIGNER')).toBe(2);
  });

  it('a clause section that fits on a page is not split', async () => {
    const { b, pageFor } = await start(250);
    const clauses = Array.from({ length: 6 }, (_, i) => ({ title: `Clause ${i + 1}`, body: 'Some wording for this clause.' }));
    b.clauses([{ heading: 'Section', intro: 'Intro text.', clauses }]);
    ['SECTION', 'Intro text', 'Clause 1', 'Clause 6'].forEach((t) => expect(pageFor(t)).toBe(2));
  });

  it('a section too long for one page flows on from where it is', async () => {
    const { b, pageFor } = await start(100);
    const clauses = Array.from({ length: 90 }, (_, i) => ({ title: `Clause ${i + 1}`, body: 'Some wording for this clause.' }));
    b.clauses([{ heading: 'Long', clauses }]);
    expect(pageFor('LONG')).toBe(1);
    expect(pageFor('Clause 1:')).toBe(1);
    expect(pageFor('Clause 90')).toBeGreaterThan(1);
  });

  it('never adds a blank page when something is taller than a page', async () => {
    const { b } = await start(20);
    b.ensure(1000);
    expect(b.doc.getNumberOfPages()).toBe(1);
  });

  it('a heading with nothing after it still prints', async () => {
    const { b, pageFor } = await start(100);
    b.section('Last heading');
    b.finish();
    expect(pageFor('LAST HEADING')).toBe(1);
  });
});

describe('signature lines', () => {
  const signatureLines = async (count: number) => {
    const { b } = await pdfKit.builder('Test', 'REF-1');
    const line = vi.spyOn(b.doc, 'line');
    b.signatures(Array.from({ length: count }, (_, i) => ({ label: `Signer ${i + 1}` })));
    return line.mock.calls.map(([x1, , x2]) => ({ x1, x2 }));
  };

  it.each([1, 2, 3])('%i block(s) stay a normal length', async (count) => {
    const lines = await signatureLines(count);
    expect(lines).toHaveLength(count);
    lines.forEach((l) => expect(l.x2 - l.x1).toBeLessThanOrEqual(60));
  });

  it('two blocks sit at the left and right margins (A4, 14 mm margins)', async () => {
    const [left, right] = await signatureLines(2);
    expect(left.x1).toBe(14);
    expect(right.x2).toBeCloseTo(196);
  });
});
