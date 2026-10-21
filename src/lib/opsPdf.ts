// Operations documents: pest management layout (Step 12), monitoring sheets and quarterly trend
// report (Step 13) and the visit schedule (Step 14). Built on the shared letterhead in pdfGenerator.

import type jsPDF from 'jspdf';
import { formatDate } from './formatters';
import { pdfKit } from './pdfGenerator';
import { DEVICE_TYPES, deviceCode, deviceTypeLabel, quarterlyTrend, sortDevices } from './devices';
import type { Device, DeviceType, MonitoringRecord } from '../types/devices';

const yesNo = (v?: boolean) => (v === undefined ? '' : v ? 'Yes' : 'No');
const safe = (s: string) => s.replace(/[^\w-]+/g, '_').replace(/_+/g, '_');

// ---------------------------------------------------------------------------
// Pest management layout
// ---------------------------------------------------------------------------
export interface LayoutInput {
  clientName: string;
  siteName?: string;
  address?: string;
  documentNo: string;
  effectiveDate: string;
  reviewDate: string;
  preparedBy: string;
  checkedBy: string;
  devices: Device[];
  floorPlanUrl?: string;
}

async function buildLayout(l: LayoutInput): Promise<jsPDF> {
  const { b } = await pdfKit.builder('Pest Management Layout', l.documentNo);
  b.titleBand(
    [
      { label: 'Document No.', value: l.documentNo },
      { label: 'Effective date', value: formatDate(l.effectiveDate) },
      { label: 'Review date', value: formatDate(l.reviewDate) },
      { label: 'Prepared by', value: l.preparedBy },
      { label: 'Checked by', value: l.checkedBy || '—' },
    ],
    `Device layout for ${l.clientName}${l.siteName ? ` (${l.siteName})` : ''}`
  );
  const devices = sortDevices(l.devices.filter((d) => d.status === 'active'));
  if (l.floorPlanUrl) {
    const img = await pdfKit.loadImage(l.floorPlanUrl, 1600);
    if (img) {
      b.section('Floor plan', 60);
      b.floorPlan(img, devices.filter((d) => d.pinX !== undefined && d.pinY !== undefined).map((d) => ({ x: d.pinX!, y: d.pinY!, label: String(d.number) })));
    }
  }
  b.section('Device summary', 24);
  b.table(
    ['Device', 'Count', 'Numbers'],
    DEVICE_TYPES.map((t) => {
      const list = devices.filter((d) => d.type === t.value);
      return list.length ? [t.label, list.length, list.map((d) => d.number).join(', ')] : null;
    }).filter(Boolean) as (string | number)[][]
  );
  b.section('Device register', 24);
  b.table(['Code', 'Type', 'Location', 'In / Out', 'Installed'], devices.map((d) => [deviceCode(d), deviceTypeLabel(d.type), d.location, d.indoorOutdoor === 'outdoor' ? 'Outdoor' : 'Indoor', formatDate(d.installedAt)]));
  b.signatures([
    { label: 'Prepared by', name: l.preparedBy },
    { label: 'Checked by', name: l.checkedBy || ' ' },
  ]);
  return b.finish();
}

// ---------------------------------------------------------------------------
// Monitoring sheet (Mechanical Trap / Glue Station sheet layout)
// ---------------------------------------------------------------------------
export interface MonitoringSheetInput {
  clientName: string;
  location: string;
  pcoName: string;
  serviceDate: string;
  followUpDate?: string;
  /** Devices in the sheet, with the service and follow-up checks for each. */
  rows: { device: Device; service?: MonitoringRecord; followUp?: MonitoringRecord }[];
}

const sheetTitle = (types: DeviceType[]) =>
  types.length === 1 ? `${deviceTypeLabel(types[0])} Monitoring Sheet` : 'Mechanical Trap / Glue Station Monitoring Sheet';

const checkCells = (r?: MonitoringRecord) =>
  r ? [r.rodentFound || '', r.lizardFound || '', yesNo(r.damaged), yesNo(r.replaced), yesNo(r.attractantChanged)] : ['', '', '', '', ''];

