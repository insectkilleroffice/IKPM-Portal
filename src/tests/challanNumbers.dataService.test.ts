// A physical challan number can be used on one job only.
import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => {
  const noop = () => () => {};
  return {
    collection: vi.fn(() => ({})), doc: vi.fn(() => ({})), limit: vi.fn(), orderBy: vi.fn(), query: vi.fn(() => ({})), where: vi.fn(),
    onSnapshot: vi.fn(noop), setDoc: vi.fn(() => Promise.resolve()),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
    writeBatch: vi.fn(() => ({ set: vi.fn(), update: vi.fn(), commit: vi.fn(() => Promise.resolve()) })),
  };
});
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/cloudinary', () => ({ deleteFromCloudinary: vi.fn(() => Promise.resolve()) }));

const { dataService } = await import('../services/dataService');
import type { Challan } from '../types/operations';

const challan = (jobId: string, challanNumber: string): Challan => ({
  id: `CHL-${jobId}`, challanNumber, challanKey: '', jobId, customerId: 'CO-1', customerName: 'Shan Foods', clientType: 'company',
  challanDate: '2026-11-03', fileUrl: '', fileName: 'x.pdf', uploadedBy: 'a', uploadedByName: 'A', uploadedAt: '2026-11-03', status: 'active',
} as Challan);

describe('physical challan numbers', () => {
  it('cannot be used on two jobs, whatever the spacing or case', async () => {
    dataService.saveChallan(challan('JOB-1', 'CH-0012'));
    expect(dataService.challanNumberUsedBy('ch 0012', 'JOB-2')).toBe('JOB-1');
    expect(() => dataService.saveChallan(challan('JOB-2', 'ch0012'))).toThrow(/already used on job JOB-1/);
    await expect(dataService.assertChallanNumberFree('CH0012', 'JOB-2')).rejects.toThrow(/already used/);
  });

  it('the same job may save its own number again, and a new number is free', async () => {
    expect(() => dataService.saveChallan(challan('JOB-1', 'CH-0012'))).not.toThrow();
    await expect(dataService.assertChallanNumberFree('CH-0013', 'JOB-2')).resolves.toBeUndefined();
  });
});
