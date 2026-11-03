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
  it('prefills the offer from the salary structure, with a 3-month probation', () => {
    const t = L.defaultTerms(db.employees[0], 'offer_letter', 'PCO / Technician');
    expect(t.grossSalary).toBe(36000);
    expect(t.probationEndDate).toBe('2026-11-01');
    expect(t.offerValidUntil).toBeTruthy();
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
