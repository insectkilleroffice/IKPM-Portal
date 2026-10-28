// Computes actionable in-app notifications from the current data store state.
// No extra Firestore collection — derived from leads and jobs in real time.

import type { Lead } from '../types/crm';
import type { ServiceJob } from '../types/operations';
import type { UserProfile } from '../types';
import type { UserRole } from '../types';
import { baseRoleOf } from './permissions';

export type NotificationCategory = 'assigned' | 'completed' | 'action_needed';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string;
  entityId: string;
  createdAt: string;
}

const CATEGORY_COLOR: Record<NotificationCategory, string> = {
  assigned: 'var(--ikpm-teal-500)',
  completed: 'var(--ikpm-emerald-600)',
  action_needed: 'var(--ikpm-amber-500)',
};

export { CATEGORY_COLOR };

export function computeNotifications(
  leads: Lead[],
  jobs: ServiceJob[],
  profile: UserProfile,
  effectiveRole: UserRole | null
): AppNotification[] {
  const role = baseRoleOf(effectiveRole);
  const uid = profile.uid;
  const out: AppNotification[] = [];

  const isAdmin = role === 'super_admin' || role === 'admin';

  // ── Operations Manager (or admin) ─────────────────────────────────────────
  if (isAdmin || role === 'operations') {
    leads.forEach((l) => {
      const i = l.inspection;
      // New meeting scheduled by CRO that needs a team assigned
      if (i && i.status === 'scheduled' && !i.assignedTeamLeaderId) {
        out.push({
          id: `op_assign_${l.id}`,
          category: 'action_needed',
          title: 'Meeting needs team assignment',
          body: `${l.title} · ${i.scheduledDate}`,
          link: `/crm?lead=${l.id}`,
          entityId: l.id,
          createdAt: i.scheduledDate || l.updatedAt,
        });
      }
      // Site inspection requested but no team leader assigned
      if (
        l.siteInspection?.status === 'scheduled' &&
        !l.siteInspection.teamLeaderId
      ) {
        out.push({
          id: `op_si_assign_${l.id}`,
          category: 'action_needed',
          title: 'Site inspection needs team',
          body: `${l.title} · ${l.siteInspection.scheduledDate}`,
          link: `/inspections`,
          entityId: l.id,
          createdAt: l.siteInspection.scheduledDate || l.updatedAt,
        });
      }
      // Inspection report complete — TL flagged ready for proposal
      if (
        i?.status === 'completed' &&
        i.tlStatus === 'send_proposal' &&
        !l.proposalId
      ) {
        out.push({
          id: `op_proposal_ready_${l.id}`,
          category: 'completed',
          title: 'Report ready — create proposal',
          body: `${l.title} · TL approved`,
          link: `/crm?lead=${l.id}`,
          entityId: l.id,
          createdAt: i.completedDate || l.updatedAt,
        });
      }
      // Site inspection completed — no proposal yet
      if (l.siteInspection?.status === 'completed' && !l.proposalId) {
        out.push({
          id: `op_si_done_${l.id}`,
          category: 'completed',
          title: 'Site inspection complete',
          body: `${l.title} · ${l.siteInspection.branchName || 'Main site'}`,
          link: `/inspections`,
          entityId: l.id,
          createdAt: l.siteInspection.completedDate || l.updatedAt,
        });
      }
    });
  }

  // ── CRO / Sales ───────────────────────────────────────────────────────────
  if (isAdmin || role === 'sales') {
    leads.forEach((l) => {
      const i = l.inspection;
      // TL flagged ready to send proposal
      if (
        i?.status === 'completed' &&
        i.tlStatus === 'send_proposal' &&
        !l.proposalId
      ) {
        out.push({
          id: `cro_proposal_${l.id}`,
          category: 'completed',
          title: 'Inspection done — send proposal',
          body: `${l.title} · Team Leader approved`,
          link: `/crm?lead=${l.id}`,
          entityId: l.id,
          createdAt: i.completedDate || l.updatedAt,
        });
      }
      // Site inspection completed and no proposal yet
      if (l.siteInspection?.status === 'completed' && !l.proposalId) {
        out.push({
          id: `cro_si_done_${l.id}`,
          category: 'action_needed',
          title: 'Site inspection complete — next step',
          body: `${l.title} · ${l.siteInspection.branchName || 'Main site'}`,
          link: `/crm?lead=${l.id}`,
          entityId: l.id,
          createdAt: l.siteInspection.completedDate || l.updatedAt,
        });
      }
    });
  }

  // ── Team Leader ───────────────────────────────────────────────────────────
  if (isAdmin || role === 'team_leader') {
    const myLeads = leads.filter(
      (l) =>
        l.inspection?.assignedTeamLeaderId === uid ||
        l.siteInspection?.teamLeaderId === uid
    );
    myLeads.forEach((l) => {
      const i = l.inspection;
      if (i?.status === 'scheduled' && i.assignedTeamLeaderId === uid) {
        out.push({
          id: `tl_meeting_${l.id}`,
          category: 'assigned',
          title: 'Meeting assigned to you',
          body: `${l.title} · ${i.scheduledDate}${i.meetingAddress ? ` · ${i.meetingAddress}` : ''}`,
          link: `/operations/dispatch`,
          entityId: l.id,
          createdAt: i.scheduledDate || l.updatedAt,
        });
      }
      if (
        l.siteInspection?.status === 'scheduled' &&
        l.siteInspection.teamLeaderId === uid
      ) {
        out.push({
          id: `tl_si_${l.id}`,
          category: 'assigned',
          title: 'Site inspection assigned',
          body: `${l.title} · ${l.siteInspection.branchName || 'Main site'} · ${l.siteInspection.scheduledDate}`,
          link: `/inspections`,
          entityId: l.id,
          createdAt: l.siteInspection.scheduledDate || l.updatedAt,
        });
      }
    });

    // Jobs assigned as team leader
    jobs
      .filter(
        (j) =>
          (j.status === 'scheduled' || j.status === 'en_route') &&
          j.assignedTeamLeaderId === uid
      )
      .forEach((j) => {
        out.push({
          id: `tl_job_${j.id}`,
          category: 'assigned',
          title: 'Service job assigned to you',
          body: `${j.customerName} · ${j.siteName} · ${j.scheduledDate}`,
          link: `/operations/jobs?job=${j.id}`,
          entityId: j.id,
          createdAt: j.scheduledDate || '',
        });
      });
  }

  // ── Technician ────────────────────────────────────────────────────────────
  if (role === 'technician') {
    jobs
      .filter(
        (j) =>
          (j.status === 'scheduled' || j.status === 'en_route') &&
          j.assignedTechnicianIds.includes(uid)
      )
      .forEach((j) => {
        out.push({
          id: `tech_job_${j.id}`,
          category: 'assigned',
          title: 'Job assigned to you',
          body: `${j.customerName} · ${j.siteName} · ${j.scheduledDate}`,
          link: `/operations/jobs?job=${j.id}`,
          entityId: j.id,
          createdAt: j.scheduledDate || '',
        });
      });
  }

  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── localStorage read tracking ────────────────────────────────────────────────

const STORAGE_KEY = (uid: string) => `notif_read_${uid}`;
const MAX_STORED = 200;

export function getReadIds(uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(uid));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function markAsRead(uid: string, ids: string[]): void {
  try {
    const existing = getReadIds(uid);
    ids.forEach((id) => existing.add(id));
    const trimmed = Array.from(existing).slice(-MAX_STORED);
    localStorage.setItem(STORAGE_KEY(uid), JSON.stringify(trimmed));
  } catch {
    // localStorage unavailable
  }
}
