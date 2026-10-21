// Lead pipeline rules shared by the Leads page, Site Inspections page and Excel import/export.
//
// new → contacted → engaged → inspection_scheduled → inspection_completed → proposal_sent → won | lost

import type { ActivityChannel, ContactOutcome, Lead, LeadContact, LeadSource, LeadStage } from '../types/crm';
import { normalizePakistaniPhone } from './formatters';

/** Photo categories for site visits (lead site photos and inspection findings). */
export const INSPECTION_PHOTO_TYPES: { value: string; label: string }[] = [
  { value: 'infestation', label: 'Infestation / activity' },
  { value: 'damage', label: 'Damage' },
  { value: 'entry_point', label: 'Entry / breeding point' },
  { value: 'general', label: 'General site view' },
];

export type PipelineStage = 'new' | 'contacted' | 'engaged' | 'inspection_scheduled' | 'inspection_completed' | 'proposal_sent' | 'won' | 'lost';

export const PIPELINE: { stage: PipelineStage; label: string; short: string; hint: string; color: string }[] = [
  { stage: 'new', label: 'New inquiries', short: 'New', hint: 'Not contacted yet', color: '#1A73E8' },
  { stage: 'contacted', label: 'Contacted', short: 'Contacted', hint: 'Reached out, waiting for interest', color: '#0891B2' },
  { stage: 'engaged', label: 'Engaged', short: 'Engaged', hint: 'Interested: schedule an inspection', color: '#7C3AED' },
  { stage: 'inspection_scheduled', label: 'Inspection scheduled', short: 'Inspection', hint: 'Team assigned to visit the site', color: '#D97706' },
  { stage: 'inspection_completed', label: 'Inspection done', short: 'Inspected', hint: 'Findings recorded: prepare proposal', color: '#B45309' },
  { stage: 'proposal_sent', label: 'Proposal', short: 'Proposal', hint: 'Proposal shared with client', color: '#0E8A5F' },
  { stage: 'won', label: 'Won', short: 'Won', hint: 'Converted to customer', color: '#0A6B4A' },
  { stage: 'lost', label: 'Lost / rejected', short: 'Lost', hint: 'Not interested or lost to competitor', color: '#DC2626' },
];

export const stageOf = (lead: Pick<Lead, 'stage'>): PipelineStage => {
  if (lead.stage === 'qualified') return 'engaged';
  if (lead.stage === 'proposal_drafted') return 'proposal_sent';
  return lead.stage as PipelineStage;
};

export const stageMeta = (s: LeadStage) => PIPELINE.find((p) => p.stage === stageOf({ stage: s })) ?? PIPELINE[0];

export const OUTCOMES: { value: ContactOutcome; label: string; tone: 'slate' | 'amber' | 'emerald' | 'rose' }[] = [
  { value: 'no_response', label: 'No response', tone: 'slate' },
  { value: 'callback', label: 'Call back later', tone: 'amber' },
  { value: 'engaged', label: 'Interested / engaged', tone: 'emerald' },
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
    inspectorIds: lead.inspection?.status === 'scheduled' || lead.inspection?.status === 'completed' ? lead.inspection?.inspectorIds ?? lead.inspectorIds : lead.inspectorIds,
  };
}

/** The single recommended next step shown on each row. */
export function nextStep(lead: Lead): { label: string; action: 'log_contact' | 'schedule_inspection' | 'record_findings' | 'create_proposal' | 'open_proposal' | 'open_customer' | 'reopen' } {
  switch (stageOf(lead)) {
    case 'new':
      return { label: 'Log first contact', action: 'log_contact' };
    case 'contacted':
      return { label: 'Log follow-up', action: 'log_contact' };
    case 'engaged':
      return { label: 'Schedule inspection', action: 'schedule_inspection' };
    case 'inspection_scheduled':
      return { label: 'Record findings', action: 'record_findings' };
    case 'inspection_completed':
      return { label: 'Create proposal', action: 'create_proposal' };
    case 'proposal_sent':
      return { label: 'Open proposal', action: 'open_proposal' };
    case 'won':
      return { label: 'Open customer', action: 'open_customer' };
    default:
      return { label: 'Reopen lead', action: 'reopen' };
  }
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
