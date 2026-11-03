// Employee letters, one per stage of employment:
//   At hiring        → Offer Letter          (employee signs to accept)
//   On joining       → Employment Contract   (employee signs; status becomes Probation)
//   End of probation → Confirmation Letter   (status becomes Permanent)
// Each letter is its own HR-only record (collection employee_letters) with its terms frozen at issue,
// a reference number, and the signed copy once returned.

import { dataService } from '../../services/dataService';
import type { Employee, EmployeeLetter, EmployeeLetterKind, EmployeeLetterTerms } from '../../types/hr';

export const LETTER_ORDER: EmployeeLetterKind[] = ['offer_letter', 'employment_contract', 'confirmation_letter'];
const REF_CODE: Record<EmployeeLetterKind, string> = { offer_letter: 'OL', employment_contract: 'EC', confirmation_letter: 'CL' };

export const DEFAULT_PROBATION_MONTHS = 3;
export const DEFAULT_WORKING_HOURS = '9:00 am to 6:00 pm, Monday to Saturday';

const today = () => new Date().toISOString().slice(0, 10);
// Date-only maths in UTC, so local time zones (Pakistan is UTC+5) never shift a date by a day
const addDays = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** The letter of a kind that counts (latest one not withdrawn). */
export const activeLetter = (letters: EmployeeLetter[], kind: EmployeeLetterKind) =>
  letters.filter((l) => l.kind === kind && l.status !== 'withdrawn').sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];

/** Starting terms for a new letter: the previous letter's terms, then the current profile and salary. */
export function defaultTerms(emp: Employee, kind: EmployeeLetterKind, designation: string, reportingTo?: string): EmployeeLetterTerms {
  const letters = dataService.getEmployeeLetters(emp.id);
  const prev = [...LETTER_ORDER].reverse().map((k) => activeLetter(letters, k)).find(Boolean)?.terms;
  const pay = dataService.getEmployeePay(emp.id);
  const probationMonths = prev?.probationMonths ?? DEFAULT_PROBATION_MONTHS;
  const allowances = pay
    ? [
        { label: 'Attendance allowance', amount: pay.attendanceAllowance || 0 },
        { label: 'Mobile package', amount: pay.mobilePackage || 0 },
        { label: 'Bike maintenance', amount: pay.bikeMaintenance || 0 },
        { label: 'Other allowance', amount: pay.otherAllowance || 0 },
      ]
    : prev?.allowances ?? [];
  const basicSalary = pay?.basicSalary ?? prev?.basicSalary ?? 0;
  const probationEndDate = emp.probationEndDate || addMonths(emp.joiningDate, probationMonths);
  return {
    designation: prev?.designation || designation,
    department: emp.department,
    reportingTo: reportingTo || prev?.reportingTo,
    joiningDate: emp.joiningDate,
    probationMonths,
    probationEndDate,
    basicSalary,
    allowances,
    grossSalary: basicSalary + allowances.reduce((s, a) => s + a.amount, 0),
    workingHours: prev?.workingHours || DEFAULT_WORKING_HOURS,
    noticeDaysProbation: prev?.noticeDaysProbation ?? 7,
    noticeDaysPermanent: prev?.noticeDaysPermanent ?? 30,
    ...(kind === 'offer_letter' ? { offerValidUntil: addDays(today(), 7) } : {}),
    ...(kind === 'confirmation_letter' ? { confirmationDate: probationEndDate < today() ? addDays(probationEndDate, 1) : probationEndDate } : {}),
  };
}

/** Problems that stop a letter being issued. */
export function termsProblems(kind: EmployeeLetterKind, t: EmployeeLetterTerms, priv?: { cnic?: string; residentialAddress?: string }): string[] {
  return [
    !t.designation.trim() && 'Enter the designation.',
    !t.joiningDate && 'Enter the joining date.',
    !(t.probationMonths >= 0) && 'Probation months cannot be negative.',
    !(t.grossSalary > 0) && 'Enter the salary (basic and allowances).',
    !t.workingHours.trim() && 'Enter the working hours.',
    kind === 'employment_contract' && !priv?.cnic?.trim() && "Enter the employee's CNIC (printed on the contract).",
    kind === 'employment_contract' && !priv?.residentialAddress?.trim() && "Enter the employee's address (printed on the contract).",
    kind === 'confirmation_letter' && !t.confirmationDate && 'Enter the confirmation date.',
  ].filter(Boolean) as string[];
}

/** What the letter of a kind is waiting for, or a warning before issuing it (undefined = all good). */
export function stageWarning(emp: Employee, kind: EmployeeLetterKind, letters: EmployeeLetter[]): string | undefined {
  if (kind === 'employment_contract' && activeLetter(letters, 'offer_letter')?.status !== 'signed') {
    return 'No accepted (signed) offer letter on record.';
  }
  if (kind === 'confirmation_letter') {
    if (activeLetter(letters, 'employment_contract')?.status !== 'signed') return 'No signed employment contract on record.';
    if (emp.probationEndDate && emp.probationEndDate > today()) return `Probation runs until ${emp.probationEndDate}: this confirms the employee early.`;
  }
  return undefined;
}

