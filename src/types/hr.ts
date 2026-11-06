
// HR, Employee Management, Daily Attendance, and 30-day Payroll Types (Changes 42, 43, 44, 48)

export type EmployeeStatus = 'hiring' | 'probation' | 'permanent' | 'notice' | 'inactive';

export type EmployeeRole =
  | 'pco'
  | 'operations_coordinator'
  | 'operations_manager'
  | 'team_leader'
  | 'operations'
  | 'cro'
  | 'entomologist'
  | 'accounts'
  | 'hr'
  | 'admin'
  | 'management';

/** The company's departments. */
export const EMPLOYEE_DEPARTMENTS = ['Operations', 'Finance', 'Sales'] as const;

/** What a person actually does at work; decides the job-specific terms on their letters. */
export type EmployeeDuty = 'field_service' | 'field_supervision' | 'site_audits' | 'client_detailing' | 'sales' | 'finance_accounts';

export const EMPLOYEE_DUTY_LABELS: Record<EmployeeDuty, string> = {
  field_service: 'Field Service (Pest Control Visits)',
  field_supervision: 'Field Team Supervision',
  site_audits: 'Site Visits & Quality Audits',
  client_detailing: 'Client Calls & Technical Detailing',
  sales: 'Sales & Client Relations (CRO)',
  finance_accounts: 'Finance & Accounts',
};

/** Before the hire is confirmed a person is a candidate: a CAND- record with no Employee ID. */
export const isCandidate = (e: { id: string }) => e.id.startsWith('CAND-');

