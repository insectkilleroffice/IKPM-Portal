// Single source of truth for "who can see what".
// Roles are data: the super admin edits them on the Team & Access page (stored in the Firestore
// `roles` collection). Each role gives every module an access level: none / view / edit.
// The sidebar, route guards and Firestore subscriptions read from here, and firestore.rules
// reads the same role documents, so the server enforces exactly what the UI shows.

import type { DataScope, UserRole } from '../types';

export type SystemRole = 'super_admin' | 'admin' | 'sales' | 'team_leader' | 'operations' | 'technician' | 'finance' | 'hr';

export type ModuleKey =
  | 'dashboard'
  | 'customers'
  | 'crm'
  | 'inspections'
  | 'proposals'
  | 'contracts'
  | 'files'
  | 'documents'
  | 'company_files'
  | 'calendar'
  | 'jobs'
  | 'pco'
  | 'invoices'
  | 'tax'
  | 'settings'
  | 'templates'
  | 'team'
  | 'roles'
  | 'complaints'
  | 'approvals'
  | 'hr'
  | 'attendance'
  | 'payroll'
  | 'challans'
  | 'search';

export type AccessLevel = 'none' | 'view' | 'edit';

export interface RoleDefinition {
  id: string;
  name: string;
  description?: string;
  color?: string;
  /** System template the role started from; legacy feature checks (e.g. "sales can draft") follow it. */
  basedOn: SystemRole;
  modules: Partial<Record<ModuleKey, AccessLevel>>;
  /** Data access given to new staff with this role. */
  defaultScope: DataScope;
  isSystem?: boolean;
  /** Hidden from the default role picker; only Super Admin can assign this role. */
  isHidden?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const MODULES: { key: ModuleKey; label: string; group: string; hint?: string }[] = [
  { key: 'dashboard', label: 'Dashboard', group: 'General' },
  { key: 'customers', label: 'Customer accounts', group: 'Sales & customers' },
  { key: 'crm', label: 'Leads pipeline', group: 'Sales & customers' },
  { key: 'inspections', label: 'Site inspections', group: 'Sales & customers', hint: 'Without Leads access: only inspections assigned to the person' },
  { key: 'proposals', label: 'Proposals', group: 'Sales & customers' },
  { key: 'contracts', label: 'Contracts & AMCs', group: 'Sales & customers' },
  { key: 'calendar', label: 'Dispatch calendar', group: 'Field operations' },
  { key: 'jobs', label: 'Service jobs', group: 'Field operations' },
  { key: 'pco', label: 'Meeting & Field Reports', group: 'Field operations', hint: 'Assigned meetings, field reports and follow-ups (Team Leaders and above)' },
  { key: 'invoices', label: 'Invoices & receipts', group: 'Accounts' },
  { key: 'settings', label: 'Settings & audit trail', group: 'Administration' },
  { key: 'templates', label: 'Document templates', group: 'Administration', hint: 'Edit = proposal, scope and SOP wording. Commercial / legal wording stays super admin only' },
  { key: 'team', label: 'Manage staff & teams', group: 'Administration', hint: 'Add people, set passwords, build teams' },
  { key: 'roles', label: 'Customize roles', group: 'Administration', hint: 'Change what each role can do' },
  { key: 'complaints', label: 'Complaints', group: 'Field operations', hint: 'CRO logs, Ops Manager resolves, re-service visits' },
  { key: 'approvals', label: 'Approvals queue', group: 'Administration', hint: 'Manager approves discounts, voids, cancellations and refunds. Others can view their own requests.' },
  { key: 'hr', label: 'Employee management', group: 'Human resources', hint: 'Staff profiles, sensitive HR data, onboarding and probation' },
  { key: 'attendance', label: 'Daily attendance', group: 'Field operations', hint: 'Coordinator marks daily PCO attendance' },
  { key: 'payroll', label: '30-day payroll', group: 'Accounts', hint: 'Calculate salary, approve cycles, record payment and salary slips' },
  { key: 'challans', label: 'Delivery & service challans', group: 'Field operations', hint: 'Signed challan records and register' },
  { key: 'search', label: 'Global search', group: 'General', hint: 'Search across all records, documents and folders' },
];

const all = (level: AccessLevel, keys: ModuleKey[]) => Object.fromEntries(keys.map((k) => [k, level])) as Partial<Record<ModuleKey, AccessLevel>>;

// ── Role Workflow ────────────────────────────────────────────────────────────
// Super Admin            : Full portal access — users, roles, settings, all data.
// Admin                  : Daily back-office — all operational records and docs.
// CRO (sales)            : Leads, meetings, proposals. Hands off when proposal accepted.
// Operation Coordinator  : Sees CRO meetings → assigns team leader → creates
//   (operations)           contract → schedules and dispatches jobs.
// Team Leader            : Field team. Submits meeting reports and job reports.
//   (team_leader)          Leads PCO technicians on site.
// Technician (PCO)       : Sees and completes only their own assigned jobs.
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: 'super_admin',
    name: 'Super Admin',
    basedOn: 'super_admin',
    isSystem: true,
    defaultScope: 'company',
    color: '#7C3AED',
    description: 'Full portal control — all data, staff, teams and roles',
    modules: all('edit', MODULES.map((m) => m.key)),
  },
  {
    id: 'admin',
    name: 'Admin',
    basedOn: 'admin',
    isSystem: true,
    defaultScope: 'company',
    color: '#0F766E',
    description: 'Daily back-office operations — edits all records and sends documents. Cannot manage roles, staff or invoices.',
    modules: {
      ...all('edit', ['dashboard', 'customers', 'crm', 'inspections', 'proposals', 'contracts', 'files', 'documents', 'company_files', 'calendar', 'jobs', 'pco', 'complaints', 'challans']),
      invoices: 'view',
      settings: 'view',
      approvals: 'view',
      search: 'edit',
      attendance: 'view',
      hr: 'view',
      payroll: 'view',
    },
  },
  {
    id: 'sales',
    name: 'CRO',
    basedOn: 'sales',
    isSystem: true,
    defaultScope: 'company',
    color: '#1A73E8',
    description: 'Lead generation, proposals and contract initiation. Creates contracts from accepted proposals; Operations dispatches jobs.',
    modules: {
      ...all('edit', ['dashboard', 'customers', 'crm', 'proposals', 'contracts', 'pco', 'files', 'complaints']),
      documents: 'view',
      company_files: 'view',
      approvals: 'view',
    },
  },
  {
    id: 'operations',
    name: 'Operations Manager',
    basedOn: 'operations',
    isSystem: true,
    defaultScope: 'company',
    color: '#D97706',
    description: 'Sees all CRO meetings, assigns team leaders, creates contracts and dispatches service jobs.',
    modules: {
      ...all('edit', ['dashboard', 'customers', 'inspections', 'contracts', 'calendar', 'jobs', 'files', 'complaints', 'challans', 'attendance', 'search']),
      crm: 'view',
      proposals: 'view',
      pco: 'view',
      documents: 'view',
      company_files: 'view',
    },
  },
  {
    id: 'team_leader',
    name: 'Operations Coordinator',
    basedOn: 'team_leader',
    isSystem: true,
    defaultScope: 'company',
    color: '#9A3412',
    description: 'Field team leader. Submits meeting reports and job reports. Leads PCO technicians on site. Manages challans and daily attendance.',
    modules: {
      ...all('edit', ['dashboard', 'inspections', 'jobs', 'files', 'complaints', 'challans', 'attendance', 'search']),
      customers: 'view',
      contracts: 'view',
      calendar: 'view',
      pco: 'view',
      company_files: 'view',
    },
  },
  {
    id: 'technician',
    name: 'Technician (PCO)',
    basedOn: 'technician',
    isSystem: true,
    defaultScope: 'own',
    color: '#0891B2',
    description: 'Field technician. Sees and completes only their own assigned service jobs.',
    modules: { dashboard: 'view', jobs: 'view', pco: 'edit', attendance: 'view' },
  },
  {
    id: 'finance',
    name: 'Accounts / Finance',
    basedOn: 'finance',
    isSystem: true,
    defaultScope: 'company',
    color: '#0A5A3E',
    description: 'Manages invoicing, tax, payroll cycles, salary payments, challan views, and search.',
    modules: {
      dashboard: 'view',
      invoices: 'edit',
      tax: 'view',
      payroll: 'edit',
      challans: 'view',
      search: 'edit',
      documents: 'view',
      contracts: 'view',
      customers: 'view',
    },
  },
  {
    id: 'hr',
    name: 'HR',
    basedOn: 'hr',
    isSystem: true,
    defaultScope: 'company',
    color: '#B45309',
    description: 'Enrolls employees, manages private data (CNIC/bank), attendance, and prepares payroll cycles.',
    modules: {
      dashboard: 'view',
      hr: 'edit',
      attendance: 'view',
      payroll: 'view',
      team: 'view',
      documents: 'view',
      search: 'view',
    },
  },];

