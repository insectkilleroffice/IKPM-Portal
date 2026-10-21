// Workflow orchestration utilities for IKPM Portal
// Connects Lead ─► Inspection ─► Proposal ─► Contract / One-off ─► Scheduled Job ─► PCO Visit ─► Verified Report ─► Invoice ─► Paid ─► Renewal

import type { TaxJurisdiction, Invoice } from '../types/finance';
import type { ServiceJob, Contract, ChemicalUsageRecord } from '../types/operations';
import type { Lead } from '../types/crm';
import type { Proposal } from '../types/proposal';
import { availableActions, nextStep, stageMeta, type LeadActionId } from './leadWorkflow';

export type UnifiedStage =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'verified'
  | 'invoiced'
  | 'paid';

export interface StageInfo {
  id: UnifiedStage;
  label: string;
  stepNumber: number;
  status: 'completed' | 'current' | 'upcoming' | 'blocked';
  message: string;
  blockerReason?: string;
  timestamp?: string;
}

export interface NextAction {
  label: string;
  targetStage: string;
  description: string;
  isBlocked: boolean;
  blockerReason?: string;
  actionType:
    | 'schedule_inspection'
    | 'complete_inspection'
    | 'create_client'
    | 'create_proposal'
    | 'submit_approval'
    | 'approve_proposal'
    | 'create_contract'
    | 'create_job'
    | 'generate_schedule'
    | 'start_job'
    | 'complete_job'
    | 'verify_report'
    | 'create_invoice'
    | 'record_payment'
    | 'renew_contract'
    | 'send_documents'
    | LeadActionId;
}

/**
 * Maps a Pakistani province to its corresponding provincial revenue authority / tax jurisdiction.
 */
export function provinceToJurisdiction(province?: string): TaxJurisdiction {
  if (!province) return 'sindh_srb';
  const p = province.toLowerCase();
  if (p.includes('punjab')) return 'punjab_pra';
  if (p.includes('islamabad') || p.includes('ict')) return 'islamabad_ict';
  if (p.includes('kpk') || p.includes('khyber') || p.includes('peshawar')) return 'kpk_kpra';
  if (p.includes('balochistan') || p.includes('quetta')) return 'balochistan_bra';
  return 'sindh_srb';
}

/**
 * Returns standard sales tax rate for jurisdiction.
 */
export function getStandardTaxRate(jurisdiction: TaxJurisdiction): number {
  switch (jurisdiction) {
    case 'sindh_srb':
      return 13;
    case 'punjab_pra':
      return 16;
    case 'islamabad_ict':
      return 16;
    case 'kpk_kpra':
      return 15;
    case 'balochistan_bra':
      return 15;
    default:
      return 13;
  }
}

/**
 * Computes the unified 6-stage workflow status for any job (and optional linked invoice).
 * Chain: Scheduled ─► In Progress ─► Completed ─► Verified ─► Invoiced ─► Paid
 */
