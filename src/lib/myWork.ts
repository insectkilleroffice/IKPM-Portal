// "My work" for the personal calendar: every dated task a person is responsible for, picked by role.
//   CRO        → meetings on their leads, follow-ups due on their leads
//   Supervisor → meetings they attend, site inspections and service visits assigned to them
//   Ops / Admin / CEO → all meetings, inspections and visits (or only their own)
//   Finance    → invoices falling due
import { baseRoleOf } from './permissions';
import type { Lead } from '../types/crm';
import type { ServiceJob } from '../types/operations';
import type { Invoice } from '../types/finance';

export type WorkKind = 'meeting' | 'inspection' | 'visit' | 'follow_up' | 'invoice_due';

export interface WorkItem {
  id: string;
  kind: WorkKind;
  date: string; // YYYY-MM-DD
  time?: string;
  title: string;
  detail: string;
  link: string;
  done: boolean;
}

export const WORK_KIND_LABEL: Record<WorkKind, string> = {
  meeting: 'Meeting',
  inspection: 'Site inspection',
  visit: 'Service visit',
  follow_up: 'Follow-up',
  invoice_due: 'Invoice due',
};

export const WORK_KIND_COLOR: Record<WorkKind, string> = {
  meeting: '#2563EB',
  inspection: '#7C3AED',
  visit: '#059669',
  follow_up: '#D97706',
  invoice_due: '#DC2626',
};

/** Roles that oversee everyone's operations work (can switch between all and only theirs). */
export const seesAllWork = (role?: string | null) =>
  ['operations', 'admin', 'super_admin', 'management'].includes(baseRoleOf(role as never) ?? role ?? '');

const day = (d?: string) => (d || '').slice(0, 10);

export function myWorkItems(
  viewer: { uid: string; role?: string | null },
  data: { leads: Lead[]; jobs: ServiceJob[]; invoices: Invoice[] },
  onlyMine = true
): WorkItem[] {
  const base = baseRoleOf(viewer.role as never) ?? viewer.role ?? '';
  const uid = viewer.uid;
  const everything = seesAllWork(viewer.role) && !onlyMine;
  const out: WorkItem[] = [];
  const owns = (l: Lead) => (l as { ownerUid?: string }).ownerUid === uid || l.assignedToUserId === uid;

  for (const l of data.leads) {
    const i = l.inspection;
    if (i?.scheduledDate && i.status !== 'cancelled') {
      const attending = i.assignedTeamLeaderId === uid || (i.inspectorIds ?? []).includes(uid);
      const mine = attending || (base === 'sales' && owns(l));
      if (everything || mine) {
        const who = i.assignedTeamLeaderName || 'not assigned';
        out.push({
          id: `m_${l.id}`,
          kind: 'meeting',
          date: day(i.scheduledDate),
          time: i.scheduledTime,
          title: l.title,
          detail: `${i.meetingType === 'negotiation' ? 'Negotiation' : i.meetingType === 'renewal' ? 'Renewal' : 'First'} meeting · ${who}${i.meetingAddress ? ` · ${i.meetingAddress}` : ''}`,
          link: '/meetings',
          done: i.status === 'completed',
        });
      }
    }
    const si = l.siteInspection;
    if (si?.scheduledDate && si.status !== 'cancelled') {
      const mine = si.teamLeaderId === uid || (si.assignedTechIds ?? []).includes(uid) || (base === 'sales' && owns(l));
      if (everything || mine) {
        out.push({
          id: `si_${l.id}`,
          kind: 'inspection',
          date: day(si.scheduledDate),
          title: l.title,
          detail: `${si.branchName || 'Main site'} · ${si.teamLeaderName || 'not assigned'}`,
          link: '/inspections',
          done: si.status === 'completed',
        });
      }
    }
    // Follow-ups belong to the CRO who owns the lead
    if (l.nextFollowUp && !['won', 'lost'].includes(l.stage) && base === 'sales' && owns(l)) {
      out.push({
        id: `fu_${l.id}`,
        kind: 'follow_up',
        date: day(l.nextFollowUp),
        title: l.title,
        detail: `Follow up · ${l.contactName || ''} ${l.phone || ''}`.trim(),
        link: `/crm?lead=${l.id}`,
        done: false,
      });
    }
  }

  for (const j of data.jobs) {
    if (j.status === 'cancelled' || !j.scheduledDate) continue;
    const mine = j.assignedTeamLeaderId === uid || j.leadPcoId === uid || (j.assignedTechnicianIds ?? []).includes(uid);
    if (everything || (mine && base !== 'finance')) {
      out.push({
        id: `j_${j.id}`,
        kind: 'visit',
        date: day(j.scheduledDate),
        time: j.scheduledTime,
        title: j.customerName,
        detail: `${j.siteName} · ${j.assignedTeamLeaderName || 'no Supervisor'} · ${j.status.replace(/_/g, ' ')}`,
        link: `/operations/jobs?job=${j.id}`,
        done: ['completed', 'verified', 'invoiced'].includes(j.status),
      });
    }
  }

  if (base === 'finance' || base === 'super_admin') {
    for (const inv of data.invoices) {
      if (inv.status === 'void_reversed' || inv.balanceDue <= 0 || !inv.dueDate) continue;
      out.push({
        id: `inv_${inv.id}`,
        kind: 'invoice_due',
        date: day(inv.dueDate),
        title: inv.customerName,
        detail: `${inv.invoiceNumber} · balance PKR ${Math.round(inv.balanceDue).toLocaleString()}`,
        link: `/finance/invoices?invoice=${inv.id}`,
        done: false,
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
}
