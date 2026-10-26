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
import {
  accessLevel,
  canAccessModule,
  DEFAULT_ROLES,
  getRole,
  seesAllRecords,
  setRoleDefinitions,
  type ModuleKey,
  type RoleDefinition,
} from '../lib/permissions';
import type {
  IndividualClient,
  CompanyMaster,
  CompanyBranch,
  SiteAddress,
} from '../types/customer';
import type { ActivityChannel, ContactOutcome, InspectionAssessment, Lead, LeadActivity, LeadBranch, LeadContact, LeadStage, MeetingFollowUp, PestType, RiskFinding, SiteInspection } from '../types/crm';
import type { Proposal, ProposalRevision } from '../types/proposal';
import type { Contract, PhotoEvidence, ServiceJob } from '../types/operations';
import type { Complaint } from '../types/complaints';
import type { Approval } from '../types/approvals';
import type { Invoice, PaymentReceipt, TaxRuleConfig } from '../types/finance';
import type { AuditLogEntry, DataScope, RecordOwnership, Team, UserProfile, UserRole } from '../types';
import type { DocumentOwner, DocumentPack, OutreachLog, PortalDocument } from '../types/document';
import { formatDate, generatePermanentId, normalizePakistaniPhone } from '../lib/formatters';
import {
  assertCanCreateProposal,
  assertStageTransition,
  contactsOf,
  outcomeLabel,
  StageTransitionError,
  stageMeta,
  stageOf,
  syncLeadFields,
} from '../lib/leadWorkflow';
import { deleteFromCloudinary } from '../lib/cloudinary';
import {
  clientInfoFrom,
  documentLink,
  recordLink,
  resolveFolderFrom,
  type FolderCollection,
  type FolderLink,
  type FolderLookups,
} from '../lib/folderResolver';
import {
  folderMeta,
  moveFolderPathToClient,
  type ClientSubfolder,
  type CompanySubfolder,
  type UploadScope,
} from '../lib/folders';
import type { FileCategory, FolderMeta } from '../types/folders';
import type { Device, MonitoringRecord } from '../types/devices';
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
  devices: Device[];
  monitoringRecords: MonitoringRecord[];
  users: UserProfile[];
  teams: Team[];
  roles: RoleDefinition[];
  complaints: Complaint[];
  approvals: Approval[];
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
  devices: 'devices',
  monitoringRecords: 'monitoring_records',
  users: 'users',
  teams: 'teams',
  roles: 'roles',
  complaints: 'complaints',
  approvals: 'approvals',
};

/** Document owner kinds that are client files; 'library' is the Company (IKPM) area (mirrors firestore.rules). */
const CLIENT_OWNER_KINDS = ['company', 'client', 'branch', 'lead', 'proposal', 'job'];

/** Folder fields (see src/types/folders.ts). */
const FOLDER_KEYS: (keyof FolderMeta)[] = ['ownerScope', 'clientId', 'clientType', 'branchId', 'folderPath', 'fileCategory'];

/** Business records that are scoped to their owner / team. */
const SCOPED: StateKey[] = ['companies', 'branches', 'clients', 'sites', 'leads', 'proposals', 'contracts', 'jobs', 'outreachLogs'];

/** Everything except staff/teams/roles, which are loaded for every signed-in person. */
const BUSINESS_KEYS: StateKey[] = [
  'companies', 'branches', 'clients', 'sites', 'leads', 'proposals', 'contracts', 'jobs',
  'invoices', 'payments', 'taxRules', 'auditLogs', 'documents', 'documentPacks', 'outreachLogs',
  'devices', 'monitoringRecords', 'complaints', 'approvals',
];

