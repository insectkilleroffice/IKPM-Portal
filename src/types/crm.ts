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
 * Pipeline:
 *   new → contacted → engaged → meeting_scheduled → meeting_done → profile_sent
 *   → proposal_sent → negotiation → won | lost
 *
 * Legacy names kept for backwards-compat (stageOf() maps them):
 *   'qualified'         → 'engaged'
 *   'proposal_drafted'  → 'proposal_sent'
 *   'inspection_scheduled' → 'meeting_scheduled'
 *   'inspection_completed' → 'meeting_done'
 */
export type LeadStage =
  | 'new'
  | 'contacted'
  | 'engaged'
  | 'meeting_scheduled'
  | 'meeting_done'
  | 'profile_sent'
  | 'proposal_sent'
  | 'negotiation'
  | 'won'
  | 'lost'
  // Legacy aliases (still stored in Firestore on old records)
  | 'qualified'
  | 'proposal_drafted'
  | 'inspection_scheduled'
  | 'inspection_completed';

/** Why the lead is stuck — shown as a badge with how many days it has been stuck. */
export type StuckAtReason =
  | 'waiting_client_reply'
  | 'asked_company_profile'
  | 'meeting_pending'
  | 'awaiting_proposal'
  | 'price_bargaining'
  | 'awaiting_decision'
  | 'other';

/** Result of the latest contact attempt. */
export type ContactOutcome = 'no_response' | 'callback' | 'interested' | 'engaged' | 'not_interested' | 'wrong_contact';

export type ActivityChannel = 'call' | 'whatsapp' | 'email' | 'meeting' | 'visit' | 'note' | 'documents';

export interface LeadContact {
  id: string;
  name: string;
  designation?: string; // e.g. Operations Manager, CMO, Admin Officer
  phone: string;
  alternatePhone?: string;
  email?: string;
  isPrimary: boolean;
}