export function getJobWorkflowChain(job: ServiceJob, invoice?: Invoice): { stages: StageInfo[]; currentStageId: UnifiedStage } {
  const isScheduled = Boolean(job.scheduledDate);
  const isInProgress = job.status === 'in_progress' || job.status === 'en_route';
  const isCompleted = ['completed', 'verified'].includes(job.status) || Boolean(job.customerSignOff?.signedAt);
  const isVerified = Boolean(job.supervisorVerification?.isVerified);
  const isInvoiced = Boolean(invoice && invoice.status !== 'void_reversed');
  const isPaid = Boolean(invoice && (invoice.status === 'paid' || invoice.balanceDue <= 0));

  let currentStageId: UnifiedStage = 'scheduled';
  if (isPaid) {
    currentStageId = 'paid';
  } else if (isInvoiced) {
    currentStageId = 'invoiced';
  } else if (isVerified) {
    currentStageId = 'verified';
  } else if (isCompleted) {
    currentStageId = 'completed';
  } else if (isInProgress) {
    currentStageId = 'in_progress';
  }

  const stages: StageInfo[] = [
    {
      id: 'scheduled',
      label: 'Scheduled',
      stepNumber: 1,
      status: isCompleted || isInProgress || isScheduled ? 'completed' : 'current',
      message: job.scheduledDate ? `Scheduled for ${job.scheduledDate} (${job.timeSlot})` : 'Scheduling pending',
      timestamp: job.createdAt,
    },
    {
      id: 'in_progress',
      label: 'In Progress',
      stepNumber: 2,
      status: isCompleted ? 'completed' : isInProgress ? 'current' : 'upcoming',
      message: isInProgress
        ? `Technician ${job.leadPcoName} is active on site`
        : isCompleted
        ? `Job executed by ${job.leadPcoName}`
        : `Awaiting technician dispatch (${job.leadPcoName})`,
    },
    {
      id: 'completed',
      label: 'Completed',
      stepNumber: 3,
      status: isCompleted ? 'completed' : isInProgress ? 'current' : 'upcoming',
      message: isCompleted
        ? `Finished & signed by ${job.customerSignOff?.acknowledgedByName || 'client'}`
        : 'Service execution & client signature pending',
      blockerReason: !isCompleted && !isInProgress ? 'Job has not been started by technician' : undefined,
      timestamp: job.customerSignOff?.signedAt,
    },
    {
      id: 'verified',
      label: 'Report Verified',
      stepNumber: 4,
      status: isVerified ? 'completed' : isCompleted ? 'current' : 'upcoming',
      message: isVerified
        ? `Supervisor QC passed: ${job.supervisorVerification?.supervisorName} (${job.supervisorVerification?.qcRating?.toUpperCase()})`
        : isCompleted
        ? 'Report awaiting supervisor QC verification'
        : 'Blocked until field visit completes',
      blockerReason: !isCompleted ? 'Cannot verify before job completion' : !isVerified ? 'Supervisor inspection & QC sign-off required' : undefined,
      timestamp: job.supervisorVerification?.verifiedAt,
    },
    {
      id: 'invoiced',
      label: 'Invoiced',
      stepNumber: 5,
      status: isInvoiced ? 'completed' : isVerified ? 'current' : 'upcoming',
      message: isInvoiced
        ? `Invoice ${invoice?.invoiceNumber} generated (${invoice?.jurisdiction.toUpperCase()})`
        : isVerified
        ? 'Report verified — ready to issue sales tax invoice'
        : 'Blocked: statutory sales tax invoice requires verified report',
      blockerReason: !isVerified ? 'Guard Rail: No invoice can be issued before report is verified' : undefined,
      timestamp: invoice?.issueDate,
    },
    {
      id: 'paid',
      label: 'Paid',
      stepNumber: 6,
      status: isPaid ? 'completed' : isInvoiced ? 'current' : 'upcoming',
      message: isPaid
        ? `Fully settled (PKR ${invoice?.grossPayable?.toLocaleString() || 0})`
        : isInvoiced
        ? `Balance due: PKR ${invoice?.balanceDue?.toLocaleString() || 0}`
        : 'Payment will be recorded against generated invoice',
      blockerReason: !isInvoiced ? 'Invoice has not been generated yet' : invoice && invoice.balanceDue > 0 ? `Outstanding balance of PKR ${invoice.balanceDue.toLocaleString()}` : undefined,
    },
  ];

  return { stages, currentStageId };
}

/** Where each lead next-step leads (target screen and description for dashboards). */
const LEAD_ACTION_INFO: Partial<Record<LeadActionId, { targetStage: string; description: string }>> = {
  log_contact: { targetStage: 'Contact', description: 'Call or WhatsApp the contact and record the outcome; an interested client moves to Engaged.' },
  schedule_inspection: { targetStage: 'Site Inspection', description: 'Assign an inspector or team to assess the infestation at the premises.' },
  record_findings: { targetStage: 'Inspection Assessment', description: 'Record inspection findings, infestation severity and area.' },
  create_proposal: { targetStage: 'Proposal', description: 'Carry site, area, pests and scope from the inspection into a proposal draft.' },
  open_proposal: { targetStage: 'Proposal', description: 'Follow up on the proposal. The lead is won when the client accepts it.' },
  open_customer: { targetStage: 'Client Profile', description: 'Lead won. Continue with the onboarding pack and contract on the customer account.' },
  reopen: { targetStage: 'Contacted', description: 'Lead was lost. Reopen it to start contacting again.' },
};

