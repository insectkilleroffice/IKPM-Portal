import { describe, it, expect } from 'vitest';
import { calculateSalaryLine, DEFAULT_PAYROLL_RULES } from '../lib/payroll';
import type { Employee, EmployeePay, AttendanceRecord } from '../types/hr';
import type { ServiceJob } from '../types/operations';

describe('Payroll Calculation (Change 44)', () => {
  const mockEmployee: Employee = {
    id: 'EMP-0001',
    name: 'Muhammad Asif',
    phone: '03001234567',
    role: 'pco',
    department: 'Operations',
    joiningDate: '2026-01-01',
    status: 'permanent',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const mockPay: EmployeePay = {
    id: 'EMP-0001',
    basicSalary: 30000,
    attendanceAllowance: 3000,
    mobilePackage: 1000,
    bikeMaintenance: 2000,
    totalGross: 36000,
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('calculates full salary when attendance is 100% present', () => {
    // 30 days present
    const attendance: AttendanceRecord[] = Array.from({ length: 30 }, (_, i) => ({
      id: `EMP-0001_2026-10-${String(i + 1).padStart(2, '0')}`,
      employeeId: 'EMP-0001',
      employeeName: 'Muhammad Asif',
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      status: 'present',
      markedBy: 'admin',
      markedByName: 'Admin',
      markedAt: '2026-10-01T08:30:00Z',
    }));

    const line = calculateSalaryLine(mockEmployee, mockPay, attendance, []);

    expect(line.baseSalary).toBe(30000);
    expect(line.allowances).toBe(6000); // 3000 + 1000 + 2000
    expect(line.attendanceDays).toBe(30);
    expect(line.lateMarks).toBe(0);
    expect(line.totalDeductions).toBe(0);
    expect(line.netPayable).toBe(36000);
  });

  it('deducts daily wage for absences and applies 3-late penalty', () => {
    // Base salary = 30000 -> Daily wage = 30000 / 30 = 1000 PKR
    // 25 present, 3 late (equals 1 day absence penalty), 2 absent
    const attendance: AttendanceRecord[] = [
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `att_${i}`,
        employeeId: 'EMP-0001',
        employeeName: 'Muhammad Asif',
        date: `2026-10-${i + 1}`,
        status: 'present' as const,
        markedBy: 'admin',
        markedByName: 'Admin',
        markedAt: '2026-10-01T08:30:00Z',
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `att_late_${i}`,
        employeeId: 'EMP-0001',
        employeeName: 'Muhammad Asif',
        date: `2026-10-${26 + i}`,
        status: 'late' as const,
        markedBy: 'admin',
        markedByName: 'Admin',
        markedAt: '2026-10-01T09:15:00Z',
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `att_absent_${i}`,
        employeeId: 'EMP-0001',
        employeeName: 'Muhammad Asif',
        date: `2026-10-${29 + i}`,
        status: 'absent' as const,
        markedBy: 'admin',
        markedByName: 'Admin',
        markedAt: '2026-10-01T08:30:00Z',
      })),
    ];

    const line = calculateSalaryLine(mockEmployee, mockPay, attendance, []);

    // 2 absences = 2000 PKR
    // 3 lates = 1 absence penalty = 1000 PKR
    // Total deductions = 3000 PKR
    expect(line.totalDeductions).toBe(3000);
    expect(line.netPayable).toBe(36000 - 3000);
  });

  it('adds verified job incentives for PCOs', () => {
    const jobs: Partial<ServiceJob>[] = [
      {
        id: 'JOB-001',
        leadPcoEmployeeId: 'EMP-0001',
        supervisorVerification: { isVerified: true, verifiedAt: '2026-10-15', supervisorName: 'QC', qcRating: 5 },
      } as unknown as ServiceJob,
      {
        id: 'JOB-002',
        performedByPcoIds: ['EMP-0001'],
        supervisorVerification: { isVerified: true, verifiedAt: '2026-10-16', supervisorName: 'QC', qcRating: 5 },
      } as unknown as ServiceJob,
    ];

    const line = calculateSalaryLine(mockEmployee, mockPay, [], jobs as ServiceJob[], {
      ...DEFAULT_PAYROLL_RULES,
      jobIncentivePerUnit: 150,
    });

    expect(line.verifiedJobs).toBe(2);
    expect(line.incentive).toBe(300); // 2 * 150
  });
});
