import { describe, expect, it } from 'vitest';
import { fuelCost, fuelForEmployee } from '../lib/fuel';
import { calculateSalaryLine } from '../lib/payroll';
import type { Employee, EmployeePay } from '../types/hr';
import type { ServiceJob } from '../types/operations';

const verified = { isVerified: true, verifiedAt: '2026-11-01', supervisorName: 'QC', qcRating: 5 };
const claim = (employeeId: string, kmGoing: number, kmReturn: number, price = 270) => ({
  employeeId, name: employeeId, role: 'pco' as const, kmGoing, kmReturn, ...fuelCost(kmGoing, kmReturn, price),
});

describe('fuel for field trips', () => {
  it('13 km going + 13 km back at 36 km/L and PKR 270/L', () => {
    // 26 km ÷ 36 = 0.72 L × 270 = PKR 195
    expect(fuelCost(13, 13, 270)).toEqual({ km: 26, litres: 0.72, amount: 195 });
  });

  it('pays only verified visits and client-blocked trips', () => {
    const jobs = [
      { id: 'J1', supervisorVerification: verified, fuelClaims: [claim('EMP-1', 13, 13)] },
      { id: 'J2', visitOutcome: 'client_blocked', fuelClaims: [claim('EMP-1', 10, 10)] },
      { id: 'J3', fuelClaims: [claim('EMP-1', 50, 50)] }, // waiting for QC
      { id: 'J4', supervisorVerification: verified, fuelClaims: [claim('EMP-2', 13, 13)] },
    ] as unknown as ServiceJob[];
    expect(fuelForEmployee('EMP-1', jobs)).toEqual({ km: 46, amount: 195 + 150, trips: 2 });
  });

  it('adds fuel to net salary', () => {
    const emp: Employee = { id: 'EMP-1', name: 'Usman', phone: '', role: 'pco', department: 'Operations', joiningDate: '2026-01-01', status: 'permanent', createdAt: '', updatedAt: '' };
    const pay: EmployeePay = { id: 'EMP-1', basicSalary: 30000, attendanceAllowance: 0, mobilePackage: 0, bikeMaintenance: 0, totalGross: 30000, updatedAt: '' };
    const jobs = [{ id: 'J1', fuelClaims: [claim('EMP-1', 13, 13)], visitOutcome: 'client_blocked' }] as unknown as ServiceJob[];
    const line = calculateSalaryLine(emp, pay, [], jobs);
    expect(line.fuelAllowance).toBe(195);
    expect(line.fuelKm).toBe(26);
    expect(line.netPayable).toBe(30000 + 195);
  });
});