/**
 * Computes next action for a Lead, from the same stage rules as the Leads page
 * (leadWorkflow.nextStep / STAGE_ACTIONS). Legacy stage names are mapped inside stageOf().
 */
export function getLeadNextAction(lead: Lead): NextAction {
  const step = nextStep(lead);
  const blocked = availableActions(lead).find((a) => a.id === step.action && !a.enabled);
  const info = LEAD_ACTION_INFO[step.action] ?? { targetStage: stageMeta(lead.stage).label, description: step.label };
  return {
    label: step.label,
    targetStage: info.targetStage,
    description: info.description,
    isBlocked: Boolean(blocked),
    blockerReason: blocked?.disabledReason,
    actionType: step.action,
  };
}

/**
 * Computes next action for a Proposal.
 */
export function getProposalNextAction(proposal: Proposal): NextAction {
  if (proposal.status === 'draft') {
    if (proposal.discountPercent > 10) {
      return {
        label: 'Submit for Manager Approval',
        targetStage: 'Approval Queue',
        description: `Discount ${proposal.discountPercent}% exceeds 10% limit. Requires Sales Manager sign-off.`,
        isBlocked: false,
        actionType: 'submit_approval',
      };
    }
    return {
      label: 'Send Proposal to Client',
      targetStage: 'Client Review',
      description: 'Send proposal quotation and company credentials via WhatsApp / Email.',
      isBlocked: false,
      actionType: 'send_documents',
    };
  }
  if (proposal.status === 'pending_approval') {
    return {
      label: 'Review Approval (AP-01)',
      targetStage: 'Manager Sign-off',
      description: 'Authorize or reject discounted quotation pricing.',
      isBlocked: false,
      actionType: 'approve_proposal',
    };
  }
  if (proposal.status === 'approved' || proposal.status === 'sent_to_client' || proposal.status === 'accepted') {
    return {
      label: 'Create Contract / Job',
      targetStage: 'Contract or One-off Job',
      description: 'Proposal approved. Generate Annual AMC contract or one-off service job with pre-filled line items.',
      isBlocked: false,
      actionType: 'create_contract',
    };
  }
  return {
    label: 'Send Proposal',
    targetStage: 'Client Outreach',
    description: 'Share updated proposal with client.',
    isBlocked: false,
    actionType: 'send_documents',
  };
}

/**
 * Computes next action for a Contract.
 */
export function getContractNextAction(contract: Contract): NextAction {
  const isExpiringSoon = contract.status === 'active' && contract.renewalAlertDate && new Date(contract.renewalAlertDate) <= new Date();
  if (isExpiringSoon || contract.status === 'expired') {
    return {
      label: 'Renew AMC Contract',
      targetStage: 'Renewal Proposal',
      description: 'Contract approaching expiration. Initiate 1-click renewal agreement.',
      isBlocked: false,
      actionType: 'renew_contract',
    };
  }
  return {
    label: 'Generate Visit Schedule',
    targetStage: 'Operations Schedule',
    description: 'Generate recurring service jobs for all scheduled visits across the term.',
    isBlocked: false,
    actionType: 'generate_schedule',
  };
}

/**
 * Computes next action for a Job.
 */
export function getJobNextAction(job: ServiceJob, invoice?: Invoice): NextAction {
  if (job.status === 'scheduled') {
    const hasTechnician = job.assignedTechnicianNames && job.assignedTechnicianNames.length > 0 && job.assignedTechnicianNames[0] !== 'Unassigned';
    return {
      label: 'Start Job Visit',
      targetStage: 'In Progress',
      description: 'Technician punches in on site and begins guided chemical application.',
      isBlocked: !hasTechnician,
      blockerReason: !hasTechnician ? 'Guard Rail: Cannot start job without an assigned technician' : undefined,
      actionType: 'start_job',
    };
  }
  if (job.status === 'en_route' || job.status === 'in_progress') {
    return {
      label: 'Complete Job & Sign-off',
      targetStage: 'Client Signature',
      description: 'Record chemicals used, photo evidence, and obtain digital customer signature.',
      isBlocked: false,
      actionType: 'complete_job',
    };
  }
  if (job.status === 'completed' && !job.supervisorVerification?.isVerified) {
    return {
      label: 'Verify Report (QC Sign-off)',
      targetStage: 'Supervisor Verification',
      description: 'Supervisor reviews chemical dosages, photo evidence, and marks QC approval.',
      isBlocked: false,
      actionType: 'verify_report',
    };
  }
  if (job.supervisorVerification?.isVerified && !invoice) {
    return {
      label: 'Create Invoice',
      targetStage: 'Sales Tax Invoice',
      description: 'Generate statutory provincial sales tax invoice pre-filled from verified service data.',
      isBlocked: false,
      actionType: 'create_invoice',
    };
  }
  if (invoice && invoice.balanceDue > 0) {
    return {
      label: 'Record Receipt',
      targetStage: 'Payment Allocation',
      description: `Receive client payment for invoice ${invoice.invoiceNumber} (Balance: PKR ${invoice.balanceDue.toLocaleString()}).`,
      isBlocked: false,
      actionType: 'record_payment',
    };
  }
  return {
    label: 'Send Report & Invoice',
    targetStage: 'Client Outreach',
    description: 'Send completed service report and tax invoice to client via WhatsApp / Email.',
    isBlocked: false,
    actionType: 'send_documents',
  };
}

