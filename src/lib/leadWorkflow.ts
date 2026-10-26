// Lead pipeline rules shared by the Leads page, Site Inspections page and Excel import/export.
//
// Step-by-step flow:
//   new → contacted → engaged → meeting_scheduled → meeting_done → profile_sent / proposal_sent → negotiation → won | lost
//
// CRO (Sales) aligns a Team Leader for the meeting at "meeting_scheduled".
// Team Leader conducts the meeting, records findings and what the client asked for.
// After meeting_done, next step depends on the client request:
//   - Client asked for company profile → profile_sent
//   - Client asked for proposal → proposal_sent
//   - Client asked for inspection / more info → remains meeting_done until recorded

import type { ActivityChannel, ContactOutcome, Lead, LeadBranch, LeadContact, LeadSource, LeadStage, StuckAtReason } from '../types/crm';
import { normalizePakistaniPhone } from './formatters';

/** Photo categories for site visits (lead site photos and inspection findings). */
export const INSPECTION_PHOTO_TYPES: { value: string; label: string }[] = [
  { value: 'infestation', label: 'Infestation / activity' },
  { value: 'damage', label: 'Damage' },
  { value: 'entry_point', label: 'Entry / breeding point' },
  { value: 'general', label: 'General site view' },
];

export type PipelineStage =
  | 'new'
  | 'contacted'
  | 'engaged'
  | 'meeting_scheduled'
  | 'meeting_done'
  | 'profile_sent'
  | 'proposal_sent'
  | 'negotiation'
  | 'won'
  | 'lost';

export const PIPELINE: { stage: PipelineStage; label: string; short: string; hint: string; color: string }[] = [
  { stage: 'new', label: 'New inquiries', short: 'New', hint: 'New lead captured — not yet contacted by Sales / CRO', color: '#1A73E8' },
  { stage: 'contacted', label: 'Contacted', short: 'Contacted', hint: 'CRO reached out — awaiting client interest', color: '#0891B2' },
  { stage: 'engaged', label: 'Engaged', short: 'Engaged', hint: 'Client is interested — CRO aligns a Team Leader and schedules a meeting', color: '#7C3AED' },
  { stage: 'meeting_scheduled', label: 'Meeting scheduled', short: 'Meeting', hint: 'Team Leader confirmed for the client meeting', color: '#D97706' },
  { stage: 'meeting_done', label: 'Meeting done', short: 'Meeting done', hint: 'Team Leader submitted the meeting report — create proposal or schedule site inspection', color: '#B45309' },
  { stage: 'proposal_sent', label: 'Proposal sent', short: 'Proposal', hint: 'Proposal created and shared with the client', color: '#0E8A5F' },
  { stage: 'negotiation', label: 'Negotiation', short: 'Negotiation', hint: 'Price or terms bargaining in progress', color: '#EA580C' },
  { stage: 'won', label: 'Won', short: 'Won', hint: 'Converted to active customer — contract raised', color: '#0A6B4A' },
  { stage: 'lost', label: 'Lost / rejected', short: 'Lost', hint: 'Not interested or lost to competitor', color: '#DC2626' },
];

/**
 * Maps legacy stage IDs stored in old Firestore records to their current PipelineStage equivalent.
 * Old ids: 'qualified' → 'engaged', 'proposal_drafted' → 'proposal_sent',
 *          'inspection_scheduled' → 'meeting_scheduled', 'inspection_completed' → 'meeting_done',
 *          'profile_sent' → 'proposal_sent' (folded in; company profile is now just an activity).
 */
export const stageOf = (lead: Pick<Lead, 'stage'>): PipelineStage => {
  switch (lead.stage) {
    case 'qualified': return 'engaged';
    case 'proposal_drafted': return 'proposal_sent';
    case 'inspection_scheduled': return 'meeting_scheduled';
    case 'inspection_completed': return 'meeting_done';
    case 'profile_sent': return 'proposal_sent';
    default: return lead.stage as PipelineStage;
  }
};

