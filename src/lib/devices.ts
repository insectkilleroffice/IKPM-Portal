// Device register and monitoring helpers. Pure, so they are unit-tested and shared by the
// register panel, the PCO monitoring step and the PDF / Excel exports.

import type { Device, DeviceType, MonitoringRecord } from '../types/devices';

export const DEVICE_TYPES: { value: DeviceType; label: string; short: string }[] = [
  { value: 'mechanical_trap', label: 'Mechanical trap', short: 'MT' },
  { value: 'glue_station', label: 'Glue station', short: 'GS' },
  { value: 'bait_station', label: 'Bait station', short: 'BS' },
  { value: 'efk', label: 'EFK (fly killer)', short: 'EFK' },
  { value: 'roach_monitor', label: 'Roach monitor', short: 'RM' },
  { value: 'gel_point', label: 'Gel point', short: 'GP' },
];

export const deviceTypeLabel = (t: DeviceType) => DEVICE_TYPES.find((d) => d.value === t)?.label ?? t;
export const deviceCode = (d: Pick<Device, 'type' | 'number'>) => `${DEVICE_TYPES.find((x) => x.value === d.type)?.short ?? d.type}-${d.number}`;

/** Stable id: one device per client / branch / type / number. */
export const deviceId = (clientId: string, branchId: string | undefined, type: DeviceType, n: number) =>
  `DEV-${clientId}-${branchId || 'HQ'}-${type}-${n}`;

/**
 * "1-30 Outside", "31-40 Kitchen", "5 Store room" → number range + location.
 * Locations containing "out" are outdoor unless stated.
 */
export function parseBulk(spec: string): { from: number; to: number; location: string; indoorOutdoor: 'indoor' | 'outdoor' } | null {
  const m = spec.trim().match(/^(\d+)\s*(?:[-–to]+\s*(\d+))?\s*(.*)$/i);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  if (!from || to < from || to - from > 499) return null;
  const location = m[3].trim() || 'Unspecified';
  return { from, to, location, indoorOutdoor: /\bout/i.test(location) ? 'outdoor' : 'indoor' };
}

/** Devices for a bulk spec; numbers already active are skipped (returned in `skipped`). */
export function bulkDevices(
  spec: string,
  base: { clientId: string; clientType?: Device['clientType']; branchId?: string; type: DeviceType; installedAt: string },
  existing: Device[]
): { devices: Device[]; skipped: number[] } {
  const p = parseBulk(spec);
  if (!p) return { devices: [], skipped: [] };
  const taken = new Set(existing.filter((d) => d.type === base.type && d.status === 'active' && (d.branchId || '') === (base.branchId || '') && d.clientId === base.clientId).map((d) => d.number));
  const devices: Device[] = [];
  const skipped: number[] = [];
  for (let n = p.from; n <= p.to; n++) {
    if (taken.has(n)) {
      skipped.push(n);
      continue;
    }
    devices.push({
      id: deviceId(base.clientId, base.branchId, base.type, n),
      clientId: base.clientId,
      clientType: base.clientType,
      branchId: base.branchId,
      type: base.type,
      number: n,
      location: p.location,
      indoorOutdoor: p.indoorOutdoor,
      status: 'active',
      installedAt: base.installedAt,
    });
  }
  return { devices, skipped };
}

export const nextDeviceNumber = (existing: Device[], type: DeviceType) =>
  existing.filter((d) => d.type === type).reduce((m, d) => Math.max(m, d.number), 0) + 1;

export const sortDevices = (list: Device[]) =>
  [...list].sort((a, b) => DEVICE_TYPES.findIndex((t) => t.value === a.type) - DEVICE_TYPES.findIndex((t) => t.value === b.type) || a.number - b.number);

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export const activityOf = (r: Pick<MonitoringRecord, 'rodentFound' | 'lizardFound'>) => (r.rodentFound || 0) + (r.lizardFound || 0);

/** Calendar quarter of a date: { key: '2026-Q4', start, end } (dates as YYYY-MM-DD). */
export function quarterOf(date: string) {
  const [y, m] = date.slice(0, 10).split('-').map(Number);
  const q = Math.floor((m - 1) / 3);
  const pad = (n: number) => String(n).padStart(2, '0');
  const endDay = new Date(y, q * 3 + 3, 0).getDate();
  return { key: `${y}-Q${q + 1}`, start: `${y}-${pad(q * 3 + 1)}-01`, end: `${y}-${pad(q * 3 + 3)}-${pad(endDay)}` };
}

export const previousQuarter = (date: string) => {
  const { start } = quarterOf(date);
  const [y, m] = start.split('-').map(Number);
  return quarterOf(m === 1 ? `${y - 1}-10-01` : `${y}-${String(m - 3).padStart(2, '0')}-01`);
};

export interface TrendRow {
  key: string;
  label: string;
  current: number;
  previous: number;
  checks: number;
}

/**
 * Quarterly trend: activity (rodent + lizard catches) per device and per area, this quarter vs
 * the previous one. Hotspots are the devices / areas with the most activity this quarter.
 */
export function quarterlyTrend(records: MonitoringRecord[], date: string) {
  const cur = quarterOf(date);
  const prev = previousQuarter(date);
  const inQ = (r: MonitoringRecord, q: { start: string; end: string }) => r.serviceDate.slice(0, 10) >= q.start && r.serviceDate.slice(0, 10) <= q.end;
  const group = (keyOf: (r: MonitoringRecord) => [string, string]) => {
    const map = new Map<string, TrendRow>();
    records.forEach((r) => {
      const isCur = inQ(r, cur);
      if (!isCur && !inQ(r, prev)) return;
      const [key, label] = keyOf(r);
      const row = map.get(key) ?? { key, label, current: 0, previous: 0, checks: 0 };
      if (isCur) {
        row.current += activityOf(r);
        row.checks += 1;
      } else row.previous += activityOf(r);
      map.set(key, row);
    });
    return [...map.values()].sort((a, b) => b.current - a.current || a.label.localeCompare(b.label));
  };
  const byDevice = group((r) => [r.deviceId, `${deviceCode({ type: r.deviceType, number: r.deviceNumber })} ${r.location}`]);
  const byArea = group((r) => [r.location.toLowerCase(), r.location]);
  const total = (rows: TrendRow[], k: 'current' | 'previous') => rows.reduce((s, r) => s + r[k], 0);
  return {
    quarter: cur,
    previousQuarter: prev,
    byDevice,
    byArea,
    hotspots: byDevice.filter((r) => r.current > 0).slice(0, 5),
    totalCurrent: total(byDevice, 'current'),
    totalPrevious: total(byDevice, 'previous'),
    damaged: records.filter((r) => inQ(r, cur) && r.damaged).length,
    replaced: records.filter((r) => inQ(r, cur) && r.replaced).length,
  };
}
