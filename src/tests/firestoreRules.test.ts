// Guards the folder rules in firestore.rules that securityVerification.test.ts simulates,
// so the simulation and the deployed rules can't silently drift apart.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf-8');
const block = (match: string) => {
  const start = rules.indexOf(`match /${match}/`);
  expect(start, `match /${match}/ exists`).toBeGreaterThan(-1);
  const next = rules.indexOf('match /', start + 1);
  return rules.slice(start, next < 0 ? undefined : next);
};

describe('firestore.rules: folders', () => {
  it('company files need company_files access; client files need files access', () => {
    const docs = block('documents');
    expect(docs).toMatch(/ownerKind\(resource\.data\) == 'library' && canViewCompanyFiles\(\)/);
    expect(docs).toMatch(/isClientKind\(resource\.data\) && canView\('files'\) && inScope/);
    expect(docs).toMatch(/owner\.kind == 'library' && canEditCompanyFiles\(\)/);
    // Roles saved before company_files existed fall back to 'documents'
    expect(rules).toMatch(/get\('company_files', roleModules\(\)\.get\('documents', 'none'\)\)/);
  });

  it('template versions are create-only; commercial wording is super admin only', () => {
    const t = block('template_versions');
    expect(t).toMatch(/allow update, delete: if false/);
    expect(t).toMatch(/kind == 'commercial' && isSuperAdmin\(\)/);
    expect(t).toMatch(/kind == 'wording' && canEditWordingTemplates\(\)/);
  });

  it('ownerScope must match the owner on create and update', () => {
    expect(block('documents').match(/scopeMatchesOwner\(request\.resource\.data\)/g)?.length).toBe(2);
  });

  it.each(['documents', 'invoices', 'document_packs'])('%s keep ownerScope / clientId on update', (c) => {
    expect(block(c)).toMatch(/folderOwnerKept\(\)/);
  });

  it.each(['proposals', 'contracts'])('%s keep ownerScope / clientId (via updateMod)', (c) => {
    expect(block(c)).toMatch(/updateMod\(/);
    expect(rules).toMatch(/function updateMod[\s\S]*?folderOwnerKept\(\)/);
  });

  it('clientId only changes on lead conversion', () => {
    expect(rules).toMatch(/function leadConversion\(\)[\s\S]*?existingCustomerId/);
    expect(rules).toMatch(/request\.resource\.data\.get\('clientId', null\) == resource\.data\.clientId\s*\|\| leadConversion\(\)/);
  });

  it('technicians cannot change folder fields on their jobs', () => {
    expect(block('service_jobs')).toMatch(/'ownerScope', 'clientId', 'clientType', 'branchId', 'folderPath', 'fileCategory'/);
  });

  it('posted invoices stay immutable and audit logs append-only', () => {
    expect(block('invoices')).toMatch(/isPosted', false\) != true/);
    expect(block('invoices')).toMatch(/allow delete: if false/);
    expect(block('audit_logs')).toMatch(/allow update, delete: if false/);
  });

  it('payments and outreach logs only change by being filed', () => {
    expect(block('payments')).toMatch(/allow update: if canEdit\('invoices'\) && filingOnly\(\)/);
    expect(block('outreach_logs')).toMatch(/allow update: if filingOnly\(\)/);
  });
});

describe('firestore.rules: complaints', () => {
  it('complaints collection rule block exists', () => {
    expect(rules).toMatch(/match \/complaints\/\{id\}/);
  });

  it('complaints require complaints module access to read', () => {
    const c = block('complaints');
    expect(c).toMatch(/canView\('complaints'\)/);
  });

  it('complaints require edit access to create', () => {
    const c = block('complaints');
    expect(c).toMatch(/canEdit\('complaints'\)/);
  });

  it('complaints are scoped (inScope check on read)', () => {
    const c = block('complaints');
    expect(c).toMatch(/inScope/);
  });

  it('complaints can only be deleted by super admin', () => {
    const c = block('complaints');
    expect(c).toMatch(/isSuperAdmin\(\)/);
  });

  it('defaultModulesFor includes complaints for management, sales, operations', () => {
    expect(rules).toMatch(/'complaints':'edit'.*'settings':'view'/s);
    const mgmt = rules.match(/r == 'management'[\s\S]*?complaints.*?edit/)?.[0];
    expect(mgmt).toBeTruthy();
  });

  it('defaultModulesFor includes complaints view for finance and auditor', () => {
    expect(rules).toMatch(/'complaints':'view'/);
  });

  it('defaultModulesFor includes admin role with edit on operational modules and view on invoices/settings', () => {
    const adminBlock = rules.match(/r == 'admin'[\s\S]*?'approvals':'view'\}/)?.[0];
    expect(adminBlock).toBeTruthy();
    expect(adminBlock).toMatch(/'dashboard':'edit'/);
    expect(adminBlock).toMatch(/'customers':'edit'/);
    expect(adminBlock).toMatch(/'complaints':'edit'/);
    expect(adminBlock).toMatch(/'invoices':'view'/);
    expect(adminBlock).toMatch(/'approvals':'view'/);
  });

  it('defaultModulesFor gives management edit on approvals', () => {
    const mgmtBlock = rules.match(/r == 'management'[\s\S]*?'approvals':'edit'\}/)?.[0];
    expect(mgmtBlock).toBeTruthy();
  });

  it('approvals rules: managers can update; nobody can approve own request', () => {
    expect(rules).toMatch(/match \/approvals\/\{id\}/);
    expect(rules).toMatch(/canEdit\('approvals'\)/);
    expect(rules).toMatch(/resource\.data\.ownerUid != request\.auth\.uid/);
  });

  it('approvals rules: requesters can only read their own; managers read all', () => {
    const appBlock = rules.match(/match \/approvals\/\{id\}[\s\S]*?allow delete/)?.[0];
    expect(appBlock).toBeTruthy();
    expect(appBlock).toMatch(/canEdit\('approvals'\)/);
    expect(appBlock).toMatch(/resource\.data\.ownerUid == request\.auth\.uid/);
  });

  it('contracts rule allows canEdit write (required for approval-triggered cancel/reactivate)', () => {
    const contractBlock = block('contracts');
    expect(contractBlock).toMatch(/canEdit\('contracts'\)/);
    expect(contractBlock).toMatch(/allow (create|update|write)/);
  });

  it('contracts are protected by updateMod (folder ownership preserved on update)', () => {
    expect(block('contracts')).toMatch(/updateMod\(/);
  });

  it('new module rules: coordinator cannot read employee_private; finance can read employee_pay; technician cannot read other attendance', () => {
    const privBlock = block('employee_private');
    expect(privBlock).toMatch(/canEdit\('hr'\) \|\| isSuperAdmin\(\)/);
    expect(privBlock).not.toMatch(/operations/);

    const payBlock = block('employee_pay');
    expect(payBlock).toMatch(/canView\('payroll'\) \|\| canEdit\('payroll'\)/);

    const attBlock = block('attendance');
    expect(attBlock).toMatch(/role\(\) == 'technician' && resource\.data\.get\('employeeId', ''\) == me\(\)\.get\('employeeId', ''\)/);
  });
});