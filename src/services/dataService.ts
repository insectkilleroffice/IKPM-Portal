// Unified Data Service for IKPM Portal.
// Cloud Firestore is the source of truth: after sign-in we open live, role-scoped subscriptions
// (see src/lib/permissions.ts + firestore.rules) and every save is written straight to Firestore.
// Firestore's persistent cache keeps the portal usable offline and syncs queued writes later.
// Components subscribe through `useDataStore()` so they re-render whenever data changes.

import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { canReadCollection, seesAllRecords } from '../lib/permissions';
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
import type { AuditLogEntry, DataScope, RecordOwnership, Team, UserProfile, UserRole } from '../types';
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

/** Where the portal kept data before it was connected to Firestore (used only for the one-time upload). */
const LEGACY_STORAGE_KEY = 'ikpm_portal_db_v1';

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
  users: UserProfile[];
  teams: Team[];
}

type StateKey = keyof DbState;

/** State key → Firestore collection. */
const COLLECTIONS: Record<StateKey, string> = {
  companies: 'companies',
  branches: 'branches',
  clients: 'clients',
  sites: 'sites',
  leads: 'leads',
  proposals: 'proposals',
  contracts: 'contracts',
  jobs: 'service_jobs',
  invoices: 'invoices',
  payments: 'payments',
  taxRules: 'tax_rules',
  auditLogs: 'audit_logs',
  documents: 'documents',
  documentPacks: 'document_packs',
  outreachLogs: 'outreach_logs',
  users: 'users',
  teams: 'teams',
};

/** Business records that are scoped to their owner / team. */
const SCOPED: StateKey[] = ['companies', 'branches', 'clients', 'sites', 'leads', 'proposals', 'contracts', 'jobs', 'outreachLogs'];

/** Records uploaded by the one-time local → cloud migration (users/teams/audit are never migrated). */
const MIGRATABLE: StateKey[] = [
  'companies', 'branches', 'clients', 'sites', 'leads', 'proposals', 'contracts', 'jobs',
  'invoices', 'payments', 'taxRules', 'documents', 'documentPacks', 'outreachLogs',
];

const SEEDS: Partial<Record<StateKey, { id: string }[]>> = {
  companies: SEED_COMPANIES,
  branches: SEED_BRANCHES,
  clients: SEED_INDIVIDUAL_CLIENTS,
  sites: SEED_SITES,
  leads: SEED_LEADS,
  proposals: SEED_PROPOSALS,
  contracts: SEED_CONTRACTS,
  jobs: SEED_SERVICE_JOBS,
  invoices: SEED_INVOICES,
  taxRules: SEED_TAX_RULES,
  documentPacks: SEED_DOCUMENT_PACKS,
};

const emptyState = (): DbState => ({
  companies: [],
  branches: [],
  clients: [],
  sites: [],
  leads: [],
  proposals: [],
  contracts: [],
  jobs: [],
  invoices: [],
  payments: [],
  // Shared configuration shows the built-in defaults until Firestore has its own copy
  taxRules: [...SEED_TAX_RULES],
  auditLogs: [],
  documents: [],
  documentPacks: [...SEED_DOCUMENT_PACKS],
  outreachLogs: [],
  users: [],
  teams: [],
});

const now = () => new Date().toISOString();

/** Firestore rejects `undefined` values — drop them before writing. */
const toFirestore = <T,>(data: T): T => JSON.parse(JSON.stringify(data));

/** Newest first, using whichever timestamp the record type carries. */
const recordTime = (r: Record<string, unknown>) =>
  String(r.createdAt ?? r.timestamp ?? r.uploadedAt ?? r.sentAt ?? r.issueDate ?? r.updatedAt ?? '');

export interface DataSession {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  dataScope: DataScope;
  teamId?: string;
}

export type CloudStatus = 'signed_out' | 'connecting' | 'live' | 'error';

export interface CloudState {
  status: CloudStatus;
  pendingWrites: number;
  /** Collections whose subscription was refused (usually: rules not deployed). */
  blocked: string[];
  lastError?: { collection: string; message: string; at: string };
}

export interface WriteError {
  collection: string;
  id: string;
  code: string;
  message: string;
}