const SHEET_HEAD = ['No.', 'Location', 'Rodent', 'Lizard', 'Damage', 'Replaced', 'Attractant', 'Rodent', 'Lizard', 'Damage', 'Replaced', 'Attractant'];

async function buildMonitoringSheet(m: MonitoringSheetInput): Promise<jsPDF> {
  const types = [...new Set(m.rows.map((r) => r.device.type))];
  const { b } = await pdfKit.builder(sheetTitle(types), `${safe(m.clientName)}-${m.serviceDate.slice(0, 10)}`);
  b.titleBand(
    [
      { label: 'Client', value: m.clientName },
      { label: 'Location', value: m.location || '—' },
      { label: 'PCO name', value: m.pcoName || '—' },
      { label: 'Service date', value: formatDate(m.serviceDate) },
      { label: 'Follow-up date', value: m.followUpDate ? formatDate(m.followUpDate) : '—' },
    ]
  );
  const rows = [...m.rows].sort((a, b) => a.device.type.localeCompare(b.device.type) || a.device.number - b.device.number);
  types.forEach((t) => {
    b.section(`${deviceTypeLabel(t)}s`, 30);
    b.paragraph('Columns 3–7: service visit. Columns 8–12: follow-up visit.', 7.5, pdfKit.MUTED);
    b.table(
      SHEET_HEAD,
      rows.filter((r) => r.device.type === t).map((r) => [deviceCode(r.device), r.device.location, ...checkCells(r.service), ...checkCells(r.followUp)]),
      { styles: { fontSize: 7, halign: 'center' }, columnStyles: { 1: { halign: 'left', cellWidth: 34 } } }
    );
  });
  b.signatures([
    { label: 'PCO', name: m.pcoName || ' ' },
    { label: 'Client representative', name: ' ' },
  ]);
  return b.finish();
}

async function monitoringSheetXlsx(m: MonitoringSheetInput): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const bold = (value: string) => ({ value, fontWeight: 'bold' as const });
  const header = [
    [bold(sheetTitle([...new Set(m.rows.map((r) => r.device.type))]))],
    [bold('Client'), { value: m.clientName }],
    [bold('Location'), { value: m.location }],
    [bold('PCO name'), { value: m.pcoName }],
    [bold('Service date'), { value: formatDate(m.serviceDate) }],
    [bold('Follow-up date'), { value: m.followUpDate ? formatDate(m.followUpDate) : '' }],
    [],
    [bold(''), bold(''), bold('Service'), null, null, null, null, bold('Follow-up')],
    SHEET_HEAD.map(bold),
  ];
  const cell = (v: string | number) => ({ value: typeof v === 'number' ? v : String(v), type: typeof v === 'number' ? Number : String });
  const body = [...m.rows]
    .sort((a, b) => a.device.type.localeCompare(b.device.type) || a.device.number - b.device.number)
    .map((r) => [deviceCode(r.device), r.device.location, ...checkCells(r.service), ...checkCells(r.followUp)].map(cell));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return writeXlsxFile([...header, ...body] as any, { columns: SHEET_HEAD.map((_, i) => ({ width: i === 1 ? 26 : 10 })) }).toBlob();
}

// ---------------------------------------------------------------------------
// Quarterly trend report
// ---------------------------------------------------------------------------
export interface TrendInput {
  clientName: string;
  location?: string;
  date: string;
  preparedBy: string;
  records: MonitoringRecord[];
}

