// Unified Data Service for IKPM Portal (local cache + best-effort Firestore mirror).
// Components subscribe through `useDataStore()` so they re-render whenever data changes.

import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type {
  IndividualClient,
  CompanyMaster,
  CompanyBranch,
  SiteAddress,
} from '../types/customer';
import type { Lead } from '../types/crm';
import type { Proposal, ProposalRevision } from '../types/proposal';
import type { Contract, ServiceJob } from '../types/operations';
import type { Invoice, PaymentReceipt, TaxRuleConfig } from '../types/finance';
import type { AuditLogEntry } from '../types';
import type { DocumentOwner, DocumentPack, OutreachLog, PortalDocument } from '../types/document';
import { normalizePakistaniPhone } from '../lib/formatters';
import {
  SEED_COMPANIES,
  SEED_BRANCHES,
  SEED_INDIVIDUAL_CLIENTS,
  SEED_SITES,
  SEED_LEADS,
  SEED_PROPOSALS,
  SEED_CONTRACTS,
  SEED_SERVICE_JOBS,
  SEED_INVOICES,
  SEED_TAX_RULES,
  SEED_DOCUMENT_PACKS,
} from './seedData';

const STORAGE_KEY = 'ikpm_portal_db_v1';

interface DbState {
  companies: CompanyMaster[];
  branches: CompanyBranch[];
  clients: IndividualClient[];
  sites: SiteAddress[];
  leads: Lead[];
  proposals: Proposal[];
  contracts: Contract[];
  jobs: ServiceJob[];
  invoices: Invoice[];
  payments: PaymentReceipt[];
  taxRules: TaxRuleConfig[];
  auditLogs: AuditLogEntry[];
  documents: PortalDocument[];
  documentPacks: DocumentPack[];
  outreachLogs: OutreachLog[];
}

const seedState = (): DbState => ({
  companies: [...SEED_COMPANIES],
  branches: [...SEED_BRANCHES],
  clients: [...SEED_INDIVIDUAL_CLIENTS],
  sites: [...SEED_SITES],
  leads: [...SEED_LEADS],
  proposals: [...SEED_PROPOSALS],
  contracts: [...SEED_CONTRACTS],
  jobs: [...SEED_SERVICE_JOBS],
  invoices: [...SEED_INVOICES],
  payments: [],
  taxRules: [...SEED_TAX_RULES],
  auditLogs: [],
  documents: [],
  documentPacks: [...SEED_DOCUMENT_PACKS],
  outreachLogs: [],
});

const now = () => new Date().toISOString();

/** Firestore rejects `undefined` values — drop them before mirroring. */
const toFirestore = <T,>(data: T): T => JSON.parse(JSON.stringify(data));

type Listener = () => void;

class DataService {
  private s: DbState = seedState();
  private listeners = new Set<Listener>();
  private version = 0;

  constructor() {
    this.load();
  }

  // --- Store plumbing ---

