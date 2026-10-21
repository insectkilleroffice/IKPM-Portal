// Guards the folder rules in firestore.rules that securityVerification.test.ts simulates,
// so the simulation and the deployed rules can't silently drift apart.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf-8');
const block = (match: string) => {
  const start = rules.indexOf(`match /${match}/`);
  expect(start, `match /${match}/ exists`).toBeGreaterThan(-1);
  const next = rules.indexOf('\n    match /', start + 1);
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
