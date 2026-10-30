
// HR, Employee Management, Daily Attendance, and 30-day Payroll Types (Changes 42, 43, 44, 48)

export type EmployeeStatus = 'hiring' | 'probation' | 'permanent' | 'notice' | 'inactive';

export type EmployeeRole =
  | 'pco'
  | 'operations_coordinator'
  | 'operations_manager'
  | 'team_leader'
  | 'operations'
  | 'cro'
  | 'accounts'
  | 'hr'
  | 'admin'
  | 'management';

export interface Employee {
  id: string; // e.g. EMP-0007
  name: string;
  phone: string;
  email?: string;
  role: EmployeeRole;
  department: string;
  reportingToRole?: string;
  reportingCoordinatorId?: string;
  joiningDate: string; // YYYY-MM-DD
  status: EmployeeStatus;
  probationEndDate?: string; // joiningDate + Settings months (default 3)
  uid?: string; // portal login uid if created (optional, PCOs default to none)
  photoUrl?: string;
  emergencyContact?: string;
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