/** A branch / site that belongs to the lead's company. */
export interface LeadBranch {
  id: string;
  name: string;
  address: string;
  city?: string;
  contactName?: string;
  contactPhone?: string;
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
  /** Amount quoted in a revision or negotiation round. */
  quotedAmount?: number;
  /** Client's counter-offer in a negotiation round. */
  counterOffer?: number;
  /** System entries such as "Stage changed to Engaged". */
  kind?: 'contact' | 'stage' | 'inspection' | 'proposal' | 'system' | 'documents' | 'negotiation';
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

export type MeetingType = 'first_meeting' | 'negotiation' | 'renewal';
export type InspectionHandling = 'done_inline' | 'tl_schedule' | 'separate_visit';

export type MeetingFollowUpType =
  | 'company_profile'
  | 'proposal'
  | 'inspection'       // separate inspection visit requested
  | 'other_documents'  // other specific documents; note field holds details
  | 'not_interested'
  | 'contract_ready';

/** One item the client asked for during the meeting — tracked to completion. */
export interface MeetingFollowUp {
  id: string;
  type: MeetingFollowUpType;
  /** For 'inspection': when the visit is scheduled. */
  scheduledDate?: string;
  /** For 'other_documents': what documents specifically. */
  note?: string;
  /** ISO timestamp when this item was delivered / completed. */
  doneAt?: string;
  /** For 'inspection': branch/site where the visit should happen. */
  branchId?: string;
  branchName?: string;
  branchAddress?: string;
  /** For 'inspection': true when TL couldn't confirm the address yet. */
  addressTbd?: boolean;
}

/** A separate technical site inspection scheduled after the initial client meeting. */
export interface SiteInspection {
  id: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  scheduledDate: string;
  /** Which branch / site is being inspected. */
  branchId?: string;
  branchName?: string;
  branchAddress?: string;
  /** Technician(s) assigned to conduct the inspection. */
  assignedTechIds?: string[];
  assignedTechNames?: string[];
  teamLeaderId?: string;
  teamLeaderName?: string;
  requestedAt: string;
  requestedBy: string;
  completedDate?: string;
  pestTypesFound?: PestType[];
  infestationSeverity?: 'low' | 'moderate' | 'high' | 'severe';
  areaSqFt?: number;
  criticalFindings?: string;
  recommendedTreatment?: string;
  photoEvidenceUrls?: string[];
  photos?: SitePhoto[];
  findings?: RiskFinding[];
  reportTitle?: string;
  observedBy?: string;
  notes?: string;
}

/** One row of the risk assessment report: picture evidence, observation, risk, recommendation. */
export interface RiskFinding {
  id: string;
  photo?: SitePhoto;
  /** Where it was seen (e.g. "Kitchen back door"). */
  location?: string;
  observation: string;
  risk: string;
  recommendation: string;
}


export interface InspectionAssessment {
  id: string;
  leadId: string;
  scheduledDate: string;
  /** Exact start time as HH:MM (24-hour), e.g. "14:00". */
  scheduledTime?: string;
  timeSlot?: 'morning' | 'afternoon' | 'evening';
  completedDate?: string;
  inspectorId: string;
  inspectorName: string;
  /** Everyone assigned to the visit (staff uids). */
  inspectorIds?: string[];
  inspectorNames?: string[];
  teamId?: string;
  teamName?: string;
  /** The staff member who leads the team on this visit. */
  assignedTeamLeaderId?: string;
  assignedTeamLeaderName?: string;
  instructions?: string;
  /** Notes added by the team leader / for technician follow-up. */
  teamLeaderNotes?: string;
  branchId?: string;
  branchName?: string;
  /** Address where the meeting / inspection takes place. */
  meetingAddress?: string;
  findingsBy?: string;
  pestTypesFound: PestType[];
  infestationSeverity: 'low' | 'moderate' | 'high' | 'severe';
  areaSqFt: number;
  criticalFindings: string;
  recommendedTreatment: string;
  /** Kept in step with `photos` for older screens that only read URLs. */
  photoEvidenceUrls: string[];
  photos?: SitePhoto[];
  /** Risk assessment rows. Older inspections only have criticalFindings / recommendedTreatment. */
  findings?: RiskFinding[];
  /** What the client asked for at the end of the meeting — drives next pipeline step. */
  clientRequest?: 'company_profile' | 'proposal' | 'both' | 'more_info' | 'not_interested' | 'contract_ready';
  /** Checklist of what the client requested — replaces the single clientRequest for new reports. */
  meetingFollowUps?: MeetingFollowUp[];
  /** Summary note from the Team Leader about what was discussed / what the client wants. */
  meetingReportNote?: string;
  /** TL's go/no-go decision: ready to create a proposal, or hold for more steps. */
  tlStatus?: 'send_proposal' | 'waiting';
  /** Report heading, e.g. "Risk Assessment Report - Dunkin Johar". */
  reportTitle?: string;
  /** Branch / site the report is for. */
  siteName?: string;
  /** Who observed on the client's side (or alongside the inspector). */
  observedBy?: string;
  /** Whether this is a first meeting, a negotiation follow-up, or a renewal discussion. */
  meetingType?: MeetingType;
  /** How the technical inspection will be / was handled for a first meeting. */
  inspectionHandling?: InspectionHandling;
  /** Notes captured when scheduling later — client preferences, questions to clarify, site restrictions. */
  schedulingNote?: string;
  /** Preferred inspection date when client or TL requests a separate visit. */
  preferredInspectionDate?: string;
  /** For negotiation/renewal meetings: new terms or price discussed. */
  negotiationTermsNote?: string;
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
  /** All proposals ever created for this lead (newest first). */
  proposalIds?: string[];
  /** The latest active proposal. */
  proposalId?: string;
  /** Set when the team went from Engaged straight to a proposal without a site inspection. */
  inspectionSkipped?: { reason: string; at: string; by: string };
  wonAt?: string;
  lostAt?: string;
  lostAtStage?: LeadStage;
  source: LeadSource;
  stage: LeadStage;
  customerType: CustomerType;
  /** B2B goes through TL meeting + inspection; residential skips directly to proposal. Missing = b2b. */
  clientType?: 'residential' | 'b2b';
  existingCustomerId?: string; // If linked to existing Client or Company
  branchId?: string; // If linked to a corporate branch
  contactName: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
  city: string;
  area: string;
  propertyAddress: string;
  /** Full head-office address (for multi-site companies). */
  headquarterAddress?: string;
  /** Branches / sites identified during the sales process or site visit. */
  branches?: LeadBranch[];
  pestIssues: PestType[];
  estimatedValue?: number; // PKR
  assignedToUserId?: string;
  assignedToName?: string;
  /** Team leader (staff user) who owns the meeting / site visit. */
  assignedTeamLeaderId?: string;
  assignedTeamLeaderName?: string;
  inspection?: InspectionAssessment;
  /** Separate technical site inspection (distinct from the initial client meeting visit). */
  siteInspection?: SiteInspection;
  lostReason?: string;
  notes?: string;
  /** Photos of the property — kept optional so old records still load; no longer captured in the form. */
  sitePhotos?: SitePhoto[];
  duplicateWarning?: string; // Flag if phone/email matches existing records
  /** Current "stuck" status with when it was set. */
  stuckAt?: StuckAtReason;
  stuckAtDate?: string;
  // ----- Negotiation tracking -----
  /** Total number of negotiation rounds. */
  negotiationRounds?: number;
  /** Amount in PKR last quoted to the client. */
  lastQuotedAmount?: number;
  /** Client's last counter-offer. */
  clientCounterOffer?: number;
  /** Free-form notes on the price negotiation. */
  bargainingNotes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}
