// Employee letters, one per stage of employment:
//   At hiring        → Offer Letter          (candidate signs to accept; HR then confirms the hire,
//                                             which gives them an Employee ID, department and duties)
//   On joining       → Employment Agreement  (general and role-specific terms; employee signs)
//                    → Probation Letter      (probation terms; employee signs; status becomes Probation)
//   End of probation → Confirmation Letter   (status becomes Permanent)
// Each letter is its own HR-only record (collection employee_letters) with its terms frozen at issue,
// a reference number, and the signed copy once returned.

import { cnicProblem } from '../../lib/validation';
import { dataService } from '../../services/dataService';
import { isCandidate, type Employee, type EmployeeDuty, type EmployeeLetter, type EmployeeLetterKind, type EmployeeLetterTerms, type EmployeeRole } from '../../types/hr';
import { defaultDutiesForRole, letterClauseSections } from './employmentTerms';

export const LETTER_ORDER: EmployeeLetterKind[] = ['offer_letter', 'employment_contract', 'probation_letter', 'confirmation_letter'];
const REF_CODE: Record<EmployeeLetterKind, string> = { offer_letter: 'OL', employment_contract: 'EC', probation_letter: 'PL', confirmation_letter: 'CL' };

export const DEFAULT_PROBATION_MONTHS = 2;
export const DEFAULT_WORKING_HOURS = '9:00 am to 6:00 pm, Monday to Saturday';

/** Letters that print the employee's CNIC and address, so both are required before issuing. */
export const needsEmployeeDetails = (kind: EmployeeLetterKind) => kind === 'employment_contract' || kind === 'probation_letter';

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

/** Allowances on a letter: attendance, mobile, bike, then the one HR names (e.g. Transportation). */
export const OTHER_ALLOWANCE_INDEX = 3;
export const OTHER_ALLOWANCE_LABEL = 'Other allowance';

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
        { label: pay.otherAllowanceLabel?.trim() || prev?.allowances[OTHER_ALLOWANCE_INDEX]?.label || OTHER_ALLOWANCE_LABEL, amount: pay.otherAllowance || 0 },
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
    duties: emp.duties?.length ? emp.duties : prev?.duties ?? defaultDutiesForRole(emp.role),
    ...(emp.jobDescription || prev?.jobDescription ? { jobDescription: emp.jobDescription || prev?.jobDescription } : {}),
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
    kind === 'probation_letter' && !(t.probationMonths > 0) && 'A probation letter needs a probation period of at least one month.',
    needsEmployeeDetails(kind) && (priv?.cnic?.trim() ? cnicProblem(priv.cnic) : "Enter the employee's CNIC (printed on the letter)."),
    needsEmployeeDetails(kind) && !priv?.residentialAddress?.trim() && "Enter the employee's address (printed on the letter).",
    kind === 'confirmation_letter' && !t.confirmationDate && 'Enter the confirmation date.',
  ].filter(Boolean) as string[];
}