/** Module that grants read access to each business collection (mirrors firestore.rules). */
const MODULE_FOR: Partial<Record<StateKey, ModuleKey>> = {
  companies: 'customers',
  branches: 'customers',
  clients: 'customers',
  sites: 'customers',
  leads: 'crm',
  proposals: 'proposals',
  contracts: 'contracts',
  jobs: 'jobs',
  invoices: 'invoices',
  payments: 'invoices',
  auditLogs: 'settings',
  complaints: 'complaints',
  approvals: 'approvals',
};

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
  devices: [],
  monitoringRecords: [],
  users: [],
  teams: [],
  roles: [...DEFAULT_ROLES],
  complaints: [],
  approvals: [],
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
  /** Business-data subscriptions; reopened when the person's role permissions change. */
  private scopedUnsubs: Unsubscribe[] = [];
  private accessSignature = '';
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
    this.closeScoped();
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
    // Staff, teams and role definitions are needed by everyone and decide what else to load
    (['users', 'teams', 'roles'] as StateKey[]).forEach((key) => this.listen(key, `${key}#0`, collection(db, COLLECTIONS[key]), this.unsubs));
    this.openScoped();
    this.commit();
  }

  private closeScoped() {
    this.scopedUnsubs.forEach((u) => u());
    this.scopedUnsubs = [];
    BUSINESS_KEYS.forEach((k) => this.partials.delete(k));
  }

  /** (Re)opens business-data subscriptions for the current role's module access. */
  private openScoped() {
    const se = this.session;
    if (!se) return;
    const role = getRole(se.role);
    this.accessSignature = JSON.stringify(role?.modules ?? {});
    BUSINESS_KEYS.forEach((key) => {
      this.queriesFor(key, se).forEach((q, i) => this.listen(key, `${key}#${i}`, q, this.scopedUnsubs));
    });
  }

  /** Role documents changed: refresh the registry and reload data if this person's access changed. */
  private onRolesUpdated() {
    setRoleDefinitions(this.s.roles);
    const se = this.session;
    if (!se) return;
    if (se.role === 'super_admin') this.backfillRoleModules();
    const sig = JSON.stringify(getRole(se.role)?.modules ?? {});
    if (sig !== this.accessSignature) {
      this.closeScoped();
      BUSINESS_KEYS.forEach((k) => this.rebuild(k));
      this.openScoped();
    }
  }

  /**
   * Built-in roles saved before a module existed don't mention it, and firestore.rules treats a
   * missing module as "none". The super admin's session fills in the default level once.
   */
  private backfillRoleModules() {
    const cloud = new Map<string, Record<string, unknown>>();
    this.partials.get('roles')?.forEach((docs) => docs.forEach((v, id) => cloud.set(id, v as Record<string, unknown>)));
    DEFAULT_ROLES.filter((r) => r.id !== 'super_admin').forEach((def) => {
      const saved = cloud.get(def.id);
      if (!saved) {
        // Role was added after initial seeding (e.g. team_leader replacing technician) — create it now
        this.write('roles', def.id, { ...def, createdAt: now(), updatedAt: now() });
        return;
      }
      const savedModules = (saved.modules ?? {}) as Record<string, unknown>;
      const missing = Object.fromEntries(Object.entries(def.modules).filter(([k]) => !(k in savedModules)));
      if (Object.keys(missing).length) this.write('roles', def.id, { modules: missing });
    });
  }

  /** Queries this person may run for a collection; each must be provable by firestore.rules. */
  private queriesFor(key: StateKey, se: DataSession): Query[] {
    const col = collection(db, COLLECTIONS[key]);
    const all = seesAllRecords(se.role, se.dataScope);
    const can = (m: ModuleKey) => canAccessModule(se.role, m);
    const ownAndTeam = (): Query[] => {
      const qs: Query[] = [query(col, where('ownerUid', '==', se.uid))];
      if (se.dataScope === 'team' && se.teamId) qs.push(query(col, where('teamId', '==', se.teamId)));
      return qs;
    };

    // Shared configuration: readable by every active person
    if (key === 'taxRules' || key === 'documentPacks') return [col];

    if (key === 'auditLogs') return can('settings') ? [query(col, orderBy('timestamp', 'desc'), limit(500))] : [];

    // Finance records aren't owner-scoped
    if (key === 'invoices' || key === 'payments') return can('invoices') ? [col] : [];

    if (key === 'jobs') {
      const qs: Query[] = [];
      if (can('jobs')) qs.push(...(all ? [col] : ownAndTeam()));
      // Field app: jobs assigned to this person
      if (can('pco') && !(can('jobs') && all)) qs.push(query(col, where('assignedTechnicianIds', 'array-contains', se.uid)));
      return qs;
    }

    if (key === 'documents') {
      // Company (IKPM) files (owner.kind 'library') and client files are read through separate
      // queries, so firestore.rules can prove each one (company files need company_files access).
      const clientFiles = (q: Query) => query(q, where('owner.kind', 'in', CLIENT_OWNER_KINDS));
      const qs: Query[] = can('files')
        ? (all ? [clientFiles(col)] : ownAndTeam().map(clientFiles))
        : [clientFiles(query(col, where('ownerUid', '==', se.uid)))];
      if (can('company_files')) qs.push(query(col, where('owner.kind', '==', 'library')));
      return qs;
    }

    if (key === 'leads') {
      const qs: Query[] = can('crm') ? (all ? [col] : ownAndTeam()) : [];
      // Inspectors see the leads they were assigned to inspect
      if (can('inspections') && !(can('crm') && all)) qs.push(query(col, where('inspectorIds', 'array-contains', se.uid)));
      return qs;
    }

    // Devices and monitoring records: customer viewers and dispatch
    if (key === 'devices' || key === 'monitoringRecords') return can('customers') || can('jobs') || can('pco') ? [col] : [];

    if (key === 'outreachLogs') {
      if (!(can('crm') || can('proposals') || can('documents'))) return [];
      return all ? [col] : ownAndTeam();
    }

    const module = MODULE_FOR[key];
    if (!module || accessLevel(se.role, module) === 'none') return [];
    return all ? [col] : ownAndTeam();
  }

  private listen(key: StateKey, queryKey: string, q: Query, bucket: Unsubscribe[]) {
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
        if (key === 'roles') this.onRolesUpdated();
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
    bucket.push(unsub);
  }

  private rebuild(key: StateKey) {
    const merged = new Map<string, unknown>();
    this.partials.get(key)?.forEach((docs) => docs.forEach((v, id) => merged.set(id, v)));
    let list = Array.from(merged.values()) as Record<string, unknown>[];
    list.sort((a, b) => recordTime(b).localeCompare(recordTime(a)));
    // Shared config keeps showing defaults until someone saves real values
    if (key === 'roles') {
      // Built-in roles always exist; cloud copies override them
      const byId = new Map(DEFAULT_ROLES.map((r) => [r.id, r as unknown as Record<string, unknown>]));
      list.forEach((r) => byId.set(String(r.id), { ...byId.get(String(r.id)), ...r }));
      list = Array.from(byId.values());
    } else if (list.length === 0 && (key === 'taxRules' || key === 'documentPacks')) {
      list = [...(SEEDS[key] as unknown as Record<string, unknown>[])];
    }
    (this.s as unknown as Record<StateKey, unknown[]>)[key] = list;
  }

  /** First super-admin login on an empty project: store the default tax rules & document packs. */
  private maybeSeedDefaults(key: StateKey, empty: boolean) {
    if (!empty || this.session?.role !== 'super_admin') return;
    if (key === 'roles') {
      // The rules read role documents, so the built-in roles must exist in Firestore
      DEFAULT_ROLES.filter((r) => r.id !== 'super_admin').forEach((r) => this.write('roles', r.id, { ...r, createdAt: now(), updatedAt: now() }));
      return;
    }
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
      // ...nor its folder (an edit built from an older copy must not unfile the record)
      const folder: FolderMeta = {};
      const prevFolder = prev as unknown as FolderMeta;
      const nextFolder = item as unknown as FolderMeta;
      FOLDER_KEYS.forEach((k) => {
        if (prevFolder[k] !== undefined && nextFolder[k] === undefined) (folder as Record<string, unknown>)[k] = prevFolder[k];
      });
      list[idx] = { ...item, ...folder, ...kept, ...(stamp ? { updatedAt: now() } : {}) };
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

  public getRoles(): RoleDefinition[] {
    return [...this.s.roles];
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

  /**
   * Saves a lead. A stage change must follow ALLOWED_TRANSITIONS (throws otherwise) and is
   * written to audit_logs with who, from, to and the reason.
   */
  public saveLead(lead: Lead, userEmail = 'admin', reason?: string): Lead {
    const prev = this.getLeadById(lead.id);
    const from = prev ? stageOf(prev) : undefined;
    const to = stageOf(lead);
    if (prev && from !== to) assertStageTransition(prev, lead.stage, lead);

    const dups = this.checkDuplicates(lead.phone, lead.email);
    if (dups.length > 0) {
      lead.duplicateWarning = dups.join(' | ');
    } else {
      delete lead.duplicateWarning;
    }

    const created = this.upsert(this.s.leads, lead);
    this.audit(userEmail, created ? 'create' : 'update', 'lead', lead.id, lead.title,
      created ? `Created new lead inquiry: ${lead.title}` : `Updated lead ${lead.title} stage to ${lead.stage}`);
    if (from && from !== to) {
      this.logAudit({
        userId: this.session?.uid || '',
        userEmail,
        action: 'status_change',
        entityType: 'lead',
        entityId: lead.id,
        entityTitle: lead.title,
        details: `Stage ${stageMeta(from).label} → ${stageMeta(to).label}${reason ? `. Reason: ${reason}` : ''}`,
        beforeData: { stage: prev!.stage },
        afterData: { stage: lead.stage, ...(reason ? { reason } : {}) },
      });
    }
    this.write('leads', lead.id, lead);
    return lead;
  }

  // --- Lead workflow (see src/lib/leadWorkflow.ts) ---

  /** Existing leads (and customers) with the same phone or email. */
  public findLeadDuplicates(phone: string, email?: string, excludeLeadId?: string): string[] {
    const p = normalizePakistaniPhone(phone);
    const e = email?.toLowerCase().trim();
    const hits = this.s.leads
      .filter((l) => l.id !== excludeLeadId)
      .filter((l) => contactsOf(l).some((c) => (p && normalizePakistaniPhone(c.phone) === p) || (e && c.email?.toLowerCase() === e)))
      .map((l) => `Matches existing lead ${l.title} (${l.id}, ${stageMeta(l.stage).label})`);
    return [...hits, ...this.checkDuplicates(phone, email)];
  }

  private activity(entry: Omit<LeadActivity, 'id' | 'at' | 'byName' | 'byUid'>): LeadActivity {
    return {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      at: now(),
      byUid: this.session?.uid,
      byName: this.session?.name || 'Staff',
      ...entry,
    };
  }

  private nextLeadId(): string {
    const year = new Date().getFullYear();
    const max = this.s.leads.reduce((m, l) => {
      const n = Number(l.id.match(/(\d+)$/)?.[1] || 0);
      return l.id.includes(String(year)) ? Math.max(m, n) : m;
    }, 0);
    return `LD-${year}-${String(max + 1).padStart(4, '0')}`;
  }

  /** Creates a lead from the new-lead form or an import row. */
  public createLead(data: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>, userEmail = 'admin'): Lead {
    const lead = syncLeadFields({
      ...data,
      id: this.nextLeadId(),
      stage: 'new',
      activities: [this.activity({ kind: 'system', channel: 'note', note: 'Lead created' })],
      assignedToUserId: data.assignedToUserId || this.session?.uid,
      assignedToName: data.assignedToName || this.session?.name,
      createdAt: now(),
      createdBy: this.session?.name || userEmail,
      updatedAt: now(),
    } as Lead);
    return this.saveLead(lead, userEmail);
  }

  /** Imports many leads at once (Excel). Returns how many were created. */
  public importLeads(rows: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[], userEmail = 'admin'): number {
    rows.forEach((r) => {
      const lead = this.createLead({ ...r, activities: undefined }, userEmail);
      lead.activities = [this.activity({ kind: 'system', channel: 'note', note: 'Imported from Excel' })];
      this.write('leads', lead.id, { activities: lead.activities });
    });
    return rows.length;
  }

  /** Records a call / WhatsApp / meeting and moves the lead according to the outcome. */
  public logLeadContact(
    leadId: string,
    entry: { channel: ActivityChannel; outcome?: ContactOutcome; note?: string; contactId?: string; nextFollowUp?: string; lostReason?: string },
    userEmail = 'admin'
  ): Lead | undefined {
    const lead = this.getLeadById(leadId);
    if (!lead) return undefined;
    const contact = contactsOf(lead).find((c) => c.id === entry.contactId);
    const act = this.activity({ kind: 'contact', channel: entry.channel, outcome: entry.outcome, note: entry.note, contactId: entry.contactId, contactName: contact?.name, nextFollowUp: entry.nextFollowUp });

    const stage = stageOf(lead);
    if (stage === 'won' || stage === 'lost') throw new StageTransitionError(`Contacts can't be logged on a ${stageMeta(stage).label} lead. Reopen it first.`);
    let nextStage: LeadStage = lead.stage;
    if (entry.outcome === 'engaged' && ['new', 'contacted'].includes(stage)) nextStage = 'engaged';
    else if (entry.outcome === 'interested' && stage === 'new') nextStage = 'contacted';
    else if (entry.outcome === 'not_interested' || entry.outcome === 'wrong_contact') nextStage = 'lost';
    else if (stage === 'new' && entry.channel !== 'note') nextStage = 'contacted';

    const why = entry.outcome ? outcomeLabel(entry.outcome) : `Logged ${entry.channel}`;
    // A first call that ends "engaged" passes through Contacted (new → contacted → engaged).
    if (stage === 'new' && nextStage === 'engaged') {
      this.saveLead({ ...lead, stage: 'contacted' }, userEmail, why);
    }
    const current = this.getLeadById(leadId) ?? lead;

    // If the client replied (any outcome except no_response / note), clear 'waiting for reply'
    const contactResolvesStuck = entry.outcome && entry.outcome !== 'no_response' && current.stuckAt === 'waiting_client_reply';
    const updated: Lead = {
      ...current,
      stage: nextStage,
      contactOutcome: entry.outcome ?? lead.contactOutcome,
      lastContactedAt: entry.channel === 'note' ? lead.lastContactedAt : act.at,
      nextFollowUp: entry.nextFollowUp || (nextStage === 'lost' ? undefined : lead.nextFollowUp),
      activities: [act, ...(lead.activities ?? [])],
      ...(nextStage === 'lost' && lead.stage !== 'lost'
        ? { lostAt: now(), lostAtStage: lead.stage, lostReason: entry.lostReason || outcomeLabel(entry.outcome) }
        : {}),
      ...(contactResolvesStuck ? { stuckAt: undefined, stuckAtDate: undefined } : {}),
    };
    return this.saveLead(updated, userEmail, nextStage === 'lost' ? entry.lostReason || why : why);
  }

  /** Engaged → proposal without a site inspection. Needs a typed reason (kept on the lead, its timeline and audit_logs). */
  public skipLeadInspection(leadId: string, reason: string, userEmail = 'admin'): Lead {
    const lead = this.getLeadById(leadId);
    if (!lead) throw new Error('Lead not found');
    const why = reason?.trim();
    if (!why) throw new StageTransitionError('Give a reason for skipping the inspection.');
    if (stageOf(lead) !== 'engaged') throw new StageTransitionError(`The inspection can only be skipped while the lead is Engaged (now ${stageMeta(lead.stage).label}).`);
    if (lead.proposalId) throw new StageTransitionError(`Lead ${lead.id} already has proposal ${lead.proposalId}.`);
    const updated: Lead = {
      ...lead,
      inspectionSkipped: { reason: why, at: now(), by: this.session?.name || userEmail },
      activities: [this.activity({ kind: 'stage', channel: 'note', note: `Inspection skipped: ${why}` }), ...(lead.activities ?? [])],
    };
    this.saveLead(updated, userEmail);
    this.logAudit({
      userId: this.session?.uid || '',
      userEmail,
      action: 'status_change',
      entityType: 'lead',
      entityId: lead.id,
      entityTitle: lead.title,
      details: `Inspection skipped (Engaged → Proposal allowed). Reason: ${why}`,
      afterData: { inspectionSkipped: true, reason: why },
    });
    return updated;
  }

  /** Moves a lead to any stage manually (with a timeline entry). */
  public setLeadStage(leadId: string, stage: LeadStage, note?: string, userEmail = 'admin'): Lead | undefined {
    const lead = this.getLeadById(leadId);
    if (!lead) return undefined;
    assertStageTransition(lead, stage, lead);
    if (stageOf({ stage }) === 'lost' && !note?.trim()) throw new StageTransitionError('Give a reason for marking the lead as lost.');
    const updated: Lead = {
      ...lead,
      stage,
      activities: [this.activity({ kind: 'stage', channel: 'note', note: `Moved to ${stageMeta(stage).label}${note ? `: ${note}` : ''}` }), ...(lead.activities ?? [])],
      ...(stage === 'lost' ? { lostAt: now(), lostAtStage: lead.stage, lostReason: note || lead.lostReason } : {}),
      ...(stage === 'won' ? { wonAt: now() } : {}),
    };
    return this.saveLead(updated, userEmail, note);
  }

  public scheduleLeadInspection(
    leadId: string,
    plan: {
      date: string;
      scheduledTime?: string;
      timeSlot: 'morning' | 'afternoon' | 'evening';
      teamId?: string;
      inspectorIds: string[];
      teamLeaderId?: string;
      meetingAddress?: string;
      instructions?: string;
      meetingType?: import('../types/crm').MeetingType;
    },
    userEmail = 'admin'
  ): Lead | undefined {
    const lead = this.getLeadById(leadId);
    if (!lead) return undefined;
    const stage = stageOf(lead);
    const _isNegotiationMeeting = plan.meetingType === 'negotiation' || plan.meetingType === 'renewal';
    // Meetings can be scheduled at any stage — client may request a meeting at any point in the pipeline.
    // Only block if lost (must reopen first).
    if (stage === 'lost') {
      throw new StageTransitionError('Reopen the lead before scheduling a meeting.');
    }
    const team = this.s.teams.find((t) => t.id === plan.teamId);
    const people = plan.inspectorIds.map((uid) => this.s.users.find((u) => u.uid === uid)).filter(Boolean) as UserProfile[];
    const leader = plan.teamLeaderId ? this.s.users.find((u) => u.uid === plan.teamLeaderId) : undefined;
    const inspection: InspectionAssessment = {
      ...(lead.inspection ?? {
        pestTypesFound: lead.pestIssues ?? [],
        infestationSeverity: 'moderate',
        areaSqFt: 0,
        criticalFindings: '',
        recommendedTreatment: '',
        photoEvidenceUrls: [],
      }),
      id: lead.inspection?.id || `INSP-${Date.now().toString(36).toUpperCase()}`,
      leadId,
      scheduledDate: plan.date,
      scheduledTime: plan.scheduledTime || undefined,
      timeSlot: plan.timeSlot,
      teamId: team?.id,
      teamName: team?.name,
      assignedTeamLeaderId: leader?.uid,
      assignedTeamLeaderName: leader?.displayName,
      inspectorIds: people.map((p) => p.uid),
      inspectorNames: people.map((p) => p.displayName),
      inspectorId: leader?.uid || people[0]?.uid || '',
      inspectorName: leader?.displayName || people.map((p) => p.displayName).join(', ') || team?.name || 'Unassigned',
      instructions: plan.instructions,
      meetingAddress: plan.meetingAddress,
      meetingType: plan.meetingType || lead.inspection?.meetingType || 'first_meeting',
      status: 'scheduled',
    } as InspectionAssessment;
    const rescheduled = lead.inspection?.status === 'scheduled';
    const meetingLabel = plan.meetingType === 'negotiation' ? 'Negotiation meeting' : plan.meetingType === 'renewal' ? 'Renewal meeting' : 'Meeting';
    // Advance to meeting_scheduled only from early stages; never regress a lead that is already further along.
    const earlyStage = stage === 'new' || stage === 'contacted' || stage === 'engaged';
    const nextStage = earlyStage ? 'meeting_scheduled' : stage;
    const updated: Lead = {
      ...lead,
      stage: nextStage,
      inspection,
      inspectorIds: [leader?.uid, ...people.map((p) => p.uid)].filter((v, i, a) => v && a.indexOf(v) === i) as string[],
      assignedTeamLeaderId: leader?.uid,
      assignedTeamLeaderName: leader?.displayName,
      activities: [
        this.activity({
          kind: 'inspection',
          channel: 'visit',
          note: `${rescheduled ? `${meetingLabel} rescheduled` : `${meetingLabel} scheduled`} for ${formatDate(plan.date)} (${plan.timeSlot})${team ? ` · ${team.name}` : ''}${leader ? ` · Leader: ${leader.displayName}` : people.length ? ` · ${inspection.inspectorName}` : ''}${plan.meetingAddress ? ` @ ${plan.meetingAddress}` : ''}`,
        }),
        ...(lead.activities ?? []),
      ],
    };
    return this.saveLead(updated, userEmail, `${meetingLabel} ${rescheduled ? 'rescheduled' : 'scheduled'} for ${plan.date}`);
  }

  public recordInspectionFindings(
    leadId: string,
    findings: Pick<InspectionAssessment, 'pestTypesFound' | 'infestationSeverity' | 'areaSqFt' | 'criticalFindings' | 'recommendedTreatment' | 'photos'>
      & Partial<Pick<InspectionAssessment, 'findings' | 'reportTitle' | 'siteName' | 'observedBy' | 'teamLeaderNotes' | 'clientRequest' | 'meetingReportNote' | 'meetingFollowUps' | 'tlStatus'>>,
    userEmail = 'admin',
    branches?: LeadBranch[]
  ): Lead | undefined {
    const lead = this.getLeadById(leadId);
    if (!lead) return undefined;
    const stage = stageOf(lead);
    if (stage !== 'meeting_scheduled' && stage !== 'meeting_done') {
      throw new StageTransitionError(
        stage === 'engaged' || stage === 'new' || stage === 'contacted'
          ? 'Schedule the meeting / inspection before recording findings.'
          : `Meeting / Inspection findings cannot be changed while the lead is ${stageMeta(stage).label}.`
      );
    }
    const base = lead.inspection;
    const inspection: InspectionAssessment = {
      id: base?.id || `INSP-${Date.now().toString(36).toUpperCase()}`,
      leadId,
      scheduledDate: base?.scheduledDate || now().slice(0, 10),
      inspectorId: base?.inspectorId || this.session?.uid || '',
      inspectorName: base?.inspectorName || this.session?.name || '',
      ...base,
      ...findings,
      photos: findings.photos ?? base?.photos ?? [],
      // Older screens read URLs only: include the finding photos too
      photoEvidenceUrls: [
        ...(findings.photos ?? base?.photos ?? []).map((p) => p.imageUrl),
        ...(findings.findings ?? []).flatMap((f) => (f.photo ? [f.photo.imageUrl] : [])),
      ],
      completedDate: now().slice(0, 10),
      findingsBy: this.session?.name,
      status: 'completed',
    };
    const mergedBranches = branches?.length
      ? [...(lead.branches ?? []), ...branches.filter((b) => !(lead.branches ?? []).some((eb) => eb.name.toLowerCase() === b.name.toLowerCase()))]
      : lead.branches;
    const updated: Lead = {
      ...lead,
      stage: 'meeting_done',
      inspection,
      pestIssues: findings.pestTypesFound,
      branches: mergedBranches,
      activities: [
        this.activity({ kind: 'inspection', channel: 'visit', note: `Meeting / Inspection findings recorded (${findings.infestationSeverity} infestation, ${findings.areaSqFt || 0} sq ft${findings.findings?.length ? `, ${findings.findings.length} risk finding${findings.findings.length > 1 ? 's' : ''}` : ''}${findings.photos?.length ? `, ${findings.photos.length} photo${findings.photos.length > 1 ? 's' : ''}` : ''}${findings.meetingFollowUps?.length ? ` · Client asked for: ${findings.meetingFollowUps.map((f) => f.type.replace(/_/g, ' ')).join(', ')}` : findings.clientRequest ? ` · Client asked for: ${findings.clientRequest.replace(/_/g, ' ')}` : ''}${branches?.length ? `, ${branches.length} branch/site${branches.length > 1 ? 's' : ''} added` : ''})` }),
        ...(lead.activities ?? []),
      ],
    };
    return this.saveLead(updated, userEmail, 'Meeting / Inspection findings recorded');
  }

  /** Saves the meeting report from the Team Leader. Advances to meeting_done unless it's a negotiation/renewal meeting. */
  public recordMeetingReport(
    leadId: string,
    report: Partial<Pick<InspectionAssessment,
      | 'teamLeaderNotes' | 'clientRequest' | 'meetingFollowUps' | 'meetingReportNote' | 'tlStatus'
      | 'reportTitle' | 'siteName' | 'observedBy' | 'meetingType' | 'inspectionHandling'
      | 'schedulingNote' | 'preferredInspectionDate' | 'assignedTeamLeaderId' | 'assignedTeamLeaderName'
      | 'negotiationTermsNote'
      // Inline inspection fields (when inspectionHandling === 'done_inline')
      | 'pestTypesFound' | 'infestationSeverity' | 'areaSqFt' | 'criticalFindings' | 'recommendedTreatment'
      | 'photos' | 'photoEvidenceUrls'
    >>,
    userEmail = 'admin',
    branches?: LeadBranch[]
  ): Lead | undefined {
    const lead = this.getLeadById(leadId);
    if (!lead) return undefined;
    const stage = stageOf(lead);
    const isNegoRenewal = report.meetingType === 'negotiation' || report.meetingType === 'renewal'
      || lead.inspection?.meetingType === 'negotiation' || lead.inspection?.meetingType === 'renewal';
    // Meeting reports can be submitted at any stage — a meeting may be added at any point in the pipeline.
    if (stage === 'lost') {
      throw new StageTransitionError('Reopen the lead before submitting a meeting report.');
    }
    if (!lead.inspection) {
      throw new StageTransitionError('No meeting is scheduled for this lead. Schedule a meeting first.');
    }
    const base = lead.inspection;
    const isDoneInline = report.inspectionHandling === 'done_inline';
    const inspection: InspectionAssessment = {
      // Spread base first so explicit assignments below take precedence
      ...(base as InspectionAssessment),
      ...report,
      id: base?.id || `INSP-${Date.now().toString(36).toUpperCase()}`,
      leadId,
      scheduledDate: base?.scheduledDate || now().slice(0, 10),
      inspectorId: base?.inspectorId || this.session?.uid || '',
      inspectorName: base?.inspectorName || this.session?.name || '',
      // Only keep pest findings when the inspection was done inline; clear stale data otherwise.
      // Use report.* values (from the form) when set; fall back to base only if the field wasn't submitted.
      pestTypesFound: isDoneInline ? (report.pestTypesFound ?? base?.pestTypesFound ?? []) : [],
      infestationSeverity: isDoneInline ? (report.infestationSeverity ?? base?.infestationSeverity ?? 'moderate') : 'moderate',
      areaSqFt: isDoneInline ? (report.areaSqFt ?? base?.areaSqFt ?? 0) : 0,
      criticalFindings: isDoneInline ? (report.criticalFindings ?? base?.criticalFindings ?? '') : '',
      recommendedTreatment: isDoneInline ? (report.recommendedTreatment ?? base?.recommendedTreatment ?? '') : '',
      photoEvidenceUrls: isDoneInline ? (report.photoEvidenceUrls ?? base?.photoEvidenceUrls ?? []) : (base?.photoEvidenceUrls ?? []),
      photos: isDoneInline ? (report.photos ?? base?.photos) : base?.photos,
      // When switching away from done_inline, clear pest fields so the proposal gate isn't tripped by stale data
      ...(report.inspectionHandling && !isDoneInline ? { pestTypesFound: [], criticalFindings: '', recommendedTreatment: '' } : {}),
      completedDate: base?.completedDate || now().slice(0, 10),
      findingsBy: base?.findingsBy || this.session?.name,
      status: 'completed',
    };
    const mergedBranches = branches?.length
      ? [...(lead.branches ?? []), ...branches.filter((b) => !(lead.branches ?? []).some((eb) => eb.name.toLowerCase() === b.name.toLowerCase()))]
      : lead.branches;
    const fuNote = report.meetingFollowUps?.length
      ? ` · Client asked for: ${report.meetingFollowUps.map((f: MeetingFollowUp) => f.type.replace(/_/g, ' ')).join(', ')}`
      : report.clientRequest ? ` · Client asked for: ${report.clientRequest.replace(/_/g, ' ')}` : '';
    const tlNote = report.tlStatus === 'send_proposal' ? ' · Ready to send proposal' : report.tlStatus === 'waiting' ? ' · Hold — need more steps' : '';
    const meetingTypeLabel = isNegoRenewal ? (report.meetingType === 'renewal' || lead.inspection?.meetingType === 'renewal' ? 'Renewal meeting' : 'Negotiation meeting') : 'Meeting';
    // Only advance to meeting_done from early stages; later stages (proposal_sent, won, etc.) keep their current stage.
    const earlyForReport = stage === 'meeting_scheduled' || stage === 'engaged' || stage === 'contacted' || stage === 'new';
    const nextStage = (isNegoRenewal || !earlyForReport) ? stage : 'meeting_done';
    // Clear stuckAt reasons that are resolved by completing the meeting
    const stuckNowResolved = lead.stuckAt === 'meeting_pending' || lead.stuckAt === 'waiting_client_reply';
    const updated: Lead = {
      ...lead,
      stage: nextStage,
      inspection,
      branches: mergedBranches,
      ...(stuckNowResolved ? { stuckAt: undefined, stuckAtDate: undefined } : {}),
      activities: [
        this.activity({ kind: 'inspection', channel: 'visit', note: `${meetingTypeLabel} report submitted${fuNote}${tlNote}${branches?.length ? `, ${branches.length} site(s) added` : ''}` }),
        ...(lead.activities ?? []),
      ],
    };
    return this.saveLead(updated, userEmail, 'Meeting report submitted');
  }

  /** Schedules a separate technical site inspection after the client meeting. */
  public scheduleSiteInspection(
    leadId: string,
    plan: {
      scheduledDate: string;
      branchId?: string;
      branchName?: string;
      branchAddress?: string;
      assignedTechIds?: string[];
      assignedTechNames?: string[];
      teamLeaderId?: string;
      teamLeaderName?: string;
      notes?: string;
    },
    userEmail = 'admin'
  ): Lead | undefined {
    const lead = this.getLeadById(leadId);
    if (!lead) return undefined;
    const existing = lead.siteInspection;
    const siteInspection: SiteInspection = {
      id: existing?.id || `SI-${Date.now().toString(36).toUpperCase()}`,
      requestedAt: existing?.requestedAt || now(),
      requestedBy: existing?.requestedBy || this.session?.name || userEmail,
      ...existing,
      ...plan,
      status: 'scheduled',
    };
    const updated: Lead = {
      ...lead,
      siteInspection,
      activities: [
        this.activity({ kind: 'inspection', channel: 'visit', note: `Site inspection scheduled for ${formatDate(plan.scheduledDate)}${plan.branchName ? ` @ ${plan.branchName}` : ''}${plan.assignedTechNames?.length ? ` · Tech: ${plan.assignedTechNames.join(', ')}` : ''}` }),
        ...(lead.activities ?? []),
      ],
    };
    return this.saveLead(updated, userEmail, `Site inspection scheduled for ${plan.scheduledDate}`);
  }

  /** Records pest findings from a separate site inspection visit. */
  public recordSiteInspectionFindings(
    leadId: string,
    findings: {
      pestTypesFound: PestType[];
      infestationSeverity: 'low' | 'moderate' | 'high' | 'severe';
      areaSqFt?: number;
      criticalFindings?: string;
      recommendedTreatment?: string;
      photos?: import('../types/operations').SitePhoto[];
      findings?: RiskFinding[];
      reportTitle?: string;
      observedBy?: string;
      notes?: string;
    },
    userEmail = 'admin'
  ): Lead | undefined {
    const lead = this.getLeadById(leadId);
    if (!lead) return undefined;
    if (!lead.siteInspection) throw new StageTransitionError('No site inspection is scheduled for this lead.');
    const base = lead.siteInspection;
    const siteInspection: SiteInspection = {
      ...base,
      ...findings,
      photoEvidenceUrls: [
        ...(findings.photos ?? []).map((p) => p.imageUrl),
        ...(findings.findings ?? []).flatMap((f: RiskFinding) => f.photo ? [f.photo.imageUrl] : []),
      ],
      completedDate: now().slice(0, 10),
      status: 'completed',
    };
    const siteStuckResolved = lead.stuckAt === 'meeting_pending' || lead.stuckAt === 'waiting_client_reply';
    const updated: Lead = {
      ...lead,
      siteInspection,
      pestIssues: findings.pestTypesFound.length ? findings.pestTypesFound : lead.pestIssues,
      ...(siteStuckResolved ? { stuckAt: undefined, stuckAtDate: undefined } : {}),
      activities: [
        this.activity({ kind: 'inspection', channel: 'visit', note: `Site inspection findings submitted (${findings.infestationSeverity} infestation${findings.findings?.length ? `, ${findings.findings.length} risk finding(s)` : ''}${findings.photos?.length ? `, ${findings.photos.length} photo(s)` : ''})` }),
        ...(lead.activities ?? []),
      ],
    };
    return this.saveLead(updated, userEmail, 'Site inspection findings submitted');
  }

  /**
   * Sends company documents (e.g. company profile) to the client.
   * Logs a 'documents' activity and moves the lead to 'profile_sent'.
   */
  public sendLeadDocuments(leadId: string, note?: string, userEmail = 'admin'): Lead | undefined {
    const lead = this.getLeadById(leadId);
    if (!lead) return undefined;
    const stage = stageOf(lead);
    const allowedStages = ['new', 'contacted', 'engaged', 'meeting_scheduled', 'meeting_done'];
    const act = this.activity({
      kind: 'documents',
      channel: 'documents',
      note: note?.trim() || 'Company profile / documents sent to client',
    });
    const moveToProfileSent = allowedStages.includes(stage);
    // After sending docs: clear 'asked for profile' and replace with 'waiting for reply'
    const updated: Lead = {
      ...lead,
      stage: moveToProfileSent ? 'profile_sent' : lead.stage,
      activities: [act, ...(lead.activities ?? [])],
      stuckAt: 'waiting_client_reply',
      stuckAtDate: now().slice(0, 10),
    };
    return this.saveLead(updated, userEmail, 'Company documents sent');
  }

  /** Sets or clears the "stuck at" status on a lead. Pass undefined to clear. */
  public setLeadStuckAt(leadId: string, stuckAt: import('../types/crm').StuckAtReason | undefined, userEmail = 'admin'): Lead | undefined {
    const lead = this.getLeadById(leadId);
    if (!lead) return undefined;
    const updated: Lead = {
      ...lead,
      stuckAt,
      stuckAtDate: stuckAt ? now().slice(0, 10) : undefined,
      activities: [
        this.activity({ kind: 'system', channel: 'note', note: stuckAt ? `Stuck at: ${stuckAt.replace(/_/g, ' ')}` : 'Stuck status cleared' }),
        ...(lead.activities ?? []),
      ],
    };
    return this.saveLead(updated, userEmail);
  }

  private provinceFor(city: string): CompanyMaster['province'] {
    const c = city.toLowerCase();
    if (/lahore|faisalabad|multan|rawalpindi|gujranwala|sialkot|sargodha|bahawalpur/.test(c)) return /rawalpindi/.test(c) ? 'Punjab' : 'Punjab';
    if (/islamabad/.test(c)) return 'Islamabad_ICT';
    if (/peshawar|mardan|abbottabad|swat/.test(c)) return 'KPK';
    if (/quetta|gwadar/.test(c)) return 'Balochistan';
    return 'Sindh';
  }

  /**
   * Proposals need a customer account. Creates a prospect account (status "lead") from the lead's
   * company details and contacts, or reuses the one already linked. Returns the account id.
   */
  public ensureLeadCustomer(leadId: string, userEmail = 'admin'): { customerId: string; customerType: 'company' | 'individual' } {
    const lead = this.getLeadById(leadId);
    if (!lead) throw new Error('Lead not found');
    if (lead.existingCustomerId) return { customerId: lead.existingCustomerId, customerType: lead.customerType };

    const ts = now();
    const contacts = contactsOf(lead);
    const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
    const province = this.provinceFor(lead.city || '');
    let customerId: string;

    if (lead.customerType === 'individual') {
      customerId = generatePermanentId('CL', this.s.clients.length + 1);
      const client: IndividualClient = {
        id: customerId,
        type: 'individual',
        fullName: primary?.name || lead.title,
        primaryPhone: primary?.phone || lead.phone,
        email: primary?.email || lead.email,
        residentialAddress: lead.propertyAddress || lead.city,
        city: lead.city,
        area: lead.area,
        province,
        taxStatus: 'non_filer',
        status: 'lead',
        balance: 0,
        createdAt: ts,
        createdBy: this.session?.name || userEmail,
        updatedAt: ts,
      };
      this.saveClient(client, userEmail);
    } else {
      customerId = generatePermanentId('CO', this.s.companies.length + 1);
      const toContact = (c: LeadContact, isPrimary: boolean) => ({
        id: `cont_${c.id}_${Date.now().toString(36)}`,
        fullName: c.name,
        designation: c.designation,
        phone: c.phone,
        mobile: c.phone,
        email: c.email,
        isPrimary,
      });
      const company: CompanyMaster = {
        id: customerId,
        type: 'company',
        legalCompanyName: lead.companyName || lead.title,
        headOfficeAddress: lead.propertyAddress || lead.city,
        city: lead.city,
        province,
        website: lead.website,
        primaryContact: primary ? toContact(primary, true) : { id: 'cont_primary', fullName: lead.contactName, phone: lead.phone, mobile: lead.phone, email: lead.email, isPrimary: true },
        additionalContacts: contacts.filter((c) => c !== primary).map((c) => toContact(c, false)),
        industrySegment: 'other',
        billingPreference: 'centralized',
        taxStatus: 'active_filer',
        totalBranchesCount: 1,
        totalActiveContracts: 0,
        totalBalance: 0,
        status: 'lead',
        createdAt: ts,
        createdBy: this.session?.name || userEmail,
        updatedAt: ts,
      };
      this.saveCompany(company, userEmail);
    }

    this.saveLead({ ...lead, existingCustomerId: customerId }, userEmail);
    this.refileLeadRecords(lead.id, customerId, userEmail);
    return { customerId, customerType: lead.customerType };
  }

  /** Closes a lead as won and activates its customer account. */
  public markLeadWon(leadId: string, note?: string, userEmail = 'admin'): Lead | undefined {
    const lead = this.getLeadById(leadId);
    if (!lead) return undefined;
    // Check before creating/activating the customer account so nothing is half-done.
    assertStageTransition(lead, 'won', lead);
    const { customerId, customerType } = this.ensureLeadCustomer(leadId, userEmail);
    // Files created after the prospect account existed are already filed; this catches the rest.
    this.refileLeadRecords(leadId, customerId, userEmail);
    if (customerType === 'company') {
      const co = this.getCompanyById(customerId);
      if (co && co.status !== 'active') this.saveCompany({ ...co, status: 'active' }, userEmail);
      if (lead.branches?.length) {
        const existing = this.getBranches(customerId);
        lead.branches.forEach((b, idx) => {
          if (!existing.some((eb) => eb.branchName.toLowerCase() === b.name.toLowerCase())) {
            const branchId = `BR-${new Date().getFullYear()}-${String(existing.length + idx + 1).padStart(4, '0')}`;
            this.saveBranch({
              id: branchId,
              companyId: customerId,
              companyName: co?.legalCompanyName || lead.companyName || lead.title,
              branchName: b.name || `Branch ${idx + 1}`,
              city: b.city || lead.city || 'Karachi',
              area: b.address || lead.area || '',
              province: (co?.province || 'Sindh') as any,
              physicalAddress: b.address || '',
              branchPhone: b.contactPhone || lead.phone || '',
              branchManagerName: b.contactName || '',
              branchManagerPhone: b.contactPhone || '',
              billingType: 'company_invoice',
              balance: 0,
              contacts: b.contactName ? [{ id: `cont_${Date.now()}_${idx}`, fullName: b.contactName, phone: b.contactPhone || '', mobile: b.contactPhone || '', isPrimary: true }] : [],
              status: 'active',
              createdAt: now(),
              createdBy: userEmail,
              updatedAt: now(),
            }, userEmail);
          }
        });
      }
    } else {
      const cl = this.getClientById(customerId);
      if (cl && cl.status !== 'active') this.saveClient({ ...cl, status: 'active' }, userEmail);
      if (lead.branches?.length) {
        const existing = this.getSites(customerId);
        lead.branches.forEach((b, idx) => {
          if (!existing.some((es) => es.siteName.toLowerCase() === b.name.toLowerCase())) {
            this.saveSite({
              id: `SITE-${Date.now()}-${idx}`,
              customerId,
              customerType: 'company',
              propertyType: 'commercial_office',
              siteName: b.name || `Site ${idx + 1}`,
              addressLine1: b.address || '',
              city: b.city || lead.city || 'Karachi',
              area: b.address || '',
              province: 'Sindh',
              contactPersonName: b.contactName || lead.contactName || '',
              contactPersonPhone: b.contactPhone || lead.phone || '',
              isActive: true,
              createdAt: now(),
            });
          }
        });
      }
    }
    return this.setLeadStage(leadId, 'won', note, userEmail);
  }

  /** Keeps the lead in step with its proposal. Declined proposal → negotiation (not lost). */
  private syncLeadWithProposal(proposal: Proposal, created: boolean, userEmail: string) {
    if (!proposal.leadId) return;
    const lead = this.getLeadById(proposal.leadId);
    if (!lead) return;
    const stage = stageOf(lead);
    const proposalIds = Array.from(new Set([proposal.id, ...(lead.proposalIds ?? [])].filter(Boolean)));
    // Link the proposal (moves lead to proposal_sent) unless lead is already won/lost.
    if (!['won', 'lost'].includes(stage)) {
      const isNew = created || !lead.proposalIds?.includes(proposal.id);
      if (isNew) {
        const proposalStuckResolved = lead.stuckAt === 'awaiting_proposal' || lead.stuckAt === 'meeting_pending';
        this.saveLead({
          ...lead,
          stage: 'proposal_sent',
          proposalId: proposal.id,
          proposalIds,
          ...(proposalStuckResolved ? { stuckAt: undefined, stuckAtDate: undefined } : {}),
          activities: [
            this.activity({ kind: 'proposal', channel: 'note', note: `Proposal ${proposal.id}${proposal.revisionNumber ? ` R${proposal.revisionNumber}` : ''} created (PKR ${Math.round(proposal.totalAmount).toLocaleString()})`, quotedAmount: proposal.totalAmount }),
            ...(lead.activities ?? []),
          ],
        }, userEmail, `Proposal ${proposal.id} created`);
      } else {
        // Editing an existing proposal — keep proposalIds in sync
        this.saveLead({ ...this.getLeadById(lead.id) ?? lead, proposalIds, proposalId: proposal.id }, userEmail);
      }
    }
    const current = stageOf(this.getLeadById(lead.id) ?? lead);
    if (proposal.status === 'accepted' && (current === 'proposal_sent' || current === 'negotiation')) {
      this.markLeadWon(lead.id, `Proposal ${proposal.id} accepted`, userEmail);
    } else if (proposal.status === 'declined' && current !== 'lost' && current !== 'won') {
      // Declined → negotiation with stuckAt = price_bargaining (not lost)
      const latestLead = this.getLeadById(lead.id) ?? lead;
      const updatedLead: Lead = {
        ...latestLead,
        stage: 'negotiation',
        stuckAt: 'price_bargaining',
        stuckAtDate: now().slice(0, 10),
        activities: [
          this.activity({ kind: 'negotiation', channel: 'note', note: `Proposal ${proposal.id} declined by client — moved to negotiation` }),
          ...(latestLead.activities ?? []),
        ],
      };
      this.saveLead(updatedLead, userEmail, `Proposal ${proposal.id} declined — negotiation`);
    }
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
    // New proposal from a lead: the lead must be at a stage that allows a proposal.
    if (proposal.leadId && !this.getProposalById(proposal.id)) {
      const lead = this.getLeadById(proposal.leadId);
      if (lead) assertCanCreateProposal(lead);
    }
    this.fileRecord(proposal, {
      customerId: proposal.customerId,
      customerType: proposal.customerType,
      customerName: proposal.customerName,
      branchId: proposal.branchId,
      leadId: proposal.leadId,
      category: 'proposal',
      date: proposal.createdAt,
    });
    if (proposal.discountPercent > 10 && proposal.status === 'draft') {
      const ts = now();
      proposal.status = 'pending_approval';
      proposal.approval = {
        ruleId: 'AP-01',
        ruleDescription: `Discount ${proposal.discountPercent}% exceeds standard authority threshold (10%). Requires Sales Manager / CEO Approval.`,
        requiredRole: proposal.discountPercent > 20 ? 'ceo' : 'sales_manager',
        status: 'pending',
        requestedAt: ts,
        requestedBy: userEmail,
        requestedByName: userEmail,
      };
      // Also push to the global approvals queue so the Manager can act on it there.
      const existingApproval = this.getApprovalForEntity(proposal.id);
      if (!existingApproval) {
        const approvalId = `AP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const approval: Approval = {
          id: approvalId,
          type: 'proposal_discount',
          entityType: 'proposal',
          entityId: proposal.id,
          entityTitle: `Proposal ${proposal.id} for ${proposal.customerName}`,
          ownerUid: this.session?.uid ?? userEmail,
          requestedBy: userEmail,
          requestedByName: userEmail,
          requestedAt: ts,
          reason: `Discount ${proposal.discountPercent}% exceeds the 10% threshold. Rule AP-01.`,
          amount: proposal.discountAmount,
          status: 'pending',
          updatedAt: ts,
        };
        this.upsert(this.s.approvals, approval);
        this.write('approvals', approval.id, approval);
      }
    }

    const created = this.upsert(this.s.proposals, proposal);
    this.audit(userEmail, created ? 'create' : 'update', 'proposal', proposal.id, proposal.id,
      created
        ? `Drafted new proposal ${proposal.id} for ${proposal.customerName}`
        : `Updated proposal ${proposal.id} (status: ${proposal.status})`);
    this.write('proposals', proposal.id, proposal);
    try {
      this.syncLeadWithProposal(proposal, created, userEmail);
    } catch (err) {
      // New proposals were checked up front; for edits of older proposals whose lead is on another
      // stage, keep the proposal change and leave the lead where it is.
      if (created || !(err instanceof StageTransitionError)) throw err;
      console.warn(`Lead ${proposal.leadId} not updated from proposal ${proposal.id}: ${err.message}`);
    }
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
    if (!changeReason?.trim()) throw new Error('A change reason is required to create a revision.');

    const nextRevisionNum = (base.revisionNumber || 0) + 1;
    const revisionRecord: ProposalRevision = {
      revisionNumber: nextRevisionNum,
      timestamp: now(),
      changedBy: userEmail,
      changedByName: this.session?.name || userEmail,
      changeReason: changeReason.trim(),
      subtotal: updates.subtotal ?? base.subtotal,
      discountPercent: updates.discountPercent ?? base.discountPercent,
      totalAmount: updates.totalAmount ?? base.totalAmount,
    };

    const updatedProposal: Proposal = {
      ...base,
      ...updates,
      revisionNumber: nextRevisionNum,
      status: 'sent_to_client',
      revisionsHistory: [...base.revisionsHistory, revisionRecord],
      updatedAt: now(),
    };

    // Log revision on the lead timeline
    if (base.leadId) {
      const lead = this.getLeadById(base.leadId);
      if (lead) {
        const negRound = (lead.negotiationRounds ?? 0) + 1;
        const updatedLead: Lead = {
          ...lead,
          stage: 'negotiation',
          negotiationRounds: negRound,
          lastQuotedAmount: updatedProposal.totalAmount,
          activities: [
            this.activity({
              kind: 'negotiation',
              channel: 'note',
              note: `Revision R${nextRevisionNum} sent — ${changeReason.trim()} (PKR ${Math.round(updatedProposal.totalAmount).toLocaleString()})`,
              quotedAmount: updatedProposal.totalAmount,
            }),
            ...(lead.activities ?? []),
          ],
        };
        this.saveLead(updatedLead, userEmail);
      }
    }

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
    this.fileRecord(contract, {
      customerId: contract.customerId,
      customerType: contract.customerType,
      customerName: contract.customerName,
      branchId: contract.branchId,
      category: 'contract',
      date: contract.startDate,
    });
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
        chemicalsUsed: [],
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

  /**
   * Creates the reviewed visit schedule (src/lib/visitSchedule.ts) as service_jobs: one job per
   * visit, service and follow-up linked through pairedJobId. Refuses PCO double-bookings.
   */
  public createScheduledJobs(
    contract: Contract,
    visits: { key: string; branchId: string; branchName: string; date: string; kind: 'service' | 'follow_up'; pairKey?: string; timeSlot: ServiceJob['timeSlot']; windowStart?: string; windowEnd?: string; pcoId?: string; pcoName?: string }[],
    userEmail = 'admin'
  ): ServiceJob[] {
    const booked = new Set<string>();
    this.s.jobs.filter((j) => j.status !== 'cancelled').forEach((j) => j.assignedTechnicianIds.forEach((u) => booked.add(`${u}|${j.scheduledDate.slice(0, 10)}|${j.timeSlot}`)));
    visits.forEach((v) => {
      if (!v.pcoId) return;
      const k = `${v.pcoId}|${v.date}|${v.timeSlot}`;
      if (booked.has(k)) throw new Error(`${v.pcoName || 'The PCO'} is already booked on ${v.date} (${v.timeSlot.replace('_', ' ')}).`);
      booked.add(k);
    });

    const stamp = Date.now().toString(36).toUpperCase();
    const idOf = new Map(visits.map((v, i) => [v.key, `JOB-${stamp}-${String(i + 1).padStart(3, '0')}`]));
    const sites = this.getSites(contract.customerId);
    const created = visits.map((v) => {
      const branch = v.branchId ? this.getBranchById(v.branchId) : undefined;
      const site = sites.find((x) => x.branchId === v.branchId) ?? sites[0];
      const job: ServiceJob = {
        id: idOf.get(v.key)!,
        contractId: contract.id,
        proposalId: contract.proposalId,
        customerType: contract.customerType,
        customerId: contract.customerId,
        customerName: contract.customerName,
        branchId: branch?.id ?? contract.branchId,
        branchName: branch?.branchName ?? v.branchName,
        siteId: site?.id || 'SITE-01',
        siteName: site?.siteName || v.branchName,
        siteAddress: site?.addressLine1 || branch?.physicalAddress || '',
        serviceType: v.kind === 'follow_up' ? `Follow-up: ${contract.serviceScope}` : contract.serviceScope,
        targetPests: [],
        scheduledDate: v.date,
        timeSlot: v.timeSlot,
        windowStart: v.windowStart,
        windowEnd: v.windowEnd,
        visitKind: v.kind,
        pairedJobId: v.pairKey ? idOf.get(v.pairKey) : undefined,
        assignedTechnicianIds: v.pcoId ? [v.pcoId] : [],
        assignedTechnicianNames: v.pcoName ? [v.pcoName] : [],
        leadPcoId: v.pcoId || '',
        leadPcoName: v.pcoName || 'Unassigned',
        status: 'scheduled',
        checklists: [],
        chemicalsUsed: [],
        photoEvidence: [],
        createdAt: now(),
        updatedAt: now(),
      };
      this.saveJob(job, userEmail);
      return job;
    });
    this.saveContract({ ...contract, totalJobsScheduled: (contract.totalJobsScheduled || 0) + created.length }, userEmail);
    this.audit(userEmail, 'create', 'contract', contract.id, contract.customerName, `Scheduled ${created.length} visits (${created.filter((j) => j.visitKind === 'service').length} service, ${created.filter((j) => j.visitKind === 'follow_up').length} follow-up)`);
    return created;
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
    this.fileRecord(job, {
      customerId: job.customerId,
      customerType: job.customerType,
      customerName: job.customerName,
      branchId: job.branchId,
      category: 'service_report',
      date: job.scheduledDate,
    });
    const created = this.upsert(this.s.jobs, job);
    this.audit(userEmail, created ? 'create' : 'update', 'job', job.id, job.serviceType,
      created ? `Scheduled service job ${job.id} for ${job.customerName}` : `Updated job ${job.id} status to ${job.status}`);
    this.write('service_jobs', job.id, job);
    return job;
  }

  /** Public record behind a document's "Scan to verify" QR code (minimal details, readable by id only). */
  public recordVerification(id: string, data: Record<string, unknown>) {
    this.write('doc_verifications', id, data);
  }

  /** Saves field photos as they are taken (no audit entry per photo; finishing the job logs the visit). */
  public saveJobPhotos(jobId: string, photos: PhotoEvidence[]) {
    const job = this.getJobById(jobId);
    if (!job) return;
    const before = job.photoEvidence?.length ?? 0;
    this.upsert(this.s.jobs, { ...job, photoEvidence: photos });
    this.write('service_jobs', jobId, { photoEvidence: photos, updatedAt: now() });
    if (photos.length !== before) {
      this.logAudit({
        userId: this.session?.uid || '',
        userEmail: this.session?.email || '',
        action: photos.length > before ? 'create' : 'delete',
        entityType: 'document',
        entityId: jobId,
        entityTitle: `${job.customerName} job photos`,
        details: `${photos.length > before ? 'Uploaded' : 'Removed'} ${Math.abs(photos.length - before)} photo(s) on job ${jobId} (${job.folderPath || 'Unfiled'})`,
      });
    }
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

    if (!existing) {
      this.fileRecord(invoice, {
        customerId: invoice.customerId,
        customerType: invoice.customerType,
        customerName: invoice.customerName,
        branchId: invoice.branchId,
        category: 'invoice',
        date: invoice.issueDate,
      });
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

    this.fileRecord(payment, {
      customerId: payment.customerId,
      customerType: invoice.customerType,
      customerName: payment.customerName,
      branchId: payment.branchId,
      category: 'payment_receipt',
      date: payment.paymentDate,
    });
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

  // --- Virtual folders (paths built only by src/lib/folders.ts) ---

  /** Lookups for src/lib/folderResolver.ts (the backfill script passes its own). */
  private readonly folderLookups: FolderLookups = {
    company: (id) => this.getCompanyById(id),
    client: (id) => this.getClientById(id),
    lead: (id) => this.getLeadById(id),
    branch: (id) => this.getBranchById(id),
    proposal: (id) => this.getProposalById(id),
    job: (id) => this.getJobById(id),
    invoice: (id) => this.getInvoiceById(id),
  };

  /** Display name and type of a client account, or of a lead that is not a customer yet. */
  public clientInfo(clientId: string): { name?: string; type?: 'company' | 'individual' } {
    return clientInfoFrom(this.folderLookups, clientId);
  }

  /**
   * Folder fields for a record from its links. Records of a lead that is not a customer yet are
   * filed under the lead (clientId = lead id, "Leads & Inspections"). Returns {} when nothing
   * links the record to an owner (it then shows in "Unfiled").
   */
  public resolveFolder(link: FolderLink): FolderMeta {
    return resolveFolderFrom(this.folderLookups, link);
  }

  /** Adds folder fields to a new record that doesn't have them yet (never overwrites). */
  private fileRecord<T extends FolderMeta>(record: T, link: FolderLink): T {
    if (record.folderPath) return record;
    return Object.assign(record, this.resolveFolder(link));
  }

  /** Folder fields for a document from its owner (library, client, branch, lead, proposal or job). */
  public resolveDocumentFolder(document: Pick<PortalDocument, 'owner' | 'category' | 'folder' | 'fileCategory' | 'uploadedAt'>): FolderMeta {
    const link = documentLink(this.folderLookups, document);
    return link ? this.resolveFolder(link) : {};
  }

  /** Upload scope (for uploadFile) of a document owner. */
  public uploadScopeFor(owner: DocumentOwner, category: FileCategory): UploadScope {
    const meta = this.resolveDocumentFolder({ owner, category: 'other', fileCategory: category, uploadedAt: now() });
    if (!meta.ownerScope) throw new Error('This file is not linked to a client or to IKPM, so it cannot be uploaded.');
    return { ownerScope: meta.ownerScope, clientId: meta.clientId, category };
  }

  /**
   * When a lead becomes a customer account, its files move from the lead's folder to the
   * customer's. Only metadata changes (nothing is re-uploaded); logged in audit_logs.
   */
  private refileLeadRecords(leadId: string, customerId: string, userEmail: string) {
    const info = this.clientInfo(customerId);
    const keys: StateKey[] = ['documents', 'documentPacks', 'invoices', 'payments', 'proposals', 'contracts', 'jobs', 'outreachLogs'];
    const moved: string[] = [];
    for (const key of keys) {
      const list = this.s[key] as unknown as (FolderMeta & { id: string })[];
      list.forEach((rec, i) => {
        if (rec.ownerScope !== 'client' || rec.clientId !== leadId) return;
        const patch: FolderMeta = {
          clientId: customerId,
          clientType: info.type ?? rec.clientType,
          folderPath: moveFolderPathToClient(rec.folderPath, { clientId: customerId, clientName: info.name }),
        };
        list[i] = { ...rec, ...patch };
        this.write(COLLECTIONS[key], rec.id, { ...patch, folderMovedFrom: leadId, updatedAt: now() });
        moved.push(`${COLLECTIONS[key]}/${rec.id}`);
      });
    }
    if (!moved.length) return;
    this.commit();
    this.logAudit({
      userId: this.session?.uid || '',
      userEmail,
      action: 'update',
      entityType: 'document',
      entityId: leadId,
      entityTitle: info.name,
      details: `Moved ${moved.length} file record(s) from lead ${leadId} to client ${customerId}: ${moved.slice(0, 20).join(', ')}${moved.length > 20 ? ', …' : ''}`,
      afterData: { clientId: customerId, records: moved.length },
    });
  }

  /**
   * Files an older record that has no folder yet, from its own links (customer, branch, lead).
   * Posted invoices are left to the backfill script (they are immutable in the portal).
   */
  public fileUnfiledRecord(kind: 'proposal' | 'contract' | 'job' | 'invoice' | 'payment' | 'outreach', id: string, userEmail = 'admin'): FolderMeta {
    const target: Record<typeof kind, [StateKey, FolderCollection]> = {
      proposal: ['proposals', 'proposals'],
      contract: ['contracts', 'contracts'],
      job: ['jobs', 'service_jobs'],
      invoice: ['invoices', 'invoices'],
      payment: ['payments', 'payments'],
      outreach: ['outreachLogs', 'outreach_logs'],
    };
    const [key, collectionName] = target[kind];
    const list = this.s[key] as unknown as (FolderMeta & { id: string; isPosted?: boolean })[];
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error('Record not found');
    const rec = list[idx];
    if (rec.folderPath) return rec;
    if (kind === 'invoice' && rec.isPosted) throw new Error('Posted invoices are immutable here. The backfill script files them.');
    const link = recordLink(this.folderLookups, collectionName, rec as unknown as Record<string, unknown>);
    const meta = link ? this.resolveFolder(link) : {};
    if (!meta.folderPath) throw new Error('This record is not linked to a client, so it cannot be filed automatically.');
    list[idx] = { ...rec, ...meta };
    this.commit();
    this.write(collectionName, id, { ...meta, updatedAt: now() });
    this.logAudit({
      userId: this.session?.uid || '',
      userEmail,
      action: 'update',
      entityType: 'document',
      entityId: id,
      entityTitle: `${collectionName}/${id}`,
      details: `Filed ${collectionName}/${id} into ${meta.folderPath}`,
      afterData: { folderPath: meta.folderPath },
    });
    return meta;
  }

  /**
   * Moves a document to another folder of the same owner (or files an unfiled one).
   * A filed document can't change client or company/client scope; upload it there instead.
   */
  public moveDocument(
    id: string,
    target: { owner?: DocumentOwner; fileCategory?: FileCategory; folder?: PortalDocument['folder']; year?: number; subfolder?: ClientSubfolder | CompanySubfolder },
    userEmail = 'admin'
  ): PortalDocument {
    const current = this.getDocumentById(id);
    if (!current) throw new Error('Document not found');
    const next: PortalDocument = {
      ...current,
      owner: target.owner ?? current.owner,
      folder: target.folder ?? current.folder,
      year: target.year,
      fileCategory: target.fileCategory ?? current.fileCategory,
    };
    const resolved = this.resolveDocumentFolder(next);
    const meta = target.subfolder && resolved.ownerScope
      ? folderMeta({
          ownerScope: resolved.ownerScope,
          clientId: resolved.clientId,
          clientType: resolved.clientType,
          clientName: resolved.clientId ? this.clientInfo(resolved.clientId).name : undefined,
          branchId: resolved.branchId,
          branchName: resolved.branchId ? this.getBranchById(resolved.branchId)?.branchName : undefined,
          category: resolved.fileCategory,
          subfolder: target.subfolder,
        })
      : resolved;
    if (current.ownerScope && meta.ownerScope && current.ownerScope !== meta.ownerScope) {
      throw new Error('Files cannot move between a client and the Company (IKPM) area. Upload a copy there instead.');
    }
    if (current.clientId && meta.clientId && current.clientId !== meta.clientId) {
      throw new Error('Files cannot move to another client. Upload a copy in that client\'s folder instead.');
    }
    const updated: PortalDocument = { ...next, ...meta };
    this.upsert(this.s.documents, updated, false);
    this.commit();
    this.write('documents', id, updated);
    this.logAudit({
      userId: this.session?.uid || '',
      userEmail,
      action: 'update',
      entityType: 'document',
      entityId: id,
      entityTitle: current.title,
      details: `Moved "${current.title}" from ${current.folderPath || 'Unfiled'} to ${updated.folderPath || 'Unfiled'}`,
      beforeData: { folderPath: current.folderPath ?? null },
      afterData: { folderPath: updated.folderPath ?? null },
    });
    return updated;
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
    if (!document.folderPath) Object.assign(document, this.resolveDocumentFolder(document));
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
        details: `Uploaded document "${document.title}" to ${ownerLabel} (${document.folderPath || 'Unfiled'})`,
      });
    }
    return document;
  }

  /** Removes the record from the portal and, when the server API is configured, deletes the file from Cloudinary. */
  public removeDocument(id: string, userEmail = 'admin') {
    const docRec = this.getDocumentById(id);
    if (!docRec) return;
    this.s.documents = this.s.documents.filter((d) => d.id !== id);
    this.s.documentPacks = this.s.documentPacks.map((p) => ({ ...p, documentIds: p.documentIds.filter((x) => x !== id) }));
    this.audit(userEmail, 'delete', 'document', id, docRec.title, `Removed document "${docRec.title}" from portal`);
    this.write('documents', id, { removed: true, removedAt: now() });
    // Delete the actual file unless another document still points at it (e.g. a copy)
    const shared = this.s.documents.some((d) => d.file.publicId && d.file.publicId === docRec.file.publicId);
    if (!shared) {
      deleteFromCloudinary(docRec.file).catch((err: Error) =>
        this.emitError({ collection: 'cloudinary', id, code: 'cloudinary', message: `${docRec.title}: ${err.message}` })
      );
    }
  }

  public getDocumentPacks(): DocumentPack[] {
    return [...this.s.documentPacks];
  }

  /** IKPM's pitch packs (not the per-client onboarding packs). */
  public getLibraryPacks(): DocumentPack[] {
    return this.s.documentPacks.filter((p) => p.kind !== 'onboarding');
  }

  // --- Device register (src/lib/devices.ts) ---
  public getDevices(clientId: string, branchId?: string, includeRetired = false): Device[] {
    return this.s.devices.filter(
      (d) => d.clientId === clientId && (branchId === undefined || (d.branchId || '') === (branchId || '')) && (includeRetired || d.status === 'active')
    );
  }

  public saveDevices(devices: Device[], userEmail = 'admin', note?: string) {
    devices.forEach((d) => {
      this.upsert(this.s.devices, d);
      this.write('devices', d.id, d);
    });
    this.commit();
    if (devices.length) this.audit(userEmail, 'update', 'device', devices[0].clientId, devices[0].clientId, note || `Saved ${devices.length} device(s)`);
  }

  public retireDevice(id: string, userEmail = 'admin') {
    const d = this.s.devices.find((x) => x.id === id);
    if (!d) return;
    this.saveDevices([{ ...d, status: 'retired', retiredAt: now() }], userEmail, `Retired device ${d.type} ${d.number}`);
  }

  // --- Monitoring records (one per device per visit) ---
  public getMonitoringRecords(filter: { clientId?: string; branchId?: string; jobId?: string }): MonitoringRecord[] {
    return this.s.monitoringRecords.filter(
      (r) =>
        (!filter.jobId || r.jobId === filter.jobId) &&
        (!filter.clientId || r.clientId === filter.clientId) &&
        (filter.branchId === undefined || (r.branchId || '') === (filter.branchId || ''))
    );
  }

  /** Saved locally first; Firestore's offline cache syncs the write when the device is back online. */
  public saveMonitoringRecords(records: MonitoringRecord[]) {
    records.forEach((r) => {
      this.upsert(this.s.monitoringRecords, r, false);
      this.write('monitoring_records', r.id, r);
    });
    this.commit();
  }

  // --- Onboarding pack (after a lead is won; see src/lib/onboarding.ts) ---
  public getOnboardingPack(clientId: string): DocumentPack | undefined {
    return this.s.documentPacks.find((p) => p.kind === 'onboarding' && p.clientId === clientId);
  }

  public saveOnboardingPack(pack: DocumentPack, userEmail = 'admin', note?: string): DocumentPack {
    const created = !this.s.documentPacks.some((p) => p.id === pack.id);
    const saved: DocumentPack = {
      ...pack,
      kind: 'onboarding',
      ownerScope: 'client',
      documentIds: Array.from(new Set((pack.items ?? []).flatMap((i) => i.documentIds))),
      createdAt: pack.createdAt || now(),
      updatedAt: now(),
    };
    this.saveDocumentPack(saved);
    this.audit(userEmail, created ? 'create' : 'update', 'document', saved.id, saved.name, note || (created ? `Started onboarding pack for ${saved.clientId}` : `Updated onboarding pack ${saved.id}`));
    return saved;
  }

  /** Records that the pack went to the client (the message itself is in outreach_logs). */
  public markOnboardingSent(packId: string, via: OutreachLog['channel'][], userEmail = 'admin'): DocumentPack | undefined {
    const pack = this.s.documentPacks.find((p) => p.id === packId);
    if (!pack) return undefined;
    const updated: DocumentPack = { ...pack, sentAt: now(), sentByName: this.session?.name || userEmail, sentVia: via };
    this.saveDocumentPack(updated);
    this.audit(userEmail, 'status_change', 'document', pack.id, pack.name, `Onboarding pack sent via ${via.join(' & ')} (${pack.documentIds.length} document(s))`);
    return updated;
  }

  public saveDocumentPack(pack: DocumentPack) {
    // Library packs are IKPM's own; packs made for one client live in that client's Documents
    this.fileRecord(pack, pack.clientId
      ? { customerId: pack.clientId, customerType: pack.clientType, branchId: pack.branchId, category: pack.fileCategory ?? 'other' }
      : { ownerScope: 'company', category: 'other' });
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

  // --- Complaints ---
  public getComplaints(customerId?: string): Complaint[] {
    const list = [...this.s.complaints].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return customerId ? list.filter((c) => c.customerId === customerId) : list;
  }

  public getComplaintsByContract(contractId: string): Complaint[] {
    return this.s.complaints.filter((c) => c.contractId === contractId);
  }

  public getComplaintsByOpsManager(uid: string): Complaint[] {
    return this.s.complaints.filter((c) => c.assignedOperationsManagerId === uid);
  }

  public getComplaintById(id: string): Complaint | undefined {
    return this.s.complaints.find((c) => c.id === id);
  }

  public saveComplaint(complaint: Complaint, userEmail = 'admin'): Complaint {
    const created = this.upsert(this.s.complaints, complaint);
    this.audit(userEmail, created ? 'create' : 'status_change', 'complaint', complaint.id, complaint.subject,
      created ? `Logged complaint for ${complaint.customerName}` : `Updated complaint ${complaint.id} → ${complaint.status}`);
    this.write('complaints', complaint.id, complaint);
    return complaint;
  }

  // --- Approvals ---
  public getApprovals(ownerUid?: string): Approval[] {
    const list = [...this.s.approvals].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return ownerUid ? list.filter((a) => a.ownerUid === ownerUid) : list;
  }

  public getApprovalById(id: string): Approval | undefined {
    return this.s.approvals.find((a) => a.id === id);
  }

  public getApprovalForEntity(entityId: string): Approval | undefined {
    return this.s.approvals.find((a) => a.entityId === entityId && a.status === 'pending');
  }

  public saveApproval(approval: Approval, userEmail = 'admin'): Approval {
    const created = this.upsert(this.s.approvals, approval);
    this.audit(userEmail, created ? 'create' : 'status_change', 'approval', approval.id, approval.entityTitle,
      created
        ? `Approval request ${approval.id} created for ${approval.entityTitle}`
        : `Approval ${approval.id} updated → ${approval.status}`);
    this.write('approvals', approval.id, approval);
    return approval;
  }

  public decideApproval(
    id: string,
    decision: 'approved' | 'rejected',
    decisionNote: string,
    decidedBy: string,
    decidedByName: string,
    decidedByUid: string,
    userEmail = 'admin',
  ): Approval {
    const approval = this.s.approvals.find((a) => a.id === id);
    if (!approval) throw new Error(`Approval ${id} not found`);
    if (approval.ownerUid === decidedByUid) throw new Error('Cannot decide your own approval request');
    const updated: Approval = {
      ...approval,
      status: decision,
      decidedBy,
      decidedByName,
      decidedAt: now(),
      decisionNote,
      updatedAt: now(),
    };
    this.upsert(this.s.approvals, updated);
    this.write('approvals', updated.id, updated);
    this.audit(userEmail, 'status_change', 'approval', updated.id, updated.entityTitle,
      `${decision === 'approved' ? 'Approved' : 'Rejected'} ${updated.id}: ${decisionNote}`);
    // Keep the linked proposal in sync when the approval is for a proposal discount
    if (updated.type === 'proposal_discount') {
      const proposal = this.s.proposals.find((p) => p.id === updated.entityId);
      if (proposal) {
        const updatedProposal = {
          ...proposal,
          status: decision === 'approved' ? ('approved' as const) : ('rejected' as const),
          approval: proposal.approval
            ? {
                ...proposal.approval,
                status: decision,
                decisionAt: updated.decidedAt,
                decisionBy: decidedBy,
                decisionByName: decidedByName,
                decisionNote,
              }
            : proposal.approval,
          updatedAt: now(),
        };
        this.upsert(this.s.proposals, updatedProposal);
        this.write('proposals', proposal.id, updatedProposal);
      }
    }
    // Apply contract cancel / reactivate when approved
    if (decision === 'approved' && (updated.type === 'contract_cancel' || updated.type === 'contract_reactivate')) {
      const contract = this.s.contracts.find((c) => c.id === updated.entityId);
      if (contract) {
        const newStatus = updated.type === 'contract_cancel' ? ('cancelled' as const) : ('active' as const);
        const updatedContract = { ...contract, status: newStatus, updatedAt: now() };
        this.upsert(this.s.contracts, updatedContract);
        this.write('contracts', contract.id, updatedContract);
      }
    }
    return updated;
  }

  // --- Outreach (WhatsApp / Email) ---
  public getOutreachLogs(related?: { kind: OutreachLog['related']['kind']; id: string }): OutreachLog[] {
    if (!related) return [...this.s.outreachLogs];
    return this.s.outreachLogs.filter((l) => l.related.kind === related.kind && l.related.id === related.id);
  }

  public logOutreach(log: OutreachLog) {
    Object.assign(log, this.ownership());
    const link = recordLink(this.folderLookups, 'outreach_logs', log as unknown as Record<string, unknown>);
    if (link) this.fileRecord(log, link);
    this.s.outreachLogs.unshift(log);
    this.commit();
    this.write('outreach_logs', log.id, log);
  }
}

export const dataService = new DataService();
