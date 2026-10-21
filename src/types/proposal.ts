// Proposals, Quotations, Revisions and Approval Matrix types

import type { CustomerType } from './customer';
import type { PestType } from './crm';
import type { FolderMeta, TemplateStamp } from './folders';
import type { ScopeSection, ServicePlanItem, ServicePlanPreset } from '../lib/proposalPlan';

export type { ScopeSection, ServicePlanItem, ServicePlanPreset };

export type ProposalStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'sent_to_client'
  | 'negotiation'
  | 'accepted'
  | 'declined'
  | 'expired';

export type TemplateType =
  | 'termite_proofing'
  | 'general_ipm'
  | 'bedbug_eradication'
  | 'rodent_control'
  | 'commercial_kitchen'
  | 'fumigation_export'
  | 'cockroach_gel';

export interface ProposalLineItem {
  id: string;
  serviceName: string;
  targetPest: PestType;
  chemicalsSuggested: string;
  treatmentMethod: string;
  areaCoveredSqFt?: number;
  frequency: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ProposalRevision {
  revisionNumber: number;
  timestamp: string;
  changedBy: string;
  changedByName: string;
  changeReason: string;
  subtotal: number;
  discountPercent: number;
  totalAmount: number;
}

export interface ApprovalRequest {
  ruleId: 'AP-01' | 'AP-02' | 'AP-03' | 'AP-04' | 'AP-05' | 'AP-06';
  ruleDescription: string;
  requiredRole: 'sales_manager' | 'ceo' | 'accounts_manager';
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  requestedBy: string;
  requestedByName: string;
  decisionAt?: string;
  decisionBy?: string;
  decisionByName?: string;
  rejectionReason?: string;
  comments?: string;
}

export interface Proposal extends FolderMeta, TemplateStamp {
  id: string;
  revisionNumber: number;
  parentProposalId?: string;
  templateType: TemplateType;
  customerType: CustomerType;
  customerId: string;
  customerName: string;
  /** Lead this proposal was created from; accepting / declining it closes the lead as won / lost. */
  leadId?: string;
  branchId?: string;
  branchName?: string;
  siteId?: string;
  siteAddress?: string;
  preparedByUserId: string;
  preparedByName: string;
  scopeOfWork: string;
  exclusions?: string;
  clientResponsibilities?: string;
  safetyInstructions?: string;
  warrantyPeriodMonths?: number;
  lineItems: ProposalLineItem[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  totalAmount: number;
  validityDays: number;
  paymentTerms: string;
  status: ProposalStatus;
  approval?: ApprovalRequest;
  revisionsHistory: ProposalRevision[];
  sentDate?: string;
  acceptedDate?: string;
  pdfUrl?: string;

  // ---- Monthly IPM service plan (quotation format). All optional: older proposals use line items only.
  /** Person the cover letter is addressed to. */
  attentionTo?: { name: string; designation?: string };
  clientAddress?: string;
  coverLetter?: string;
  /** Scope of services A / B / C. */
  scopeSections?: ScopeSection[];
  /** Terms (a) – (h). */
  terms?: string[];
  servicePlanPreset?: ServicePlanPreset;
  /** "Monthly IPM Service Plan" table. */
  servicePlan?: ServicePlanItem[];
  serviceVisitsPerMonth?: number;
  followUpVisitsPerMonth?: number;
  pcoCountMin?: number;
  pcoCountMax?: number;
  documentationIncluded?: string[];
  /** Monthly charge as entered (see taxMode). */
  monthlyRate?: number;
  taxMode?: 'exclusive' | 'inclusive';
  tenureMonths?: number;
  tenureStart?: string;
  tenureEnd?: string;
  /** Invoices payable within this many days (default 15). */
  paymentTermsDays?: number;
  /** Who owns / pays for mechanical devices. */
  deviceOwnership?: string;
  /** Products to be used (Fendona, K-Othrine…); the onboarding pack needs an MSDS for each. */
  chemicals?: string[];

  createdAt: string;
  updatedAt: string;
}
