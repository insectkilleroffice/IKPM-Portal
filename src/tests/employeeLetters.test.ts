// Employee letters: offer at hiring → contract on joining (probation) → confirmation (permanent).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, EmployeeLetter, EmployeePay } from '../types/hr';

const db = { employees: [] as Employee[], letters: [] as EmployeeLetter[], pay: [] as EmployeePay[], seq: 0 };
vi.mock('../services/dataService', () => ({
  dataService: {
    getEmployeeById: (id: string) => db.employees.find((e) => e.id === id),
    saveEmployee: (e: Employee) => { db.employees = [...db.employees.filter((x) => x.id !== e.id), e]; return e; },
    getEmployeeLetters: (id?: string) => db.letters.filter((l) => !id || l.employeeId === id),
    saveEmployeeLetter: (l: EmployeeLetter) => { db.letters = [...db.letters.filter((x) => x.id !== l.id), l]; return l; },
    getEmployeePay: (id: string) => db.pay.find((p) => p.id === id),
    nextSequence: async (_k: string, floor = 0) => Math.max(++db.seq, floor + 1),
  },
}));

const L = await import('../features/hr/employeeLetters');
const { letterClauseSections, termsProfileForRole } = await import('../features/hr/employmentTerms');
const user = { email: 'hr@ikpm.pk', name: 'HR Officer' };
const emp = (p: Partial<Employee> = {}): Employee => ({
  id: 'EMP-0007', name: 'Ali Raza', phone: '03001234567', role: 'pco', department: 'Operations',
  joiningDate: '2026-08-01', status: 'hiring', createdAt: '', updatedAt: '', ...p,
});

beforeEach(() => {
  db.employees = [emp()];
  db.letters = [];
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

  it('saves the role-specific clause wording on the letter when it is issued', async () => {
    const titles = (l: Awaited<ReturnType<typeof L.issueLetter>>) => (l.terms.clauseSections ?? []).map((s) => s.heading);
    db.employees = [emp({ role: 'entomologist', department: 'Quality Assurance' })];
    const contract = await L.issueLetter(db.employees[0], 'employment_contract', L.defaultTerms(db.employees[0], 'employment_contract', 'Entomologist'), user);
    expect(titles(contract)).toContain('General Terms & Conditions of Employment');
    expect(titles(contract)).toContain('Role-Specific Terms: Entomologist');
    expect(titles(contract)).toContain('CRO Duties');
    expect(JSON.stringify(contract.terms.clauseSections)).toContain('Client Calls & Technical Detailing');
    expect(titles(contract).join(' ')).not.toMatch(/Supervisor/);
    const clauseCount = contract.terms.clauseSections?.[0].clauses.length;
    expect(clauseCount).toBe(22);

    // HR can choose different role terms for this one letter
    const asCro = await L.issueLetter(db.employees[0], 'probation_letter', { ...L.defaultTerms(db.employees[0], 'probation_letter', 'CRO'), termsProfile: 'cro' }, user);
    expect(titles(asCro)).toEqual(['General Terms & Conditions', 'Probation & Employment Confirmation', 'Role-Specific Terms: CRO']);
    const asEntomologist = letterClauseSections('probation_letter', asCro.terms, 'entomologist');
    expect(asEntomologist.map((x) => x.heading)).toEqual(['General Terms & Conditions', 'Probation & Employment Confirmation', 'Role-Specific Terms: Entomologist', 'CRO Duties']);
    expect(asEntomologist[3].intro).toMatch(/references to the CRO include the Entomologist/);
    expect(asCro.terms.clauseSections?.[0].clauses).toHaveLength(19);
    expect(asCro.terms.clauseSections?.[1].clauses).toHaveLength(6);
  });

  it('prints the probation length chosen on the letter, and extra terms in their own section', () => {
    const base = L.defaultTerms(db.employees[0], 'employment_contract', 'PCO');
    const sections = letterClauseSections('employment_contract', { ...base, probationMonths: 3, extraTerms: 'Works Sundays by rota.\n' }, 'pco');
    expect(JSON.stringify(sections)).toContain('three (03) months');
    expect(sections[sections.length - 1]).toEqual({ heading: 'Additional Terms', clauses: [{ body: 'Works Sundays by rota.' }] });
  });

  it('gives CRO, Supervisor and Entomologist their own terms, and everyone else the general terms only', () => {
    expect(termsProfileForRole('cro')).toBe('cro');
    expect(termsProfileForRole('team_leader')).toBe('supervisor');
    expect(termsProfileForRole('operations_coordinator')).toBe('supervisor');
    expect(termsProfileForRole('entomologist')).toBe('entomologist');
    expect(termsProfileForRole('accounts')).toBe('general');
    const base = L.defaultTerms(db.employees[0], 'employment_contract', 'HR');
    expect(letterClauseSections('employment_contract', base, 'general').map((s) => s.heading).join(' ')).not.toMatch(/Role-Specific/);
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
    expect(L.stageWarning(db.employees[0], 'confirmation_letter', [])).toMatch(/No signed employment contract/);
    const t = L.defaultTerms(db.employees[0], 'employment_contract', 'PCO');
    expect(L.termsProblems('employment_contract', t, {}).join(' ')).toMatch(/CNIC.*address/);
    expect(L.termsProblems('employment_contract', t, { cnic: '42101-1234567-1', residentialAddress: 'Karachi' })).toEqual([]);
  });

  it('a withdrawn letter no longer counts, so a corrected one can be issued', async () => {
    const offer = await L.issueLetter(db.employees[0], 'offer_letter', L.defaultTerms(db.employees[0], 'offer_letter', 'PCO'), user);
    L.withdrawLetter(offer, 'Salary corrected', user);
    expect(L.activeLetter(db.letters, 'offer_letter')).toBeUndefined();
    expect(L.nextLetterStep(db.employees[0], db.letters)?.kind).toBe('offer_letter');
  });
});
