// Quality audit workflow: schedule (manual or random pick) → entomologist submits the report →
// super admin verifies (or returns it) → save to the client's folder and / or send to the client.

import { dataService } from '../../services/dataService';
import { companyProfile } from '../../services/companyProfile';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { fileGenerated } from '../documents/fileGenerated';
import { sendOutreach, isValidEmail } from '../../services/outreachService';
import { outreachEnv } from '../../config/env';
import { formatDate } from '../../lib/formatters';
import type { Contract, ServiceJob } from '../../types/operations';
import type { AuditReport, QualityAudit } from '../../types/audits';
import type { DocumentOwner, PortalDocument } from '../../types/document';
import { channelBlocker, type InvoiceSendChannel } from '../invoices/invoiceWorkflow';

export interface AuditActor {
  uid: string;
  email: string;
  name: string;
  businessEmail: string;
}

const nowIso = () => new Date().toISOString();
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);

/** Staff who also do quality audits ("Entomologist" ticked in Team & Access), whatever their role. */
export const entomologists = () => dataService.getStaff().filter((u) => u.isEntomologist);

/** Latest completed visit at a contract / client site (the work being audited). */
export function lastVisitOf(contract: Pick<Contract, 'id' | 'customerId' | 'branchId'>): ServiceJob | undefined {
  return dataService.getJobs()
    .filter((j) => j.status === 'completed' && (j.contractId === contract.id || (j.customerId === contract.customerId && (j.branchId || '') === (contract.branchId || ''))))
    .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate))[0];
}

export interface AuditCandidate {
  contract: Contract;
  lastAuditDate?: string;
  daysSinceAudit: number;
  openComplaints: number;
  /** Higher = more due for an audit. */
  priority: number;
}

/** Active contracts ranked by how due they are for an audit (never audited, long ago, complaints). */
export function auditCandidates(today = nowIso().slice(0, 10)): AuditCandidate[] {
  const interval = Math.max(1, companyProfile.get().auditIntervalDays ?? 30);
  const audits = dataService.getAudits().filter((a) => a.status !== 'cancelled');
  const complaints = dataService.getComplaints().filter((c) => c.status !== 'closed');
  return dataService.getContracts()
    .filter((c) => c.status === 'active' && c.startDate <= today && c.endDate >= today)
    .map((contract) => {
      const last = audits.filter((a) => a.contractId === contract.id).map((a) => a.scheduledDate).sort().pop();
      const daysSinceAudit = last ? daysBetween(last, today) : 9999;
      const openComplaints = complaints.filter((c) => c.contractId === contract.id || (c.customerId === contract.customerId && (c.branchId || '') === (contract.branchId || ''))).length;
      return { contract, lastAuditDate: last, daysSinceAudit, openComplaints, priority: Math.min(daysSinceAudit, 365) + openComplaints * 30 };
    })
    .filter((c) => c.daysSinceAudit >= interval || c.openComplaints > 0)
    .sort((a, b) => b.priority - a.priority);
}

/** Random pick among the most-due sites (top 5), so the field team can't predict it. */
export function randomAuditPick(rand = Math.random): AuditCandidate | undefined {
  const top = auditCandidates().slice(0, 5);
  return top.length ? top[Math.floor(rand() * top.length)] : undefined;
}

/** Schedules an audit (super admin). */
export async function scheduleAudit(args: {
  contract: Contract;
  entomologistUid: string;
  scheduledDate: string;
  surprise: boolean;
  random: boolean;
  instructions?: string;
}, actor: AuditActor): Promise<QualityAudit> {
  const ent = entomologists().find((u) => u.uid === args.entomologistUid);
  if (!ent) throw new Error('Choose the entomologist.');
  if (!args.scheduledDate) throw new Error('Choose the audit date.');
  const c = args.contract;
  const branch = c.branchId ? dataService.getBranchById(c.branchId) : undefined;
  const site = dataService.getSites(c.customerId, c.branchId)[0];
  const last = lastVisitOf(c);
  const year = new Date().getFullYear();
  const seq = await dataService.nextSequence(`quality_audit_${year}`, dataService.maxSeqOf(dataService.getAudits().map((a) => a.auditNumber)));
  const auditNumber = `QA-${year}-${String(seq).padStart(4, '0')}`;
  const ts = nowIso();
  const audit: QualityAudit = {
    id: auditNumber,
    auditNumber,
    customerType: c.customerType,
    customerId: c.customerId,
    customerName: c.customerName,
    branchId: c.branchId,
    branchName: c.branchName,
    siteName: branch?.branchName || site?.siteName || last?.siteName || c.customerName,
    siteAddress: branch?.physicalAddress || last?.siteAddress || (site ? [site.addressLine1, site.area, site.city].filter(Boolean).join(', ') : ''),
    contractId: c.id,
    lastJobId: last?.id,
    lastJobDate: last?.scheduledDate,
    lastTeamLeaderName: last?.assignedTeamLeaderName,
    entomologistUid: ent.uid,
    entomologistName: ent.displayName || ent.email,
    scheduledDate: args.scheduledDate,
    surprise: args.surprise,
    random: args.random,
    instructions: args.instructions?.trim() || undefined,
    status: 'scheduled',
    createdBy: actor.email,
    createdByName: actor.name,
    createdAt: ts,
    updatedAt: ts,
  };
  return dataService.saveAudit(audit, actor.email);
}

