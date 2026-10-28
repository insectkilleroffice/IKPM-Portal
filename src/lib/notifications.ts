// Computes actionable in-app notifications from the current data store state.
// No extra Firestore collection — derived from leads and jobs in real time.

import type { Lead } from '../types/crm';
import type { ServiceJob, Contract } from '../types/operations';
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
  proposals: Proposal[] = [],
  contracts: Contract[] = []
): AppNotification[] {
  const role = baseRoleOf(effectiveRole);
  const uid = profile.uid;
  const out: AppNotification[] = [];

  const isAdmin = role === 'super_admin' || role === 'admin';

  // ── Operations Manager — all scheduled meetings + assign nudges ──────────
  if (role === 'operations') {
    leads.forEach((l) => {
      const i = l.inspection;
      if (i && i.status === 'scheduled') {
        if (!i.assignedTeamLeaderId) {
          out.push({
            id: `op_assign_${l.id}`,
            category: 'action_needed',
            title: 'Meeting needs team assignment',
            body: `${l.title} · ${i.scheduledDate}`,
            link: `/crm?lead=${l.id}`,
            entityId: l.id,
            createdAt: i.scheduledDate || l.updatedAt,
          });
        } else {
          out.push({
            id: `op_meeting_${l.id}`,
            category: 'assigned',
            title: 'Meeting scheduled',
            body: `${l.title} · ${i.scheduledDate}${i.assignedTeamLeaderName ? ` · TL: ${i.assignedTeamLeaderName}` : ''}`,
            link: `/crm?lead=${l.id}`,
            entityId: l.id,
            createdAt: i.scheduledDate || l.updatedAt,
          });
        }
      }
      if (l.siteInspection?.status === 'scheduled') {
        if (!l.siteInspection.teamLeaderId) {
          out.push({
            id: `op_si_assign_${l.id}`,
            category: 'action_needed',
            title: 'Site inspection needs team',
            body: `${l.title} · ${l.siteInspection.scheduledDate}`,
            link: `/inspections`,
            entityId: l.id,
            createdAt: l.siteInspection.scheduledDate || l.updatedAt,
          });
        } else {
          out.push({
            id: `op_si_sched_${l.id}`,
            category: 'assigned',
            title: 'Site inspection scheduled',
            body: `${l.title} · ${l.siteInspection.branchName || 'Main site'} · ${l.siteInspection.scheduledDate}${l.siteInspection.teamLeaderName ? ` · TL: ${l.siteInspection.teamLeaderName}` : ''}`,
            link: `/inspections`,
            entityId: l.id,
            createdAt: l.siteInspection.scheduledDate || l.updatedAt,
          });
        }
      }
    });
  }

  // ── Admin / Super Admin — assign nudges + completed reports ───────────────
  if (isAdmin) {
    leads.forEach((l) => {
      const i = l.inspection;
      if (i && i.status === 'scheduled') {
        if (!i.assignedTeamLeaderId) {
          out.push({
            id: `op_assign_${l.id}`,
            category: 'action_needed',
            title: 'Meeting needs team assignment',
            body: `${l.title} · ${i.scheduledDate}`,
            link: `/crm?lead=${l.id}`,
            entityId: l.id,
            createdAt: i.scheduledDate || l.updatedAt,
          });
        } else {
          out.push({
            id: `op_meeting_${l.id}`,
            category: 'assigned',
            title: 'Meeting scheduled',
            body: `${l.title} · ${i.scheduledDate}${i.assignedTeamLeaderName ? ` · TL: ${i.assignedTeamLeaderName}` : ''}`,
            link: `/crm?lead=${l.id}`,
            entityId: l.id,
            createdAt: i.scheduledDate || l.updatedAt,
          });
        }
      }
      if (l.siteInspection?.status === 'scheduled') {
        if (!l.siteInspection.teamLeaderId) {
          out.push({
            id: `op_si_assign_${l.id}`,
            category: 'action_needed',
            title: 'Site inspection needs team',
            body: `${l.title} · ${l.siteInspection.scheduledDate}`,
            link: `/inspections`,
            entityId: l.id,
            createdAt: l.siteInspection.scheduledDate || l.updatedAt,
          });
        } else {
          out.push({
            id: `op_si_sched_${l.id}`,
            category: 'assigned',
            title: 'Site inspection scheduled',
            body: `${l.title} · ${l.siteInspection.branchName || 'Main site'} · ${l.siteInspection.scheduledDate}${l.siteInspection.teamLeaderName ? ` · TL: ${l.siteInspection.teamLeaderName}` : ''}`,
            link: `/inspections`,
            entityId: l.id,
            createdAt: l.siteInspection.scheduledDate || l.updatedAt,
          });
        }
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

  // ── Team Leader / any role directly assigned to a meeting or site inspection ─
  if (isAdmin || role === 'team_leader') {
    leads
      .filter((l) => l.inspection?.assignedTeamLeaderId === uid)
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
      });
  }

  // Site inspection "assigned to you" fires for any role whose uid matches the TL slot
  leads
    .filter((l) => l.siteInspection?.status === 'scheduled' && l.siteInspection.teamLeaderId === uid)
    .forEach((l) => {
      out.push({
        id: `tl_si_${l.id}`,
        category: 'assigned',
        title: 'Site inspection assigned to you',
        body: `${l.title} · ${l.siteInspection!.branchName || 'Main site'} · ${l.siteInspection!.scheduledDate}`,
        link: `/inspections`,
        entityId: l.id,
        createdAt: l.siteInspection!.scheduledDate || l.updatedAt,
      });
    });

  // Service job / contract schedule "assigned to you as TL" fires for any role
  // Group by contractId so an edited schedule shows ONE notification per contract, not N per job.
  const tlJobs = jobs.filter((j) => (j.status === 'scheduled' || j.status === 'en_route') && j.assignedTeamLeaderId === uid);
  const contractGroups = new Map<string, typeof tlJobs>();
  tlJobs.forEach((j) => {
    const key = j.contractId || j.id;
    if (!contractGroups.has(key)) contractGroups.set(key, []);
    contractGroups.get(key)!.push(j);
  });
  contractGroups.forEach((group, contractKey) => {
    const first = group[0];
    const isContract = !!first.contractId;
    out.push({
      id: `tl_job_${contractKey}`,
      category: 'assigned',
      title: isContract ? 'Visit schedule assigned to you' : 'Service job assigned to you',
      body: isContract
        ? `${first.customerName}${first.branchName ? ` · ${first.branchName}` : ''} · ${group.length} visits · next: ${group.map((j) => j.scheduledDate).sort()[0]}`
        : `${first.customerName} · ${first.siteName} · ${first.scheduledDate}`,
      link: `/operations/jobs`,
      entityId: contractKey,
      createdAt: group.map((j) => j.updatedAt).sort().reverse()[0] || first.scheduledDate || '',
    });
  });

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

  // ── Contract notifications — Operations Manager + Admin ──────────────────
  if (role === 'operations' || isAdmin) {
    contracts.forEach((c) => {
      if (c.status !== 'active') return;
      // New active contract with no schedule generated yet
      if (c.totalJobsScheduled === 0) {
        out.push({
          id: `op_contract_sched_${c.id}`,
          category: 'action_needed',
          title: 'New contract — generate visit schedule',
          body: `${c.customerName}${c.branchName ? ` · ${c.branchName}` : ''} · ${c.id}`,
          link: `/contracts`,
          entityId: c.id,
          createdAt: c.createdAt,
        });
      }
      // Active contract with no team leader assigned
      if (c.totalJobsScheduled > 0 && !c.assignedTeamLeaderId) {
        out.push({
          id: `op_contract_tl_${c.id}`,
          category: 'action_needed',
          title: 'Contract needs team leader',
          body: `${c.customerName}${c.branchName ? ` · ${c.branchName}` : ''} · ${c.id}`,
          link: `/contracts`,
          entityId: c.id,
          createdAt: c.createdAt,
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
