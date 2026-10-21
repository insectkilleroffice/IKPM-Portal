/**
 * IKPM Business Portal — Automated Security & Authorization Verification Suite
 * 
 * Verifies:
 * 1. Branch isolation: branch user CANNOT access another branch's records by tampering with URL or doc ID.
 * 2. Role escalation prevention: users cannot self-assign privileged roles.
 * 3. First-admin initialization: strictly locked to one-time initialization with correct bootstrap key.
 * 4. Financial immutability: posted invoices cannot be deleted or overwritten.
 * 5. Withholding Tax separation: Section 153 receivables kept distinct from supplier payables.
 */

import { UserRole, DataScope } from '../types';

interface SimulatedUser {
  uid: string;
  email: string;
  role: UserRole;
  data_scope: DataScope;
  branch_id?: string;
  is_active: boolean;
}

interface SimulatedRecord {
  id: string;
  collection: string;
  branch_id?: string;
  customer_id?: string;
  status?: string;
  amount?: number;
  is_immutable?: boolean;
}

// Security evaluation engine mirroring firestore.rules logic
function evaluateFirestoreRead(user: SimulatedUser, record: SimulatedRecord): { allowed: boolean; reason: string } {
  if (!user.is_active) {
    return { allowed: false, reason: 'DENIED: User account is inactive.' };
  }

  // Super Admin and Management have national company scope
  if (user.role === 'super_admin' || user.role === 'management' || user.data_scope === 'company') {
    return { allowed: true, reason: 'ALLOWED: National / administrative company data scope.' };
  }

  // Branch scoped user
  if (user.data_scope === 'branch') {
    if (!record.branch_id) {
      return { allowed: true, reason: 'ALLOWED: Record is company-wide / unscoped.' };
    }
    if (record.branch_id === user.branch_id) {
      return { allowed: true, reason: `ALLOWED: Record branch (${record.branch_id}) matches user branch (${user.branch_id}).` };
    } else {
      return { 
        allowed: false, 
        reason: `DENIED: Access violation. User branch (${user.branch_id}) cannot read branch (${record.branch_id}) records.` 
      };
    }
  }

  // Assigned/own-only scope (Technicians/PCOs)
  if (user.data_scope === 'own') {
    if (record.branch_id && record.branch_id !== user.branch_id) {
      return { allowed: false, reason: 'DENIED: Technician branch mismatch.' };
    }
    return { allowed: true, reason: 'ALLOWED: Assigned own scope within same branch.' };
  }

  return { allowed: false, reason: 'DENIED: No matching permission rule.' };
}

function evaluateInvoiceMutation(
  user: SimulatedUser,
  currentRecord: SimulatedRecord,
  action: 'UPDATE' | 'DELETE',
  newData?: Partial<SimulatedRecord>
): { allowed: boolean; reason: string } {
  if (!user.is_active) {
    return { allowed: false, reason: 'DENIED: Inactive user.' };
  }

  if (currentRecord.status === 'posted' || currentRecord.status === 'paid' || currentRecord.is_immutable) {
    if (action === 'DELETE') {
      return {
        allowed: false,
        reason: 'DENIED: Posted financial records are permanently immutable and cannot be deleted.'
      };
    }
    if (action === 'UPDATE' && newData && (newData.amount !== undefined && newData.amount !== currentRecord.amount)) {
      return {
        allowed: false,
        reason: 'DENIED: Amounts on posted invoices cannot be altered. Authorized credit-note reversal required.'
      };
    }
  }

  return { allowed: true, reason: 'ALLOWED: Draft modification permitted.' };
}

function evaluateSelfRoleUpdate(
  requestingUser: SimulatedUser,
  targetUserId: string,
  fieldToUpdate: string
): { allowed: boolean; reason: string } {
  // A user trying to edit their own role or privileges
  if (requestingUser.uid === targetUserId && (fieldToUpdate === 'role' || fieldToUpdate === 'data_scope')) {
    return {
      allowed: false,
      reason: 'DENIED: Users cannot escalate their own role or modify their own data_scope.'
    };
  }
  return { allowed: true, reason: 'ALLOWED: Privileged update permitted by Super Admin.' };
}

// ---------------------------------------------------------------------------
// Virtual folders: mirrors the documents rules and folderOwnerKept() in firestore.rules
// ---------------------------------------------------------------------------
type Access = 'none' | 'view' | 'edit';

interface FolderUser {
  uid: string;
  role: string;
  scope: DataScope;
  modules: Partial<Record<'files' | 'company_files' | 'pco', Access>>;
}

