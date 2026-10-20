// CRM, Leads, Inspections, Pipeline types

import type { CustomerType } from './customer';

export type LeadSource =
  | 'whatsapp'
  | 'website_form'
  | 'inbound_phone'
  | 'referral'
  | 'walk_in'
  | 'facebook_instagram'
  | 'google_search'
  | 'field_canvassing';

export type LeadStage =
  | 'new'
  | 'contacted'
  | 'inspection_scheduled'
  | 'inspection_completed'
  | 'qualified'
  | 'proposal_drafted'
  | 'won'
  | 'lost';

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
  completedDate?: string;
  inspectorId: string;
  inspectorName: string;
  pestTypesFound: PestType[];
  infestationSeverity: 'low' | 'moderate' | 'high' | 'severe';
  areaSqFt: number;
  criticalFindings: string;
  recommendedTreatment: string;
  photoEvidenceUrls: string[];
  status: 'scheduled' | 'completed' | 'cancelled';
}

export interface Lead {
  id: string; // Permanent ID: LD-2026-0001
  title: string;
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
  duplicateWarning?: string; // Flag if phone/email matches existing records
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}