/**
 * Chemical treatment presets by pest for instant technician logging.
 */
export const CHEMICAL_PRESETS: Record<string, ChemicalUsageRecord> = {
  cockroaches: {
    id: 'preset_cockroaches',
    chemicalName: 'Maxforce FC Magnum Gel (Bayer)',
    activeIngredient: 'Fipronil 0.05%',
    registrationNumber: 'DPP-PAK-2021-994',
    dosageRate: '1-2 spots / m²',
    quantityUsed: 30,
    unit: 'grams',
    batchNumber: 'BAY-2026-PAK',
    targetPest: 'cockroaches',
    applicationMethod: 'gel_baiting',
  },
  termites: {
    id: 'preset_termites',
    chemicalName: 'Premise 200 SC (Imidacloprid)',
    activeIngredient: 'Imidacloprid 200g/L',
    registrationNumber: 'DPP-PAK-2019-112',
    dosageRate: '5L finished solution / linear meter',
    quantityUsed: 5,
    unit: 'litres',
    batchNumber: 'BAY-2026-TM',
    targetPest: 'termites',
    applicationMethod: 'soil_injection',
  },
  bedbugs: {
    id: 'preset_bedbugs',
    chemicalName: 'K-Othrine Polyzone (Deltamethrin)',
    activeIngredient: 'Deltamethrin 62.5g/L',
    registrationNumber: 'DPP-PAK-2022-540',
    dosageRate: '10ml per litre water',
    quantityUsed: 100,
    unit: 'ml',
    batchNumber: 'BAY-2026-BB',
    targetPest: 'bedbugs',
    applicationMethod: 'residual_spray',
  },
  rodents_rats: {
    id: 'preset_rodents',
    chemicalName: 'Contrac All-Weather Rodent Blox',
    activeIngredient: 'Bromadiolone 0.005%',
    registrationNumber: 'DPP-PAK-2020-412',
    dosageRate: '1-2 blocks per tamper-resistant station',
    quantityUsed: 8,
    unit: 'bait_stations',
    batchNumber: 'BELL-2026-03',
    targetPest: 'rodents_rats',
    applicationMethod: 'rodent_bait_station',
  },
  mosquitoes_flies: {
    id: 'preset_fogging',
    chemicalName: 'Aqua K-Othrine ULV Fogging',
    activeIngredient: 'Deltamethrin 2% EW',
    registrationNumber: 'DPP-PAK-2023-702',
    dosageRate: '100ml per 1000m³ space',
    quantityUsed: 500,
    unit: 'ml',
    batchNumber: 'BAY-2026-ULV',
    targetPest: 'mosquitoes_flies',
    applicationMethod: 'cold_fogging_ulv',
  },
  general_fumigation: {
    id: 'preset_general',
    chemicalName: 'Fendona 6 SC (Alpha-Cypermethrin)',
    activeIngredient: 'Alpha-Cypermethrin 60g/L',
    registrationNumber: 'DPP-PAK-2021-318',
    dosageRate: '25ml per 5L water',
    quantityUsed: 250,
    unit: 'ml',
    batchNumber: 'BASF-2026-08',
    targetPest: 'general_fumigation',
    applicationMethod: 'residual_spray',
  },
};