const friendlyError = (code: string, message: string) => {
  if (code === 'permission-denied') {
    return 'Permission denied by Firestore. Either your role is not allowed to change this record, or the security rules have not been deployed yet (npx firebase-tools deploy --only firestore).';
  }
  if (code === 'unavailable') return 'Firestore is unreachable. The change is kept on this device and will sync when the connection returns.';
  return message;
};

type Listener = () => void;

class DataService {
  private s: DbState = emptyState();
  private listeners = new Set<Listener>();
  private errorListeners = new Set<(e: WriteError) => void>();
  private version = 0;
  private session: DataSession | null = null;
  private unsubs: Unsubscribe[] = [];
  /** Per-collection, per-query result sets; a collection's state is the union of its queries. */
  private partials = new Map<StateKey, Map<string, Map<string, unknown>>>();
  private cloud: CloudState = { status: 'signed_out', pendingWrites: 0, blocked: [] };
  private loadedKeys = new Set<StateKey>();

  // --- Store plumbing ---

  /** Notify subscribed components. */
  private commit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private setCloud(patch: Partial<CloudState>) {
    this.cloud = { ...this.cloud, ...patch };
    this.commit();
  }

  /**
   * Called by AuthContext whenever the signed-in user (or their role/team) changes.
   * Tears down old subscriptions and opens only the ones this user is allowed to read.
   */
  public setSession(session: DataSession | null) {
    const same =
      session && this.session &&
      session.uid === this.session.uid && session.role === this.session.role &&
      session.dataScope === this.session.dataScope && session.teamId === this.session.teamId;
    if (same || (!session && !this.session)) return;

    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.partials.clear();
    this.loadedKeys.clear();
    this.s = emptyState();
    this.session = session;

    if (!session) {
      this.cloud = { status: 'signed_out', pendingWrites: 0, blocked: [] };
      this.commit();
      return;
    }

    this.cloud = { status: 'connecting', pendingWrites: 0, blocked: [] };
    (Object.keys(COLLECTIONS) as StateKey[]).forEach((key) => {
      this.queriesFor(key, session).forEach((q, i) => this.listen(key, `${key}#${i}`, q));
    });
    this.commit();
  }

  private queriesFor(key: StateKey, se: DataSession): Query[] {
    const name = COLLECTIONS[key];
    const col = collection(db, name);

    if (key === 'users' || key === 'teams') return [col];
    if (!canReadCollection(se.role, name)) return [];
    if (key === 'auditLogs') return [query(col, orderBy('timestamp', 'desc'), limit(500))];
    if (key === 'taxRules' || key === 'documentPacks' || key === 'invoices' || key === 'payments') return [col];

    if (key === 'jobs' && se.role === 'technician') {
      return [query(col, where('assignedTechnicianIds', 'array-contains', se.uid))];
    }
    if (key === 'documents' && se.role === 'technician') {
      return [query(col, where('ownerUid', '==', se.uid))];
    }

    if (seesAllRecords(se.role, se.dataScope)) return [col];

    const scoped: Query[] = [query(col, where('ownerUid', '==', se.uid))];
    if (se.dataScope === 'team' && se.teamId) scoped.push(query(col, where('teamId', '==', se.teamId)));
    if (key === 'documents') scoped.push(query(col, where('owner.kind', '==', 'library')));
    return scoped;
  }