export const SYSTEM_ROLE_IDS = DEFAULT_ROLES.map((r) => r.id) as SystemRole[];

// ---------- Live registry (defaults, overridden by the Firestore `roles` collection) ----------
let registry = new Map<string, RoleDefinition>(DEFAULT_ROLES.map((r) => [r.id, r]));

export function setRoleDefinitions(fromCloud: RoleDefinition[]) {
  const next = new Map<string, RoleDefinition>(DEFAULT_ROLES.map((r) => [r.id, r]));
  fromCloud.forEach((r) => {
    if (r.id === 'super_admin') return; // Super admin can never be narrowed
    const base = next.get(r.id);
    // For system roles: Firestore may change access *levels* but cannot add back modules that
    // DEFAULT_ROLES no longer lists (prevents stale Firestore data re-adding removed modules).
    // For custom roles: merge freely so admin-added modules are preserved.
    const baseModules = base?.modules ?? {};
    const mergedModules = base?.isSystem
      ? Object.fromEntries(
          Object.entries({ ...baseModules, ...r.modules }).filter(([k]) => k in baseModules)
        ) as Partial<Record<ModuleKey, AccessLevel>>
      : { ...baseModules, ...r.modules };
    next.set(r.id, { ...base, ...r, modules: mergedModules });
  });
  registry = next;
}

