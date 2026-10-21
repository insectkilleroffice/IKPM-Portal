// Works out which folder a record belongs in from its own links (customer, branch, lead,
// proposal, job). Pure: the portal (dataService) and the backfill script pass their own lookups,
// so both file records exactly the same way. Paths themselves are built in ./folders.ts.

import type { FileCategory, FolderMeta, OwnerScope } from '../types/folders';
import type { DocumentOwner, ClientFolder, CompanyDocCategory } from '../types/document';
import { documentFolderCategory, folderMeta, type ClientSubfolder, type CompanySubfolder } from './folders';

type CustomerType = 'company' | 'individual';

/** Read access to the records folder resolution needs. Missing records return undefined. */
export interface FolderLookups {
  company(id: string): { legalCompanyName?: string } | undefined;
  client(id: string): { fullName?: string } | undefined;
  lead(id: string): { id: string; title?: string; companyName?: string; customerType?: CustomerType; existingCustomerId?: string } | undefined;
  branch(id: string): { id: string; companyId: string; branchName?: string } | undefined;
  proposal(id: string): { customerId?: string; customerType?: CustomerType; customerName?: string; branchId?: string; leadId?: string } | undefined;
  job(id: string): { customerId?: string; customerType?: CustomerType; customerName?: string; branchId?: string; scheduledDate?: string } | undefined;
  invoice(id: string): { customerType?: CustomerType } | undefined;
}

export interface FolderLink {
  ownerScope?: OwnerScope;
  customerId?: string;
  customerType?: CustomerType;
  customerName?: string;
  branchId?: string;
  leadId?: string;
  category: FileCategory;
  date?: string;
  subfolder?: ClientSubfolder | CompanySubfolder;
}

/** Display name and type of a client account, or of a lead that is not a customer yet. */
export function clientInfoFrom(l: FolderLookups, clientId: string): { name?: string; type?: CustomerType } {
  const co = l.company(clientId);
  if (co) return { name: co.legalCompanyName, type: 'company' };
  const cl = l.client(clientId);
  if (cl) return { name: cl.fullName, type: 'individual' };
  const lead = l.lead(clientId);
  if (lead) return { name: lead.companyName || lead.title, type: lead.customerType };
  return {};
}

/**
 * Folder fields for a link. A lead that is not a customer yet keeps its records under the lead
 * (clientId = lead id, "Leads & Inspections"). Returns {} when nothing links to an owner.
 */
export function resolveFolderFrom(l: FolderLookups, link: FolderLink): FolderMeta {
  if (link.ownerScope === 'company') return folderMeta({ ownerScope: 'company', category: link.category, subfolder: link.subfolder });
  const lead = !link.customerId && link.leadId ? l.lead(link.leadId) : undefined;
  const clientId = link.customerId || lead?.existingCustomerId || lead?.id || link.leadId;
  if (!clientId) return {};
  const onlyLead = !link.customerId && !lead?.existingCustomerId;
  const info = clientInfoFrom(l, clientId);
  const branch = link.branchId ? l.branch(link.branchId) : undefined;
  return folderMeta({
    ownerScope: 'client',
    clientId,
    clientName: info.name || link.customerName,
    clientType: info.type || link.customerType || lead?.customerType,
    branchId: link.branchId,
    branchName: branch?.branchName,
    category: link.category,
    date: link.date,
    subfolder: onlyLead ? 'Leads & Inspections' : link.subfolder,
  });
}

/** Link for a document from its owner (library, client, branch, lead, proposal or job). Null when the owner is gone. */
export function documentLink(
  l: FolderLookups,
  doc: { owner: DocumentOwner; category: CompanyDocCategory; folder?: ClientFolder; fileCategory?: FileCategory; uploadedAt?: string }
): FolderLink | null {
  const { category, subfolder } = documentFolderCategory(doc);
  const owner = doc.owner;
  const date = doc.uploadedAt;
  switch (owner.kind) {
    case 'library':
      return { ownerScope: 'company', category, subfolder };
    case 'company':
    case 'client':
      return { customerId: owner.id, customerType: owner.kind === 'company' ? 'company' : 'individual', category, date, subfolder };
    case 'branch': {
      const br = l.branch(owner.id);
      return br ? { customerId: br.companyId, customerType: 'company', branchId: br.id, category, date, subfolder } : null;
    }
    case 'lead':
      return { leadId: owner.id, category, date, subfolder };
    case 'proposal': {
      const p = l.proposal(owner.id);
      return p ? { customerId: p.customerId, customerType: p.customerType, customerName: p.customerName, branchId: p.branchId, leadId: p.leadId, category: doc.fileCategory ?? 'proposal', date } : null;
    }
    case 'job': {
      const j = l.job(owner.id);
      return j ? { customerId: j.customerId, customerType: j.customerType, customerName: j.customerName, branchId: j.branchId, category: doc.fileCategory ?? 'service_report', date: j.scheduledDate } : null;
    }
  }
  return null;
}

