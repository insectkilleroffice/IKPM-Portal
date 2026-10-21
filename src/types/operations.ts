// Operations, Contracts, Service Jobs, Chemical Logs, Checklists, and Verified Reports

import type { CustomerType } from './customer';
import type { PestType } from './crm';

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

export interface ServiceJob {
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
  timeSlot: 'morning' | 'afternoon' | 'evening' | 'night_shift';
  assignedTechnicianIds: string[];
  assignedTechnicianNames: string[];
  leadPcoId: string;
  leadPcoName: string;
  status: JobStatus;
  rescheduledReason?: string;
  cancellationReason?: string;
  checklists: ServiceChecklistItem[];
  chemicalsUsed: ChemicalUsageRecord[];
  photoEvidence: PhotoEvidence[];
  customerSignOff?: CustomerSignOff;
  supervisorVerification?: SupervisorVerification;
  executionNotes?: string;
  isOfflineDraft?: boolean;
  syncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Contract {
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
  createdAt: string;
  updatedAt: string;
}