export const stageMeta = (s: LeadStage) => PIPELINE.find((p) => p.stage === stageOf({ stage: s })) ?? PIPELINE[0];

export const OUTCOMES: { value: ContactOutcome; label: string; tone: 'slate' | 'amber' | 'emerald' | 'rose' }[] = [
  { value: 'no_response', label: 'No response', tone: 'slate' },
  { value: 'callback', label: 'Call back later', tone: 'amber' },
  { value: 'interested', label: 'Interested', tone: 'emerald' },
  { value: 'engaged', label: 'Engaged', tone: 'emerald' },
  { value: 'not_interested', label: 'Not interested (rejected)', tone: 'rose' },
  { value: 'wrong_contact', label: 'Wrong / unreachable contact', tone: 'rose' },
];

export const outcomeLabel = (o?: ContactOutcome) => OUTCOMES.find((x) => x.value === o)?.label ?? '';
export const outcomeTone = (o?: ContactOutcome) => OUTCOMES.find((x) => x.value === o)?.tone ?? 'slate';

export const CHANNELS: { value: ActivityChannel; label: string }[] = [
  { value: 'call', label: 'Phone call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'visit', label: 'Site visit' },
  { value: 'note', label: 'Note' },
  { value: 'documents', label: 'Documents sent' },
];

export const SOURCES: { value: LeadSource; label: string }[] = [
  { value: 'inbound_phone', label: 'Phone call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'website_form', label: 'Website' },
  { value: 'referral', label: 'Referral' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'facebook_instagram', label: 'Facebook / Instagram' },
  { value: 'google_search', label: 'Google' },
  { value: 'field_canvassing', label: 'Field canvassing' },
];

export const sourceLabel = (s?: LeadSource) => SOURCES.find((x) => x.value === s)?.label ?? s ?? '';

export const INDUSTRIES = [
  'Food & restaurant', 'Hotel & hospitality', 'Manufacturing / factory', 'Warehouse & logistics', 'Healthcare & pharma',
  'Corporate office', 'Retail & mall', 'Education', 'Residential society', 'Other',
];

export const STUCK_AT_REASONS: { value: StuckAtReason; label: string }[] = [
  { value: 'waiting_client_reply', label: 'Waiting for client reply' },
  { value: 'asked_company_profile', label: 'Client asked for company profile' },
  { value: 'meeting_pending', label: 'Meeting / inspection pending' },
  { value: 'awaiting_proposal', label: 'Awaiting proposal' },
  { value: 'price_bargaining', label: 'Price bargaining' },
  { value: 'awaiting_decision', label: 'Awaiting client decision' },
  { value: 'other', label: 'Other' },
];

export const stuckAtLabel = (s?: StuckAtReason) => STUCK_AT_REASONS.find((x) => x.value === s)?.label ?? '';

/** Days since the lead was marked stuck. */
export const daysSince = (iso?: string): number => {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
};

/** Contacts of a lead, falling back to the legacy single-contact fields for older records. */
export function contactsOf(lead: Lead): LeadContact[] {
  if (lead.contacts?.length) return lead.contacts;
  if (!lead.contactName && !lead.phone) return [];
  return [{ id: 'primary', name: lead.contactName, phone: lead.phone, email: lead.email, isPrimary: true }];
}

export const primaryContact = (lead: Lead): LeadContact | undefined => {
  const list = contactsOf(lead);
  return list.find((c) => c.isPrimary) ?? list[0];
};

/** Keeps legacy fields (used by search, duplicate checks, outreach and proposals) in step with the contacts list. */
export function syncLeadFields(lead: Lead): Lead {
  const contacts = (lead.contacts ?? []).filter((c) => c.name.trim() || c.phone.trim());
  if (contacts.length && !contacts.some((c) => c.isPrimary)) contacts[0] = { ...contacts[0], isPrimary: true };
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  return {
    ...lead,
    contacts,
    title: (lead.companyName || lead.title || primary?.name || 'Untitled lead').trim(),
    contactName: primary?.name ?? lead.contactName ?? '',
    phone: primary?.phone ?? lead.phone ?? '',
    email: primary?.email || lead.email,
    inspectorIds:
      lead.inspection?.status === 'scheduled' || lead.inspection?.status === 'completed'
        ? lead.inspection?.inspectorIds ?? lead.inspectorIds
        : lead.inspectorIds,
  };
}

// ---------------------------------------------------------------------------
// Stage rules: which actions each stage allows (one source of truth for the
// row "⋮" menu, the lead detail footer and the primary next-step button)
// ---------------------------------------------------------------------------

export type LeadActionId =
  | 'edit'
  | 'log_contact'
  | 'schedule_inspection'
  | 'reschedule_inspection'
  | 'record_findings'
  | 'create_proposal'
  | 'open_proposal'
  | 'create_revision'
  | 'skip_inspection'
  | 'send_documents'
  | 'set_stuck_at'
  | 'mark_won'
  | 'mark_lost'
  | 'open_customer'
  | 'reopen'
  | 'change_stage'
  | 'record_meeting'
  | 'schedule_site_inspection'
  | 'record_site_inspection'
  | 'schedule_negotiation_meeting';

/**
 * Actions offered at each stage, in menu order. 'mark_won' is never in a stage menu:
 * a lead becomes won when its proposal is accepted.
 */
export const STAGE_ACTIONS: Record<PipelineStage, LeadActionId[]> = {
  new: ['edit', 'log_contact', 'schedule_negotiation_meeting', 'send_documents', 'set_stuck_at', 'mark_lost'],
  contacted: ['edit', 'log_contact', 'schedule_negotiation_meeting', 'send_documents', 'change_stage', 'set_stuck_at', 'mark_lost'],
  engaged: ['edit', 'log_contact', 'schedule_inspection', 'schedule_negotiation_meeting', 'schedule_site_inspection', 'record_site_inspection', 'send_documents', 'change_stage', 'set_stuck_at', 'mark_lost'],
  meeting_scheduled: ['edit', 'reschedule_inspection', 'schedule_negotiation_meeting', 'record_meeting', 'schedule_site_inspection', 'record_site_inspection', 'send_documents', 'change_stage', 'set_stuck_at', 'mark_lost'],
  meeting_done: ['edit', 'record_meeting', 'schedule_negotiation_meeting', 'schedule_site_inspection', 'record_site_inspection', 'create_proposal', 'open_proposal', 'send_documents', 'change_stage', 'set_stuck_at', 'mark_lost'],
  profile_sent: ['edit', 'log_contact', 'schedule_negotiation_meeting', 'record_meeting', 'create_proposal', 'open_proposal', 'send_documents', 'change_stage', 'set_stuck_at', 'mark_lost'],
  proposal_sent: ['edit', 'schedule_negotiation_meeting', 'record_meeting', 'open_proposal', 'create_proposal', 'send_documents', 'change_stage', 'set_stuck_at', 'mark_lost'],
  negotiation: ['edit', 'schedule_negotiation_meeting', 'record_meeting', 'open_proposal', 'create_proposal', 'create_revision', 'log_contact', 'send_documents', 'change_stage', 'set_stuck_at', 'mark_lost'],
  won: ['open_customer', 'open_proposal', 'schedule_negotiation_meeting', 'send_documents'],
  lost: ['reopen', 'create_proposal'],
};

export const ACTION_LABELS: Record<LeadActionId, string> = {
  edit: 'Edit details',
  log_contact: 'Log contact',
  schedule_inspection: 'Schedule meeting (assign Team Leader)',
  reschedule_inspection: 'Reschedule meeting',
  record_findings: 'Submit meeting report / inspection findings',
  create_proposal: 'Create proposal',
  open_proposal: 'Open proposal',
  create_revision: 'Revise & resend proposal',
  skip_inspection: 'Skip meeting → go straight to proposal',
  send_documents: 'Send company profile / documents',
  set_stuck_at: 'Set "stuck at" status',
  mark_won: 'Mark as won',
  mark_lost: 'Mark as lost',
  open_customer: 'Open customer',
  reopen: 'Reopen lead',
  change_stage: 'Move to stage…',
  record_meeting: 'Submit meeting report',
  schedule_site_inspection: 'Schedule site inspection',
  record_site_inspection: 'Record inspection findings',
  schedule_negotiation_meeting: 'Schedule meeting',
};

/** Actions that only open existing records, so view-only users may use them. */
export const READ_ONLY_ACTIONS: LeadActionId[] = ['open_proposal', 'open_customer'];

export interface AvailableAction {
  id: LeadActionId;
  label: string;
  enabled: boolean;
  disabledReason?: string;
}

/** Actions for a lead's current stage, with the reason when one can't be used yet. */
export function availableActions(lead: Lead): AvailableAction[] {
  const stage = stageOf(lead);
  const isResidential = lead.clientType === 'residential';
  // For residential leads add create_proposal to any stage where it is not already listed.
  const stageActions = (STAGE_ACTIONS[stage] ?? []).slice();
  if (isResidential && !stageActions.includes('create_proposal') && !['won'].includes(stage)) {
    stageActions.unshift('create_proposal');
  }
  const out: AvailableAction[] = [];
  for (const id of stageActions) {
    let label = ACTION_LABELS[id];
    let enabled = true;
    let disabledReason: string | undefined;
    switch (id) {
      case 'record_findings':
        if (lead.inspection?.status === 'completed') label = 'Edit meeting / inspection findings';
        break;
      case 'create_proposal':
        if (isResidential) {
          if (lead.proposalId) {
            enabled = false;
            disabledReason = `Proposal ${lead.proposalId} already exists — open or revise it instead.`;
          }
          break;
        }
        if (lead.proposalId) {
          enabled = false;
          disabledReason = `Proposal ${lead.proposalId} already exists — open or revise it instead.`;
        } else if (stage === 'meeting_done') {
          const meetingType = lead.inspection?.meetingType;
          const skipInspCheck = meetingType === 'negotiation' || meetingType === 'renewal';
          const inlineInspDone = Boolean(lead.inspection?.pestTypesFound?.length);
          const siteInspDone = lead.siteInspection?.status === 'completed';
          const inspectionDone = inlineInspDone || siteInspDone;
          const tl = lead.inspection?.tlStatus;
          if (!skipInspCheck && !inspectionDone) {
            enabled = false;
            disabledReason = 'A completed inspection is required. Record findings during the meeting or complete the site inspection first.';
          } else if (tl === 'waiting') {
            enabled = false;
            disabledReason = 'Team Leader set status to "Hold — need more steps". Update the meeting report when ready.';
          } else if (!skipInspCheck && !tl) {
            enabled = false;
            disabledReason = 'Team Leader must submit their report and set decision to "Ready — send proposal" first.';
          }
        }
        break;
      case 'create_revision':
        if (!lead.proposalId) {
          enabled = false;
          disabledReason = 'No proposal to revise.';
        }
        break;
      case 'skip_inspection':
        if (lead.proposalId) {
          enabled = false;
          disabledReason = `Proposal ${lead.proposalId} already exists`;
        } else if (lead.inspectionSkipped) {
          label = 'Continue to proposal (meeting / inspection skipped)';
        }
        break;
      case 'record_meeting':
        if (lead.inspection?.status === 'completed') label = 'Edit meeting report';
        break;
      case 'schedule_negotiation_meeting': {
        const mt = lead.inspection?.meetingType;
        const ist = lead.inspection?.status;
        if (ist === 'scheduled') {
          label = mt === 'negotiation' ? 'Reschedule negotiation meeting' : mt === 'renewal' ? 'Reschedule renewal meeting' : 'Reschedule meeting';
        } else if (stage === 'won') {
          label = 'Schedule renewal meeting';
        } else if (stage === 'negotiation') {
          label = ist === 'completed' ? 'Schedule another negotiation meeting' : 'Schedule negotiation meeting';
        } else if (ist === 'completed') {
          label = 'Schedule another meeting';
        }
        break;
      }
      case 'schedule_site_inspection':
        if (lead.siteInspection?.status === 'completed') {
          enabled = false;
          disabledReason = 'Site inspection already completed.';
        } else if (lead.siteInspection?.status === 'scheduled') {
          label = 'Reschedule / edit site inspection';
        }
        break;
      case 'record_site_inspection':
        if (!lead.siteInspection) {
          enabled = false;
          disabledReason = 'Schedule a site inspection first.';
        } else if (lead.siteInspection.status === 'cancelled') {
          enabled = false;
          disabledReason = 'Site inspection cancelled. Schedule a new one.';
        } else if (lead.siteInspection.status === 'completed') {
          label = 'Edit inspection report';
        }
        break;
      case 'open_proposal':
        // At "meeting done" and "profile sent" this only appears once a proposal exists.
        if (!lead.proposalId) {
          if (stage === 'meeting_done' || stage === 'profile_sent') continue;
          enabled = false;
          disabledReason = 'No proposal is linked to this lead yet';
        }
        break;
      case 'open_customer':
        if (!lead.existingCustomerId) {
          enabled = false;
          disabledReason = 'No customer account is linked to this lead';
        }
        break;
      case 'reschedule_inspection':
        if (!lead.inspection) {
          enabled = false;
          disabledReason = 'Schedule the meeting / inspection first';
        }
        break;
    }
    out.push({ id, label, enabled, ...(disabledReason ? { disabledReason } : {}) });
  }
  return out;
}

export const isActionAllowed = (lead: Lead, id: LeadActionId) => availableActions(lead).some((a) => a.id === id && a.enabled);

/**
 * Stage changes the data layer accepts. Staying on the same stage (e.g. rescheduling an
 * inspection, editing findings) is always allowed.
 * engaged → proposal_sent / negotiation are allowed (skip path or residential).
 */
export const ALLOWED_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  new: ['contacted', 'lost'],
  contacted: ['engaged', 'lost'],
  engaged: ['meeting_scheduled', 'profile_sent', 'proposal_sent', 'negotiation', 'lost'],
  meeting_scheduled: ['meeting_done', 'lost'],
  meeting_done: ['profile_sent', 'proposal_sent', 'negotiation', 'lost'],
  profile_sent: ['proposal_sent', 'negotiation', 'lost'],
  proposal_sent: ['negotiation', 'won', 'lost'],
  negotiation: ['proposal_sent', 'won', 'lost'],
  won: [],
  lost: ['contacted'],
};

export class StageTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageTransitionError';
  }
}

