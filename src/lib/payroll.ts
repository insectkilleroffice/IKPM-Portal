import type { AttendanceRecord, Employee, EmployeePay, SalaryDeductionItem, SalaryLine } from '../types/hr';
import type { ServiceJob } from '../types/operations';

export interface PayrollRules {
  daysInCycle: number;
  lateMarksPerAbsence: number;
  lateDeductionFixed: number;
  absenceDeductionRatio: number;
  jobIncentivePerUnit: number;
  /** Normal working hours in a day; the hourly rate is salary ÷ days in cycle ÷ these hours. */
  standardHoursPerDay: number;
  /** Overtime pays this many times the normal hourly rate (Pakistani labour law: 2× for factories / shops). */
  overtimeMultiplier: number;
}

export const DEFAULT_PAYROLL_RULES: PayrollRules = {
  daysInCycle: 30,
  lateMarksPerAbsence: 3,
  lateDeductionFixed: 0,
  absenceDeductionRatio: 1.0,
  jobIncentivePerUnit: 100, // PKR per verified job
  standardHoursPerDay: 8,
  overtimeMultiplier: 2,
};

/** The payroll rules in use: Settings → Payroll values over the built-in defaults. */
export function payrollRulesFrom(saved?: Partial<PayrollRules>): PayrollRules {
  const r = { ...DEFAULT_PAYROLL_RULES };
  (Object.keys(r) as (keyof PayrollRules)[]).forEach((k) => {
    const v = Number(saved?.[k]);
    if (saved?.[k] !== undefined && saved?.[k] !== null && Number.isFinite(v) && v >= 0) r[k] = v;
  });
  return r;
}

/** Normal hourly rate from salary, and the overtime rate (a fixed rate on the pay record wins). */
export function overtimeRateFor(pay: EmployeePay | undefined, rules: PayrollRules = DEFAULT_PAYROLL_RULES): number {
  if (pay?.overtimeHourlyRate) return pay.overtimeHourlyRate;
  const base = pay?.basicSalary || 0;
  if (!base || rules.daysInCycle <= 0 || rules.standardHoursPerDay <= 0) return 0;
  return Math.round((base / rules.daysInCycle / rules.standardHoursPerDay) * rules.overtimeMultiplier);
}

/**
 * Calculates a single employee's salary line for a 30-day cycle.
 * Pure function suitable for unit tests and deterministic execution.
 */
export function calculateSalaryLine(
  employee: Employee,
  pay: EmployeePay | undefined,
  attendanceRecords: AttendanceRecord[],
  jobs: ServiceJob[],
  rules: PayrollRules = DEFAULT_PAYROLL_RULES
): SalaryLine {
  const baseSalary = pay?.basicSalary || 0;
  const allowances = (pay?.attendanceAllowance || 0) + (pay?.mobilePackage || 0) + (pay?.bikeMaintenance || 0);
  const dailyWage = rules.daysInCycle > 0 ? baseSalary / rules.daysInCycle : 0;

  // Filter attendance for this employee in the cycle
  const empAttendance = attendanceRecords.filter((a) => a.employeeId === employee.id);
  const halfDays = empAttendance.filter((a) => a.status === 'half_day').length;
  const lateMarks = empAttendance.filter((a) => a.status === 'late').length;
  const absentDays = empAttendance.filter((a) => a.status === 'absent').length;

  // Attendance is automatic: a day nobody marked counts as present. Only absences and half days
  // reduce the days worked (leave and off days are paid).
  const totalAttendanceDays = Math.max(0, rules.daysInCycle - absentDays - halfDays * 0.5);

  // Overtime, from the hours entered on the daily sheet
  const overtimeHours = empAttendance.reduce((sum, a) => sum + (Number(a.overtimeHours) || 0), 0);
  const overtimeRate = overtimeRateFor(pay, rules);
  const overtimePay = Math.round(overtimeHours * overtimeRate);

  // Count verified jobs where employee was assigned or performed
  const verifiedJobs = jobs.filter((j) => {
    if (!j.supervisorVerification?.isVerified) return false;
    const isLead = j.leadPcoEmployeeId === employee.id || j.leadPcoId === employee.id;
    const isAssigned = j.assignedPcoEmployeeIds?.includes(employee.id) || j.performedByPcoIds?.includes(employee.id);
    return isLead || isAssigned;
  }).length;

  // Compute deductions
  const deductions: SalaryDeductionItem[] = [];

  // 1. Absence deduction
  if (absentDays > 0) {
    const amount = Math.round(absentDays * dailyWage * rules.absenceDeductionRatio);
    deductions.push({
      ruleName: 'Absence Deduction',
      amount,
      reason: `${absentDays} day(s) absent @ ${Math.round(dailyWage)} PKR/day`,
    });
  }

  // 2. Half day deduction
  if (halfDays > 0) {
    const amount = Math.round(halfDays * 0.5 * dailyWage);
    deductions.push({
      ruleName: 'Half Day Deduction',
      amount,
      reason: `${halfDays} half-day(s) @ 50% daily wage`,
    });
  }

  // 3. Late arrival deduction
  if (rules.lateMarksPerAbsence > 0 && lateMarks >= rules.lateMarksPerAbsence) {
    const equivalentAbsences = Math.floor(lateMarks / rules.lateMarksPerAbsence);
    const amount = Math.round(equivalentAbsences * dailyWage);
    deductions.push({
      ruleName: 'Late Arrival Penalty',
      amount,
      reason: `${lateMarks} late marks (${rules.lateMarksPerAbsence} lates = 1 day salary)`,
    });
  } else if (rules.lateDeductionFixed > 0 && lateMarks > 0) {
    const amount = lateMarks * rules.lateDeductionFixed;
    deductions.push({
      ruleName: 'Late Arrival Fixed Charge',
      amount,
      reason: `${lateMarks} late arrival(s) @ ${rules.lateDeductionFixed} PKR`,
    });
  }

  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);

  // Incentives (e.g. verified jobs incentive for PCOs)
  const incentive = employee.role === 'pco' ? verifiedJobs * rules.jobIncentivePerUnit : 0;

  // Net payable calculation
  const grossPay = baseSalary + allowances;
  const netPayable = Math.max(0, grossPay + incentive + overtimePay - totalDeductions);

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    role: employee.role,
    baseSalary,
    allowances,
    attendanceDays: totalAttendanceDays,
    lateMarks,
    verifiedJobs,
    overtimeHours,
    overtimeRate,
    overtimePay,
    approvedExpenses: 0,
    performanceScore: 100,
    deductions,
    totalDeductions,
    incentive,
    netPayable,
  };
}