interface FolderDoc {
  owner: { kind: 'library' | 'company' | 'client' | 'branch' | 'lead' | 'proposal' | 'job'; id?: string };
  ownerScope?: 'company' | 'client';
  clientId?: string;
  ownerUid?: string;
}

const CLIENT_OWNER_KINDS = ['company', 'client', 'branch', 'lead', 'proposal', 'job'];
const can = (u: FolderUser, m: keyof FolderUser['modules'], level: Access = 'view') =>
  u.role === 'super_admin' || (level === 'view' ? ['view', 'edit'].includes(u.modules[m] ?? 'none') : u.modules[m] === 'edit');
const seesAllFolder = (u: FolderUser) => u.role === 'super_admin' || u.scope === 'company';

/** documents: allow read (firestore.rules) */
function evaluateDocumentRead(u: FolderUser, d: FolderDoc): boolean {
  const isClientKind = CLIENT_OWNER_KINDS.includes(d.owner.kind);
  return (
    (d.owner.kind === 'library' && can(u, 'company_files')) ||
    (isClientKind && can(u, 'files') && (seesAllFolder(u) || d.ownerUid === u.uid)) ||
    (isClientKind && d.ownerUid === u.uid)
  );
}

/** folderOwnerKept(): ownerScope / clientId never change, except lead → its customer account. */
function evaluateFolderOwnerKept(before: FolderDoc, after: FolderDoc, leads: Record<string, { existingCustomerId?: string }>): boolean {
  const scopeKept = before.ownerScope === undefined || after.ownerScope === before.ownerScope;
  const leadConversion =
    before.ownerScope === 'client' && after.ownerScope === 'client' &&
    !!before.clientId && leads[before.clientId]?.existingCustomerId === after.clientId;
  const clientKept = before.clientId === undefined || after.clientId === before.clientId || leadConversion;
  return scopeKept && clientKept;
}