const stageLabel = (s: PipelineStage) => PIPELINE.find((p) => p.stage === s)?.label ?? s;

/**
 * Throws a StageTransitionError when `lead` may not move to `to`.
 * For engaged → proposal_sent: B2B leads require a valid inspection-skipped reason in `next`.
 * Residential leads bypass this check.
 */
export function assertStageTransition(
  lead: Pick<Lead, 'stage'> & { clientType?: Lead['clientType'] },
  to: LeadStage,
  next?: Pick<Lead, 'inspectionSkipped'>,
): void {
  const from = stageOf(lead);
  const target = stageOf({ stage: to });
  if (from === target) return;
  if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(target)) {
    throw new StageTransitionError(`A lead cannot move from ${stageLabel(from)} to ${stageLabel(target)}.`);
  }
  // engaged → proposal_sent without TL meeting requires a skip reason for B2B
  if (from === 'engaged' && target === 'proposal_sent' && lead.clientType !== 'residential') {
    if (!next?.inspectionSkipped?.reason?.trim()) {
      throw new StageTransitionError('Skipping the TL meeting to send a proposal requires an inspection-skipped reason.');
    }
  }
}

export const canTransition = (lead: Pick<Lead, 'stage'> & { clientType?: Lead['clientType'] }, to: LeadStage, next?: Pick<Lead, 'inspectionSkipped'>) => {
  try {
    assertStageTransition(lead, to, next);
    return true;
  } catch {
    return false;
  }
};