export interface Employee {
  id: string; // e.g. EMP-0007 (CAND-0003 until the hire is confirmed)
  name: string;
  phone: string;
  email?: string;
  role: EmployeeRole;
  department: string;
  reportingToRole?: string;
  reportingCoordinatorId?: string;
  joiningDate: string; // YYYY-MM-DD
  status: EmployeeStatus;
  probationEndDate?: string; // joiningDate + probation months (default 2)
  uid?: string; // portal login uid if created (optional, PCOs default to none)
  photoUrl?: string;
  emergencyContact?: string;
  /** Set when the hire is confirmed: what they do, which decides their job-specific terms. */
  duties?: EmployeeDuty[];
  jobDescription?: string;
  /** The candidate record this employee came from, and on that old record the employee it became. */
  candidateId?: string;
  mergedIntoId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeePrivate {
  id: string; // matches Employee.id
  cnic: string; // Encrypted / protected at rest
  fatherName?: string;
  fatherCnic?: string;
  residentialAddress: string;
  witnesses?: {
    name: string;
    cnic: string;
    phone: string;
    relation: string;
  }[];
  bankAccount?: {
    bankName: string;
    accountTitle: string;
    accountNumber: string;
    iban: string;
  };
  updatedAt: string;
}

export interface EmployeePay {
  id: string; // matches Employee.id
  basicSalary: number;
  attendanceAllowance: number;
  mobilePackage: number;
  bikeMaintenance: number;
  otherAllowance?: number;
  /** What the other allowance is for, e.g. "Transportation". */
  otherAllowanceLabel?: string;
  overtimeHourlyRate?: number;
  bankName?: string;
  bankAccountNumber?: string;
  totalGross: number; // auto sum of above
  updatedAt: string;
}

// ---------- Attendance (Change 43) ----------
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave' | 'half_day' | 'off';

export interface AttendanceRecord {
  id: string; // employeeId + '_' + date, e.g. EMP-0007_2026-10-30
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD (Pakistan time)
  status: AttendanceStatus;
  arrivalTime?: string; // HH:mm
  lateMinutes?: number;
  /** Extra hours worked beyond the normal day; paid from the person's salary (see payroll rules). */
  overtimeHours?: number;
  remarks?: string;
  markedBy: string;
  markedByName: string;
  markedAt: string;
}

// ---------- Payroll (Change 44) ----------
export type SalaryCycleStatus = 'draft' | 'verified' | 'approved' | 'paid';

export interface SalaryDeductionItem {
  ruleName: string;
  amount: number;
  reason?: string;
}

export interface SalaryLine {
  employeeId: string;
  employeeName: string;
  role: EmployeeRole;
  baseSalary: number;
  allowances: number;
  attendanceDays: number;
  lateMarks: number;
  verifiedJobs: number;
  /** Overtime in the cycle and what it pays (hourly rate from salary × overtime multiplier). */
  overtimeHours?: number;
  overtimeRate?: number;
  overtimePay?: number;
  /** Fuel for field trips in the cycle (km ÷ 36 km/L × petrol price on the report). */
  fuelKm?: number;
  fuelAllowance?: number;
  approvedExpenses: number;
  performanceScore?: number;
  deductions: SalaryDeductionItem[];
  totalDeductions: number;
  incentive: number;
  netPayable: number;
  remarks?: string;
}

export interface SalaryCycle {
  id: string; // e.g. PAY-2026-10
  title: string;
  startDate: string;
  endDate: string;
  status: SalaryCycleStatus;
  lines: SalaryLine[];
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  preparedBy?: string;
  preparedAt?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  paidOn?: string;
  paymentMethod?: string;
  paymentRef?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- Employee letters: offer → employment agreement + probation letter → confirmation ----------

export type EmployeeLetterKind = 'offer_letter' | 'employment_contract' | 'probation_letter' | 'confirmation_letter';

export interface LetterClause {
  /** Bold lead-in, e.g. "Working Hours". Older letters have none. */
  title?: string;
  body: string;
}

export interface LetterClauseSection {
  heading: string;
  /** Short introduction printed under the heading. */
  intro?: string;
  clauses: LetterClause[];
}

/** issued = printed / handed over; signed = the employee signed it (signed copy may be attached). */
export type EmployeeLetterStatus = 'issued' | 'signed' | 'withdrawn';

export const EMPLOYEE_LETTER_LABELS: Record<EmployeeLetterKind, string> = {
  offer_letter: 'Offer Letter',
  employment_contract: 'Employment Agreement',
  probation_letter: 'Probation Letter',
  confirmation_letter: 'Confirmation Letter',
};

/** When each letter is given. */
export const EMPLOYEE_LETTER_STAGE: Record<EmployeeLetterKind, string> = {
  offer_letter: 'At hiring',
  employment_contract: 'On joining',
  probation_letter: 'On joining',
  confirmation_letter: 'End of probation',
};

/** Terms printed on a letter, frozen when it is issued (later salary or profile edits don't change it). */
export interface EmployeeLetterTerms {
  designation: string;
  department: string;
  reportingTo?: string;
  joiningDate: string;
  probationMonths: number;
  probationEndDate?: string;
  /** Monthly pay: basic + allowances. */
  basicSalary: number;
  allowances: { label: string; amount: number }[];
  grossSalary: number;
  workingHours: string;
  /** Offer letter: last day to accept. */
  offerValidUntil?: string;
  /** Notice either side may give: during probation / once permanent (days). */
  noticeDaysProbation: number;
  noticeDaysPermanent: number;
  /** Confirmation letter: date the employee becomes permanent, and any revised gross pay. */
  confirmationDate?: string;
  revisedGrossSalary?: number;
  /** Extra clauses HR adds for this employee (one per line). */
  extraTerms?: string;
  /** Duties chosen when the letter was issued; each adds its job-specific terms. */
  duties?: EmployeeDuty[];
  /** In HR's own words, what this person will do. */
  jobDescription?: string;
  /**
   * The exact clause wording, saved when the letter is issued: a signed letter must keep printing what
   * the employee signed, even after the standard wording changes. Letters issued before this existed
   * have none and print their original wording.
   */
  clauseSections?: LetterClauseSection[];
}

export interface EmployeeLetter {
  id: string; // e.g. EMP-0007_offer_letter_1
  employeeId: string;
  employeeName: string;
  kind: EmployeeLetterKind;
  /** Reference printed on the letter, e.g. IKPM/HR/OL/2026/0007. */
  refNo: string;
  status: EmployeeLetterStatus;
  terms: EmployeeLetterTerms;
  issuedAt: string;
  issuedBy: string;
  issuedByName: string;
  signedAt?: string;
  /** Scan / photo of the signed copy. */
  signedCopy?: { url: string; fileName: string; fileType: string };
  withdrawnReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
