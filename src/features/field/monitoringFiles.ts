// Monitoring sheet (PDF + Excel) for a visit, filed into the client's Monitoring Sheets folder.
// A follow-up visit's sheet shows its service visit alongside (and vice versa).

import { dataService } from '../../services/dataService';
import { opsPdf, type MonitoringSheetInput } from '../../lib/opsPdf';
import { fileGenerated } from '../documents/fileGenerated';
import type { ServiceJob } from '../../types/operations';
import type { DocumentOwner } from '../../types/document';

export function monitoringSheetInput(job: ServiceJob): MonitoringSheetInput | null {
  const paired = job.pairedJobId ? dataService.getJobById(job.pairedJobId) : undefined;
  const serviceJob = job.visitKind === 'follow_up' ? paired : job;
  const followJob = job.visitKind === 'follow_up' ? job : paired;
  const recs = (j?: ServiceJob) => (j ? dataService.getMonitoringRecords({ jobId: j.id }) : []);
  const svc = recs(serviceJob);
  const fu = recs(followJob);
  if (!svc.length && !fu.length) return null;
  const devices = dataService.getDevices(job.customerId, job.branchId ?? '', true);
  const ids = new Set([...svc, ...fu].map((r) => r.deviceId));
  return {
    clientName: job.customerName,
    location: job.branchName || job.siteName,
    pcoName: (serviceJob ?? job).leadPcoName,
    serviceDate: (serviceJob ?? job).scheduledDate,
    followUpDate: followJob?.scheduledDate,
    rows: devices
      .filter((d) => ids.has(d.id))
      .map((device) => ({ device, service: svc.find((r) => r.deviceId === device.id), followUp: fu.find((r) => r.deviceId === device.id) })),
  };
}

export async function fileMonitoringSheets(job: ServiceJob, user: { email?: string; displayName?: string }) {
  const input = monitoringSheetInput(job);
  if (!input) return 0;
  const owner: DocumentOwner = job.branchId ? { kind: 'branch', id: job.branchId } : { kind: job.customerType === 'company' ? 'company' : 'client', id: job.customerId };
  const title = `Monitoring Sheet ${input.location} ${input.serviceDate.slice(0, 10)}`;
  await fileGenerated(await opsPdf.monitoringBlob(input), { owner, category: 'monitoring_sheet', title, fileName: opsPdf.monitoringFileName(input, 'pdf'), subPath: job.id, user });
  await fileGenerated(await opsPdf.monitoringXlsx(input), { owner, category: 'monitoring_sheet', title: `${title} (Excel)`, fileName: opsPdf.monitoringFileName(input, 'xlsx'), subPath: job.id, user });
  return input.rows.length;
}
