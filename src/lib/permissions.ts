// Single source of truth for "who can see what".
// Roles are data: the super admin edits them on the Team & Access page (stored in the Firestore
// `roles` collection). Each role gives every module an access level: none / view / edit.
// The sidebar, route guards and Firestore subscriptions read from here, and firestore.rules
// reads the same role documents, so the server enforces exactly what the UI shows.

import type { DataScope, UserRole } from '../types';

export type SystemRole = 'super_admin' | 'management' | 'sales' | 'operations' | 'finance' | 'technician' | 'auditor';

export type ModuleKey =
  | 'dashboard'
  | 'customers'
  | 'crm'
  | 'proposals'
  | 'contracts'
  | 'files'
  | 'documents'
  | 'calendar'
  | 'jobs'
  | 'pco'
  | 'invoices'
  | 'tax'
  | 'settings'
  | 'team'
  | 'roles';

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
  createdAt?: string;
  updatedAt?: string;
}

export const MODULES: { key: ModuleKey; label: string; group: string; hint?: string }[] = [
  { key: 'dashboard', label: 'Dashboard', group: 'General' },
  { key: 'customers', label: 'Customer accounts', group: 'Sales & customers' },
  { key: 'crm', label: 'Leads', group: 'Sales & customers' },
  { key: 'proposals', label: 'Proposals', group: 'Sales & customers' },
  { key: 'contracts', label: 'Contracts & AMCs', group: 'Sales & customers' },
  { key: 'files', label: 'Client files', group: 'Files' },
  { key: 'documents', label: 'Company documents', group: 'Files' },
  { key: 'calendar', label: 'Dispatch calendar', group: 'Field operations' },
  { key: 'jobs', label: 'Service jobs', group: 'Field operations' },
  { key: 'pco', label: 'PCO field app', group: 'Field operations', hint: 'Only jobs assigned to the person' },
  { key: 'invoices', label: 'Invoices & receipts', group: 'Accounts' },
  { key: 'tax', label: 'Tax rules & WHT', group: 'Accounts' },
  { key: 'settings', label: 'Settings & audit trail', group: 'Administration' },
  { key: 'team', label: 'Manage staff & teams', group: 'Administration', hint: 'Add people, set passwords, build teams' },
  { key: 'roles', label: 'Customize roles', group: 'Administration', hint: 'Change what each role can do' },
];

const all = (level: AccessLevel, keys: ModuleKey[]) => Object.fromEntries(keys.map((k) => [k, level])) as Partial<Record<ModuleKey, AccessLevel>>;

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: 'super_admin', name: 'Super Admin', basedOn: 'super_admin', isSystem: true, defaultScope: 'company', color: '#7C3AED',
    description: 'Full control of the portal, staff, teams and roles',
    modules: all('edit', MODULES.map((m) => m.key)),
  },
  {
    id: 'management', name: 'Management', basedOn: 'management', isSystem: true, defaultScope: 'company', color: '#1B3A63',
    description: 'Sees everything, approves proposals, views reports',
    modules: { ...all('edit', ['dashboard', 'customers', 'crm', 'proposals', 'contracts', 'files', 'documents', 'calendar', 'jobs', 'pco', 'invoices', 'tax']), settings: 'view' },
  },
  {
    id: 'sales', name: 'Sales', basedOn: 'sales', isSystem: true, defaultScope: 'own', color: '#1A73E8',
    description: 'Leads, proposals and their own customers',
    modules: { ...all('edit', ['dashboard', 'customers', 'crm', 'proposals', 'contracts', 'files']), documents: 'view' },
  },
  {
    id: 'operations', name: 'Operations', basedOn: 'operations', isSystem: true, defaultScope: 'company', color: '#D97706',
    description: 'Dispatch, service jobs and field teams',
    modules: { ...all('edit', ['dashboard', 'calendar', 'jobs', 'pco', 'files']), customers: 'view', contracts: 'view', documents: 'view' },
  },
  {
    id: 'finance', name: 'Finance', basedOn: 'finance', isSystem: true, defaultScope: 'company', color: '#0E8A5F',
    description: 'Invoices, receipts, WHT and tax rules',
    modules: { ...all('edit', ['dashboard', 'invoices', 'tax']), customers: 'view', contracts: 'view', files: 'view', jobs: 'view' },
  },
  {
    id: 'technician', name: 'Technician (PCO)', basedOn: 'technician', isSystem: true, defaultScope: 'own', color: '#9A3412',
    description: 'Only the jobs assigned to them, in the PCO field app',
    modules: { pco: 'edit' },
  },
  {
    id: 'auditor', name: 'Auditor (read-only)', basedOn: 'auditor', isSystem: true, defaultScope: 'company', color: '#4B5563',
    description: 'Read-only access for compliance review',
    modules: all('view', ['dashboard', 'customers', 'crm', 'proposals', 'contracts', 'files', 'documents', 'calendar', 'jobs', 'invoices', 'settings']),
  },
];

export const SYSTEM_ROLE_IDS = DEFAULT_ROLES.map((r) => r.id) as SystemRole[];

// ---------- Live registry (defaults, overridden by the Firestore `roles` collection) ----------
let registry = new Map<string, RoleDefinition>(DEFAULT_ROLES.map((r) => [r.id, r]));

export function setRoleDefinitions(fromCloud: RoleDefinition[]) {
  const next = new Map<string, RoleDefinition>(DEFAULT_ROLES.map((r) => [r.id, r]));
  fromCloud.forEach((r) => {
    if (r.id === 'super_admin') return; // Super admin can never be narrowed
    next.set(r.id, { ...next.get(r.id), ...r, modules: { ...r.modules } });
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
  return registry.get(role)?.modules[module] ?? 'none';
};

export const canAccessModule = (role: UserRole | null | undefined, module: ModuleKey) => accessLevel(role, module) !== 'none';

export const canEditModule = (role: UserRole | null | undefined, module: ModuleKey) => accessLevel(role, module) === 'edit';

/** The super admin and anyone given company-wide data access see every record. */
export const seesAllRecords = (role: UserRole, scope: DataScope) => role === 'super_admin' || scope === 'company';

export const roleLabel = (id: UserRole | null | undefined) => (id ? registry.get(id)?.name || id.replace(/_/g, ' ') : '—');

export const roleDescription = (id: UserRole) => registry.get(id)?.description || '';

export const roleColor = (id: UserRole) => registry.get(id)?.color || '#475569';

export const defaultScopeFor = (id: UserRole): DataScope => registry.get(id)?.defaultScope || 'own';

/** System template a role follows, used by older feature checks that list system roles. */
export const baseRoleOf = (id: UserRole | null | undefined): SystemRole | undefined => (id ? registry.get(id)?.basedOn : undefined);

export const SCOPE_LABELS: Partial<Record<DataScope, string>> = {
  own: 'Own records only',
  team: 'Own team’s records',
  company: 'Entire company',
};

const MODULE_HOME: Partial<Record<ModuleKey, string>> = {
  dashboard: '/',
  pco: '/pco-field',
  customers: '/customers',
  crm: '/crm',
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
