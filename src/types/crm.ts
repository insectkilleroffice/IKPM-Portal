// CRM, Leads, Inspections, Pipeline types

import type { CustomerType } from './customer';
import type { SitePhoto } from './operations';

export type LeadSource =
  | 'whatsapp'
  | 'website_form'
  | 'inbound_phone'
  | 'referral'
  | 'walk_in'
  | 'facebook_instagram'
  | 'google_search'
  | 'field_canvassing';

/**
 * Pipeline: new → contacted → engaged → inspection_scheduled → inspection_completed
 *           → proposal_sent → won | lost.
 * 'qualified' and 'proposal_drafted' are older names kept so existing records still load
 * (treated as 'engaged' and 'proposal_sent').
 */
export type LeadStage =
  | 'new'
  | 'contacted'
  | 'engaged'
  | 'inspection_scheduled'
  | 'inspection_completed'
  | 'proposal_sent'
  | 'won'
  | 'lost'
  | 'qualified'
  | 'proposal_drafted';

/** Result of the latest contact attempt. */
export type ContactOutcome = 'no_response' | 'callback' | 'engaged' | 'not_interested' | 'wrong_contact';

export type ActivityChannel = 'call' | 'whatsapp' | 'email' | 'meeting' | 'visit' | 'note';

export interface LeadContact {
  id: string;
  name: string;
  designation?: string; // e.g. Operations Manager, CMO, Admin Officer
  phone: string;
  email?: string;
  isPrimary: boolean;
}

export interface LeadActivity {
  id: string;
  at: string;
  byUid?: string;
  byName: string;
  channel: ActivityChannel;
  contactId?: string;
  contactName?: string;
  outcome?: ContactOutcome;
  note?: string;
  nextFollowUp?: string; // ISO date
  /** System entries such as "Stage changed to Engaged". */
  kind?: 'contact' | 'stage' | 'inspection' | 'proposal' | 'system';
}

export type PestType =
  | 'termites'
  | 'cockroaches'
  | 'bedbugs'
  | 'rodents_rats'
  | 'mosquitoes_flies'
  | 'ants'
  | 'stored_grain_pests'
  | 'general_fumigation'
  | 'snake_reptile'
  | 'other';

export interface InspectionAssessment {
  id: string;
  leadId: string;
  scheduledDate: string;
  timeSlot?: 'morning' | 'afternoon' | 'evening';
  completedDate?: string;
  inspectorId: string;
  inspectorName: string;
  /** Everyone assigned to the visit (staff uids). */
  inspectorIds?: string[];
  inspectorNames?: string[];
  teamId?: string;
  teamName?: string;
  instructions?: string;
  findingsBy?: string;
  pestTypesFound: PestType[];
  infestationSeverity: 'low' | 'moderate' | 'high' | 'severe';
  areaSqFt: number;
  criticalFindings: string;
  recommendedTreatment: string;
  /** Kept in step with `photos` for older screens that only read URLs. */
  photoEvidenceUrls: string[];
  photos?: SitePhoto[];
  status: 'scheduled' | 'completed' | 'cancelled';
}

export interface Lead {
  id: string; // Permanent ID: LD-2026-0001
  /** Display name: the company name (or the person's name for individual leads). */
  title: string;
  companyName?: string;
  industry?: string;
  website?: string;
  companyPhone?: string;
  companyEmail?: string;
  /** At least one contact; exactly one is primary. contactName/phone/email mirror the primary. */
  contacts?: LeadContact[];
  activities?: LeadActivity[];
  contactOutcome?: ContactOutcome;
  lastContactedAt?: string;
  nextFollowUp?: string;
  /** Mirrors inspection.inspectorIds at the top level so firestore.rules can match assigned inspectors. */
  inspectorIds?: string[];
  proposalId?: string;
  wonAt?: string;
  lostAt?: string;
  lostAtStage?: LeadStage;
  source: LeadSource;
  stage: LeadStage;
  customerType: CustomerType;
  existingCustomerId?: string; // If linked to existing Client or Company
  branchId?: string; // If linked to a corporate branch
  contactName: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
  city: string;
  area: string;
  propertyAddress: string;
  pestIssues: PestType[];
  estimatedValue?: number; // PKR
  assignedToUserId?: string;
  assignedToName?: string;
  inspection?: InspectionAssessment;
  lostReason?: string;
  notes?: string;
  /** Photos of the property taken when the lead was added or visited. */
  sitePhotos?: SitePhoto[];
  duplicateWarning?: string; // Flag if phone/email matches existing records
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}
