// Computes actionable in-app notifications from the current data store state.
// No extra Firestore collection — derived from leads and jobs in real time.

import type { Lead } from '../types/crm';
import type { ServiceJob } from '../types/operations';
import type { Proposal } from '../types/proposal';
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
  effectiveRole: UserRole | null,
  proposals: Proposal[] = []
): AppNotification[] {
  const role = baseRoleOf(effectiveRole);
  const uid = profile.uid;
  const out: AppNotification[] = [];

  const isAdmin = role === 'super_admin' || role === 'admin';

  // ── Operations Manager — assign teams only (no completed clutter) ─────────
  if (role === 'operations') {
    leads.forEach((l) => {
      const i = l.inspection;
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
      if (l.siteInspection?.status === 'scheduled' && !l.siteInspection.teamLeaderId) {
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
    });
  }

  // ── Admin / Super Admin — assign nudges + completed reports ───────────────
  if (isAdmin) {
    leads.forEach((l) => {
      const i = l.inspection;
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
      if (l.siteInspection?.status === 'scheduled' && !l.siteInspection.teamLeaderId) {
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
      // Meeting report submitted — no proposal yet
      if (i?.status === 'completed' && !l.proposalId) {
        out.push({
          id: `admin_report_${l.id}`,
          category: 'completed',
          title: 'Meeting report submitted',
          body: `${l.title}${i.tlStatus === 'send_proposal' ? ' · TL approved' : ''}`,
          link: `/crm?lead=${l.id}`,
          entityId: l.id,
          createdAt: i.completedDate || l.updatedAt,
        });
      }
      // Site inspection report submitted — no proposal yet
      if (l.siteInspection?.status === 'completed' && !l.proposalId) {
        out.push({
          id: `admin_si_done_${l.id}`,
          category: 'completed',
          title: 'Site inspection report submitted',
          body: `${l.title} · ${l.siteInspection.branchName || 'Main site'}`,
          link: `/crm?lead=${l.id}`,
          entityId: l.id,
          createdAt: l.siteInspection.completedDate || l.updatedAt,
        });
      }
    });
  }

  // ── CRO / Sales — report submitted → next step: send proposal ─────────────
  if (role === 'sales') {
    leads.forEach((l) => {
      const i = l.inspection;
      // Meeting report submitted (any completion, not just TL-approved)
      if (i?.status === 'completed' && !l.proposalId) {
        out.push({
          id: `cro_report_${l.id}`,
          category: 'completed',
          title: 'Meeting report submitted',
          body: `${l.title}${i.tlStatus === 'send_proposal' ? ' · TL approved — send proposal' : ' · Review and send proposal'}`,
          link: `/crm?lead=${l.id}`,
          entityId: l.id,
          createdAt: i.completedDate || l.updatedAt,
        });
      }
      // Site inspection report submitted
      if (l.siteInspection?.status === 'completed' && !l.proposalId) {
        out.push({
          id: `cro_si_done_${l.id}`,
          category: 'action_needed',
          title: 'Site inspection complete — send proposal',
          body: `${l.title} · ${l.siteInspection.branchName || 'Main site'}`,
          link: `/crm?lead=${l.id}`,
          entityId: l.id,
          createdAt: l.siteInspection.completedDate || l.updatedAt,
        });
      }
    });
  }

  // ── Team Leader — assigned meetings, inspections, and jobs ────────────────
  if (isAdmin || role === 'team_leader') {
    leads
      .filter((l) => l.inspection?.assignedTeamLeaderId === uid || l.siteInspection?.teamLeaderId === uid)
      .forEach((l) => {
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
        if (l.siteInspection?.status === 'scheduled' && l.siteInspection.teamLeaderId === uid) {
          out.push({
            id: `tl_si_${l.id}`,
            category: 'assigned',
            title: 'Site inspection assigned to you',
            body: `${l.title} · ${l.siteInspection.branchName || 'Main site'} · ${l.siteInspection.scheduledDate}`,
            link: `/inspections`,
            entityId: l.id,
            createdAt: l.siteInspection.scheduledDate || l.updatedAt,
          });
        }
      });

    jobs
      .filter((j) => (j.status === 'scheduled' || j.status === 'en_route') && j.assignedTeamLeaderId === uid)
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

  // ── Technician — assigned jobs ────────────────────────────────────────────
  if (role === 'technician') {
    jobs
      .filter((j) => (j.status === 'scheduled' || j.status === 'en_route') && j.assignedTechnicianIds.includes(uid))
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

  // ── Proposal approval workflow ────────────────────────────────────────────
  if (isAdmin) {
    proposals
      .filter((p) => p.status === 'pending_approval')
      .forEach((p) => {
        out.push({
          id: `admin_proposal_review_${p.id}`,
          category: 'action_needed',
          title: 'Proposal needs review',
          body: `${p.id} · ${p.customerName} · by ${p.preparedByName}`,
          link: `/proposals?view=${p.id}`,
          entityId: p.id,
          createdAt: p.approval?.requestedAt || p.updatedAt,
        });
      });
  }

  if (role === 'sales') {
    proposals.forEach((p) => {
      if (p.status === 'approved') {
        out.push({
          id: `cro_proposal_approved_${p.id}`,
          category: 'action_needed',
          title: 'Proposal approved — send to client',
          body: `${p.id} · ${p.customerName}`,
          link: `/proposals?view=${p.id}`,
          entityId: p.id,
          createdAt: p.approval?.decisionAt || p.updatedAt,
        });
      }
      if (p.status === 'draft' && p.approval?.status === 'changes_requested') {
        out.push({
          id: `cro_proposal_changes_${p.id}`,
          category: 'action_needed',
          title: 'Changes requested on proposal',
          body: `${p.id} · ${p.customerName}${p.approval.comments ? ` · ${p.approval.comments}` : ''}`,
          link: `/proposals?view=${p.id}`,
          entityId: p.id,
          createdAt: p.approval.decisionAt || p.updatedAt,
        });
      }
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
