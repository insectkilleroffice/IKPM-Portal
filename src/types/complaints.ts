/** Complaint module types — status flow: new → assigned → in_progress → resolved → closed (or reopened) */

export type ComplaintStatus =
  | 'new'         // just logged, unassigned
  | 'assigned'    // ops manager assigned
  | 'in_progress' // ops manager actively working
  | 'resolved'    // ops manager resolved, awaiting CRO confirmation
  | 'closed'      // CRO confirmed, client satisfied
  | 'reopened'    // CRO reopened because client not satisfied
  | 'escalated';  // escalated to CEO (Change 22)

export type ComplaintCategory =
  | 're_infestation'       // pest still active / recurring after service (SRS)
  | 'pco_behaviour'        // technician conduct/attitude issue (SRS)
  | 'service_quality'      // chemical / service quality issue (SRS)
  | 'pest_present'         // legacy: pest still active after service
  | 'missed_visit'         // scheduled visit did not happen
  | 'technician_behaviour' // legacy: technician conduct/attitude issue
  | 'chemical_safety'      // chemical or safety concern
  | 'billing'              // billing or payment dispute
  | 'other';

export type ComplaintPriority = 'low' | 'normal' | 'urgent';

export type ComplaintSource = 'phone' | 'whatsapp' | 'email' | 'walk_in';

export interface ComplaintNote {
  id: string;
  at: string;
  byUid: string;
  byName: string;
  note: string;
}

export interface Complaint {
  id: string; // CMP-YYYY-XXXX
  customerType: 'company' | 'individual';
  customerId: string;
  customerName: string;
  branchId?: string;
  branchName?: string;
  contractId?: string;
  jobId?: string;
  /** Job created for the re-service visit that resolves this complaint. */
  reServiceJobId?: string;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  subject: string;
  description: string;
  photos?: string[];
  source: ComplaintSource;
  status: ComplaintStatus;
  assignedOperationsManagerId?: string;
  assignedOperationsManagerName?: string;
  assignedAt?: string;
  /** ISO date; auto-set on log: urgent=+1d, normal=+3d, low=+7d. */
  dueDate?: string;
  resolutionNote?: string;
  rootCause?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolvedByName?: string;
  clientSatisfied?: boolean;
  reopenedCount: number;
  notes: ComplaintNote[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

/** Days until a complaint is due based on priority. */
export const COMPLAINT_DUE_DAYS: Record<ComplaintPriority, number> = {
  urgent: 1,
  normal: 3,
  low: 7,
};

export const CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  re_infestation: 'Re-infestation (SRS)',
  pco_behaviour: 'PCO Behaviour (SRS)',
  service_quality: 'Service Quality (SRS)',
  pest_present: 'Pest still active',
  missed_visit: 'Missed visit',
  technician_behaviour: 'Technician behaviour',
  chemical_safety: 'Chemical / safety issue',
  billing: 'Billing dispute',
  other: 'Other',
};

export const STATUS_LABELS: Record<ComplaintStatus, string> = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  resolved: 'Awaiting confirmation',
  closed: 'Closed',
  reopened: 'Reopened',
  escalated: 'Escalated to CEO',
};

export const PRIORITY_LABELS: Record<ComplaintPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  urgent: 'Urgent',
};

export const SOURCE_LABELS: Record<ComplaintSource, string> = {
  phone: 'Phone call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  walk_in: 'Walk-in',
};

export function isComplaintOverdue(c: Complaint): boolean {
  if (!c.dueDate) return false;
  if (['closed', 'resolved'].includes(c.status)) return false;
  return c.dueDate < new Date().toISOString().slice(0, 10);
}

/** Compute dueDate string for a new complaint based on priority. */
export function computeDueDate(priority: ComplaintPriority): string {
  const d = new Date();
  d.setDate(d.getDate() + COMPLAINT_DUE_DAYS[priority]);
  return d.toISOString().slice(0, 10);
}