async function buildTrend(t: TrendInput): Promise<jsPDF> {
  const trend = quarterlyTrend(t.records, t.date);
  const { b } = await pdfKit.builder('Quarterly Trend Report', `${safe(t.clientName)}-${trend.quarter.key}`);
  b.titleBand(
    [
      { label: 'Quarter', value: `${trend.quarter.key} (${formatDate(trend.quarter.start)} – ${formatDate(trend.quarter.end)})` },
      { label: 'Compared with', value: trend.previousQuarter.key },
      { label: 'Prepared by', value: t.preparedBy },
    ],
    `Pest activity trend for ${t.clientName}${t.location ? ` (${t.location})` : ''}`
  );
  const change = trend.totalCurrent - trend.totalPrevious;
  b.keyValues([
    ['Activity this quarter', String(trend.totalCurrent)],
    ['Previous quarter', String(trend.totalPrevious)],
    ['Change', `${change > 0 ? '+' : ''}${change}`],
    ['Devices damaged / replaced', `${trend.damaged} / ${trend.replaced}`],
  ]);
  b.section('Hotspots', 24);
  if (trend.hotspots.length) b.table(['Device', 'This quarter', 'Previous'], trend.hotspots.map((r) => [r.label, r.current, r.previous]));
  else b.paragraph('No rodent or lizard activity was recorded on any device this quarter.');
  b.section('Activity by area', 24);
  b.table(['Area', 'This quarter', 'Previous', 'Checks'], trend.byArea.map((r) => [r.label, r.current, r.previous, r.checks]));
  b.section('Activity by device', 24);
  b.table(['Device', 'This quarter', 'Previous', 'Checks'], trend.byDevice.map((r) => [r.label, r.current, r.previous, r.checks]));
  b.signatures([{ label: 'Prepared by', name: t.preparedBy }]);
  return b.finish();
}

// ---------------------------------------------------------------------------
// Visit schedule ("Dunkin" format: branch, closing time, 1st and 2nd service date per month)
// ---------------------------------------------------------------------------
export interface ScheduleInput {
  clientName: string;
  contractId: string;
  preparedBy: string;
  visits: { branchName: string; closingTime?: string; date: string; kind: 'service' | 'follow_up'; pcoName?: string }[];
}

async function buildSchedule(s: ScheduleInput): Promise<jsPDF> {
  const { b } = await pdfKit.builder('Service Schedule', s.contractId);
  const dates = s.visits.map((v) => v.date).sort();
  b.titleBand(
    [
      { label: 'Contract', value: s.contractId },
      { label: 'From', value: dates[0] ? formatDate(dates[0]) : '—' },
      { label: 'To', value: dates.length ? formatDate(dates[dates.length - 1]) : '—' },
      { label: 'Prepared by', value: s.preparedBy },
    ],
    `Visit schedule for ${s.clientName}`
  );
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  months.forEach((month) => {
    const inMonth = s.visits.filter((v) => v.date.startsWith(month));
    const branches = [...new Set(inMonth.map((v) => v.branchName))].sort();
    b.section(new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), 24);
    b.table(
      ['Branch', 'Closing time', '1st service date', '2nd service date', 'Follow-up dates'],
      branches.map((name) => {
        const v = inMonth.filter((x) => x.branchName === name);
        const svc = v.filter((x) => x.kind === 'service').map((x) => x.date).sort();
        const fu = v.filter((x) => x.kind === 'follow_up').map((x) => formatDate(x.date));
        return [name, v[0]?.closingTime || '—', svc[0] ? formatDate(svc[0]) : '—', svc[1] ? formatDate(svc[1]) : '—', [...svc.slice(2).map(formatDate), ...fu].join(', ') || '—'];
      })
    );
  });
  return b.finish();
}

export const opsPdf = {
  layoutBlob: async (l: LayoutInput) => (await buildLayout(l)).output('blob'),
  layoutFileName: (l: LayoutInput) => `Pest_Management_Layout_${safe(l.documentNo)}.pdf`,
  monitoringBlob: async (m: MonitoringSheetInput) => (await buildMonitoringSheet(m)).output('blob'),
  monitoringXlsx: monitoringSheetXlsx,
  monitoringFileName: (m: MonitoringSheetInput, ext: 'pdf' | 'xlsx') => `Monitoring_Sheet_${safe(m.clientName)}_${m.serviceDate.slice(0, 10)}.${ext}`,
  trendBlob: async (t: TrendInput) => (await buildTrend(t)).output('blob'),
  trendFileName: (t: TrendInput) => `Trend_Report_${safe(t.clientName)}_${quarterlyTrend([], t.date).quarter.key}.pdf`,
  scheduleBlob: async (s: ScheduleInput) => (await buildSchedule(s)).output('blob'),
  scheduleFileName: (s: ScheduleInput) => `Service_Schedule_${safe(s.contractId)}.pdf`,
};

/** Browser download (used when file storage is off or offline). */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