  private listen(key: StateKey, queryKey: string, q: Query) {
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = new Map<string, unknown>();
        snap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          if (data.removed) return; // soft-deleted
          docs.set(d.id, key === 'users' ? { uid: d.id, ...data } : { id: d.id, ...data });
        });
        if (!this.partials.has(key)) this.partials.set(key, new Map());
        this.partials.get(key)!.set(queryKey, docs);
        this.rebuild(key);
        this.loadedKeys.add(key);
        if (this.cloud.status === 'connecting') this.cloud = { ...this.cloud, status: 'live' };
        this.commit();
        this.maybeSeedDefaults(key, snap.empty && !snap.metadata.fromCache);
      },
      (err) => {
        console.error(`[Firestore] subscription to "${COLLECTIONS[key]}" failed:`, err);
        const blocked = Array.from(new Set([...this.cloud.blocked, COLLECTIONS[key]]));
        this.setCloud({
          status: 'error',
          blocked,
          lastError: { collection: COLLECTIONS[key], message: friendlyError(err.code, err.message), at: now() },
        });
      }
    );
    this.unsubs.push(unsub);
  }

  private rebuild(key: StateKey) {
    const merged = new Map<string, unknown>();
    this.partials.get(key)?.forEach((docs) => docs.forEach((v, id) => merged.set(id, v)));
    let list = Array.from(merged.values()) as Record<string, unknown>[];
    list.sort((a, b) => recordTime(b).localeCompare(recordTime(a)));
    // Shared config keeps showing defaults until someone saves real values
    if (list.length === 0 && (key === 'taxRules' || key === 'documentPacks')) {
      list = [...(SEEDS[key] as unknown as Record<string, unknown>[])];
    }
    (this.s as unknown as Record<StateKey, unknown[]>)[key] = list;
  }

  /** First super-admin login on an empty project: store the default tax rules & document packs. */
  private maybeSeedDefaults(key: StateKey, empty: boolean) {
    if (!empty || this.session?.role !== 'super_admin') return;
    if (key !== 'taxRules' && key !== 'documentPacks') return;
    (SEEDS[key] ?? []).forEach((item) => this.write(COLLECTIONS[key], item.id, item));
  }

  /** Writes to Firestore and reports failures to the UI instead of failing silently. */
  private write(collectionName: string, id: string, data: unknown) {
    if (!this.session) {
      this.emitError({ collection: collectionName, id, code: 'unauthenticated', message: 'You are signed out. Sign in again to save changes.' });
      return;
    }
    this.cloud = { ...this.cloud, pendingWrites: this.cloud.pendingWrites + 1 };
    this.commit();
    setDoc(doc(db, collectionName, id), toFirestore(data) as Record<string, unknown>, { merge: true })
      .catch((err: { code?: string; message?: string }) => {
        const code = err?.code || 'unknown';
        const message = friendlyError(code, err?.message || String(err));
        console.error(`[Firestore] write to ${collectionName}/${id} failed:`, err);
        this.cloud = { ...this.cloud, lastError: { collection: collectionName, message, at: now() } };
        this.emitError({ collection: collectionName, id, code, message });
      })
      .finally(() => {
        this.cloud = { ...this.cloud, pendingWrites: Math.max(0, this.cloud.pendingWrites - 1) };
        this.commit();
      });
  }

  private emitError(e: WriteError) {
    this.errorListeners.forEach((l) => l(e));
  }

  /** Ownership stamp for brand-new records (drives own/team scoping in firestore.rules). */
  private ownership(): RecordOwnership {
    const se = this.session;
    if (!se) return {};
    return { ownerUid: se.uid, ownerName: se.name, ownerEmail: se.email, ...(se.teamId ? { teamId: se.teamId } : {}) };
  }

  /** Insert-or-replace by id. Returns whether the record was newly created. Mutates `item` to the saved shape. */
  private upsert<T extends { id: string }>(list: T[], item: T, stamp = true): boolean {
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx !== -1) {
      // An edit never drops the original owner
      const prev = list[idx] as T & RecordOwnership;
      const kept: RecordOwnership = {};
      if (prev.ownerUid) Object.assign(kept, { ownerUid: prev.ownerUid, ownerName: prev.ownerName, ownerEmail: prev.ownerEmail });
      if (prev.teamId) kept.teamId = prev.teamId;
      list[idx] = { ...item, ...kept, ...(stamp ? { updatedAt: now() } : {}) };
      Object.assign(item, list[idx]);
      return false;
    }
    const owned = item as T & RecordOwnership;
    const created = {
      ...item,
      ...(owned.ownerUid ? {} : this.ownership()),
      ...(stamp ? { createdAt: (item as { createdAt?: string }).createdAt || now(), updatedAt: now() } : {}),
    } as T;
    Object.assign(item, created);
    list.unshift(created);
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
    this.logAudit({ userId: this.session?.uid || '', userEmail, action, entityType, entityId, entityTitle, details });
  }

  public subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getVersion = () => this.version;

  /** Subscribe to failed cloud writes (used to show a toast). */
  public onWriteError(listener: (e: WriteError) => void) {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  public getCloudState(): CloudState {
    return this.cloud;
  }

  public getSession() {
    return this.session;
  }

  // --- Staff & teams (read side; writes live in staffService) ---
  public getUsers(): UserProfile[] {
    return [...this.s.users].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }

  public getStaff(roles?: UserRole[]): UserProfile[] {
    return this.getUsers().filter((u) => u.isActive && (!roles || roles.includes(u.role)));
  }

  public getTeams(): Team[] {
    return [...this.s.teams].sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- One-time upload of data that was only saved in this browser ---
  private readLegacy(): Partial<DbState> | null {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<DbState>) : null;
    } catch {
      return null;
    }
  }

  /** Records saved locally before Firestore worked, excluding untouched demo/sample records. */
  public getLocalOnlyRecords(includeSamples = false): { collection: string; count: number }[] {
    return this.localGroups(includeSamples).map((g) => ({ collection: g.collection, count: g.items.length }));
  }

  private localGroups(includeSamples: boolean) {
    const legacy = this.readLegacy();
    if (!legacy) return [];
    return MIGRATABLE.map((key) => {
      const seedById = new Map((SEEDS[key] ?? []).map((x) => [x.id, JSON.stringify(x)]));
      const raw = legacy[key];
      const items = (Array.isArray(raw) ? (raw as { id: string }[]) : []).filter(
        (x) => x && x.id && (includeSamples || seedById.get(x.id) !== JSON.stringify(x))
      );
      return { key, collection: COLLECTIONS[key], items };
    }).filter((g) => g.items.length > 0);
  }

  public async uploadLocalRecords(includeSamples = false): Promise<number> {
    if (!this.session) throw new Error('Sign in first.');
    const groups = this.localGroups(includeSamples);
    const owner = this.ownership();
    let count = 0;
    let batch = writeBatch(db);
    let inBatch = 0;
    for (const g of groups) {
      for (const item of g.items) {
        const data = SCOPED.includes(g.key) || g.key === 'documents' ? { ...owner, ...item } : item;
        batch.set(doc(db, g.collection, item.id), toFirestore(data) as Record<string, unknown>, { merge: true });
        count++;
        if (++inBatch >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          inBatch = 0;
        }
      }
    }
    if (inBatch > 0) await batch.commit();
    try {
      localStorage.setItem(`${LEGACY_STORAGE_KEY}_uploaded`, localStorage.getItem(LEGACY_STORAGE_KEY) || '');
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage blocked: the upload itself already succeeded
    }
    this.logAudit({
      userId: this.session.uid,
      userEmail: this.session.email,
      action: 'create',
      entityType: 'user',
      entityId: this.session.uid,
      entityTitle: 'Local data upload',
      details: `Uploaded ${count} record(s) saved in this browser to Cloud Firestore`,
    });
    return count;
  }

  // --- Audit Logging ---
  public logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) {
    const log: AuditLogEntry = {
      ...entry,
      userId: this.session?.uid || entry.userId,
      userEmail: this.session?.email || entry.userEmail,
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: now(),
    };
    if (!this.session) return; // Nothing is recorded while signed out
    this.s.auditLogs.unshift(log);
    this.commit();
    this.write('audit_logs', log.id, log);
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
    this.write('clients', client.id, client);
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
    this.write('companies', company.id, company);
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
    this.write('branches', branch.id, branch);
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
    this.write('sites', site.id, site);
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
    this.write('leads', lead.id, lead);
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
    this.write('proposals', proposal.id, proposal);
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
    this.write('contracts', contract.id, contract);
    return contract;
  }

  /**
   * Generates recurring visit schedule for an active contract.
   * Creates service jobs spaced according to the contract's frequency across its term.
   */
  public generateVisitScheduleForContract(
    contractId: string,
    technician?: { uid: string; name: string },
    userEmail = 'admin'
  ): ServiceJob[] {
    const leadPcoName = technician?.name || 'Unassigned';
    const contract = this.getContractById(contractId);
    if (!contract) throw new Error('Contract not found');

    const startDate = new Date(contract.startDate);
    const endDate = new Date(contract.endDate);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid contract start or end date');
    }

    // Determine interval days based on service frequency
    let stepDays = 30; // default monthly
    switch (contract.frequency) {
      case 'weekly':
        stepDays = 7;
        break;
      case 'fortnightly':
        stepDays = 14;
        break;
      case 'monthly':
        stepDays = 30;
        break;
      case 'bi_monthly':
        stepDays = 60;
        break;
      case 'quarterly':
        stepDays = 90;
        break;
      case 'one_off':
        stepDays = 0;
        break;
      default:
        stepDays = 30;
    }

    const createdJobs: ServiceJob[] = [];
    const customer =
      contract.customerType === 'company'
        ? this.getCompanyById(contract.customerId)
        : this.getClientById(contract.customerId);
    const sites = this.getSites(contract.customerId, contract.branchId);
    const site = sites[0];

    const siteId = site?.id || 'SITE-01';
    const siteName = site?.siteName || `${contract.customerName} Facility`;
    const siteAddress = site?.addressLine1 || (customer && 'headOfficeAddress' in customer ? customer.headOfficeAddress : (customer && 'residentialAddress' in customer ? customer.residentialAddress : 'Karachi Facility'));

    let curDate = new Date(startDate.getTime());
    let jobIdx = 1;

    while (curDate <= endDate && (stepDays > 0 || jobIdx === 1)) {
      const scheduledDateStr = curDate.toISOString().split('T')[0];
      const jobId = `JOB-${new Date().getFullYear()}-${String(this.s.jobs.length + 1).padStart(4, '0')}`;

      const job: ServiceJob = {
        id: jobId,
        contractId: contract.id,
        proposalId: contract.proposalId,
        customerType: contract.customerType,
        customerId: contract.customerId,
        customerName: contract.customerName,
        branchId: contract.branchId,
        branchName: contract.branchName,
        siteId,
        siteName,
        siteAddress,
        serviceType: contract.serviceScope,
        targetPests: ['cockroaches', 'rodents_rats'],
        scheduledDate: scheduledDateStr,
        timeSlot: 'morning',
        assignedTechnicianIds: technician ? [technician.uid] : [],
        assignedTechnicianNames: technician ? [leadPcoName] : [],
        leadPcoId: technician?.uid || '',
        leadPcoName,
        status: 'scheduled',
        checklists: [
          { id: 'c1', taskDescription: 'Conduct preliminary perimeter inspection & harbor check', isCompleted: false },
          { id: 'c2', taskDescription: 'Calibrated application of target IPM formulations', isCompleted: false },
          { id: 'c3', taskDescription: 'Post-treatment sanitation and site sign-off with customer', isCompleted: false },
        ],
        chemicalsUsed: [
          {
            id: 'chem_01',
            chemicalName: 'Maxforce FC Magnum Roach Gel',
            activeIngredient: 'Fipronil 0.05%',
            dosageRate: '1-2 spots per sq meter',
            quantityUsed: 30,
            unit: 'grams',
            batchNumber: 'BAY-2026-PAK',
            targetPest: 'cockroaches',
            applicationMethod: 'gel_baiting',
          },
        ],
        photoEvidence: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.saveJob(job, userEmail);
      createdJobs.push(job);
      jobIdx++;

      if (stepDays === 0) break;
      curDate = new Date(curDate.getTime() + stepDays * 24 * 60 * 60 * 1000);
    }

    contract.totalJobsScheduled = (contract.totalJobsScheduled || 0) + createdJobs.length;
    this.saveContract(contract, userEmail);

    this.audit(
      userEmail,
      'create',
      'contract',
      contract.id,
      contract.customerName,
      `Generated ${createdJobs.length} visit schedule jobs across contract term`
    );

    return createdJobs;
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

  public getInvoiceForJob(jobId: string): Invoice | undefined {
    return this.s.invoices.find((i) => i.jobId === jobId);
  }

  public saveJob(job: ServiceJob, userEmail = 'admin'): ServiceJob {
    const created = this.upsert(this.s.jobs, job);
    this.audit(userEmail, created ? 'create' : 'update', 'job', job.id, job.serviceType,
      created ? `Scheduled service job ${job.id} for ${job.customerName}` : `Updated job ${job.id} status to ${job.status}`);
    this.write('service_jobs', job.id, job);
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
    this.write('invoices', invoice.id, invoice);
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
    this.write('payments', payment.id, payment);
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
    this.write('tax_rules', rule.id, rule);
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
    this.write('documents', document.id, document);
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
    this.write('documents', id, { removed: true, removedAt: now() });
  }

  public getDocumentPacks(): DocumentPack[] {
    return [...this.s.documentPacks];
  }

  public saveDocumentPack(pack: DocumentPack) {
    this.upsert(this.s.documentPacks, pack, false);
    this.commit();
    this.write('document_packs', pack.id, pack);
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
    Object.assign(log, this.ownership());
    this.s.outreachLogs.unshift(log);
    this.commit();
    this.write('outreach_logs', log.id, log);
  }
}

export const dataService = new DataService();