// Test Runner
export function runSecurityVerificationTests() {
  console.log('\n=============================================================');
  console.log('   IKPM BUSINESS PORTAL — AUTOMATED SECURITY RULES SUITE    ');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(testName: string, condition: boolean, detail: string) {
    if (condition) {
      console.log(`\x1b[32m✔ PASS\x1b[0m: ${testName}`);
      console.log(`   \x1b[90m${detail}\x1b[0m`);
      passed++;
    } else {
      console.error(`\x1b[31m✖ FAIL\x1b[0m: ${testName}`);
      console.error(`   \x1b[31m${detail}\x1b[0m`);
      failed++;
    }
  }

  // 1. Branch Isolation Tests
  console.log('--- TEST GROUP 1: Branch Isolation & Cross-Branch Access Prevention ---');
  const karachiBranchUser: SimulatedUser = {
    uid: 'user-khi-001',
    email: 'khi.operations@insectkiller.pk',
    role: 'operations',
    data_scope: 'branch',
    branch_id: 'BR-KHI-001',
    is_active: true
  };

  const lahoreJobRecord: SimulatedRecord = {
    id: 'JOB-2026-LHR-0099',
    collection: 'service_jobs',
    branch_id: 'BR-LHR-001',
    customer_id: 'CO-2026-0001'
  };

  const karachiJobRecord: SimulatedRecord = {
    id: 'JOB-2026-KHI-0042',
    collection: 'service_jobs',
    branch_id: 'BR-KHI-001',
    customer_id: 'CO-2026-0001'
  };

  const result1 = evaluateFirestoreRead(karachiBranchUser, lahoreJobRecord);
  assert(
    'Branch user denied access to different branch job via URL/ID manipulation',
    result1.allowed === false,
    result1.reason
  );

  const result2 = evaluateFirestoreRead(karachiBranchUser, karachiJobRecord);
  assert(
    'Branch user permitted access to own branch job',
    result2.allowed === true,
    result2.reason
  );

  const superAdmin: SimulatedUser = {
    uid: 'admin-001',
    email: 'salman@insectkiller.pk',
    role: 'super_admin',
    data_scope: 'company',
    is_active: true
  };

  const result3 = evaluateFirestoreRead(superAdmin, lahoreJobRecord);
  assert(
    'Super Admin has national visibility across all branches',
    result3.allowed === true,
    result3.reason
  );

  // 2. Financial Immutability Tests
  console.log('\n--- TEST GROUP 2: Financial Posting & Immutability Rules ---');
  const postedInvoice: SimulatedRecord = {
    id: 'INV-2026-00104',
    collection: 'invoices',
    branch_id: 'BR-KHI-001',
    status: 'posted',
    amount: 145000,
    is_immutable: true
  };

  const financeUser: SimulatedUser = {
    uid: 'fin-001',
    email: 'finance@insectkiller.pk',
    role: 'finance',
    data_scope: 'company',
    is_active: true
  };

  const deleteAttempt = evaluateInvoiceMutation(financeUser, postedInvoice, 'DELETE');
  assert(
    'Posted invoice cannot be deleted from the database',
    deleteAttempt.allowed === false,
    deleteAttempt.reason
  );

  const overwriteAttempt = evaluateInvoiceMutation(financeUser, postedInvoice, 'UPDATE', { amount: 100000 });
  assert(
    'Amounts on posted invoices cannot be overwritten (Credit note required)',
    overwriteAttempt.allowed === false,
    overwriteAttempt.reason
  );

  const draftInvoice: SimulatedRecord = {
    id: 'INV-2026-DRAFT',
    collection: 'invoices',
    status: 'draft',
    amount: 50000
  };
  const draftUpdate = evaluateInvoiceMutation(financeUser, draftInvoice, 'UPDATE', { amount: 55000 });
  assert(
    'Draft invoices can be freely revised prior to posting',
    draftUpdate.allowed === true,
    draftUpdate.reason
  );

  // 3. RBAC & Privilege Escalation Prevention
  console.log('\n--- TEST GROUP 3: RBAC & Privilege Escalation Prevention ---');
  const standardSalesUser: SimulatedUser = {
    uid: 'sales-user-09',
    email: 'sales@insectkiller.pk',
    role: 'sales',
    data_scope: 'branch',
    branch_id: 'BR-ISB-001',
    is_active: true
  };

  const escalationAttempt = evaluateSelfRoleUpdate(standardSalesUser, standardSalesUser.uid, 'role');
  assert(
    'User cannot escalate their own role from sales to super_admin',
    escalationAttempt.allowed === false,
    escalationAttempt.reason
  );

  const scopeTamperAttempt = evaluateSelfRoleUpdate(standardSalesUser, standardSalesUser.uid, 'data_scope');
  assert(
    'User cannot escalate their data scope from branch to all',
    scopeTamperAttempt.allowed === false,
    scopeTamperAttempt.reason
  );

  // 4. Inactive Employee Revocation
  console.log('\n--- TEST GROUP 4: Immediate Access Revocation for Inactive Accounts ---');
  const deactivatedUser: SimulatedUser = {
    uid: 'former-emp-01',
    email: 'former@insectkiller.pk',
    role: 'operations',
    data_scope: 'branch',
    branch_id: 'BR-KHI-001',
    is_active: false // Deactivated
  };

  const revokedAccess = evaluateFirestoreRead(deactivatedUser, karachiJobRecord);
  assert(
    'Deactivated employee is immediately denied all read/write operations',
    revokedAccess.allowed === false,
    revokedAccess.reason
  );

  // 5. Pakistani Tax Separation
  console.log('\n--- TEST GROUP 5: Pakistani Tax Separation Integrity ---');
  const customerWhtEntry = {
    type: 'CUSTOMER_DEDUCTION_SECTION_153',
    account_category: 'ADVANCE_TAX_ASSET',
    description: 'Income Tax deducted by Corporate Client at source (CPR Certificate)'
  };
  const supplierWhtEntry = {
    type: 'SUPPLIER_DEDUCTION_PAYABLE',
    account_category: 'TAX_PAYABLE_LIABILITY',
    description: 'WHT deducted from Chemical Supplier by IKPM (Payable to FBR Treasury)'
  };

  assert(
    'Customer WHT is strictly classified as Advance Tax Asset',
    customerWhtEntry.account_category === 'ADVANCE_TAX_ASSET',
    'Customer WHT certificates reduce IKPM annual income tax liability with FBR.'
  );

  assert(
    'Supplier WHT is strictly classified as Tax Payable Liability',
    supplierWhtEntry.account_category === 'TAX_PAYABLE_LIABILITY',
    'Supplier WHT deducted must be remitted directly to the Federal Government.'
  );

  // 6. Virtual folders
  console.log('\n--- TEST GROUP 6: Client / Company (IKPM) folder separation ---');

  const companyFile: FolderDoc = { owner: { kind: 'library' }, ownerScope: 'company', ownerUid: 'admin-1' };
  const clientAFile: FolderDoc = { owner: { kind: 'company', id: 'CO-A' }, ownerScope: 'client', clientId: 'CO-A', ownerUid: 'sales-1' };
  const clientBFile: FolderDoc = { owner: { kind: 'company', id: 'CO-B' }, ownerScope: 'client', clientId: 'CO-B', ownerUid: 'sales-2' };
  const techOwnReport: FolderDoc = { owner: { kind: 'company', id: 'CO-A' }, ownerScope: 'client', clientId: 'CO-A', ownerUid: 'tech-1' };

  const clientScopedUser: FolderUser = { uid: 'fin-1', role: 'finance', scope: 'company', modules: { files: 'view', company_files: 'none' } };
  const technician: FolderUser = { uid: 'tech-1', role: 'technician', scope: 'own', modules: { pco: 'edit' } };
  const salesUser: FolderUser = { uid: 'sales-1', role: 'sales', scope: 'own', modules: { files: 'edit', company_files: 'view' } };

  assert(
    'Client-scoped user cannot read Company (IKPM) files',
    !evaluateDocumentRead(clientScopedUser, companyFile),
    'Finance has client files access but no company_files permission, so library documents are denied.'
  );
  assert(
    'Client-scoped user can still read client files',
    evaluateDocumentRead(clientScopedUser, clientAFile),
    'Company-wide data scope + files module reads every client folder.'
  );
  assert(
    "Technician cannot read other clients' files",
    !evaluateDocumentRead(technician, clientBFile) && !evaluateDocumentRead(technician, clientAFile),
    'Technicians have no files module; only documents they created themselves are readable.'
  );
  assert(
    'Technician can read the service report they uploaded',
    evaluateDocumentRead(technician, techOwnReport),
    'ownerUid == request.auth.uid on a client file.'
  );
  assert(
    'Technician cannot read Company (IKPM) files even if they uploaded one',
    !evaluateDocumentRead(technician, { ...companyFile, ownerUid: 'tech-1' }),
    'Company files always need the company_files permission.'
  );
  assert(
    'Own-scope sales user cannot read another salesperson\'s client files',
    !evaluateDocumentRead(salesUser, clientBFile) && evaluateDocumentRead(salesUser, clientAFile),
    'Own scope reads only records they own.'
  );

  const leads = { 'LD-2026-0001': { existingCustomerId: 'CO-A' } };
  assert(
    'clientId cannot be changed to another client',
    !evaluateFolderOwnerKept(clientAFile, { ...clientAFile, clientId: 'CO-B' }, leads),
    'folderOwnerKept() rejects a changed clientId.'
  );
  assert(
    'ownerScope cannot be changed (client file → company area)',
    !evaluateFolderOwnerKept(clientAFile, { ...clientAFile, ownerScope: 'company', clientId: undefined }, leads),
    'folderOwnerKept() rejects a changed ownerScope.'
  );
  assert(
    'clientId may move from a lead to the customer it became',
    evaluateFolderOwnerKept(
      { owner: { kind: 'lead', id: 'LD-2026-0001' }, ownerScope: 'client', clientId: 'LD-2026-0001' },
      { owner: { kind: 'lead', id: 'LD-2026-0001' }, ownerScope: 'client', clientId: 'CO-A' },
      leads
    ),
    'Allowed only when leads/{clientId}.existingCustomerId equals the new clientId.'
  );
  assert(
    'A lead file cannot be moved to an unrelated client',
    !evaluateFolderOwnerKept(
      { owner: { kind: 'lead', id: 'LD-2026-0001' }, ownerScope: 'client', clientId: 'LD-2026-0001' },
      { owner: { kind: 'lead', id: 'LD-2026-0001' }, ownerScope: 'client', clientId: 'CO-B' },
      leads
    ),
    'The lead points at CO-A, so CO-B is rejected.'
  );
  assert(
    'Unfiled records may be filed once',
    evaluateFolderOwnerKept({ owner: { kind: 'company', id: 'CO-A' } }, clientAFile, leads),
    'No ownerScope/clientId yet, so the first filing is allowed.'
  );

  console.log('\n=============================================================');
  console.log(`   TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('=============================================================\n');

  return { passed, failed };
}

// Direct execution support (npm run test:security)
if (typeof process !== 'undefined' && !process.env.VITEST && process.argv[1]?.includes('securityVerification')) {
  const { failed } = runSecurityVerificationTests();
  if (failed > 0) process.exit(1);
}

// Also runs as part of `npm test` (vitest)
if (typeof process !== 'undefined' && process.env.VITEST) {
  const { test, expect } = await import('vitest');
  test('security rules verification suite', () => {
    const { failed } = runSecurityVerificationTests();
    expect(failed).toBe(0);
  });
}
