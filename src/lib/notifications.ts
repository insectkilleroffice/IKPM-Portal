// Computes actionable in-app notifications from the current data store state.
// No extra Firestore collection — derived from leads and jobs in real time.

import type { Lead } from '../types/crm';
import type { ServiceJob, Contract } from '../types/operations';
import type { Proposal } from '../types/proposal';
import type { ClientStatement, Invoice, PaymentReceipt } from '../types/finance';
import type { QualityAudit } from '../types/audits';
import type { UserProfile } from '../types';
import type { UserRole } from '../types';
import { baseRoleOf } from './permissions';
import { DEFAULT_COMPLAINT_ESCALATION_HOURS, needsCeoEscalation, type Complaint } from '../types/complaints';

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
  contracts: Contract[] = [],
  complaints: Complaint[] = [],
  complaintEscalationHours = DEFAULT_COMPLAINT_ESCALATION_HOURS,
  /** All invoices including drafts (dataService.getAllInvoices()). */
  invoices: Invoice[] = [],
  /** Client statements (dataService.getStatements()). */
  statements: ClientStatement[] = [],
  /** Payment receipts (dataService.getPayments()). */
  payments: PaymentReceipt[] = [],
  /** Quality audits this person can see (dataService.getAudits()). */
  audits: QualityAudit[] = []
): AppNotification[] {
  const role = baseRoleOf(effectiveRole);
  const uid = profile.uid;
  const out: AppNotification[] = [];

  const isAdmin = role === 'super_admin' || role === 'admin';

  const todayIso = new Date().toISOString().slice(0, 10);

  // ── Quality audits: the entomologist's visits, and reports waiting for the super admin ──
  audits.forEach((a) => {
    if (a.entomologistUid === uid && (a.status === 'scheduled' || a.status === 'returned')) {
      out.push({
        id: `audit_${a.status}_${a.id}_${a.updatedAt}`,
        category: a.status === 'returned' ? 'action_needed' : 'assigned',
        title: a.status === 'returned' ? 'Audit report returned' : 'Audit visit assigned',
        body: `${a.siteName} · ${a.scheduledDate}${a.status === 'returned' && a.returnNote ? ` · ${a.returnNote}` : ''}`,
        link: '/audits',
        entityId: a.id,
        createdAt: a.updatedAt,
      });
    }
    if (role === 'super_admin' && a.status === 'submitted') {
      out.push({
        id: `audit_verify_${a.id}_${a.submittedAt || ''}`,
        category: 'action_needed',
        title: 'Audit report to verify',
        body: `${a.auditNumber} · ${a.siteName} · score ${a.report?.score ?? '—'}/5`,
        link: '/audits',
        entityId: a.id,
        createdAt: a.submittedAt || a.updatedAt,
      });
    }
  });
  const isFinance = role === 'finance' || isAdmin;

  // ── Overdue invoices (approved, unpaid, past due): Finance and admins chase them ──
  if (isFinance) {
    invoices
      .filter((i) => i.isPosted && !i.statementId && i.status !== 'void_reversed' && i.balanceDue > 0 && i.dueDate && i.dueDate < todayIso)
      .forEach((i) => out.push({
        id: `inv_overdue_${i.id}_${i.dueDate}`,
        category: 'action_needed',
        title: 'Invoice overdue',
        body: `${i.customerName} · ${i.invoiceNumber} · PKR ${Math.round(i.balanceDue).toLocaleString()} due ${i.dueDate}`,
        link: `/finance/invoices?tab=invoices&invoice=${i.id}`,
        entityId: i.id,
        createdAt: i.dueDate,
      }));
    statements
      .filter((st) => st.status === 'approved' && st.dueDate < todayIso
        && st.invoiceIds.some((id) => (invoices.find((i) => i.id === id)?.balanceDue ?? 0) > 0))
      .forEach((st) => out.push({
        id: `bulk_overdue_${st.id}_${st.dueDate}`,
        category: 'action_needed',
        title: 'Bulk invoice overdue',
        body: `${st.customerName} · ${st.statementNumber} · due ${st.dueDate}`,
        link: '/finance/invoices?tab=invoices',
        entityId: st.id,
        createdAt: st.dueDate,
      }));
    // ── WHT deducted by the client but its certificate not received yet ──
    payments
      .filter((p) => (p.customerWhtDeducted?.amountDeducted || 0) > 0 && !p.customerWhtDeducted?.certificateNumber)
      .forEach((p) => out.push({
        id: `wht_cert_${p.id}`,
        category: 'action_needed',
        title: 'WHT certificate pending',
        body: `${p.customerName} · ${p.invoiceNumber} · WHT PKR ${Math.round(p.customerWhtDeducted.amountDeducted).toLocaleString()}`,
        link: '/finance/invoices?tab=payments',
        entityId: p.id,
        createdAt: p.paymentDate,
      }));
  }

  // ── Contract renewals: from the renewal alert date (60 days before the end) ──
  if (isAdmin || role === 'sales' || role === 'operations') {
    contracts
      .filter((c) => c.status === 'active' && !c.isRenewalInitiated && c.endDate >= todayIso
        && (c.renewalAlertDate ? c.renewalAlertDate <= todayIso : c.endDate <= new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10))
        && (role !== 'sales' || (c as Contract & { ownerUid?: string }).ownerUid === uid))
      .forEach((c) => out.push({
        id: `contract_renewal_${c.id}`,
        category: 'action_needed',
        title: 'Contract due for renewal',
        body: `${c.customerName} · ${c.id} · ends ${c.endDate}`,
        link: `/contracts?view=${c.id}`,
        entityId: c.id,
        createdAt: c.renewalAlertDate || c.endDate,
      }));
  }

  // ── After a one-off job: the CRO offers a contract (within 30 days, if the client has none) ──
  if (role === 'sales' || isAdmin) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const withContract = new Set(contracts.filter((c) => c.status === 'active').map((c) => c.customerId));
    const done = new Map<string, ServiceJob>();
    jobs.filter((j) => j.status === 'completed' && !j.contractId && !j.complaintId && !j.freeOfCharge && j.scheduledDate >= since && !withContract.has(j.customerId))
      .forEach((j) => { if (!done.has(j.customerId) || done.get(j.customerId)!.scheduledDate < j.scheduledDate) done.set(j.customerId, j); });
    done.forEach((j) => {
      const lead = leads.find((l) => l.existingCustomerId === j.customerId);
      const owner = (lead as (Lead & { ownerUid?: string }) | undefined)?.ownerUid;
      if (role === 'sales' && owner !== uid) return;
      out.push({
        id: `resell_${j.customerId}_${j.id}`,
        category: 'action_needed',
        title: 'Offer a service contract',
        body: `${j.customerName} had a one-off job on ${j.scheduledDate} and has no contract`,
        link: lead ? `/crm?lead=${lead.id}` : '/proposals?action=new_proposal',
        entityId: j.customerId,
        createdAt: j.scheduledDate,
      });
    });
  }

  // ── Bulk invoices: admins approve; the preparer hears when one comes back ──
  statements.forEach((st) => {
    if (isAdmin && st.status === 'pending_approval' && (role === 'super_admin' || st.submittedBy !== uid)) {
      out.push({
        id: `st_approval_${st.id}_${st.submittedAt || ''}`,
        category: 'action_needed',
        title: 'Bulk invoice needs approval',
        body: `${st.customerName} · ${st.periodStart} – ${st.periodEnd} · PKR ${Math.round(st.periodTotal).toLocaleString()}`,
        link: '/finance/invoices?tab=invoices',
        entityId: st.id,
        createdAt: st.submittedAt || st.updatedAt,
      });
    }
    if (st.status === 'rejected' && st.submittedBy === uid) {
      out.push({
        id: `st_rejected_${st.id}_${st.rejectedAt || ''}`,
        category: 'action_needed',
        title: 'Bulk invoice returned by admin',
        body: `${st.customerName} · ${st.rejectionReason || ''}`,
        link: '/finance/invoices?tab=invoices',
        entityId: st.id,
        createdAt: st.rejectedAt || st.updatedAt,
      });
    }
  });

  // ── Invoice approval: admins review drafts; the preparer hears when one comes back ──
  invoices.forEach((inv) => {
    if (isAdmin && inv.status === 'pending_approval' && (role === 'super_admin' || inv.submittedBy !== uid)) {
      out.push({
        id: `inv_approval_${inv.id}_${inv.submittedAt || ''}`,
        category: 'action_needed',
        title: 'Invoice needs approval',
        body: `${inv.customerName} · PKR ${Math.round(inv.grossPayable).toLocaleString()} · by ${inv.submittedByName || 'Finance'}`,
        link: `/finance/invoices?invoice=${inv.id}`,
        entityId: inv.id,
        createdAt: inv.submittedAt || inv.updatedAt,
      });
    }
    if (inv.status === 'rejected' && (inv.submittedBy === uid || (role === 'finance' && !inv.submittedBy))) {
      out.push({
        id: `inv_rejected_${inv.id}_${inv.rejectedAt || ''}`,
        category: 'action_needed',
        title: 'Invoice returned by admin',
        body: `${inv.customerName} · ${inv.rejectionReason || ''}`,
        link: `/finance/invoices?invoice=${inv.id}`,
        entityId: inv.id,
        createdAt: inv.rejectedAt || inv.updatedAt,
      });
    }
  });

  // ── Operations Manager — all scheduled meetings + assign nudges ──────────
  if (role === 'operations') {
    leads.forEach((l) => {
      const i = l.inspection;
      if (i && i.status === 'scheduled') {
        if (!i.assignedTeamLeaderId) {
          out.push({
            id: `op_assign_${l.id}_${i.scheduledDate}`,
            category: 'action_needed',
            title: 'Meeting needs team assignment',
            body: `${l.title} · ${i.scheduledDate}`,
            link: `/crm?lead=${l.id}`,
            entityId: l.id,
            createdAt: i.scheduledDate || l.updatedAt,
          });
        } else {
          out.push({
            id: `op_meeting_${l.id}_${i.assignedTeamLeaderId}_${i.scheduledDate}`,
            category: 'assigned',
            title: 'Meeting scheduled',
            body: `${l.title} · ${i.scheduledDate}${i.assignedTeamLeaderName ? ` · Supervisor: ${i.assignedTeamLeaderName}` : ''}`,
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
            body: `${l.title} · ${l.siteInspection.branchName || 'Main site'} · ${l.siteInspection.scheduledDate}${l.siteInspection.teamLeaderName ? ` · Supervisor: ${l.siteInspection.teamLeaderName}` : ''}`,
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
            id: `op_assign_${l.id}_${i.scheduledDate}`,
            category: 'action_needed',
            title: 'Meeting needs team assignment',
            body: `${l.title} · ${i.scheduledDate}`,
            link: `/crm?lead=${l.id}`,
            entityId: l.id,
            createdAt: i.scheduledDate || l.updatedAt,
          });
        } else {
          out.push({
            id: `op_meeting_${l.id}_${i.assignedTeamLeaderId}_${i.scheduledDate}`,
            category: 'assigned',
            title: 'Meeting scheduled',
            body: `${l.title} · ${i.scheduledDate}${i.assignedTeamLeaderName ? ` · Supervisor: ${i.assignedTeamLeaderName}` : ''}`,
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
            body: `${l.title} · ${l.siteInspection.branchName || 'Main site'} · ${l.siteInspection.scheduledDate}${l.siteInspection.teamLeaderName ? ` · Supervisor: ${l.siteInspection.teamLeaderName}` : ''}`,
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
          body: `${l.title}${i.tlStatus === 'send_proposal' ? ' · Supervisor approved' : ''}`,
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
      // Operations Manager (or someone else) assigned a person to a meeting this CRO booked
      if (i?.status === 'scheduled' && i.assignedTeamLeaderId && i.assignedTeamLeaderId !== uid
        && (l.assignedToUserId || (l as { ownerUid?: string }).ownerUid) === uid) {
        out.push({
          id: `cro_assigned_${l.id}_${i.assignedTeamLeaderId}_${i.scheduledDate}`,
          category: 'assigned',
          title: 'Team assigned to your meeting',
          body: `${l.title} · ${i.scheduledDate} · ${i.assignedTeamLeaderName || 'Supervisor'}`,
          link: `/meetings`,
          entityId: l.id,
          createdAt: i.scheduledDate || l.updatedAt,
        });
      }
      // Meeting report submitted (any completion, not just TL-approved)
      if (i?.status === 'completed' && !l.proposalId) {
        out.push({
          id: `cro_report_${l.id}`,
          category: 'completed',
          title: 'Meeting report submitted',
          body: `${l.title}${i.tlStatus === 'send_proposal' ? ' · Supervisor approved — send proposal' : ' · Review and send proposal'}`,
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

  // ── Anyone assigned to a meeting (Supervisor, Operations Manager, CRO who took it himself…) ─
  // The id includes the date so a new assignment or a reschedule shows as unread again.
  leads
    .filter((l) => l.inspection?.status === 'scheduled'
      && (l.inspection.assignedTeamLeaderId === uid || (l.inspection.inspectorIds ?? []).includes(uid)))
    .forEach((l) => {
      const i = l.inspection!;
      out.push({
        id: `tl_meeting_${l.id}_${i.scheduledDate}_${i.scheduledTime || ''}`,
        category: 'assigned',
        title: 'Meeting assigned to you',
        body: `${l.title} · ${i.scheduledDate}${i.scheduledTime ? ` ${i.scheduledTime}` : ''}${i.meetingAddress ? ` · ${i.meetingAddress}` : ''}`,
        link: `/meetings`,
        entityId: l.id,
        createdAt: i.scheduledDate || l.updatedAt,
      });
    });

  // Site inspection "assigned to you" fires for any role whose uid matches the TL slot or the visit team
  leads
    .filter((l) => l.siteInspection?.status === 'scheduled'
      && (l.siteInspection.teamLeaderId === uid || (l.siteInspection.assignedTechIds ?? []).includes(uid)))
    .forEach((l) => {
      out.push({
        id: `tl_si_${l.id}_${l.siteInspection!.scheduledDate}`,
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
      // Active contract with no supervisor assigned
      if (c.totalJobsScheduled > 0 && !c.assignedTeamLeaderId) {
        out.push({
          id: `op_contract_tl_${c.id}`,
          category: 'action_needed',
          title: 'Contract needs supervisor',
          body: `${c.customerName}${c.branchName ? ` · ${c.branchName}` : ''} · ${c.id}`,
          link: `/contracts`,
          entityId: c.id,
          createdAt: c.createdAt,
        });
      }
    });
  }

  // ── Supervisor — QC sent a report back / visit report overdue ───────────
  if (role === 'team_leader') {
    const today = new Date().toISOString().slice(0, 10);
    jobs
      .filter((j) => j.assignedTeamLeaderId === uid || j.leadPcoId === uid)
      .forEach((j) => {
        if (j.status === 'in_progress' && j.qcReturn) {
          out.push({
            id: `tl_qc_return_${j.id}_${j.qcReturn.at}`,
            category: 'action_needed',
            title: 'QC sent your report back',
            body: `${j.customerName} · ${j.id} · ${j.qcReturn.reason}`,
            link: `/operations/jobs?job=${j.id}`,
            entityId: j.id,
            createdAt: j.qcReturn.at,
          });
        } else if ((j.status === 'scheduled' || j.status === 'in_progress') && j.scheduledDate.slice(0, 10) < today) {
          out.push({
            id: `tl_report_due_${j.id}`,
            category: 'action_needed',
            title: 'Visit report overdue',
            body: `${j.customerName} · ${j.id} · was due ${j.scheduledDate.slice(0, 10)}`,
            link: `/operations/jobs?job=${j.id}`,
            entityId: j.id,
            createdAt: j.scheduledDate,
          });
        }
      });
  }

  // ── CEO — complaints open too long (SRS 5.6 escalation) ───────────────────
  if (role === 'super_admin') {
    complaints
      .filter((c) => needsCeoEscalation(c, complaintEscalationHours))
      .forEach((c) => {
        out.push({
          id: `ceo_complaint_escalation_${c.id}`,
          category: 'action_needed',
          title: `Complaint open over ${complaintEscalationHours} hours`,
          body: `${c.customerName} · ${c.subject}${c.assignedOperationsManagerName ? ` · with ${c.assignedOperationsManagerName}` : ' · not assigned'}`,
          link: `/complaints?view=${c.id}`,
          entityId: c.id,
          createdAt: c.createdAt,
        });
      });
  }

  // ── Supervisor & Operations Manager — Job QC & Challan Review ────────────
  if (role === 'team_leader' || role === 'operations' || isAdmin) {
    jobs.forEach((j) => {
      // Report submitted and waiting for QC (not ones already sent back to the TL)
      if (j.status === 'completed' && j.submittedAt && !j.supervisorVerification?.isVerified) {
        const isSubmitter = j.submittedByUid === uid;
        if (!isSubmitter || isAdmin) {
          out.push({
            id: `qc_needed_${j.id}`,
            category: 'action_needed',
            title: 'Job report submitted — QC & Challan review needed',
            body: `${j.customerName} · Job ${j.id}${j.challanNumber ? ` · Challan #${j.challanNumber}` : ''}`,
            link: `/operations/jobs?verify=${j.id}`,
            entityId: j.id,
            createdAt: j.submittedAt || j.updatedAt,
          });
        }
      }
    });
  }

  // ── Finance — QC Verified Jobs ready for Statutory Tax Invoicing ──
  if (role === 'finance' || isAdmin) {
    // Only jobs still to invoice: not already on an invoice, and not a free re-service / warranty visit
    const billedIds = new Set(invoices.filter((i) => i.status !== 'void_reversed').flatMap((i) => [i.jobId, ...(i.jobIds ?? []), ...(i.lineItems ?? []).map((l) => l.jobId)]).filter(Boolean) as string[]);
    jobs.forEach((j) => {
      if (j.supervisorVerification?.isVerified && j.status === 'completed' && !billedIds.has(j.id) && !j.freeOfCharge && !j.complaintId) {
        out.push({
          id: `finance_invoice_ready_${j.id}`,
          category: 'action_needed',
          title: 'Job QC verified with Challan — ready for invoice',
          body: `${j.customerName} · ${j.id}${j.challanNumber ? ` · Challan #${j.challanNumber}` : ''}`,
          link: `/finance/invoices?tab=jobs&fromJob=${j.id}`,
          entityId: j.id,
          createdAt: j.supervisorVerification.verifiedAt || j.updatedAt,
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
