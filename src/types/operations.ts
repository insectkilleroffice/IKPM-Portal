// Operations, Contracts, Service Jobs, Chemical Logs, Checklists, and Verified Reports

import type { CustomerType } from './customer';
import type { PestType } from './crm';
import type { FolderMeta, TemplateStamp } from './folders';
import type { ServicePlanItem } from '../lib/proposalPlan';

export type ContractType = 'one_time' | 'amc_recurring';

export type ServiceFrequency =
  | 'one_off'
  | 'weekly'
  | 'fortnightly'
  | 'monthly'
  | 'bi_monthly'
  | 'quarterly'
  | 'on_demand';

export type JobStatus =
  | 'scheduled'
  | 'en_route'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'rescheduled';

export interface ChemicalUsageRecord {
  id: string;
  chemicalName: string;
  activeIngredient: string;
  registrationNumber?: string;
  dosageRate: string;
  quantityUsed: number;
  unit: 'ml' | 'litres' | 'grams' | 'kg' | 'bait_stations';
  batchNumber: string;
  targetPest: PestType;
  applicationMethod: 'residual_spray' | 'cold_fogging_ulv' | 'gel_baiting' | 'dusting' | 'rodent_bait_station' | 'soil_injection';
}

export interface ServiceChecklistItem {
  id: string;
  taskDescription: string;
  isCompleted: boolean;
  notes?: string;
}

export interface PhotoEvidence {
  id: string;
  caption: string;
  type: 'before' | 'after' | 'infestation_focus' | 'bait_station';
  imageUrl: string;
  capturedAt: string;
}

/** A photo taken on site (inspection, lead visit); `type` is one of the capturing screen's categories. */
export interface SitePhoto {
  id: string;
  caption: string;
  type: string;
  imageUrl: string;
  capturedAt: string;
}

export interface CustomerSignOff {
  acknowledgedByName: string;
  customerDesignation?: string;
  customerPhone?: string;
  feedbackRating: 1 | 2 | 3 | 4 | 5;
  feedbackComments?: string;
  signatureDataUrl?: string;
  signedAt: string;
}

export interface SupervisorVerification {
  isVerified: boolean;
  supervisorId: string;
  supervisorName: string;
  verifiedAt: string;
  qcRating: 'excellent' | 'satisfactory' | 'needs_revisit' | 'rejected';
  supervisorNotes?: string;
}

export interface ServiceJob extends FolderMeta {
  id: string;
  contractId?: string;
  proposalId?: string;
  customerType: CustomerType;
  customerId: string;
  customerName: string;
  branchId?: string;
  branchName?: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  serviceType: string;
  targetPests: PestType[];
  scheduledDate: string;
  /** Exact start time as HH:MM (24-hour), e.g. "09:30". Optional — shift covers broad windows. */
  scheduledTime?: string;
  timeSlot: 'morning' | 'afternoon' | 'evening' | 'night_shift';
  assignedTechnicianIds: string[];
  assignedTechnicianNames: string[];
  leadPcoId: string;
  leadPcoName: string;
  /** Team leader accountable for this service visit. */
  assignedTeamLeaderId?: string;
  assignedTeamLeaderName?: string;
  status: JobStatus;
  rescheduledReason?: string;
  cancellationReason?: string;
  cancellationReasonCode?: 'client_denied_access' | 'team_unavailable' | 'chemical_unavailable' | 'client_request' | 'other';
  /** Outcome recorded by the Team Leader when submitting the service report. */
  visitOutcome?: 'completed' | 'partial' | 'client_blocked' | 'postponed';
  complaintId?: string;
  checklists: ServiceChecklistItem[];
  chemicalsUsed: ChemicalUsageRecord[];
  photoEvidence: PhotoEvidence[];
  customerSignOff?: CustomerSignOff;
  supervisorVerification?: SupervisorVerification;
  executionNotes?: string;
  isOfflineDraft?: boolean;
  syncedAt?: string;
  /** Contract schedule (Step 14): service visit or its follow-up; the pair share pairedJobId links. */
  visitKind?: 'service' | 'follow_up';
  pairedJobId?: string;
  /** Services to be performed in this visit, e.g. ["Cockroach Control", "Rodent Control"]. */
  visitServices?: string[];
  /** Visit window at the branch ("HH:MM"), copied from the branch when scheduled. */
  windowStart?: string;
  windowEnd?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Contract extends FolderMeta, TemplateStamp {
  id: string;
  contractType: ContractType;
  proposalId?: string;
  customerType: CustomerType;
  customerId: string;
  customerName: string;
  branchId?: string;
  branchName?: string;
  siteIds: string[];
  startDate: string;
  endDate: string;
  frequency: ServiceFrequency;
  totalContractValue: number;
  billingTerm: 'in_advance' | 'per_service' | 'monthly_billing' | 'quarterly_billing';
  serviceScope: string;
  warrantyPeriodMonths: number;
  totalJobsScheduled: number;
  totalJobsCompleted: number;
  status: 'active' | 'expired' | 'renewed' | 'cancelled';
  renewalAlertDate: string;
  isRenewalInitiated?: boolean;
  /** Team leader responsible for delivering this contract's service visits. */
  assignedTeamLeaderId?: string;
  assignedTeamLeaderName?: string;
  /** Operations Manager assigned to oversee this contract's execution. */
  assignedOperationsManagerId?: string;
  assignedOperationsManagerName?: string;
  assignedAt?: string;

  // ---- Copied from the accepted proposal so nothing is retyped (all optional for older contracts)
  servicePlan?: ServicePlanItem[];
  serviceVisitsPerMonth?: number;
  followUpVisitsPerMonth?: number;
  pcoCountMin?: number;
  pcoCountMax?: number;
  documentationIncluded?: string[];
  monthlyRate?: number;
  taxMode?: 'exclusive' | 'inclusive';
  taxPercent?: number;
  tenureMonths?: number;
  paymentTermsDays?: number;
  terms?: string[];
  exclusions?: string;
  deviceOwnership?: string;
  chemicals?: string[];

  createdAt: string;
  updatedAt: string;
}
