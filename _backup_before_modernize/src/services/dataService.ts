// Unified Data Service for IKPM Portal (Firestore with local fallback cache & offline sync)

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
} from './seedData';

class DataService {
  private companies: CompanyMaster[] = [];
  private branches: CompanyBranch[] = [];
  private clients: IndividualClient[] = [];
  private sites: SiteAddress[] = [];
  private leads: Lead[] = [];
  private proposals: Proposal[] = [];
  private contracts: Contract[] = [];
  private jobs: ServiceJob[] = [];
  private invoices: Invoice[] = [];
  private payments: PaymentReceipt[] = [];
  private taxRules: TaxRuleConfig[] = [];
  private auditLogs: AuditLogEntry[] = [];

  constructor() {
    this.init();
  }

  private init() {
    try {
      const stored = localStorage.getItem('ikpm_portal_db_v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.companies = parsed.companies || SEED_COMPANIES;
        this.branches = parsed.branches || SEED_BRANCHES;
        this.clients = parsed.clients || SEED_INDIVIDUAL_CLIENTS;
        this.sites = parsed.sites || SEED_SITES;
        this.leads = parsed.leads || SEED_LEADS;
        this.proposals = parsed.proposals || SEED_PROPOSALS;
        this.contracts = parsed.contracts || SEED_CONTRACTS;
        this.jobs = parsed.jobs || SEED_SERVICE_JOBS;
        this.invoices = parsed.invoices || SEED_INVOICES;
        this.payments = parsed.payments || [];
        this.taxRules = parsed.taxRules || SEED_TAX_RULES;
        this.auditLogs = parsed.auditLogs || [];
        return;
      }
    } catch {
      // Fallback
    }

    this.companies = [...SEED_COMPANIES];
    this.branches = [...SEED_BRANCHES];
    this.clients = [...SEED_INDIVIDUAL_CLIENTS];
    this.sites = [...SEED_SITES];
    this.leads = [...SEED_LEADS];
    this.proposals = [...SEED_PROPOSALS];
    this.contracts = [...SEED_CONTRACTS];
    this.jobs = [...SEED_SERVICE_JOBS];
    this.invoices = [...SEED_INVOICES];
    this.payments = [];
    this.taxRules = [...SEED_TAX_RULES];
    this.auditLogs = [];
    this.persist();
  }

  private persist() {
    try {
      const state = {
        companies: this.companies,
        branches: this.branches,
        clients: this.clients,
        sites: this.sites,
        leads: this.leads,
        proposals: this.proposals,
        contracts: this.contracts,
        jobs: this.jobs,
        invoices: this.invoices,
        payments: this.payments,
        taxRules: this.taxRules,
        auditLogs: this.auditLogs,
      };
      localStorage.setItem('ikpm_portal_db_v1', JSON.stringify(state));
    } catch (err) {
      console.warn('Failed to persist to localStorage', err);
    }
  }