/**
 * Throws when a new proposal may not be created for this lead.
 * Allowed stages: meeting_done, profile_sent, proposal_sent, negotiation, lost (reopen).
 * Also allowed from any stage for residential leads and from engaged when inspection was skipped.
 * Note: fine-grained UI guards (TL status, inspection done) live in availableActions(), not here.
 */
export function assertCanCreateProposal(lead: Lead): void {
  const stage = stageOf(lead);
  // Residential leads: proposal allowed from any active stage — no TL meeting or inspection needed.
  if (lead.clientType === 'residential') {
    if (stage === 'won') throw new StageTransitionError('Lead is already won.');
    if (lead.proposalId) throw new StageTransitionError(`Proposal ${lead.proposalId} already exists. Open or revise it instead.`);
    return;
  }
  // B2B always-allowed stages
  const alwaysAllowed: PipelineStage[] = ['meeting_done', 'profile_sent', 'proposal_sent', 'negotiation', 'lost'];
  if (alwaysAllowed.includes(stage)) return;
  // engaged → allowed only when inspection was explicitly skipped with a reason
  if (stage === 'engaged' && lead.inspectionSkipped?.reason?.trim()) return;
  throw new StageTransitionError(`A proposal cannot be created while the lead is ${stageLabel(stage)}.`);
}

