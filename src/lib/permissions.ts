// Single source of truth for "who can see what". The sidebar, route guards and the Firestore
// subscriptions in dataService all read from here, and firestore.rules mirrors the same matrix
// so the server enforces it too.

import type { DataScope, UserRole } from '../types';

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
  | 'team';

export const MODULE_ROLES: Record<ModuleKey, UserRole[]> = {
  dashboard: ['super_admin', 'management', 'sales', 'operations', 'finance', 'auditor'],
  customers: ['super_admin', 'management', 'sales', 'operations', 'finance', 'auditor'],
  crm: ['super_admin', 'management', 'sales', 'auditor'],
  proposals: ['super_admin', 'management', 'sales', 'auditor'],
  contracts: ['super_admin', 'management', 'sales', 'operations', 'finance', 'auditor'],
  files: ['super_admin', 'management', 'sales', 'operations', 'finance', 'auditor'],
  documents: ['super_admin', 'management', 'sales', 'operations', 'auditor'],
  calendar: ['super_admin', 'management', 'operations', 'auditor'],
  jobs: ['super_admin', 'management', 'operations', 'auditor'],
  pco: ['super_admin', 'management', 'operations', 'technician'],
  invoices: ['super_admin', 'management', 'finance', 'auditor'],
  tax: ['super_admin', 'management', 'finance'],
  settings: ['super_admin', 'management', 'auditor'],
  team: ['super_admin'],
};

/** Firestore collections each role may read. Keep in sync with firestore.rules. */
export const COLLECTION_ROLES: Record<string, UserRole[]> = {
  companies: MODULE_ROLES.customers,
  branches: MODULE_ROLES.customers,
  clients: MODULE_ROLES.customers,
  sites: MODULE_ROLES.customers,
  leads: MODULE_ROLES.crm,
  proposals: MODULE_ROLES.proposals,
  contracts: MODULE_ROLES.contracts,
  service_jobs: ['super_admin', 'management', 'operations', 'finance', 'auditor', 'technician'],
  invoices: MODULE_ROLES.invoices,
  payments: MODULE_ROLES.invoices,
  tax_rules: ['super_admin', 'management', 'sales', 'operations', 'finance', 'auditor', 'technician'],
  documents: ['super_admin', 'management', 'sales', 'operations', 'finance', 'auditor', 'technician'],
  document_packs: ['super_admin', 'management', 'sales', 'operations', 'finance', 'auditor'],
  outreach_logs: ['super_admin', 'management', 'sales', 'auditor'],
  audit_logs: ['super_admin', 'management', 'auditor'],
};

export const canAccessModule = (role: UserRole | null | undefined, module: ModuleKey) =>
  Boolean(role && MODULE_ROLES[module].includes(role));

export const canReadCollection = (role: UserRole | null | undefined, collection: string) =>
  Boolean(role && COLLECTION_ROLES[collection]?.includes(role));

/** Roles that always see every record regardless of their data scope. */
export const COMPANY_WIDE_ROLES: UserRole[] = ['super_admin', 'management', 'auditor'];

export const seesAllRecords = (role: UserRole, scope: DataScope) =>
  COMPANY_WIDE_ROLES.includes(role) || scope === 'company';

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  management: 'Management',
  sales: 'Sales',
  operations: 'Operations',
  finance: 'Finance',
  technician: 'Technician (PCO)',
  auditor: 'Auditor (read-only)',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  super_admin: 'Full control, manages staff, teams and approvals',
  management: 'Sees everything, approves proposals, views reports',
  sales: 'Leads, proposals and own customers',
  operations: 'Dispatch, service jobs and field teams',
  finance: 'Invoices, receipts, WHT and tax rules',
  technician: 'Only jobs assigned to them in the PCO app',
  auditor: 'Read-only access for compliance review',
};

/** Sensible default scope when a super admin creates a user with this role. */
export const DEFAULT_SCOPE: Record<UserRole, DataScope> = {
  super_admin: 'company',
  management: 'company',
  sales: 'own',
  operations: 'company',
  finance: 'company',
  technician: 'own',
  auditor: 'company',
};

export const SCOPE_LABELS: Partial<Record<DataScope, string>> = {
  own: 'Own records only',
  team: 'Own team’s records',
  company: 'Entire company',
};

/** Landing page for each role, so nobody lands on a module they can't open. */
export const homePathFor = (role: UserRole | null | undefined): string => {
  if (role === 'technician') return '/pco-field';
  return '/';
};