/** What the letter of a kind is waiting for, or a warning before issuing it (undefined = all good). */
export function stageWarning(emp: Employee, kind: EmployeeLetterKind, letters: EmployeeLetter[]): string | undefined {
  if (kind === 'employment_contract' && activeLetter(letters, 'offer_letter')?.status !== 'signed') {
    return 'No accepted (signed) offer letter on record.';
  }
  if (kind === 'probation_letter' && !activeLetter(letters, 'employment_contract')) {
    return 'No employment agreement on record.';
  }
  if (kind === 'confirmation_letter') {
    if (activeLetter(letters, 'employment_contract')?.status !== 'signed') return 'No signed employment agreement on record.';
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
  if (isCandidate(emp) && offer?.status === 'signed') return { kind: 'employment_contract', label: 'Offer accepted: confirm hire' };
  if (!contract) {
    if (emp.status === 'hiring' && !offer) return { kind: 'offer_letter', label: 'Issue offer letter' };
    if (emp.status === 'hiring' && offer?.status === 'issued') return { kind: 'offer_letter', label: 'Offer awaiting signature' };
    return { kind: 'employment_contract', label: 'Issue employment agreement' };
  }
  if (contract.status === 'issued') return { kind: 'employment_contract', label: 'Agreement awaiting signature' };
  const end = emp.probationEndDate || contract.terms.probationEndDate;
  const due = !end || end <= today();
  // The probation letter is issued during probation; once it has ended the next step is confirmation
  const probation = activeLetter(letters, 'probation_letter');
  if (probation?.status === 'issued') return { kind: 'probation_letter', label: 'Probation letter awaiting signature' };
  if (!probation && !due) return { kind: 'probation_letter', label: 'Issue probation letter' };
  return { kind: 'confirmation_letter', label: due ? 'Probation ended: issue confirmation' : `Confirmation due ${end}`, overdue: due };
}

export interface HireDetails {
  role: EmployeeRole;
  department: string;
  duties: EmployeeDuty[];
  jobDescription?: string;
  reportingCoordinatorId?: string;
  reportingToRole?: string;
}

/** What stops a candidate being confirmed as an employee. */
export function confirmHireProblems(emp: Employee, letters: EmployeeLetter[], d: HireDetails): string[] {
  return [
    !isCandidate(emp) && 'This person already has an Employee ID.',
    activeLetter(letters, 'offer_letter')?.status !== 'signed' && 'The offer letter must be signed first.',
    !d.department && 'Choose the department.',
    !d.duties.length && 'Choose at least one duty.',
    d.role === 'pco' && !d.reportingCoordinatorId && 'Choose this PCO\'s Supervisor.',
  ].filter(Boolean) as string[];
}

/**
 * The candidate accepted the offer: they become an employee with an Employee ID, and their letters,
 * private details and salary move to it. The old record stays, emptied, pointing at the new one.
 */
export async function confirmHire(emp: Employee, d: HireDetails, user: { email: string }): Promise<Employee> {
  const letters = dataService.getEmployeeLetters(emp.id);
  const problems = confirmHireProblems(emp, letters, d);
  if (problems.length) throw new Error(problems.join(' '));

  const used = dataService.getEmployees().filter((e) => e.id.startsWith('EMP-')).map((e) => Number(e.id.slice(4)) || 0);
  const seq = await dataService.nextSequence('employee', Math.max(0, ...used));
  const id = `EMP-${String(seq).padStart(4, '0')}`;
  const ts = new Date().toISOString();
  const employee: Employee = {
    ...emp,
    ...d,
    id,
    jobDescription: d.jobDescription?.trim() || undefined,
    candidateId: emp.id,
    updatedAt: ts,
  };
  dataService.saveEmployee(employee, user.email);

  const priv = dataService.getEmployeePrivate(emp.id);
  if (priv) {
    dataService.saveEmployeePrivate({ ...priv, id, updatedAt: ts }, user.email);
    // CNIC and bank details live in one place only
    dataService.saveEmployeePrivate({ id: emp.id, cnic: '', residentialAddress: '', updatedAt: ts }, user.email);
  }
  const pay = dataService.getEmployeePay(emp.id);
  if (pay) {
    dataService.saveEmployeePay({ ...pay, id, updatedAt: ts }, user.email);
    dataService.saveEmployeePay({ id: emp.id, basicSalary: 0, attendanceAllowance: 0, mobilePackage: 0, bikeMaintenance: 0, totalGross: 0, updatedAt: ts }, user.email);
  }
  letters.forEach((l) => dataService.saveEmployeeLetter({ ...l, employeeId: id, updatedAt: ts }, user.email));
  dataService.saveEmployee({ ...emp, status: 'inactive', mergedIntoId: id, updatedAt: ts }, user.email);
  return employee;
}

/** Issues a letter: reference number, frozen terms and clause wording. Confirmation makes the employee permanent. */
export async function issueLetter(emp: Employee, kind: EmployeeLetterKind, terms: EmployeeLetterTerms, user: { email: string; name: string }, notes?: string): Promise<EmployeeLetter> {
  if (isCandidate(emp) && kind !== 'offer_letter') throw new Error('Confirm the hire first: only an offer letter can be issued to a candidate.');
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
    terms: { ...terms, clauseSections: letterClauseSections(kind, terms, terms.duties ?? defaultDutiesForRole(emp.role)) },
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

/** Records the employee's signature (and the signed copy). A signed agreement or probation letter starts probation. */
export function markLetterSigned(letter: EmployeeLetter, signedCopy: EmployeeLetter['signedCopy'] | undefined, user: { email: string }, signedAt = today()): EmployeeLetter {
  const ts = new Date().toISOString();
  const updated: EmployeeLetter = { ...letter, status: 'signed', signedAt, ...(signedCopy ? { signedCopy } : {}), updatedAt: ts };
  dataService.saveEmployeeLetter(updated, user.email);
  const emp = dataService.getEmployeeById(letter.employeeId);
  if (emp && needsEmployeeDetails(letter.kind) && (emp.status === 'hiring' || !emp.probationEndDate)) {
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