/** The primary next step per stage; always one of the stage's enabled actions. */
const NEXT_ACTION: Record<PipelineStage, { action: LeadActionId; label: string }> = {
  new: { action: 'log_contact', label: 'Log first contact' },
  contacted: { action: 'log_contact', label: 'Log follow-up' },
  engaged: { action: 'schedule_inspection', label: 'Schedule meeting — assign Team Leader' },
  meeting_scheduled: { action: 'record_meeting', label: 'Submit meeting report' },
  meeting_done: { action: 'create_proposal', label: 'Create proposal' },
  profile_sent: { action: 'create_proposal', label: 'Create proposal' },
  proposal_sent: { action: 'open_proposal', label: 'Open proposal' },
  negotiation: { action: 'schedule_negotiation_meeting', label: 'Schedule negotiation meeting' },
  won: { action: 'open_customer', label: 'Open customer' },
  lost: { action: 'reopen', label: 'Reopen lead' },
};

/** The single recommended next step shown on each row. */
export function nextStep(lead: Lead): { label: string; action: LeadActionId } {
  const stage = stageOf(lead);
  const actions = availableActions(lead);
  // Residential shortcut: propose directly without TL meeting.
  if (lead.clientType === 'residential' && !lead.proposalId && !['won', 'lost'].includes(stage)) {
    const cp = actions.find((a) => a.id === 'create_proposal' && a.enabled);
    if (cp) return { action: 'create_proposal', label: 'Create proposal' };
  }
  const preferred = NEXT_ACTION[stage] ?? NEXT_ACTION.new;
  if (actions.some((a) => a.id === preferred.action && a.enabled)) return preferred;
  // e.g. meeting done but a proposal already exists → open it rather than create another
  if (actions.some((a) => a.id === 'open_proposal' && a.enabled)) return { action: 'open_proposal', label: 'Open proposal' };
  const first = actions.find((a) => a.enabled && a.id !== 'edit') ?? actions.find((a) => a.enabled);
  return first ? { action: first.id, label: first.label } : preferred;
}