/** Collections that carry folder metadata (Firestore names). */
export const FOLDER_COLLECTIONS = ['documents', 'document_packs', 'invoices', 'payments', 'proposals', 'contracts', 'service_jobs', 'outreach_logs'] as const;
export type FolderCollection = (typeof FOLDER_COLLECTIONS)[number];

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const ctype = (v: unknown): CustomerType | undefined => (v === 'company' || v === 'individual' ? v : undefined);

/**
 * Link for any record in a folder collection, from its existing fields. Null when the record
 * doesn't say who it belongs to (reported as unresolved, never guessed).
 */
export function recordLink(l: FolderLookups, collection: FolderCollection, r: Rec): FolderLink | null {
  switch (collection) {
    case 'documents':
      return r.owner && typeof r.owner === 'object' ? documentLink(l, r as unknown as Parameters<typeof documentLink>[1]) : null;
    case 'document_packs': {
      const clientId = str(r.clientId);
      return clientId
        ? { customerId: clientId, customerType: ctype(r.clientType), branchId: str(r.branchId), category: (r.fileCategory as FileCategory) ?? 'other' }
        : { ownerScope: 'company', category: 'other' };
    }
    case 'proposals':
      return str(r.customerId) || str(r.leadId)
        ? { customerId: str(r.customerId), customerType: ctype(r.customerType), customerName: str(r.customerName), branchId: str(r.branchId), leadId: str(r.leadId), category: 'proposal', date: str(r.createdAt) }
        : null;
    case 'contracts':
      return str(r.customerId)
        ? { customerId: str(r.customerId), customerType: ctype(r.customerType), customerName: str(r.customerName), branchId: str(r.branchId), category: 'contract', date: str(r.startDate) }
        : null;
    case 'service_jobs':
      return str(r.customerId)
        ? { customerId: str(r.customerId), customerType: ctype(r.customerType), customerName: str(r.customerName), branchId: str(r.branchId), category: 'service_report', date: str(r.scheduledDate) }
        : null;
    case 'invoices':
      return str(r.customerId)
        ? { customerId: str(r.customerId), customerType: ctype(r.customerType), customerName: str(r.customerName), branchId: str(r.branchId), category: 'invoice', date: str(r.issueDate) }
        : null;
    case 'payments':
      return str(r.customerId)
        ? { customerId: str(r.customerId), customerType: l.invoice(str(r.invoiceId) ?? '')?.customerType, customerName: str(r.customerName), branchId: str(r.branchId), category: 'payment_receipt', date: str(r.paymentDate) }
        : null;
    case 'outreach_logs': {
      const rel = r.related as { kind?: string; id?: string } | undefined;
      const date = str(r.sentAt);
      if (!rel?.kind || !rel.id) return null;
      if (rel.kind === 'lead') return { leadId: rel.id, category: 'correspondence', date };
      if (rel.kind === 'proposal') {
        const p = l.proposal(rel.id);
        return p ? { customerId: p.customerId, customerType: p.customerType, customerName: p.customerName, branchId: p.branchId, leadId: p.leadId, category: 'correspondence', date } : null;
      }
      if (rel.kind === 'branch') {
        const br = l.branch(rel.id);
        return br ? { customerId: br.companyId, customerType: 'company', branchId: br.id, category: 'correspondence', date } : null;
      }
      if (rel.id === 'ad-hoc') return { ownerScope: 'company', category: 'correspondence' };
      return { customerId: rel.id, customerType: rel.kind === 'company' ? 'company' : 'individual', category: 'correspondence', date };
    }
  }
  return null;
}
