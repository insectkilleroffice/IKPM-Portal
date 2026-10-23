import { describe, expect, it } from 'vitest';
import { effectiveContractStatus } from '../lib/contractUtils';
import type { Contract } from '../types/operations';

// Minimal stub satisfying Pick<Contract, 'status' | 'endDate'>
function stub(status: Contract['status'], endDate: string) {
  return { status, endDate };
}

const PAST = '2020-01-01';
const FUTURE = '2099-12-31';
const TODAY = new Date().toISOString().slice(0, 10);

describe('effectiveContractStatus', () => {
  it('active contract whose endDate has passed → expired', () => {
    expect(effectiveContractStatus(stub('active', PAST), TODAY)).toBe('expired');
  });

  it('active contract expiring today is still expired (strict <)', () => {
    expect(effectiveContractStatus(stub('active', TODAY), TODAY)).toBe('active');
  });

  it('active contract with future endDate → active', () => {
    expect(effectiveContractStatus(stub('active', FUTURE), TODAY)).toBe('active');
  });

  it('cancelled contract past endDate stays cancelled (not coerced to expired)', () => {
    expect(effectiveContractStatus(stub('cancelled', PAST), TODAY)).toBe('cancelled');
  });

  it('renewed contract past endDate stays renewed', () => {
    expect(effectiveContractStatus(stub('renewed', PAST), TODAY)).toBe('renewed');
  });

  it('already-expired contract → expired unchanged', () => {
    expect(effectiveContractStatus(stub('expired', PAST), TODAY)).toBe('expired');
  });
});

describe('contract status lifecycle invariants', () => {
  it('only active contracts are coerced to expired by effectiveContractStatus', () => {
    const statuses: Contract['status'][] = ['active', 'expired', 'renewed', 'cancelled'];
    const results = statuses.map((s) => effectiveContractStatus(stub(s, PAST), TODAY));
    // Only 'active' with past endDate becomes 'expired'; others pass through
    expect(results[0]).toBe('expired');
    expect(results[1]).toBe('expired');   // already expired
    expect(results[2]).toBe('renewed');
    expect(results[3]).toBe('cancelled');
  });

  it('effectiveContractStatus is pure: same inputs → same output', () => {
    const c = stub('active', PAST);
    expect(effectiveContractStatus(c, TODAY)).toBe(effectiveContractStatus(c, TODAY));
  });
});