  private load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<DbState>;
        const seeded = seedState();
        this.s = { ...seeded, ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => Array.isArray(v))) };
        return;
      }
    } catch {
      // Corrupt cache — fall back to seed data
    }
    this.s = seedState();
    this.persist();
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.s));
    } catch (err) {
      console.warn('Failed to persist to localStorage', err);
    }
  }

  /** Persist locally, then notify subscribed components. */
  private commit() {
    this.persist();
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private mirror(collection: string, id: string, data: unknown) {
    try {
      setDoc(doc(db, collection, id), toFirestore(data) as Record<string, unknown>, { merge: true }).catch(() => {});
    } catch {
      // Offline or Firebase not configured — local cache remains the source of truth
    }
  }

  /** Insert-or-replace by id. Returns whether the record was newly created. */
  private upsert<T extends { id: string }>(list: T[], item: T, stamp = true): boolean {
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx !== -1) {
      list[idx] = stamp ? { ...item, updatedAt: now() } : item;
      return false;
    }
    list.unshift(stamp ? { ...item, createdAt: now(), updatedAt: now() } : item);
    return true;
  }

  private audit(
    userEmail: string,
    action: AuditLogEntry['action'],
    entityType: AuditLogEntry['entityType'],
    entityId: string,
    entityTitle: string,
    details: string
  ) {
    this.logAudit({ userId: userEmail, userEmail, action, entityType, entityId, entityTitle, details });
  }

  public subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getVersion = () => this.version;

  // --- Audit Logging ---
  public logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) {
    const log: AuditLogEntry = {
      ...entry,
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: now(),
    };
    this.s.auditLogs.unshift(log);
    this.commit();
    this.mirror('audit_logs', log.id, log);
  }

  public getAuditLogs(entityType?: string, entityId?: string): AuditLogEntry[] {
    if (entityType && entityId) {
      return this.s.auditLogs.filter((l) => l.entityType === entityType && l.entityId === entityId);
    }
    return this.s.auditLogs;
  }

  // --- Duplicate Detection Helper ---
  public checkDuplicates(phone: string, email?: string, cnicOrNtn?: string): string[] {
    const warnings: string[] = [];
    const normalizedPhone = normalizePakistaniPhone(phone);
    const digits = (v: string) => v.replace(/\D/g, '');

    for (const c of this.s.clients) {
      if (normalizedPhone && normalizePakistaniPhone(c.primaryPhone) === normalizedPhone) {
        warnings.push(`Matches existing Individual Client: ${c.fullName} (${c.id})`);
      }
      if (email && c.email && c.email.toLowerCase() === email.toLowerCase()) {
        warnings.push(`Matches email for Client: ${c.fullName} (${c.id})`);
      }
      if (cnicOrNtn && c.cnic && digits(c.cnic) === digits(cnicOrNtn)) {
        warnings.push(`Matches CNIC for Client: ${c.fullName} (${c.id})`);
      }
    }

    for (const co of this.s.companies) {
      if (normalizedPhone && normalizePakistaniPhone(co.primaryContact.mobile) === normalizedPhone) {
        warnings.push(`Matches primary contact for Company: ${co.legalCompanyName} (${co.id})`);
      }
      if (cnicOrNtn && co.ntn && digits(co.ntn) === digits(cnicOrNtn)) {
        warnings.push(`Matches NTN for Company: ${co.legalCompanyName} (${co.id})`);
      }
    }

    for (const b of this.s.branches) {
      if (normalizedPhone && normalizePakistaniPhone(b.branchPhone) === normalizedPhone) {
        warnings.push(`Matches branch phone: ${b.companyName} - ${b.branchName} (${b.id})`);
      }
    }

    return warnings;
  }

  // --- Individual Clients ---
  public getClients(): IndividualClient[] {
    return [...this.s.clients];
  }

  public getClientById(id: string): IndividualClient | undefined {
    return this.s.clients.find((c) => c.id === id);
  }

  public saveClient(client: IndividualClient, userEmail = 'admin'): IndividualClient {
    const created = this.upsert(this.s.clients, client);
    this.audit(userEmail, created ? 'create' : 'update', 'client', client.id, client.fullName,
      created ? `Created new individual client ${client.fullName}` : `Updated client profile ${client.fullName}`);
    this.mirror('clients', client.id, client);
    return client;
  }

  // --- Companies (Master Profiles) ---
  public getCompanies(): CompanyMaster[] {
    return [...this.s.companies];
  }

  public getCompanyById(id: string): CompanyMaster | undefined {
    return this.s.companies.find((c) => c.id === id);
  }

  public saveCompany(company: CompanyMaster, userEmail = 'admin'): CompanyMaster {
    const created = this.upsert(this.s.companies, company);
    this.audit(userEmail, created ? 'create' : 'update', 'company', company.id, company.legalCompanyName,
      created ? `Created new master company ${company.legalCompanyName}` : `Updated company master ${company.legalCompanyName}`);
    this.mirror('companies', company.id, company);
    return company;
  }

  // --- Company Branches ---
  public getBranches(companyId?: string): CompanyBranch[] {
    return companyId ? this.s.branches.filter((b) => b.companyId === companyId) : [...this.s.branches];
  }

  public getBranchById(id: string): CompanyBranch | undefined {
    return this.s.branches.find((b) => b.id === id);
  }

  public saveBranch(branch: CompanyBranch, userEmail = 'admin'): CompanyBranch {
    const created = this.upsert(this.s.branches, branch);
    if (created) {
      const company = this.getCompanyById(branch.companyId);
      if (company) {
        this.saveCompany({ ...company, totalBranchesCount: (company.totalBranchesCount || 0) + 1 }, userEmail);
      }
    }
    this.audit(userEmail, created ? 'create' : 'update', 'branch', branch.id, branch.branchName,
      created
        ? `Created new branch ${branch.branchName} for ${branch.companyName}`
        : `Updated branch ${branch.branchName} of ${branch.companyName}`);
    this.mirror('branches', branch.id, branch);
    return branch;
  }

  // --- Sites & Addresses ---
  public getSites(customerId?: string, branchId?: string): SiteAddress[] {
    return this.s.sites.filter((s) => {
      if (customerId && s.customerId !== customerId) return false;
      if (branchId && s.branchId !== branchId) return false;
      return true;
    });
  }

  public saveSite(site: SiteAddress): SiteAddress {
    this.upsert(this.s.sites, site, false);
    this.commit();
    this.mirror('sites', site.id, site);
    return site;
  }

  // --- Leads & CRM ---
  public getLeads(): Lead[] {
    return [...this.s.leads];
  }

  public getLeadById(id: string): Lead | undefined {
    return this.s.leads.find((l) => l.id === id);
  }

  public saveLead(lead: Lead, userEmail = 'admin'): Lead {
    const dups = this.checkDuplicates(lead.phone, lead.email);
    if (dups.length > 0) {
      lead.duplicateWarning = dups.join(' | ');
    } else {
      delete lead.duplicateWarning;
    }

    const created = this.upsert(this.s.leads, lead);
    this.audit(userEmail, created ? 'create' : 'update', 'lead', lead.id, lead.title,
      created ? `Created new lead inquiry: ${lead.title}` : `Updated lead ${lead.title} stage to ${lead.stage}`);
    this.mirror('leads', lead.id, lead);
    return lead;
  }

  // --- Proposals & Revisions ---
  public getProposals(customerId?: string, branchId?: string): Proposal[] {
    return this.s.proposals.filter((p) => {
      if (customerId && p.customerId !== customerId) return false;
      if (branchId && p.branchId !== branchId) return false;
      return true;
    });
  }

  public getProposalById(id: string): Proposal | undefined {
    return this.s.proposals.find((p) => p.id === id);
  }

  public saveProposal(proposal: Proposal, userEmail = 'admin'): Proposal {
    if (proposal.discountPercent > 10 && proposal.status === 'draft') {
      proposal.status = 'pending_approval';
      proposal.approval = {
        ruleId: 'AP-01',
        ruleDescription: `Discount ${proposal.discountPercent}% exceeds standard authority threshold (10%). Requires Sales Manager / CEO Approval.`,
        requiredRole: proposal.discountPercent > 20 ? 'ceo' : 'sales_manager',
        status: 'pending',
        requestedAt: now(),
        requestedBy: userEmail,
        requestedByName: userEmail,
      };
    }

    const created = this.upsert(this.s.proposals, proposal);
    this.audit(userEmail, created ? 'create' : 'update', 'proposal', proposal.id, proposal.id,
      created
        ? `Drafted new proposal ${proposal.id} for ${proposal.customerName}`
        : `Updated proposal ${proposal.id} (status: ${proposal.status})`);
    this.mirror('proposals', proposal.id, proposal);
    return proposal;
  }

  public createProposalRevision(
    baseProposalId: string,
    changeReason: string,
    updates: Partial<Proposal>,
    userEmail = 'admin'
  ): Proposal {
    const base = this.getProposalById(baseProposalId);
    if (!base) throw new Error('Base proposal not found');

    const nextRevisionNum = (base.revisionNumber || 0) + 1;
    const revisionRecord: ProposalRevision = {
      revisionNumber: nextRevisionNum,
      timestamp: now(),
      changedBy: userEmail,
      changedByName: userEmail,
      changeReason,
      subtotal: updates.subtotal ?? base.subtotal,
      discountPercent: updates.discountPercent ?? base.discountPercent,
      totalAmount: updates.totalAmount ?? base.totalAmount,
    };

    const updatedProposal: Proposal = {
      ...base,
      ...updates,
      revisionNumber: nextRevisionNum,
      revisionsHistory: [...base.revisionsHistory, revisionRecord],
      updatedAt: now(),
    };

    this.saveProposal(updatedProposal, userEmail);
    return updatedProposal;
  }

  // --- Contracts & AMCs ---
  public getContracts(customerId?: string, branchId?: string): Contract[] {
    return this.s.contracts.filter((c) => {
      if (customerId && c.customerId !== customerId) return false;
      if (branchId && c.branchId !== branchId) return false;
      return true;
    });
  }

  public getContractById(id: string): Contract | undefined {
    return this.s.contracts.find((c) => c.id === id);
  }

  public saveContract(contract: Contract, _userEmail = 'admin'): Contract {
    this.upsert(this.s.contracts, contract);
    this.commit();
    this.mirror('contracts', contract.id, contract);
    return contract;
  }

  // --- Service Jobs & PCO Operations ---
  public getJobs(customerId?: string, branchId?: string): ServiceJob[] {
    return this.s.jobs.filter((j) => {
      if (customerId && j.customerId !== customerId) return false;
      if (branchId && j.branchId !== branchId) return false;
      return true;
    });
  }

  public getJobById(id: string): ServiceJob | undefined {
    return this.s.jobs.find((j) => j.id === id);
  }

  public saveJob(job: ServiceJob, userEmail = 'admin'): ServiceJob {
    const created = this.upsert(this.s.jobs, job);
    this.audit(userEmail, created ? 'create' : 'update', 'job', job.id, job.serviceType,
      created ? `Scheduled service job ${job.id} for ${job.customerName}` : `Updated job ${job.id} status to ${job.status}`);
    this.mirror('service_jobs', job.id, job);
    return job;
  }

  public checkPcoConflict(technicianId: string, date: string, timeSlot: string, currentJobId?: string): boolean {
    return this.s.jobs.some(
      (j) =>
        j.id !== currentJobId &&
        j.status !== 'cancelled' &&
        j.scheduledDate === date &&
        j.timeSlot === timeSlot &&
        j.assignedTechnicianNames.includes(technicianId)
    );
  }

  // --- Invoices & Financial Controls ---
  public getInvoices(customerId?: string, branchId?: string): Invoice[] {
    return this.s.invoices.filter((i) => {
      if (customerId && i.customerId !== customerId) return false;
      if (branchId && i.branchId !== branchId) return false;
      return true;
    });
  }

  public getInvoiceById(id: string): Invoice | undefined {
    return this.s.invoices.find((i) => i.id === id);
  }

  public saveInvoice(invoice: Invoice, userEmail = 'admin'): Invoice {
    const existing = this.getInvoiceById(invoice.id);
    if (existing && existing.isPosted && invoice.isPosted && existing.status !== 'void_reversed') {
      if (invoice.status === 'void_reversed' && !invoice.creditNoteReason) {
        throw new Error('Voiding a posted invoice requires an authorized credit note reason.');
      }
    }

    const created = this.upsert(this.s.invoices, invoice);
    this.audit(userEmail, created ? 'create' : 'update', 'invoice', invoice.id, invoice.invoiceNumber,
      created
        ? `Generated invoice ${invoice.invoiceNumber} for ${invoice.customerName}`
        : `Updated invoice ${invoice.invoiceNumber} (status: ${invoice.status})`);
    this.mirror('invoices', invoice.id, invoice);
    return invoice;
  }

  // --- Payments & Receivable Withholding Tax ---
  public getPayments(customerId?: string, branchId?: string): PaymentReceipt[] {
    return this.s.payments.filter((p) => {
      if (customerId && p.customerId !== customerId) return false;
      if (branchId && p.branchId !== branchId) return false;
      return true;
    });
  }

  public recordPayment(payment: PaymentReceipt, userEmail = 'admin'): PaymentReceipt {
    const invoice = this.getInvoiceById(payment.invoiceId);
    if (!invoice) throw new Error('Associated invoice not found.');

    this.s.payments.unshift(payment);

    const newPaid = (invoice.amountPaid || 0) + payment.cashAmountReceived;
    const newWht = (invoice.customerWhtTotal || 0) + (payment.customerWhtDeducted?.amountDeducted || 0);
    const newBalance = Math.max(0, invoice.grossPayable - newPaid - newWht);

    invoice.amountPaid = newPaid;
    invoice.customerWhtTotal = newWht;
    invoice.balanceDue = newBalance;
    invoice.status = newBalance === 0 ? 'paid' : 'partially_paid';

    this.saveInvoice(invoice, userEmail);

    this.audit(userEmail, 'create', 'payment', payment.id, payment.receiptNumber,
      `Recorded payment receipt ${payment.receiptNumber} of PKR ${payment.cashAmountReceived} (WHT: PKR ${payment.customerWhtDeducted?.amountDeducted || 0}) for ${invoice.invoiceNumber}`);
    this.mirror('payments', payment.id, payment);
    return payment;
  }

  // --- Tax Rules ---
  public getTaxRules(): TaxRuleConfig[] {
    return [...this.s.taxRules];
  }

  public saveTaxRule(rule: TaxRuleConfig, userEmail = 'admin'): TaxRuleConfig {
    this.upsert(this.s.taxRules, rule, false);
    this.audit(userEmail, 'update', 'tax_rule', rule.id, rule.jurisdictionTitle,
      `Updated tax rule for ${rule.jurisdictionTitle}: Standard ${rule.standardSalesTaxPercent}%, WHT ${rule.whtActiveFilerPercent}%`);
    this.mirror('tax_rules', rule.id, rule);
    return rule;
  }

  // --- Documents (IKPM library + client/lead/proposal attachments) ---
  public getDocuments(owner?: DocumentOwner): PortalDocument[] {
    if (!owner) return [...this.s.documents];
    return this.s.documents.filter((d) =>
      owner.kind === 'library'
        ? d.owner.kind === 'library'
        : d.owner.kind === owner.kind && 'id' in d.owner && d.owner.id === owner.id
    );
  }

  public getLibraryDocuments(): PortalDocument[] {
    return this.getDocuments({ kind: 'library' });
  }

  public getDocumentById(id: string): PortalDocument | undefined {
    return this.s.documents.find((d) => d.id === id);
  }

  public saveDocument(document: PortalDocument, userEmail = 'admin'): PortalDocument {
    const created = this.upsert(this.s.documents, document, false);
    this.commit();
    this.mirror('documents', document.id, document);
    if (created) {
      const ownerLabel = document.owner.kind === 'library' ? 'IKPM document library' : `${document.owner.kind} ${document.owner.id}`;
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'create',
        entityType: 'document',
        entityId: 'id' in document.owner ? document.owner.id : 'library',
        entityTitle: document.title,
        details: `Uploaded document "${document.title}" to ${ownerLabel}`,
      });
    }
    return document;
  }

  /** Removes the record from the portal. The file itself stays in Cloudinary (deleting requires a signed API call). */
  public removeDocument(id: string, userEmail = 'admin') {
    const docRec = this.getDocumentById(id);
    if (!docRec) return;
    this.s.documents = this.s.documents.filter((d) => d.id !== id);
    this.s.documentPacks = this.s.documentPacks.map((p) => ({ ...p, documentIds: p.documentIds.filter((x) => x !== id) }));
    this.audit(userEmail, 'delete', 'document', id, docRec.title, `Removed document "${docRec.title}" from portal`);
    this.mirror('documents', id, { removed: true, removedAt: now() });
  }

  public getDocumentPacks(): DocumentPack[] {
    return [...this.s.documentPacks];
  }

  public saveDocumentPack(pack: DocumentPack) {
    this.upsert(this.s.documentPacks, pack, false);
    this.commit();
    this.mirror('document_packs', pack.id, pack);
  }

  /** Resolves a pack to the concrete, non-expired library documents it contains. */
  public resolvePack(packId: string): PortalDocument[] {
    const pack = this.s.documentPacks.find((p) => p.id === packId);
    if (!pack) return [];
    const today = new Date().toISOString().slice(0, 10);
    return this.getLibraryDocuments().filter(
      (d) =>
        (pack.categories.includes(d.category) || pack.documentIds.includes(d.id)) &&
        (!d.expiryDate || d.expiryDate >= today)
    );
  }

  // --- Outreach (WhatsApp / Email) ---
  public getOutreachLogs(related?: { kind: OutreachLog['related']['kind']; id: string }): OutreachLog[] {
    if (!related) return [...this.s.outreachLogs];
    return this.s.outreachLogs.filter((l) => l.related.kind === related.kind && l.related.id === related.id);
  }

  public logOutreach(log: OutreachLog) {
    this.s.outreachLogs.unshift(log);
    this.commit();
    this.mirror('outreach_logs', log.id, log);
  }
}

export const dataService = new DataService();
