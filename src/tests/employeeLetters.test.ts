// Employee letters: offer at hiring → contract on joining (probation) → confirmation (permanent).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, EmployeeLetter, EmployeePay, EmployeePrivate } from '../types/hr';

const db = { employees: [] as Employee[], letters: [] as EmployeeLetter[], pay: [] as EmployeePay[], priv: [] as EmployeePrivate[], seq: 0 };
vi.mock('../services/dataService', () => ({
  dataService: {
    getEmployeeById: (id: string) => db.employees.find((e) => e.id === id),
    getEmployees: () => db.employees,
    getEmployeePrivate: (id: string) => db.priv.find((p) => p.id === id),
    saveEmployeePrivate: (p: EmployeePrivate) => { db.priv = [...db.priv.filter((x) => x.id !== p.id), p]; return p; },
    saveEmployeePay: (p: EmployeePay) => { db.pay = [...db.pay.filter((x) => x.id !== p.id), p]; return p; },
    saveEmployee: (e: Employee) => { db.employees = [...db.employees.filter((x) => x.id !== e.id), e]; return e; },
    getEmployeeLetters: (id?: string) => db.letters.filter((l) => !id || l.employeeId === id),
    saveEmployeeLetter: (l: EmployeeLetter) => { db.letters = [...db.letters.filter((x) => x.id !== l.id), l]; return l; },
    getEmployeePay: (id: string) => db.pay.find((p) => p.id === id),
    nextSequence: async (_k: string, floor = 0) => Math.max(++db.seq, floor + 1),
  },
}));

const L = await import('../features/hr/employeeLetters');
const { defaultDepartmentForRole, defaultDutiesForRole, dutiesSentence, letterClauseSections, longDate, offerKeepsPrintedTerms, offerLetterParagraphs } = await import('../features/hr/employmentTerms');
const user = { email: 'hr@ikpm.pk', name: 'HR Officer' };
const emp = (p: Partial<Employee> = {}): Employee => ({
  id: 'EMP-0007', name: 'Ali Raza', phone: '03001234567', role: 'pco', department: 'Operations',
  joiningDate: '2026-08-01', status: 'hiring', createdAt: '', updatedAt: '', ...p,
});

beforeEach(() => {
  db.employees = [emp()];
  db.letters = [];
  db.priv = [];
  db.seq = 0;
  db.pay = [{ id: 'EMP-0007', basicSalary: 30000, attendanceAllowance: 3000, mobilePackage: 1000, bikeMaintenance: 2000, otherAllowance: 0, totalGross: 36000, updatedAt: '' }];
});

