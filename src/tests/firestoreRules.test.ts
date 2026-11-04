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
    expect(rules).toMatch(/ownerKind\(resource\.data\) == 'library' && \(isSA\(w\) \|\| \(w\.active && companyFiles\(w\) in \['view', 'edit'\]\)\)/);
    expect(rules).toMatch(/isClientKind\(resource\.data\) && canV\(w, 'files'\) && inScope/);
    expect(rules).toMatch(/owner\.kind == 'library' && \(isSA\(w\) \|\| companyFiles\(w\) == 'edit'\)/);
    // Roles saved before company_files existed fall back to 'documents'
    expect(rules).toMatch(/w\.mods\.get\('company_files', w\.mods\.get\('documents', 'none'\)\)/);
  });

  it('template versions are create-only; commercial wording is super admin only', () => {
    const t = block('template_versions');
    expect(t).toMatch(/allow update, delete: if false/);
    expect(rules).toMatch(/kind == 'commercial' && isSA\(w\)/);
    expect(rules).toMatch(/kind == 'wording'\s*&& \(isSA\(w\) \|\| w\.mods\.get\('templates'/);
  });

  // Rule logic lives in named functions (each rule reads the caller once through who())
  const fn = (name: string) => {
    const start = rules.indexOf(`function ${name}(`);
    expect(start, `function ${name} exists`).toBeGreaterThan(-1);
    return rules.slice(start, rules.indexOf('\n    }', start));
  };

  it('ownerScope must match the owner on create and update', () => {
    expect(fn('documentCreate')).toMatch(/scopeMatchesOwner\(request\.resource\.data\)/);
    expect(fn('documentUpdate')).toMatch(/scopeMatchesOwner\(request\.resource\.data\)/);
  });

  it.each([['documents', 'documentUpdate'], ['invoices', 'invoiceUpdate']])('%s keep ownerScope / clientId on update', (_c, f) => {
    expect(fn(f)).toMatch(/folderOwnerKept\(\)/);
  });

  it('document packs keep ownerScope / clientId on update', () => {
    expect(block('document_packs')).toMatch(/folderOwnerKept\(\)/);
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
    expect(rules).toMatch(/function jobUpdate[\s\S]*?'ownerScope', 'clientId', 'clientType', 'branchId', 'folderPath', 'fileCategory'/);
  });

  it('posted invoices stay immutable and audit logs append-only', () => {
    expect(rules).toMatch(/function invoiceUpdate[\s\S]*?isPosted', false\) != true/);
    expect(block('invoices')).toMatch(/allow delete: if false/);
    expect(block('audit_logs')).toMatch(/allow update, delete: if false/);
  });

  it('payments only change by being filed or getting their WHT certificate (amounts fixed); outreach logs only by filing', () => {
    expect(block('payments')).toMatch(/allow update: if canE\(who\(\), 'invoices'\) && \(filingOnly\(who\(\)\)/);
    expect(block('payments')).toMatch(/customerWhtDeducted\.amountDeducted == resource\.data\.customerWhtDeducted\.amountDeducted/);
    expect(block('outreach_logs')).toMatch(/allow update: if filingOnly\(who\(\)\)/);
  });
});

describe('firestore.rules: complaints', () => {
  it('complaints collection rule block exists', () => {
    expect(rules).toMatch(/match \/complaints\/\{id\}/);
  });

  it('complaints require complaints module access to read', () => {
    const c = block('complaints');
    expect(c).toMatch(/readMod\(who\(\), 'complaints'\)/);
  });

  it('complaints require edit access to create', () => {
    const c = block('complaints');
    expect(c).toMatch(/canE\(who\(\), 'complaints'\)|createMod\(who\(\), 'complaints'\)/);
  });

  it('complaints are scoped (inScope check on read)', () => {
    const c = block('complaints');
    expect(c).toMatch(/inScope/);
  });

  it('complaints can only be deleted by super admin', () => {
    const c = block('complaints');
    expect(c).toMatch(/allow delete: if isSA\(who\(\)\)/);
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
    expect(rules).toMatch(/canE\(who\(\), 'approvals'\)/);
    expect(rules).toMatch(/resource\.data\.ownerUid != request\.auth\.uid/);
  });

  it('approvals rules: requesters can only read their own; managers read all', () => {
    const appBlock = rules.match(/match \/approvals\/\{id\}[\s\S]*?allow delete/)?.[0];
    expect(appBlock).toBeTruthy();
    expect(appBlock).toMatch(/canE\(who\(\), 'approvals'\)/);
    expect(appBlock).toMatch(/resource\.data\.ownerUid == request\.auth\.uid/);
  });

  it('contracts rule allows canEdit write (required for approval-triggered cancel/reactivate)', () => {
    const contractBlock = block('contracts');
    expect(rules).toMatch(/function contractUpdate[\s\S]*?canE\(w, 'contracts'\)/);
    expect(contractBlock).toMatch(/allow (create|update|write)/);
  });

  it('contracts are protected by updateMod (folder ownership preserved on update)', () => {
    expect(rules).toMatch(/function contractUpdate\(w\) \{\s*return updateMod\(w, 'contracts'\)/);
  });

  it('new module rules: coordinator cannot read employee_private; finance can read employee_pay; technician cannot read other attendance', () => {
    // CNIC / bank data: HR and the CEO only, checked by role so an 'hr' module grant never exposes it
    const privBlock = block('employee_private');
    expect(privBlock).toMatch(/allow read: if isHrOrCeo\(who\(\)\)/);
    expect(privBlock).toMatch(/allow create, update: if isHrOrCeo\(who\(\)\)/);
    expect(privBlock).not.toMatch(/canE\(who\(\), 'hr'\)|operations/);
    // By role (or the role it is based on), never by module level
    expect(rules).toMatch(/function isHrOrCeo\(w\) \{\s*return isSA\(w\) \|\| isBase\(w, 'hr'\);/);

    const payBlock = block('employee_pay');
    expect(payBlock).toMatch(/canV\(who\(\), 'payroll'\)/);

    const attBlock = block('attendance');
    expect(rules).toMatch(/isBase\(w, 'technician'\) && resource\.data\.get\('employeeId', ''\) == get\(profilePath\(\)\)\.data\.get\('employeeId', ''\)/);
  });
});