import { describe, expect, it } from 'vitest';
import { bulkDevices, deviceCode, parseBulk, quarterlyTrend, quarterOf, previousQuarter } from '../lib/devices';
import type { Device, MonitoringRecord } from '../types/devices';

describe('parseBulk', () => {
  it('reads ranges and locations', () => {
    expect(parseBulk('1-30 Outside')).toEqual({ from: 1, to: 30, location: 'Outside', indoorOutdoor: 'outdoor' });
    expect(parseBulk('31 - 40 Kitchen')).toEqual({ from: 31, to: 40, location: 'Kitchen', indoorOutdoor: 'indoor' });
    expect(parseBulk('5 Store room')).toEqual({ from: 5, to: 5, location: 'Store room', indoorOutdoor: 'indoor' });
    expect(parseBulk('10-2 x')).toBeNull();
    expect(parseBulk('Outside')).toBeNull();
  });
});

describe('bulkDevices', () => {
  const base = { clientId: 'C1', branchId: 'B1', type: 'mechanical_trap' as const, installedAt: '2026-10-01' };
  it('creates numbered devices and skips active numbers', () => {
    const existing: Device[] = [{ ...base, id: 'x', number: 2, location: 'Gate', indoorOutdoor: 'outdoor', status: 'active' }];
    const { devices, skipped } = bulkDevices('1-4 Outside', base, existing);
    expect(devices.map((d) => d.number)).toEqual([1, 3, 4]);
    expect(skipped).toEqual([2]);
    expect(devices[0].id).toBe('DEV-C1-B1-mechanical_trap-1');
    expect(deviceCode(devices[0])).toBe('MT-1');
  });
});

describe('quarterlyTrend', () => {
  const rec = (deviceNumber: number, location: string, serviceDate: string, rodentFound: number): MonitoringRecord => ({
    id: `${serviceDate}_${deviceNumber}`, jobId: 'J', deviceId: `D${deviceNumber}`, deviceType: 'glue_station', deviceNumber, location,
    clientId: 'C1', visitKind: 'service', serviceDate, rodentFound, lizardFound: 0, damaged: false, replaced: false, attractantChanged: false,
    recordedByUid: 'u', recordedByName: 'U', recordedAt: serviceDate,
  });
  it('compares this quarter to the previous one and finds hotspots', () => {
    const t = quarterlyTrend([rec(1, 'Kitchen', '2026-10-05', 3), rec(2, 'Store', '2026-11-05', 1), rec(1, 'Kitchen', '2026-08-01', 1), rec(2, 'Store', '2026-01-01', 9)], '2026-10-21');
    expect(t.quarter.key).toBe('2026-Q4');
    expect(t.totalCurrent).toBe(4);
    expect(t.totalPrevious).toBe(1);
    expect(t.hotspots[0]).toMatchObject({ label: 'GS-1 Kitchen', current: 3, previous: 1 });
    expect(t.byArea.map((a) => a.label)).toEqual(['Kitchen', 'Store']);
  });
  it('handles quarter boundaries', () => {
    expect(quarterOf('2026-02-28')).toEqual({ key: '2026-Q1', start: '2026-01-01', end: '2026-03-31' });
    expect(previousQuarter('2026-02-01').key).toBe('2025-Q4');
  });
});