describe('employee letters', () => {
  it('prefills the offer from the salary structure, with a 2-month probation', () => {
    const t = L.defaultTerms(db.employees[0], 'offer_letter', 'PCO / Technician');
    expect(t.grossSalary).toBe(36000);
    expect(t.probationEndDate).toBe('2026-10-01');
    expect(t.offerValidUntil).toBeTruthy();
  });

  it('prints the name HR gave the other allowance', () => {
    db.pay = [{ ...db.pay[0], otherAllowance: 4000, otherAllowanceLabel: 'Transportation', totalGross: 40000 }];
    const t = L.defaultTerms(db.employees[0], 'offer_letter', 'PCO / Technician');
    expect(t.allowances[L.OTHER_ALLOWANCE_INDEX]).toEqual({ label: 'Transportation', amount: 4000 });
    expect(t.grossSalary).toBe(40000);
  });

  it('asks for the probation letter during probation, and for confirmation once it has ended', async () => {
    db.employees = [emp({ joiningDate: '2999-01-01' })];
    const signed = async (kind: 'offer_letter' | 'employment_contract' | 'probation_letter') => {
      const l = await L.issueLetter(db.employees[0], kind, L.defaultTerms(db.employees[0], kind, 'PCO'), user);
      return { l, sign: () => L.markLetterSigned(l, undefined, user) };
    };
    (await signed('offer_letter')).sign();
    (await signed('employment_contract')).sign();
    expect(L.nextLetterStep(db.employees[0], db.letters)?.label).toBe('Issue probation letter');

    const probation = await signed('probation_letter');
    expect(probation.l.refNo).toMatch(/^IKPM\/HR\/PL\/\d{4}\/\d{4}$/);
    expect(L.nextLetterStep(db.employees[0], db.letters)?.label).toBe('Probation letter awaiting signature');
    probation.sign();
    expect(L.nextLetterStep(db.employees[0], db.letters)?.kind).toBe('confirmation_letter');
    expect(L.nextLetterStep(db.employees[0], db.letters)?.overdue).toBe(false);
  });

  it('a signed probation letter also moves a new employee from hiring to probation', async () => {
    const letter = await L.issueLetter(db.employees[0], 'probation_letter', L.defaultTerms(db.employees[0], 'probation_letter', 'PCO'), user);
    L.markLetterSigned(letter, undefined, user);
    expect(db.employees[0].status).toBe('probation');
  });

  it('requires a probation period on a probation letter', () => {
    const t = { ...L.defaultTerms(db.employees[0], 'probation_letter', 'PCO'), probationMonths: 0 };
    expect(L.termsProblems('probation_letter', t, { cnic: '42101-1234567-1', residentialAddress: 'Karachi' }).join(' ')).toMatch(/at least one month/);
  });

  it('terms follow the duties a person performs, not just their job title', async () => {
    const titles = (l: Awaited<ReturnType<typeof L.issueLetter>>) => (l.terms.clauseSections ?? []).map((s) => s.heading);
    db.employees = [emp({ role: 'entomologist', department: 'Operations' })];
    const contract = await L.issueLetter(db.employees[0], 'employment_contract', L.defaultTerms(db.employees[0], 'employment_contract', 'Entomologist'), user);
    expect(titles(contract)).toEqual([
      'General Terms & Conditions of Employment',
      'Job-Specific Terms: Site Visits & Quality Audits',
      'Job-Specific Terms: Client Calls & Technical Detailing',
      'Job-Specific Terms: Sales & Client Relations (CRO)',
      'Termination of Employment',
    ]);
    expect(contract.terms.clauseSections?.[0].clauses).toHaveLength(22);
    // Worded for whoever does the duty, not for one job title
    expect(JSON.stringify(contract.terms.clauseSections)).not.toMatch(/The (CRO|Entomologist|PCO) /);

    // HR can choose different duties for one letter
    const clientOnly = await L.issueLetter(db.employees[0], 'probation_letter', { ...L.defaultTerms(db.employees[0], 'probation_letter', 'Entomologist'), duties: ['client_detailing'] }, user);
    expect(titles(clientOnly)).toEqual(['General Terms & Conditions', 'Probation & Employment Confirmation', 'Job-Specific Terms: Client Calls & Technical Detailing']);
    expect(clientOnly.terms.clauseSections?.[0].clauses).toHaveLength(19);
    expect(clientOnly.terms.clauseSections?.[1].clauses).toHaveLength(6);
  });

  it('says "after becoming permanent", and has company termination terms with no governing law section', () => {
    const t = L.defaultTerms(db.employees[0], 'employment_contract', 'PCO');
    const sections = letterClauseSections('employment_contract', t, ['field_service']);
    const text = JSON.stringify(sections);
    expect(text).toContain('30 days after becoming permanent');
    expect(text).toContain('30 days notice after becoming permanent');
    expect(text).not.toMatch(/after confirmation|Governing Law|laws of Pakistan/);
    const termination = sections.find((s) => s.heading === 'Termination of Employment');
    expect(termination?.clauses.map((c) => c.title)).toEqual(['Termination by Notice', 'Termination Without Notice', 'Final Settlement']);
  });

  it('states the duties in the particulars, with the job in HR\'s own words', () => {
    const t = { ...L.defaultTerms(db.employees[0], 'employment_contract', 'PCO'), duties: ['site_audits' as const, 'client_detailing' as const], jobDescription: 'Explains treatments to clients' };
    expect(dutiesSentence(t, 'Your')).toBe('Your duties include Site Visits & Quality Audits and Client Calls & Technical Detailing. Explains treatments to clients.');
    expect(dutiesSentence({ ...t, duties: [], jobDescription: undefined }, 'Your')).toBe('');
  });

  it('a new offer letter has plain paragraphs and no numbered terms; only HR additions are stored', async () => {
    const t = L.defaultTerms(db.employees[0], 'offer_letter', 'PCO');
    const offer = await L.issueLetter(db.employees[0], 'offer_letter', t, user);
    expect(offer.terms.clauseSections).toEqual([]);
    expect(letterClauseSections('offer_letter', { ...t, extraTerms: 'Transport provided.' }, ['field_service']))
      .toEqual([{ heading: 'Additional Terms', clauses: [{ body: 'Transport provided.' }] }]);

    const body = offerLetterParagraphs({ ...t, designation: 'PCO', probationMonths: 3 }, { name: 'Insect Killer Pest Management', shortName: 'IKPM' }, 'PKR 36,000.00').join(' ');
    expect(body).toContain('at Insect Killer Pest Management as PCO');
    expect(body).toContain('PKR 36,000.00');
    expect(body).toContain('three (03) months');
    expect(longDate('2026-11-05')).toBe('05 November 2026');
    // The three items kept from the old terms
    expect(body).toContain('two passport-size photographs');
    expect(body).toContain('Employment Agreement and a Probation Letter');
    expect(body).toContain('must not be shared with any third party');
    // The ones removed
    expect(body).not.toMatch(/Notice Period|either side may end|bank transfer|withdrawn/i);
  });

  it('only a signed offer keeps its old numbered terms', () => {
    const t = L.defaultTerms(db.employees[0], 'offer_letter', 'PCO');
    const old = [{ heading: 'Terms of this Offer', clauses: [{ body: 'Old wording.' }] }];
    expect(offerKeepsPrintedTerms({ status: 'signed', terms: t }, old)).toBe(true);
    expect(offerKeepsPrintedTerms({ status: 'issued', terms: t }, old)).toBe(false);
    expect(offerKeepsPrintedTerms({ status: 'signed', terms: t }, [])).toBe(false);
    expect(offerKeepsPrintedTerms({ status: 'signed', terms: t }, [{ heading: 'Additional Terms', clauses: [] }])).toBe(false);
  });

  it('prints the probation length chosen on the letter, and extra terms in their own section', () => {
    const base = L.defaultTerms(db.employees[0], 'employment_contract', 'PCO');
    const sections = letterClauseSections('employment_contract', { ...base, probationMonths: 3, extraTerms: 'Works Sundays by rota.\n' }, ['field_service']);
    expect(JSON.stringify(sections)).toContain('three (03) months');
    expect(sections[sections.length - 1]).toEqual({ heading: 'Additional Terms', clauses: [{ body: 'Works Sundays by rota.' }] });
  });

  it('suggests duties and a department from the job, with general terms only when none apply', () => {
    expect(defaultDutiesForRole('cro')).toEqual(['sales']);
    expect(defaultDutiesForRole('team_leader')).toEqual(['field_supervision']);
    expect(defaultDutiesForRole('operations_coordinator')).toEqual(['field_supervision']);
    expect(defaultDutiesForRole('entomologist')).toEqual(['site_audits', 'client_detailing', 'sales']);
    expect(defaultDutiesForRole('accounts')).toEqual(['finance_accounts']);
    expect(defaultDutiesForRole('hr')).toEqual([]);
    expect(defaultDepartmentForRole('entomologist')).toBe('Operations');
    expect(defaultDepartmentForRole('cro')).toBe('Sales');
    expect(defaultDepartmentForRole('accounts')).toBe('Finance');
    const base = L.defaultTerms(db.employees[0], 'employment_contract', 'HR');
    expect(letterClauseSections('employment_contract', base, []).map((s) => s.heading).join(' ')).not.toMatch(/Job-Specific/);
  });

  describe('confirming a hire', () => {
    const candidate = () => emp({ id: 'CAND-0003', role: 'entomologist', department: 'Operations' });
    const details = { role: 'entomologist' as const, department: 'Operations', duties: ['site_audits' as const, 'client_detailing' as const], jobDescription: 'Explains findings to clients' };
    const acceptOffer = async () => {
      const offer = await L.issueLetter(db.employees[0], 'offer_letter', L.defaultTerms(db.employees[0], 'offer_letter', 'Entomologist'), user);
      L.markLetterSigned(offer, undefined, user);
    };

    beforeEach(() => {
      db.employees = [candidate()];
      db.pay = [{ id: 'CAND-0003', basicSalary: 30000, attendanceAllowance: 0, mobilePackage: 0, bikeMaintenance: 0, totalGross: 30000, updatedAt: '' }];
      db.priv = [{ id: 'CAND-0003', cnic: '42101-1234567-1', residentialAddress: 'Karachi', updatedAt: '' }];
    });

    it('a candidate can only get an offer letter, and needs it signed before being confirmed', async () => {
      const c = db.employees[0];
      await expect(L.issueLetter(c, 'employment_contract', L.defaultTerms(c, 'employment_contract', 'E'), user)).rejects.toThrow(/Confirm the hire first/);
      await expect(L.confirmHire(c, details, user)).rejects.toThrow(/offer letter must be signed/);
      await acceptOffer();
      expect(L.nextLetterStep(db.employees[0], db.letters)?.label).toBe('Offer accepted: confirm hire');
    });

    it('asks for a department and at least one duty, and a Supervisor for a PCO', async () => {
      await acceptOffer();
      expect(L.confirmHireProblems(db.employees[0], db.letters, { ...details, department: '', duties: [] }).join(' ')).toMatch(/department.*duty/);
      expect(L.confirmHireProblems(db.employees[0], db.letters, { ...details, role: 'pco' }).join(' ')).toMatch(/Supervisor/);
    });

    it('creates the Employee ID and moves letters, private details and salary to it', async () => {
      await acceptOffer();
      db.seq = 11;
      const hired = await L.confirmHire(db.employees[0], details, user);
      expect(hired.id).toMatch(/^EMP-\d{4}$/);
      expect(hired.candidateId).toBe('CAND-0003');
      expect(hired.duties).toEqual(details.duties);
      expect(hired.jobDescription).toBe('Explains findings to clients');
      expect(db.letters.every((l) => l.employeeId === hired.id)).toBe(true);
      expect(db.pay.find((p) => p.id === hired.id)?.totalGross).toBe(30000);
      expect(db.priv.find((p) => p.id === hired.id)?.cnic).toBe('42101-1234567-1');
      // The old record is emptied and points at the new one
      expect(db.priv.find((p) => p.id === 'CAND-0003')?.cnic).toBe('');
      expect(db.pay.find((p) => p.id === 'CAND-0003')?.totalGross).toBe(0);
      const old = db.employees.find((e) => e.id === 'CAND-0003');
      expect(old?.mergedIntoId).toBe(hired.id);
      expect(old?.status).toBe('inactive');
    });

    it('their contract then uses the new ID and the duties chosen', async () => {
      await acceptOffer();
      const hired = await L.confirmHire(db.employees[0], details, user);
      const t = L.defaultTerms(hired, 'employment_contract', 'Entomologist');
      expect(t.duties).toEqual(details.duties);
      const contract = await L.issueLetter(hired, 'employment_contract', t, user);
      expect(contract.employeeId).toBe(hired.id);
    });
  });

  it('runs the stages: offer → contract (probation) → confirmation (permanent)', async () => {
    expect(L.nextLetterStep(db.employees[0], db.letters)?.kind).toBe('offer_letter');

    const offer = await L.issueLetter(db.employees[0], 'offer_letter', L.defaultTerms(db.employees[0], 'offer_letter', 'PCO'), user);
    expect(offer.refNo).toMatch(/^IKPM\/HR\/OL\/\d{4}\/0001$/);
    expect(L.nextLetterStep(db.employees[0], db.letters)?.label).toBe('Offer awaiting signature');
    L.markLetterSigned(offer, undefined, user);
    expect(L.nextLetterStep(db.employees[0], db.letters)?.kind).toBe('employment_contract');

    const contract = await L.issueLetter(db.employees[0], 'employment_contract', L.defaultTerms(db.employees[0], 'employment_contract', 'PCO'), user);
    L.markLetterSigned(contract, undefined, user);
    expect(db.employees[0].status).toBe('probation');
    expect(L.nextLetterStep(db.employees[0], db.letters)?.kind).toBe('confirmation_letter');

    await L.issueLetter(db.employees[0], 'confirmation_letter', L.defaultTerms(db.employees[0], 'confirmation_letter', 'PCO'), user);
    expect(db.employees[0].status).toBe('permanent');
    expect(L.nextLetterStep(db.employees[0], db.letters)).toBeUndefined();
  });

  it('warns before confirming without a signed contract, and requires CNIC and address on the contract', () => {
    expect(L.stageWarning(db.employees[0], 'confirmation_letter', [])).toMatch(/No signed employment agreement/);
    const t = L.defaultTerms(db.employees[0], 'employment_contract', 'PCO');
    expect(L.termsProblems('employment_contract', t, {}).join(' ')).toMatch(/CNIC.*address/);
    expect(L.termsProblems('employment_contract', t, { cnic: '42101-1234567-1', residentialAddress: 'Karachi' })).toEqual([]);
    expect(L.termsProblems('employment_contract', t, { cnic: '42101-123', residentialAddress: 'Karachi' }).join(' ')).toMatch(/13 digits/);
  });

  it('a withdrawn letter no longer counts, so a corrected one can be issued', async () => {
    const offer = await L.issueLetter(db.employees[0], 'offer_letter', L.defaultTerms(db.employees[0], 'offer_letter', 'PCO'), user);
    L.withdrawLetter(offer, 'Salary corrected', user);
    expect(L.activeLetter(db.letters, 'offer_letter')).toBeUndefined();
    expect(L.nextLetterStep(db.employees[0], db.letters)?.kind).toBe('offer_letter');
  });
});