export const isFollowUpDue = (lead: Lead) =>
  Boolean(lead.nextFollowUp && lead.nextFollowUp.slice(0, 10) <= new Date().toISOString().slice(0, 10) && !['won', 'lost'].includes(stageOf(lead)));

// ---------------------------------------------------------------------------
// Excel import / export
// ---------------------------------------------------------------------------

export const IMPORT_COLUMNS = [
  'Company / Client Name*',
  'Type (Company/Individual)',
  'Industry',
  'City*',
  'Area',
  'Address',
  'Source',
  'Company Phone',
  'Company Email',
  'Website',
  'Primary Contact Name*',
  'Primary Contact Designation',
  'Primary Contact Phone*',
  'Primary Contact Email',
  'Contact 2 Name',
  'Contact 2 Designation',
  'Contact 2 Phone',
  'Contact 2 Email',
  'Contact 3 Name',
  'Contact 3 Designation',
  'Contact 3 Phone',
  'Contact 3 Email',
  'Notes',
] as const;

export interface ImportRow {
  rowNumber: number;
  lead?: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
  errors: string[];
  duplicate?: string;
}

const norm = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

const matchSource = (v: string): LeadSource => {
  const k = v.toLowerCase();
  const hit = SOURCES.find((s) => s.value === k || s.label.toLowerCase() === k || k.includes(s.label.toLowerCase().split(' ')[0]));
  return hit?.value ?? 'inbound_phone';
};