export function reportProblems(r: AuditReport): string[] {
  return [
    !r.visitedAt && 'Enter the visit date.',
    !(r.score >= 1 && r.score <= 5) && 'Give a score from 1 to 5.',
    !r.summary.trim() && 'Write a short summary.',
    r.checks.some((c) => c.ok === undefined) && 'Mark every check as OK or Not OK.',
    r.findings.some((f) => !f.observation.trim()) && 'Every finding needs an observation.',
  ].filter(Boolean) as string[];
}

/** Entomologist saves the report (draft) or submits it for verification. */
export function saveReport(audit: QualityAudit, report: AuditReport, submit: boolean, actor: AuditActor): QualityAudit {
  if (!['scheduled', 'returned'].includes(audit.status)) throw new Error('This audit is no longer open for changes.');
  if (submit) {
    const problems = reportProblems(report);
    if (problems.length) throw new Error(problems.join(' '));
  }
  return dataService.saveAudit({
    ...audit,
    report,
    status: submit ? 'submitted' : audit.status,
    ...(submit ? { submittedAt: nowIso() } : {}),
    updatedAt: nowIso(),
  }, actor.email, submit ? `Audit report ${audit.auditNumber} submitted (score ${report.score}/5)` : `Audit report ${audit.auditNumber} saved as draft`);
}

/** Super admin returns the report for corrections. */
export function returnAudit(audit: QualityAudit, note: string, actor: AuditActor): QualityAudit {
  if (audit.status !== 'submitted') throw new Error('Only a submitted report can be returned.');
  if (!note.trim()) throw new Error('Say what to correct.');
  return dataService.saveAudit({ ...audit, status: 'returned', returnNote: note.trim(), updatedAt: nowIso() }, actor.email, `Audit ${audit.auditNumber} returned: ${note.trim()}`);
}

const ownerOf = (a: QualityAudit): DocumentOwner =>
  a.branchId ? { kind: 'branch', id: a.branchId } : a.customerType === 'company' ? { kind: 'company', id: a.customerId } : { kind: 'client', id: a.customerId };

/** The audit PDF in the client's Service Reports folder (made once, reused). */
async function auditFile(a: QualityAudit, actor: AuditActor): Promise<PortalDocument> {
  const existing = a.pdfDocumentId ? dataService.getDocumentById(a.pdfDocumentId) : undefined;
  if (existing) return existing;
  const blob = await pdfGenerator.auditReportPDFBlob(a);
  const doc = await fileGenerated(blob, {
    owner: ownerOf(a),
    category: 'service_report',
    title: `Quality Audit Report - ${a.auditNumber} (${a.siteName})`,
    fileName: `Quality_Audit_${a.auditNumber}.pdf`,
    subPath: a.id,
    user: { email: actor.email, displayName: actor.name },
    noLocalDownload: true,
  });
  if (!doc) throw new Error('The report PDF could not be filed.');
  return doc;
}

/** Super admin verifies the report and files it in the client's folder. */
export async function verifyAudit(audit: QualityAudit, note: string, actor: AuditActor): Promise<QualityAudit> {
  if (audit.status !== 'submitted') throw new Error('Only a submitted report can be verified.');
  const verified: QualityAudit = { ...audit, status: 'verified', verifiedBy: actor.name, verifiedAt: nowIso(), verifierNote: note.trim() || undefined, updatedAt: nowIso() };
  dataService.saveAudit(verified, actor.email, `Audit ${audit.auditNumber} verified by ${actor.name}`);
  try {
    const doc = await auditFile(verified, actor);
    return dataService.saveAudit({ ...verified, pdfDocumentId: doc.id, savedAt: nowIso(), updatedAt: nowIso() }, actor.email, `Audit report ${audit.auditNumber} saved to the client's folder`);
  } catch {
    return verified; // verified; filing can be retried with "Save to client folder"
  }
}

/** Files (or re-files) the verified report in the client's folder. */
export async function saveAuditToFolder(audit: QualityAudit, actor: AuditActor): Promise<QualityAudit> {
  if (audit.status !== 'verified') throw new Error('Verify the report first.');
  const doc = await auditFile(audit, actor);
  return dataService.saveAudit({ ...audit, pdfDocumentId: doc.id, savedAt: nowIso(), updatedAt: nowIso() }, actor.email, `Audit report ${audit.auditNumber} saved to the client's folder`);
}