/** Next HR step for an employee, for the list and reminders. */
export function nextLetterStep(emp: Employee, letters: EmployeeLetter[]): { kind: EmployeeLetterKind; label: string; overdue?: boolean } | undefined {
  if (emp.status === 'inactive') return undefined;
  const offer = activeLetter(letters, 'offer_letter');
  const contract = activeLetter(letters, 'employment_contract');
  const confirmation = activeLetter(letters, 'confirmation_letter');
  if (confirmation || emp.status === 'permanent' && !contract) return undefined;
  if (!contract) {
    if (emp.status === 'hiring' && !offer) return { kind: 'offer_letter', label: 'Issue offer letter' };
    if (emp.status === 'hiring' && offer?.status === 'issued') return { kind: 'offer_letter', label: 'Offer awaiting signature' };
    return { kind: 'employment_contract', label: 'Issue employment contract' };
  }
  if (contract.status === 'issued') return { kind: 'employment_contract', label: 'Contract awaiting signature' };
  const end = emp.probationEndDate || contract.terms.probationEndDate;
  const due = !end || end <= today();
  return { kind: 'confirmation_letter', label: due ? 'Probation ended: issue confirmation' : `Confirmation due ${end}`, overdue: due };
}

/** Issues a letter: reference number, frozen terms. Confirmation makes the employee permanent. */
export async function issueLetter(emp: Employee, kind: EmployeeLetterKind, terms: EmployeeLetterTerms, user: { email: string; name: string }, notes?: string): Promise<EmployeeLetter> {
  const year = new Date().getFullYear();
  const prefix = `IKPM/HR/${REF_CODE[kind]}/${year}/`;
  const used = dataService.getEmployeeLetters().filter((l) => l.refNo.startsWith(prefix)).map((l) => Number(l.refNo.slice(prefix.length)) || 0);
  const seq = await dataService.nextSequence(`hr_${REF_CODE[kind].toLowerCase()}_${year}`, Math.max(0, ...used));
  const ts = new Date().toISOString();
  const letter: EmployeeLetter = {
    id: `${emp.id}_${kind}_${seq}`,
    employeeId: emp.id,
    employeeName: emp.name,
    kind,
    refNo: `IKPM/HR/${REF_CODE[kind]}/${year}/${String(seq).padStart(4, '0')}`,
    status: 'issued',
    terms,
    issuedAt: ts,
    issuedBy: user.email,
    issuedByName: user.name,
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
    createdAt: ts,
    updatedAt: ts,
  };
  dataService.saveEmployeeLetter(letter, user.email);
  // Keep the profile in step with what the letter says
  const patch: Partial<Employee> = {};
  if (terms.joiningDate !== emp.joiningDate) patch.joiningDate = terms.joiningDate;
  if (kind !== 'confirmation_letter' && terms.probationEndDate && terms.probationEndDate !== emp.probationEndDate) patch.probationEndDate = terms.probationEndDate;
  if (kind === 'offer_letter' && emp.status !== 'hiring' && !activeLetter(dataService.getEmployeeLetters(emp.id), 'employment_contract')) patch.status = 'hiring';
  if (kind === 'confirmation_letter') patch.status = 'permanent';
  if (Object.keys(patch).length) dataService.saveEmployee({ ...emp, ...patch, updatedAt: ts }, user.email);
  return letter;
}

/** Records the employee's signature (and the signed copy). A signed contract starts probation. */
export function markLetterSigned(letter: EmployeeLetter, signedCopy: EmployeeLetter['signedCopy'] | undefined, user: { email: string }, signedAt = today()): EmployeeLetter {
  const ts = new Date().toISOString();
  const updated: EmployeeLetter = { ...letter, status: 'signed', signedAt, ...(signedCopy ? { signedCopy } : {}), updatedAt: ts };
  dataService.saveEmployeeLetter(updated, user.email);
  const emp = dataService.getEmployeeById(letter.employeeId);
  if (emp && letter.kind === 'employment_contract' && (emp.status === 'hiring' || !emp.probationEndDate)) {
    dataService.saveEmployee({
      ...emp,
      status: emp.status === 'hiring' ? 'probation' : emp.status,
      probationEndDate: emp.probationEndDate || letter.terms.probationEndDate,
      updatedAt: ts,
    }, user.email);
  }
  return updated;
}

/** Withdraws a letter (never deleted). A new one can then be issued. */
export function withdrawLetter(letter: EmployeeLetter, reason: string, user: { email: string }): EmployeeLetter {
  const updated: EmployeeLetter = { ...letter, status: 'withdrawn', withdrawnReason: reason.trim(), updatedAt: new Date().toISOString() };
  dataService.saveEmployeeLetter(updated, user.email);
  return updated;
}