/** Minimal CSV parser (quoted fields, commas and new lines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Reads an .xlsx or .csv file into rows of cell values. */
export async function readSpreadsheet(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(await file.text());
  const { readSheet } = await import('read-excel-file/browser');
  return (await readSheet(file)) as unknown[][];
}

/** Validates spreadsheet rows against the import template. */
export function parseLeadRows(
  rows: unknown[][],
  findDuplicate: (phone: string, email?: string) => string | undefined
): ImportRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => headerKey(norm(h)));
  const col = (name: string) => headers.indexOf(headerKey(name));
  const get = (r: unknown[], name: string) => {
    const i = col(name);
    return i >= 0 ? norm(r[i]) : '';
  };

  const seenPhones = new Set<string>();
  return rows.slice(1).map((r, idx) => {
    const errors: string[] = [];
    const name = get(r, 'Company / Client Name*') || get(r, 'Company Name') || get(r, 'Name');
    const city = get(r, 'City*') || get(r, 'City');
    const contacts: LeadContact[] = [];
    [['Primary Contact', true], ['Contact 2', false], ['Contact 3', false]].forEach(([prefix, primary], i) => {
      const cName = get(r, `${prefix} Name*`) || get(r, `${prefix} Name`);
      const cPhone = get(r, `${prefix} Phone*`) || get(r, `${prefix} Phone`);
      if (!cName && !cPhone) return;
      contacts.push({
        id: `c${i + 1}`,
        name: cName,
        designation: get(r, `${prefix} Designation`) || undefined,
        phone: cPhone,
        email: get(r, `${prefix} Email`) || undefined,
        isPrimary: primary as boolean,
      });
    });

    if (!name) errors.push('Company / client name is missing');
    if (!city) errors.push('City is missing');
    const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
    if (!primary?.name) errors.push('Primary contact name is missing');
    if (!primary?.phone) errors.push('Primary contact phone is missing');
    else if (normalizePakistaniPhone(primary.phone).replace(/\D/g, '').length < 10) errors.push(`Phone "${primary.phone}" looks invalid`);

    const phoneKey = primary?.phone ? normalizePakistaniPhone(primary.phone) : '';
    let duplicate = primary?.phone ? findDuplicate(primary.phone, primary.email) : undefined;
    if (phoneKey && seenPhones.has(phoneKey)) duplicate = duplicate || 'Same phone appears earlier in this file';
    if (phoneKey) seenPhones.add(phoneKey);

    if (errors.length) return { rowNumber: idx + 2, errors, duplicate };

    const isIndividual = /indiv|person|resident/i.test(get(r, 'Type (Company/Individual)') || get(r, 'Type'));
    return {
      rowNumber: idx + 2,
      errors,
      duplicate,
      lead: syncLeadFields({
        title: name,
        companyName: isIndividual ? undefined : name,
        customerType: isIndividual ? 'individual' : 'company',
        industry: get(r, 'Industry') || undefined,
        city,
        area: get(r, 'Area'),
        propertyAddress: get(r, 'Address'),
        source: matchSource(get(r, 'Source')),
        companyPhone: get(r, 'Company Phone') || undefined,
        companyEmail: get(r, 'Company Email') || undefined,
        website: get(r, 'Website') || undefined,
        contacts: contacts.map((c, i) => ({ ...c, isPrimary: i === 0 })),
        notes: get(r, 'Notes') || undefined,
        stage: 'new',
        pestIssues: [],
        contactName: '',
        phone: '',
      } as unknown as Lead),
    };
  });
}

