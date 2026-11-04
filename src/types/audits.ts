// Quality audits: the super admin schedules a (possibly surprise / random) visit by an entomologist,
// who inspects the site and the last service, and submits a report. The super admin verifies it,
// then saves it to the client's folder or sends it to the client.

import type { CustomerType } from './customer';

export type AuditStatus = 'scheduled' | 'submitted' | 'returned' | 'verified' | 'cancelled';

export const AUDIT_STATUS_LABELS: Record<AuditStatus, string> = {
  scheduled: 'Scheduled',
  submitted: 'Report submitted — verify',
  returned: 'Returned to entomologist',
  verified: 'Verified',
  cancelled: 'Cancelled',
};

export type ActivityLevel = 'none' | 'low' | 'moderate' | 'high';

export interface AuditPestActivity {
  area: string;
  pest: string;
  level: ActivityLevel;
  notes?: string;
}

export interface AuditCheck {
  item: string;
  /** true = OK, false = not OK, undefined = not checked. */
  ok?: boolean;
  notes?: string;
}

export interface AuditFinding {
  observation: string;
  risk: 'low' | 'medium' | 'high';
  recommendation: string;
}

export interface AuditReport {
  visitedAt: string; // YYYY-MM-DD
  pestActivity: AuditPestActivity[];
  checks: AuditCheck[];
  findings: AuditFinding[];
  /** Overall quality of the service team's work, 1 (poor) – 5 (excellent). */
  score: number;
  summary: string;
  photos: { url: string; caption: string }[];
}

export interface QualityAudit {
  id: string;
  /** e.g. QA-2026-0001 */
  auditNumber: string;
  customerType: CustomerType;
  customerId: string;
  customerName: string;
  branchId?: string;
  branchName?: string;
  siteName: string;
  siteAddress: string;
  contractId?: string;
  /** The last service visit at the site, whose work is being checked. */
  lastJobId?: string;
  lastJobDate?: string;
  lastTeamLeaderName?: string;
  entomologistUid: string;
  entomologistName: string;
  scheduledDate: string;
  /** Hidden from the Supervisor / field team (only the super admin and the entomologist see it). */
  surprise: boolean;
  /** Picked by the portal at random among sites due for an audit. */
  random: boolean;
  instructions?: string;
  status: AuditStatus;
  report?: AuditReport;
  submittedAt?: string;
  returnNote?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  verifierNote?: string;
  /** Filed in the client's folder (the PDF). */
  pdfDocumentId?: string;
  savedAt?: string;
  sentAt?: string;
  sentTo?: string;
  sentVia?: 'email_auto' | 'whatsapp' | 'email_gmail' | 'email_outlook';
  /** Free re-service visit created from this audit. */
  followUpJobId?: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

/** Standard checklist the entomologist fills in. */
export const DEFAULT_AUDIT_CHECKS = [
  'Bait stations / devices present, numbered and secured as per layout',
  'Bait / glue boards fresh and correctly placed',
  'Chemicals used match the contract and label dosage',
  'Service records and challan kept on site',
  'Treated areas clean; no chemical spills or residue risk',
  'Pest entry points identified and reported',
  'Client staff aware of hygiene / housekeeping recommendations',
];