export const getRoleDefinitions = (): RoleDefinition[] => {
  const order = new Map(SYSTEM_ROLE_IDS.map((id, i) => [id as string, i]));
  return Array.from(registry.values()).sort(
    (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || a.name.localeCompare(b.name)
  );
};

export const getRole = (id: UserRole | null | undefined) => (id ? registry.get(id) : undefined);

export const accessLevel = (role: UserRole | null | undefined, module: ModuleKey): AccessLevel => {
  if (!role) return 'none';
  if (role === 'super_admin') return 'edit';
  const key = resolveRoleKey(role);
  return (key ? registry.get(key)?.modules[module] : undefined) ?? 'none';
};

export const canAccessModule = (role: UserRole | null | undefined, module: ModuleKey) => accessLevel(role, module) !== 'none';

export const canEditModule = (role: UserRole | null | undefined, module: ModuleKey) => accessLevel(role, module) === 'edit';

/** Company (IKPM) folder: who can see it, and who can upload / rename / move / delete in it. */
export const canViewCompanyFiles = (role: UserRole | null | undefined) => canAccessModule(role, 'company_files');
export const canEditCompanyFiles = (role: UserRole | null | undefined) => canEditModule(role, 'company_files');

/** The super admin and anyone given company-wide data access see every record. */
export const seesAllRecords = (role: UserRole, scope: DataScope) => role === 'super_admin' || scope === 'company';

export const roleLabel = (id: UserRole | null | undefined) => {
  const key = resolveRoleKey(id);
  return key ? registry.get(key)?.name || id?.replace(/_/g, ' ') : '—';
};

export const roleDescription = (id: UserRole) => registry.get(id)?.description || '';

export const roleColor = (id: UserRole) => registry.get(id)?.color || '#475569';

export const defaultScopeFor = (id: UserRole): DataScope => registry.get(id)?.defaultScope || 'own';

/** System template a role follows, used by older feature checks that list system roles. */
export const resolveRoleKey = (id: UserRole | null | undefined): UserRole | undefined => {
  if (!id) return undefined;
  if (id === 'operations_manager') return 'operations';
  if (id === 'operations_coordinator') return 'team_leader';
  return id;
};

export const baseRoleOf = (id: UserRole | null | undefined): SystemRole | undefined => {
  const key = resolveRoleKey(id);
  return key ? registry.get(key)?.basedOn : undefined;
};

export const SCOPE_LABELS: Partial<Record<DataScope, string>> = {
  own: 'Own records only',
  team: 'Own team’s records',
  company: 'Entire company',
};

const MODULE_HOME: Partial<Record<ModuleKey, string>> = {
  dashboard: '/',
  pco: '/operations/jobs',
  customers: '/customers',
  crm: '/crm',
  inspections: '/inspections',
  proposals: '/proposals',
  contracts: '/contracts',
  files: '/files',
  documents: '/documents',
  calendar: '/operations/calendar',
  jobs: '/operations/jobs',
  invoices: '/finance/invoices',
  tax: '/finance/tax-rules',
  settings: '/settings',
  team: '/admin/team',
};

/** Landing page for a role: the dashboard if allowed, otherwise the first module it can open. */
export const homePathFor = (role: UserRole | null | undefined): string => {
  if (canAccessModule(role, 'dashboard')) return '/';
  const first = (Object.keys(MODULE_HOME) as ModuleKey[]).find((m) => canAccessModule(role, m));
  return first ? MODULE_HOME[first]! : '/';
};