  // --- Audit Logging ---
  public logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) {
    const log: AuditLogEntry = {
      ...entry,
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    this.persist();

    try {
      setDoc(doc(db, 'audit_logs', log.id), log).catch(() => {});
    } catch {}
  }

  public getAuditLogs(entityType?: string, entityId?: string): AuditLogEntry[] {
    if (entityType && entityId) {
      return this.auditLogs.filter(l => l.entityType === entityType && l.entityId === entityId);
    }
    return this.auditLogs;
  }

  // --- Duplicate Detection Helper ---
  public checkDuplicates(phone: string, email?: string, cnicOrNtn?: string): string[] {
    const warnings: string[] = [];
    const normalizedPhone = normalizePakistaniPhone(phone);

    for (const c of this.clients) {
      if (normalizedPhone && normalizePakistaniPhone(c.primaryPhone) === normalizedPhone) {
        warnings.push(`Matches existing Individual Client: ${c.fullName} (${c.id})`);
      }
      if (email && c.email && c.email.toLowerCase() === email.toLowerCase()) {
        warnings.push(`Matches email for Client: ${c.fullName} (${c.id})`);
      }
      if (cnicOrNtn && c.cnic && c.cnic.replace(/\D/g, '') === cnicOrNtn.replace(/\D/g, '')) {
        warnings.push(`Matches CNIC for Client: ${c.fullName} (${c.id})`);
      }
    }

    for (const co of this.companies) {
      if (normalizedPhone && normalizePakistaniPhone(co.primaryContact.mobile) === normalizedPhone) {
        warnings.push(`Matches primary contact for Company: ${co.legalCompanyName} (${co.id})`);
      }
      if (cnicOrNtn && co.ntn && co.ntn.replace(/\D/g, '') === cnicOrNtn.replace(/\D/g, '')) {
        warnings.push(`Matches NTN for Company: ${co.legalCompanyName} (${co.id})`);
      }
    }

    for (const b of this.branches) {
      if (normalizedPhone && normalizePakistaniPhone(b.branchPhone) === normalizedPhone) {
        warnings.push(`Matches branch phone: ${b.companyName} - ${b.branchName} (${b.id})`);
      }
    }

    return warnings;
  }

  // --- Individual Clients ---
  public getClients(): IndividualClient[] {
    return [...this.clients];
  }

  public getClientById(id: string): IndividualClient | undefined {
    return this.clients.find(c => c.id === id);
  }

  public saveClient(client: IndividualClient, userEmail = 'admin'): IndividualClient {
    const idx = this.clients.findIndex(c => c.id === client.id);
    if (idx !== -1) {
      this.clients[idx] = { ...client, updatedAt: new Date().toISOString() };
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'update',
        entityType: 'client',
        entityId: client.id,
        entityTitle: client.fullName,
        details: `Updated client profile ${client.fullName}`,
      });
    } else {
      this.clients.unshift({ ...client, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'create',
        entityType: 'client',
        entityId: client.id,
        entityTitle: client.fullName,
        details: `Created new individual client ${client.fullName}`,
      });
    }
    this.persist();
    try {
      setDoc(doc(db, 'clients', client.id), client, { merge: true }).catch(() => {});
    } catch {}
    return client;
  }

  // --- Companies (Master Profiles) ---
  public getCompanies(): CompanyMaster[] {
    return [...this.companies];
  }

  public getCompanyById(id: string): CompanyMaster | undefined {
    return this.companies.find(c => c.id === id);
  }

  public saveCompany(company: CompanyMaster, userEmail = 'admin'): CompanyMaster {
    const idx = this.companies.findIndex(c => c.id === company.id);
    if (idx !== -1) {
      this.companies[idx] = { ...company, updatedAt: new Date().toISOString() };
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'update',
        entityType: 'company',
        entityId: company.id,
        entityTitle: company.legalCompanyName,
        details: `Updated company master ${company.legalCompanyName}`,
      });
    } else {
      this.companies.unshift({ ...company, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'create',
        entityType: 'company',
        entityId: company.id,
        entityTitle: company.legalCompanyName,
        details: `Created new master company ${company.legalCompanyName}`,
      });
    }
    this.persist();
    try {
      setDoc(doc(db, 'companies', company.id), company, { merge: true }).catch(() => {});
    } catch {}
    return company;
  }

  // --- Company Branches ---
  public getBranches(companyId?: string): CompanyBranch[] {
    if (companyId) {
      return this.branches.filter(b => b.companyId === companyId);
    }
    return [...this.branches];
  }

  public getBranchById(id: string): CompanyBranch | undefined {
    return this.branches.find(b => b.id === id);
  }

  public saveBranch(branch: CompanyBranch, userEmail = 'admin'): CompanyBranch {
    const idx = this.branches.findIndex(b => b.id === branch.id);
    if (idx !== -1) {
      this.branches[idx] = { ...branch, updatedAt: new Date().toISOString() };
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'update',
        entityType: 'branch',
        entityId: branch.id,
        entityTitle: branch.branchName,
        details: `Updated branch ${branch.branchName} of ${branch.companyName}`,
      });
    } else {
      this.branches.unshift({ ...branch, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      const company = this.getCompanyById(branch.companyId);
      if (company) {
        company.totalBranchesCount = (company.totalBranchesCount || 0) + 1;
        this.saveCompany(company, userEmail);
      }
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'create',
        entityType: 'branch',
        entityId: branch.id,
        entityTitle: branch.branchName,
        details: `Created new branch ${branch.branchName} for ${branch.companyName}`,
      });
    }
    this.persist();
    try {
      setDoc(doc(db, 'branches', branch.id), branch, { merge: true }).catch(() => {});
    } catch {}
    return branch;
  }

  // --- Sites & Addresses ---
  public getSites(customerId?: string, branchId?: string): SiteAddress[] {
    return this.sites.filter(s => {
      if (customerId && s.customerId !== customerId) return false;
      if (branchId && s.branchId !== branchId) return false;
      return true;
    });
  }

  public saveSite(site: SiteAddress): SiteAddress {
    const idx = this.sites.findIndex(s => s.id === site.id);
    if (idx !== -1) {
      this.sites[idx] = site;
    } else {
      this.sites.unshift(site);
    }
    this.persist();
    try {
      setDoc(doc(db, 'sites', site.id), site, { merge: true }).catch(() => {});
    } catch {}
    return site;
  }

  // --- Leads & CRM ---
  public getLeads(): Lead[] {
    return [...this.leads];
  }

  public getLeadById(id: string): Lead | undefined {
    return this.leads.find(l => l.id === id);
  }

  public saveLead(lead: Lead, userEmail = 'admin'): Lead {
    const dups = this.checkDuplicates(lead.phone, lead.email);
    if (dups.length > 0) {
      lead.duplicateWarning = dups.join(' | ');
    } else {
      delete lead.duplicateWarning;
    }

    const idx = this.leads.findIndex(l => l.id === lead.id);
    if (idx !== -1) {
      this.leads[idx] = { ...lead, updatedAt: new Date().toISOString() };
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'update',
        entityType: 'lead',
        entityId: lead.id,
        entityTitle: lead.title,
        details: `Updated lead ${lead.title} stage to ${lead.stage}`,
      });
    } else {
      this.leads.unshift({ ...lead, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'create',
        entityType: 'lead',
        entityId: lead.id,
        entityTitle: lead.title,
        details: `Created new lead inquiry: ${lead.title}`,
      });
    }
    this.persist();
    try {
      setDoc(doc(db, 'leads', lead.id), lead, { merge: true }).catch(() => {});
    } catch {}
    return lead;
  }

  // --- Proposals & Revisions ---
  public getProposals(customerId?: string, branchId?: string): Proposal[] {
    return this.proposals.filter(p => {
      if (customerId && p.customerId !== customerId) return false;
      if (branchId && p.branchId !== branchId) return false;
      return true;
    });
  }

  public getProposalById(id: string): Proposal | undefined {
    return this.proposals.find(p => p.id === id);
  }

  public saveProposal(proposal: Proposal, userEmail = 'admin'): Proposal {
    if (proposal.discountPercent > 10 && proposal.status === 'draft') {
      proposal.status = 'pending_approval';
      proposal.approval = {
        ruleId: 'AP-01',
        ruleDescription: `Discount ${proposal.discountPercent}% exceeds standard authority threshold (10%). Requires Sales Manager / CEO Approval.`,
        requiredRole: proposal.discountPercent > 20 ? 'ceo' : 'sales_manager',
        status: 'pending',
        requestedAt: new Date().toISOString(),
        requestedBy: userEmail,
        requestedByName: userEmail,
      };
    }

    const idx = this.proposals.findIndex(p => p.id === proposal.id);
    if (idx !== -1) {
      this.proposals[idx] = { ...proposal, updatedAt: new Date().toISOString() };
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'update',
        entityType: 'proposal',
        entityId: proposal.id,
        entityTitle: proposal.id,
        details: `Updated proposal ${proposal.id} (status: ${proposal.status})`,
      });
    } else {
      this.proposals.unshift({ ...proposal, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'create',
        entityType: 'proposal',
        entityId: proposal.id,
        entityTitle: proposal.id,
        details: `Drafted new proposal ${proposal.id} for ${proposal.customerName}`,
      });
    }
    this.persist();
    try {
      setDoc(doc(db, 'proposals', proposal.id), proposal, { merge: true }).catch(() => {});
    } catch {}
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
      timestamp: new Date().toISOString(),
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
      updatedAt: new Date().toISOString(),
    };

    this.saveProposal(updatedProposal, userEmail);
    return updatedProposal;
  }

  // --- Contracts & AMCs ---
  public getContracts(customerId?: string, branchId?: string): Contract[] {
    return this.contracts.filter(c => {
      if (customerId && c.customerId !== customerId) return false;
      if (branchId && c.branchId !== branchId) return false;
      return true;
    });
  }

  public getContractById(id: string): Contract | undefined {
    return this.contracts.find(c => c.id === id);
  }

  public saveContract(contract: Contract, _userEmail = 'admin'): Contract {
    const idx = this.contracts.findIndex(c => c.id === contract.id);
    if (idx !== -1) {
      this.contracts[idx] = { ...contract, updatedAt: new Date().toISOString() };
    } else {
      this.contracts.unshift({ ...contract, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    this.persist();
    try {
      setDoc(doc(db, 'contracts', contract.id), contract, { merge: true }).catch(() => {});
    } catch {}
    return contract;
  }

  // --- Service Jobs & PCO Operations ---
  public getJobs(customerId?: string, branchId?: string): ServiceJob[] {
    return this.jobs.filter(j => {
      if (customerId && j.customerId !== customerId) return false;
      if (branchId && j.branchId !== branchId) return false;
      return true;
    });
  }

  public getJobById(id: string): ServiceJob | undefined {
    return this.jobs.find(j => j.id === id);
  }

  public saveJob(job: ServiceJob, userEmail = 'admin'): ServiceJob {
    const idx = this.jobs.findIndex(j => j.id === job.id);
    if (idx !== -1) {
      this.jobs[idx] = { ...job, updatedAt: new Date().toISOString() };
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'update',
        entityType: 'job',
        entityId: job.id,
        entityTitle: job.serviceType,
        details: `Updated job ${job.id} status to ${job.status}`,
      });
    } else {
      this.jobs.unshift({ ...job, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'create',
        entityType: 'job',
        entityId: job.id,
        entityTitle: job.serviceType,
        details: `Scheduled service job ${job.id} for ${job.customerName}`,
      });
    }
    this.persist();
    try {
      setDoc(doc(db, 'service_jobs', job.id), job, { merge: true }).catch(() => {});
    } catch {}
    return job;
  }

  public checkPcoConflict(technicianId: string, date: string, timeSlot: string, currentJobId?: string): boolean {
    return this.jobs.some(
      j =>
        j.id !== currentJobId &&
        j.status !== 'cancelled' &&
        j.scheduledDate === date &&
        j.timeSlot === timeSlot &&
        j.assignedTechnicianNames.includes(technicianId)
    );
  }

  // --- Invoices & Financial Controls ---
  public getInvoices(customerId?: string, branchId?: string): Invoice[] {
    return this.invoices.filter(i => {
      if (customerId && i.customerId !== customerId) return false;
      if (branchId && i.branchId !== branchId) return false;
      return true;
    });
  }

  public getInvoiceById(id: string): Invoice | undefined {
    return this.invoices.find(i => i.id === id);
  }

  public saveInvoice(invoice: Invoice, userEmail = 'admin'): Invoice {
    const existing = this.getInvoiceById(invoice.id);
    if (existing && existing.isPosted && invoice.isPosted && existing.status !== 'void_reversed') {
      if (invoice.status === 'void_reversed' && !invoice.creditNoteReason) {
        throw new Error('Voiding a posted invoice requires an authorized credit note reason.');
      }
    }

    const idx = this.invoices.findIndex(i => i.id === invoice.id);
    if (idx !== -1) {
      this.invoices[idx] = { ...invoice, updatedAt: new Date().toISOString() };
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'update',
        entityType: 'invoice',
        entityId: invoice.id,
        entityTitle: invoice.invoiceNumber,
        details: `Updated invoice ${invoice.invoiceNumber} (status: ${invoice.status})`,
      });
    } else {
      this.invoices.unshift({ ...invoice, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      this.logAudit({
        userId: userEmail,
        userEmail,
        action: 'create',
        entityType: 'invoice',
        entityId: invoice.id,
        entityTitle: invoice.invoiceNumber,
        details: `Generated invoice ${invoice.invoiceNumber} for ${invoice.customerName}`,
      });
    }
    this.persist();
    try {
      setDoc(doc(db, 'invoices', invoice.id), invoice, { merge: true }).catch(() => {});
    } catch {}
    return invoice;
  }

  // --- Payments & Receivable Withholding Tax ---
  public getPayments(customerId?: string, branchId?: string): PaymentReceipt[] {
    return this.payments.filter(p => {
      if (customerId && p.customerId !== customerId) return false;
      if (branchId && p.branchId !== branchId) return false;
      return true;
    });
  }

  public recordPayment(payment: PaymentReceipt, userEmail = 'admin'): PaymentReceipt {
    const invoice = this.getInvoiceById(payment.invoiceId);
    if (!invoice) throw new Error('Associated invoice not found.');

    this.payments.unshift(payment);

    const newPaid = (invoice.amountPaid || 0) + payment.cashAmountReceived;
    const newWht = (invoice.customerWhtTotal || 0) + (payment.customerWhtDeducted?.amountDeducted || 0);
    const newBalance = Math.max(0, invoice.grossPayable - newPaid - newWht);

    invoice.amountPaid = newPaid;
    invoice.customerWhtTotal = newWht;
    invoice.balanceDue = newBalance;
    if (newBalance === 0) {
      invoice.status = 'paid';
    } else {
      invoice.status = 'partially_paid';
    }

    this.saveInvoice(invoice, userEmail);

    this.logAudit({
      userId: userEmail,
      userEmail,
      action: 'create',
      entityType: 'payment',
      entityId: payment.id,
      entityTitle: payment.receiptNumber,
      details: `Recorded payment receipt ${payment.receiptNumber} of PKR ${payment.cashAmountReceived} (WHT: PKR ${payment.customerWhtDeducted?.amountDeducted || 0}) for ${invoice.invoiceNumber}`,
    });

    this.persist();
    try {
      setDoc(doc(db, 'payments', payment.id), payment, { merge: true }).catch(() => {});
    } catch {}
    return payment;
  }

  // --- Tax Rules ---
  public getTaxRules(): TaxRuleConfig[] {
    return [...this.taxRules];
  }

  public saveTaxRule(rule: TaxRuleConfig, userEmail = 'admin'): TaxRuleConfig {
    const idx = this.taxRules.findIndex(r => r.id === rule.id);
    if (idx !== -1) {
      this.taxRules[idx] = rule;
    } else {
      this.taxRules.unshift(rule);
    }
    this.logAudit({
      userId: userEmail,
      userEmail,
      action: 'update',
      entityType: 'tax_rule',
      entityId: rule.id,
      entityTitle: rule.jurisdictionTitle,
      details: `Updated tax rule for ${rule.jurisdictionTitle}: Standard ${rule.standardSalesTaxPercent}%, WHT ${rule.whtActiveFilerPercent}%`,
    });
    this.persist();
    try {
      setDoc(doc(db, 'tax_rules', rule.id), rule, { merge: true }).catch(() => {});
    } catch {}
    return rule;
  }
}

export const dataService = new DataService();
