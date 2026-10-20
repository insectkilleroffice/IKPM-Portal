// Core shared types for IKPM Portal

export type UserRole =
  | 'super_admin'
  | 'management'
  | 'sales'
  | 'operations'
  | 'finance'
  | 'technician'
  | 'auditor';

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
  isActive: boolean;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
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
  entityType: 'client' | 'company' | 'branch' | 'lead' | 'proposal' | 'contract' | 'job' | 'report' | 'invoice' | 'payment' | 'user' | 'tax_rule';
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
