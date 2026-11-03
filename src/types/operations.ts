// Operations, Contracts, Service Jobs, Chemical Logs, Checklists, and Verified Reports

import type { CustomerType } from './customer';
import type { PestType } from './crm';
import type { FolderMeta, TemplateStamp } from './folders';
import type { ServicePlanItem } from '../lib/proposalPlan';
import type { RecordOwnership } from './index';

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
  type: 'before' | 'after' | 'infestation_focus' | 'bait_station' | 'challan' | 'signed_report';
  imageUrl: string;
  capturedAt: string;
  uploadedBy?: string;
}

export interface Challan extends FolderMeta {
  id: string;
  challanNumber: string;
  challanKey: string; // lowercase, spaces & dashes removed
  jobId: string;
  contractId?: string;
  customerId: string;
  customerName: string;
  clientType: CustomerType;
  branchId?: string;
  challanDate: string; // YYYY-MM-DD
  fileUrl: string;
  fileName: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  status: 'active' | 'superseded';
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

/** Start gate (SRS 5.5): confirmed by the Supervisor before the job can start. */
export interface JobPreCheck {
  uniform: boolean;
  safetyGear: boolean;
  chemicalsIssued: boolean;
  /** What was issued from store for this job, e.g. "Maxforce gel 2 tubes". */
  chemicalsIssuedNote?: string;
  confirmedByUid?: string;
  confirmedByName: string;
  confirmedAt: string;
}

/** QC sent the report back to the Supervisor instead of verifying it. */
export interface QcReturn {
  reason: string;
  byName: string;
  at: string;
}

/** QC re-entered chemicals from the signed paper report (SRS 5.5 chemical match). */
export interface QcChemicalCheck {
  entries: { name: string; qty: number; unit: ChemicalUsageRecord['unit'] }[];
  matches: boolean;
  checkedAt: string;
}

/** Cash the Supervisor collected from the client at the visit (residential jobs). */
export interface JobCashCollection {
  amount: number;
  collectedAt: string;
  collectedByUid?: string;
  collectedByName?: string;
  /** Photo of the handwritten receipt / cash slip given to the client. */
  receiptPhotoUrl?: string;
  note?: string;
  /** Set when Finance confirms receiving the cash and the Cash Memo is created. */
  receivedByFinanceAt?: string;
  receivedByFinanceName?: string;
  invoiceId?: string;
}

/** One person's trip to a visit and back, for the fuel paid with salary. */
export interface FuelClaim {
  /** HR employee id (PCO or the Supervisor's own record); no id = not paid through payroll. */
  employeeId?: string;
  name: string;
  role: 'pco' | 'supervisor';
  kmGoing: number;
  kmReturn: number;
  litres: number;
  /** PKR = (kmGoing + kmReturn) ÷ 36 × petrol price */
  amount: number;
}

export interface ServiceJob extends FolderMeta, Partial<RecordOwnership> {
  id: string;
  contractId?: string;
  proposalId?: string;
  cashCollection?: JobCashCollection;
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
  /** Supervisor accountable for this service visit. */
  assignedTeamLeaderId?: string;
  assignedTeamLeaderName?: string;
  status: JobStatus;
  rescheduledReason?: string;
  cancellationReason?: string;
  cancellationReasonCode?: 'client_denied_access' | 'team_unavailable' | 'chemical_unavailable' | 'client_request' | 'other';
  /** Outcome recorded by the Supervisor when submitting the service report. */
  visitOutcome?: 'completed' | 'partial' | 'client_blocked' | 'postponed';
  complaintId?: string;
  checklists: ServiceChecklistItem[];
  chemicalsUsed: ChemicalUsageRecord[];
  photoEvidence: PhotoEvidence[];
  customerSignOff?: CustomerSignOff;
  supervisorVerification?: SupervisorVerification;
  preCheck?: JobPreCheck;
  /** Latest QC send-back; cleared when QC verifies. */
  qcReturn?: QcReturn;
  qcChemicalCheck?: QcChemicalCheck;
  executionNotes?: string;
  // Challan fields (Change 39)
  challanNumber?: string;
  challanId?: string;
  challanFileUrl?: string;
  // PCOs are HR employees with no login (Change 48). The Supervisor is the login on the job.
  leadPcoEmployeeId?: string;
  /** PCOs planned for the visit (employee ids, from the Supervisor's team). */
  assignedPcoEmployeeIds?: string[];
  /** PCOs who actually did the work, ticked by the Supervisor on the report (employee ids; payroll credit). */
  performedByPcoIds?: string[];
  /** Supervisor went on site personally. */
  teamLeaderOnSite?: boolean;
  /** Why a PCO from another team was used. */
  borrowedPcoReason?: string;
  /** Petrol price (PKR per litre) on the day, entered by the Supervisor on the report. */
  petrolPricePerLitre?: number;
  /** Travel by each person on site; paid with their salary (km ÷ 36 km/L × petrol price). */
  fuelClaims?: FuelClaim[];
  // Supervisor submission on behalf of PCOs (Change 49)
  submittedByUid?: string;
  submittedByName?: string;
  submittedAt?: string;
  checklistConfirmedBy?: string;
  lateSubmission?: boolean;
  lateDays?: number;
  lateReason?: string;
  filingPending?: boolean;
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
  /** Supervisor responsible for delivering this contract's service visits. */
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
  /** How often this contract is invoiced: 0 / unset = calendar month, else every N days (from the proposal). */
  billingCycleDays?: number;
  terms?: string[];
  exclusions?: string;
  deviceOwnership?: string;
  chemicals?: string[];

  /** Why and when the contract was cancelled (set when it is cancelled, directly or by approval). */
  cancellation?: ContractCancellation;

  createdAt: string;
  updatedAt: string;
}

export type ContractCancelCategory =
  | 'client_request'
  | 'non_payment'
  | 'service_quality'
  | 'business_closed'
  | 'price'
  | 'moved_to_competitor'
  | 'other';

export const CONTRACT_CANCEL_CATEGORY_LABELS: Record<ContractCancelCategory, string> = {
  client_request: 'Client requested',
  non_payment: 'Non-payment',
  service_quality: 'Service quality / complaints',
  business_closed: 'Client business closed / relocated',
  price: 'Price / budget',
  moved_to_competitor: 'Moved to a competitor',
  other: 'Other',
};

export interface ContractCancellation {
  category: ContractCancelCategory;
  reason: string;
  /** Last day of service. Scheduled visits after this date are cancelled. */
  effectiveDate: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  approvedBy?: string;
  approvedByName?: string;
  cancelledAt: string;
}