export function auditRecipient(a: QualityAudit): { name: string; email?: string; phone?: string } {
  if (a.customerType === 'company') {
    const br = a.branchId ? dataService.getBranchById(a.branchId) : undefined;
    const co = dataService.getCompanyById(a.customerId);
    if (br && isValidEmail(br.branchEmail)) return { name: br.branchManagerName || a.customerName, email: br.branchEmail, phone: br.branchManagerPhone || br.branchPhone };
    return { name: co?.primaryContact.fullName || a.customerName, email: co?.primaryContact.email, phone: co?.primaryContact.mobile };
  }
  const cl = dataService.getClientById(a.customerId);
  return { name: cl?.fullName || a.customerName, email: cl?.email, phone: cl?.primaryPhone };
}

export function auditMessage(a: QualityAudit, name: string, actor: AuditActor): { subject: string; message: string } {
  return {
    subject: `${outreachEnv.companyName} — Quality audit report ${a.auditNumber} (${a.siteName})`,
    message: [
      `Dear ${name.split(' ')[0] || 'Sir/Madam'},`,
      '',
      `As part of our quality programme, our entomologist audited the pest management at ${a.siteName} on ${formatDate(a.report?.visitedAt || a.scheduledDate)}. Please find the report attached.`,
      '',
      'Regards,',
      actor.name,
      outreachEnv.companyName,
    ].join('\n'),
  };
}

/** Super admin sends the verified report to the client. */
export async function sendAuditToClient(a: QualityAudit, actor: AuditActor, opts: {
  channel: InvoiceSendChannel; name: string; email?: string; phone?: string; subject: string; message: string;
  linkWindow?: Window | null; emailWindow?: Window | null;
}): Promise<QualityAudit> {
  if (a.status !== 'verified') throw new Error('Verify the report before sending it.');
  const blocker = channelBlocker(opts.channel);
  if (blocker) throw new Error(blocker);
  const isWhatsApp = opts.channel === 'whatsapp';
  if (isWhatsApp && !opts.phone?.trim()) throw new Error("Enter the client's WhatsApp number.");
  if (!isWhatsApp && !isValidEmail(opts.email)) throw new Error('Enter a valid client email address.');
  const doc = await auditFile(a, actor);
  const owner = ownerOf(a) as { kind: 'company' | 'client' | 'branch'; id: string };
  const [result] = await sendOutreach({
    channels: [isWhatsApp ? 'whatsapp' : 'email'],
    recipientName: opts.name, phone: opts.phone, email: opts.email,
    subject: opts.subject, message: opts.message,
    documents: [doc],
    related: { kind: owner.kind, id: owner.id, title: `Audit ${a.auditNumber}` },
    sender: { email: actor.email, name: actor.name, businessEmail: actor.businessEmail },
    emailVia: opts.channel === 'email_gmail' ? 'gmail' : opts.channel === 'email_outlook' ? 'outlook' : 'api',
    linkWindow: opts.linkWindow, emailWindow: opts.emailWindow,
    noLinksInBody: opts.channel === 'email_auto',
  });
  if (!result?.ok) throw new Error(result?.error || 'The message could not be sent.');
  return dataService.saveAudit({
    ...a, pdfDocumentId: doc.id, savedAt: a.savedAt || nowIso(),
    sentAt: nowIso(), sentTo: isWhatsApp ? opts.phone : opts.email, sentVia: opts.channel, updatedAt: nowIso(),
  }, actor.email, `Audit report ${a.auditNumber} sent to the client (${isWhatsApp ? 'WhatsApp' : 'email'})`);
}

/** Free re-service visit to fix what the audit found (no charge to the client). */
export async function createAuditFollowUp(a: QualityAudit, date: string, actor: AuditActor): Promise<QualityAudit> {
  if (!date) throw new Error('Choose the visit date.');
  const id = `JOB-${Date.now().toString(36).toUpperCase()}-QA`;
  const last = a.lastJobId ? dataService.getJobById(a.lastJobId) : undefined;
  const job = {
    id,
    contractId: a.contractId,
    customerType: a.customerType,
    customerId: a.customerId,
    customerName: a.customerName,
    branchId: a.branchId,
    branchName: a.branchName,
    siteId: last?.siteId || a.contractId || a.customerId,
    siteName: a.siteName,
    siteAddress: a.siteAddress,
    serviceType: `Corrective visit (quality audit ${a.auditNumber})`,
    targetPests: last?.targetPests ?? [],
    scheduledDate: date,
    timeSlot: 'morning' as const,
    assignedTechnicianIds: [] as string[],
    assignedTechnicianNames: [] as string[],
    leadPcoId: '',
    leadPcoName: 'Unassigned',
    status: 'scheduled' as const,
    freeOfCharge: true,
    freeOfChargeReason: `Corrective visit after quality audit ${a.auditNumber}`,
    executionNotes: (a.report?.findings ?? []).map((f) => `• ${f.observation} → ${f.recommendation}`).join('\n') || undefined,
    checklists: [] as never[],
    chemicalsUsed: [] as never[],
    photoEvidence: [] as never[],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  dataService.saveJob(job as unknown as ServiceJob, actor.email);
  return dataService.saveAudit({ ...a, followUpJobId: id, updatedAt: nowIso() }, actor.email, `Free corrective visit ${id} created from audit ${a.auditNumber}`);
}