const fmtDate = (v?: string) => (v ? new Date(v).toLocaleDateString('en-GB') : '');

/** Downloads leads as an .xlsx using the same columns as the import template (plus pipeline columns). */
export async function exportLeadsToExcel(leads: Lead[], fileName: string) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const extra = ['Lead ID', 'Stage', 'Last outcome', 'Last contacted', 'Next follow-up', 'Inspection date', 'Assigned team', 'Owner', 'Created'];
  const header = [...IMPORT_COLUMNS.map((c) => c.replace('*', '')), ...extra].map((value) => ({ value, fontWeight: 'bold' as const }));
  const data = leads.map((l) => {
    const cs = contactsOf(l);
    const primary = cs.find((c) => c.isPrimary) ?? cs[0];
    const others = cs.filter((c) => c !== primary);
    const c = (x?: LeadContact) => [x?.name ?? '', x?.designation ?? '', x?.phone ?? '', x?.email ?? ''];
    const owner = (l as Lead & { ownerName?: string }).ownerName || l.assignedToName || l.createdBy || '';
    return [
      l.companyName || l.title,
      l.customerType === 'individual' ? 'Individual' : 'Company',
      l.industry ?? '',
      l.city ?? '',
      l.area ?? '',
      l.propertyAddress ?? '',
      sourceLabel(l.source),
      l.companyPhone ?? '',
      l.companyEmail ?? '',
      l.website ?? '',
      ...c(primary),
      ...c(others[0]),
      ...c(others[1]),
      l.notes ?? '',
      l.id,
      stageMeta(l.stage).label,
      outcomeLabel(l.contactOutcome),
      fmtDate(l.lastContactedAt),
      fmtDate(l.nextFollowUp),
      fmtDate(l.inspection?.scheduledDate),
      l.inspection?.teamName ?? '',
      owner,
      fmtDate(l.createdAt),
    ].map((value) => ({ value: String(value), type: String }));
  });
  await writeXlsxFile([header, ...data], { columns: header.map((h, i) => ({ width: i === 0 ? 32 : h.value.length > 18 ? 22 : 16 })) }).toFile(fileName);
}

/** Empty template with two example rows. */
export async function downloadImportTemplate() {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const header = IMPORT_COLUMNS.map((value) => ({ value, fontWeight: 'bold' as const }));
  const ex1 = ['Shan Foods (Pvt) Ltd', 'Company', 'Food & restaurant', 'Karachi', 'Korangi', 'Plot 23, Sector 7A', 'Referral', '021-35000000', 'info@shanfoods.com', 'shanfoods.com',
    'Tariq Mehmood', 'Operations Manager', '03001234567', 'tariq@shanfoods.com', 'Sana Ali', 'Admin Officer', '03211234567', '', '', '', '', '', 'Wants quarterly cockroach and rodent control'];
  const ex2 = ['Ahmed Raza', 'Individual', 'Residential society', 'Lahore', 'DHA Phase 5', 'House 12, Street 4', 'WhatsApp', '', '', '',
    'Ahmed Raza', '', '03331234567', '', '', '', '', '', '', '', '', '', 'Termite issue in wooden doors'];
  const row = (r: string[]) => r.map((value) => ({ value, type: String }));
  await writeXlsxFile([header, row(ex1), row(ex2)], { columns: IMPORT_COLUMNS.map((c) => ({ width: Math.max(14, c.length + 2) })) }).toFile('IKPM-leads-import-template.xlsx');
}

/** Blank lead branch record. */
export const blankLeadBranch = (): LeadBranch => ({
  id: `lb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
  name: '',
  address: '',
  city: '',
  contactName: '',
  contactPhone: '',
});
