// Core shared types for IKPM Portal

/**
 * A role id: one of the built-in roles ('super_admin', 'admin', 'sales', 'operations', 'team_leader', 'technician')
 * or a custom role created by the super admin.
 * Definitions live in src/lib/permissions.ts and the Firestore `roles` collection.
 */
export type UserRole = string;

export type DataScope = 'own' | 'team' | 'area' | 'branch' | 'department' | 'company';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  dataScope: DataScope;
  departmentId?: string;
  departmentName?: string;
  designationId?: string;
  designationTitle?: string;
  branchId?: string;
  branchName?: string;
  area?: string;
  /** Team this user belongs to (managed by the super admin). Drives "team" data scope. */
  teamId?: string;
  teamName?: string;
  /** Address client emails are sent from. Defaults to the login email. */
  businessEmail?: string;
  isActive: boolean;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface Team {
  id: string;
  name: string;
  department?: string;
  description?: string;
  leadUid?: string;
  leadName?: string;
  leaderId?: string;
  leaderName?: string;
  color?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Stamped on every business record when it's first created; firestore.rules uses it to scope access. */
export interface RecordOwnership {
  ownerUid?: string;
  ownerName?: string;
  ownerEmail?: string;
  teamId?: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  headUserId?: string;
  headUserName?: string;
  isActive: boolean;
}

export interface Designation {
  id: string;
  departmentId: string;
  title: string;
  level: number; // 1 (Executive/CEO) to 7 (Field Technician)
  defaultRole: UserRole;
  defaultScope: DataScope;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  action: 'create' | 'update' | 'delete' | 'status_change' | 'approve' | 'reject' | 'reverse' | 'login';
  entityType: 'client' | 'company' | 'branch' | 'lead' | 'proposal' | 'contract' | 'job' | 'report' | 'invoice' | 'payment' | 'user' | 'tax_rule' | 'document' | 'outreach' | 'template' | 'device' | 'monitoring' | 'complaint' | 'approval' | 'challan' | 'employee' | 'attendance' | 'payroll';
  entityId: string;
  entityTitle?: string;
  details: string;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  ipAddress?: string;
}

export interface SystemInitialization {
  isInitialized: boolean;
  superAdminUid?: string;
  superAdminEmail?: string;
  setupCompletedAt?: string;
  organizationName: string;
}
