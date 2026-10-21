// Runs firestore.rules in the Firestore emulator (needs Java + firebase-tools):
//   npm run test:rules
// Skipped in the normal `npm test` run, where FIRESTORE_EMULATOR_HOST is not set.
// Talks to the emulator's REST API with unsigned mock ID tokens, so no extra packages are needed.
import { beforeAll, describe, expect, it } from 'vitest';

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-ikpm';
const BASE = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const toValue = (v: Json): Record<string, unknown> => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
};
const toFields = (o: { [k: string]: Json }) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (uid: string) =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    email: `${uid}@ikpm.test`,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    auth_time: Math.floor(Date.now() / 1000),
    firebase: { sign_in_provider: 'password', identities: {} },
  })}.`;

const call = (method: string, path: string, as: string, body?: { [k: string]: Json }, query = '') =>
  fetch(`${BASE}/${path}${query}`, {
    method,
    headers: { Authorization: `Bearer ${as === 'owner' ? 'owner' : tokenFor(as)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify({ fields: toFields(body) }) : undefined,
  }).then((r) => r.status);

/** Writes bypassing the rules. */
const seed = (path: string, data: { [k: string]: Json }) => call('PATCH', path, 'owner', data);
const read = (as: string, path: string) => call('GET', path, as);
const create = (as: string, path: string, data: { [k: string]: Json }) => call('PATCH', path, as, data, '?currentDocument.exists=false');
const update = (as: string, path: string, data: { [k: string]: Json }) => call('PATCH', path, as, data, '?currentDocument.exists=true');

const OK = 200;
const DENIED = 403;

describe.skipIf(!HOST)('firestore.rules in the emulator: old records and templates', () => {
  // A legacy client file: no owner, ownerScope, clientId or fileCategory
  const legacyDoc = { title: 'Old report', ownerUid: 'u_sales', uploadedAt: '2025-01-01' };
  // A legacy company (library) file: owner set, no ownerScope
  const legacyLibrary = { title: 'MSDS Fendona', owner: { kind: 'library', id: 'msds' }, ownerUid: 'u_admin' };
  const filedContract = { customerId: 'C1', ownerUid: 'u_mgmt', ownerScope: 'client', clientId: 'C1', folderPath: 'clients/C1/contracts', status: 'active' };

  beforeAll(async () => {
    await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    await seed('users/u_admin', { role: 'super_admin', isActive: true, dataScope: 'company' });
    await seed('users/u_mgmt', { role: 'management', isActive: true, dataScope: 'company' });
    await seed('users/u_sales', { role: 'sales', isActive: true, dataScope: 'own' });
    await seed('users/u_fin', { role: 'finance', isActive: true, dataScope: 'company' });
    // Role documents saved before company_files / templates existed
    await seed('roles/management', { modules: { files: 'edit', documents: 'view', contracts: 'edit' } });
    await seed('roles/sales', { modules: { files: 'edit', contracts: 'edit' } });
    await seed('roles/finance', { modules: { invoices: 'edit' } });
    await seed('documents/legacy1', legacyDoc);
    await seed('documents/lib1', legacyLibrary);
    await seed('contracts/old1', { customerId: 'C1', ownerUid: 'u_mgmt', status: 'active' });
    await seed('contracts/filed1', filedContract);
    await seed('template_versions/wording_v1', { kind: 'wording', version: 1, data: { coverLetter: 'x' }, savedBy: 'a', savedByUid: 'u_admin', savedAt: '2026-01-01' });
  });

  it('old client files without owner / ownerScope keep the previous access (files + scope)', async () => {
    expect(await read('u_sales', 'documents/legacy1')).toBe(OK); // own record
    expect(await read('u_mgmt', 'documents/legacy1')).toBe(OK); // company-wide scope
    expect(await read('u_fin', 'documents/legacy1')).toBe(DENIED); // no files access
  });

  it('old client files can be filed into a folder once', async () => {
    const filed = { ...legacyDoc, ownerScope: 'client', clientId: 'C1', clientType: 'company', folderPath: 'clients/C1/documents', fileCategory: 'other' };
    expect(await update('u_mgmt', 'documents/legacy1', filed)).toBe(OK);
    // Once filed, the client cannot be changed
    expect(await update('u_mgmt', 'documents/legacy1', { ...filed, clientId: 'C2' })).toBe(DENIED);
  });

  it('old company files: roles without company_files fall back to documents access', async () => {
    expect(await read('u_mgmt', 'documents/lib1')).toBe(OK); // documents: view
    expect(await read('u_sales', 'documents/lib1')).toBe(DENIED); // neither
    expect(await update('u_mgmt', 'documents/lib1', { ...legacyLibrary, title: 'changed' })).toBe(DENIED); // view only
    expect(await update('u_admin', 'documents/lib1', { ...legacyLibrary, title: 'changed' })).toBe(OK);
  });

  it('old contracts without folder fields stay editable; filed ones keep their client', async () => {
    expect(await update('u_mgmt', 'contracts/old1', { customerId: 'C1', ownerUid: 'u_mgmt', status: 'expired' })).toBe(OK);
    expect(await update('u_mgmt', 'contracts/filed1', { ...filedContract, status: 'expired' })).toBe(OK);
    expect(await update('u_mgmt', 'contracts/filed1', { ...filedContract, clientId: 'C9' })).toBe(DENIED);
  });

  it('template versions: wording by management, commercial by super admin only, never overwritten', async () => {
    const v = (kind: string, version: number, uid: string, data: { [k: string]: Json }) => ({ kind, version, data, savedBy: uid, savedByUid: uid, savedAt: '2026-10-21' });
    expect(await create('u_mgmt', 'template_versions/wording_v2', v('wording', 2, 'u_mgmt', { coverLetter: 'Hi' }))).toBe(OK);
    expect(await create('u_mgmt', 'template_versions/wording_v3', v('wording', 3, 'u_mgmt', { terms: ['sneaky'] }))).toBe(DENIED);
    expect(await create('u_mgmt', 'template_versions/commercial_v1', v('commercial', 1, 'u_mgmt', { terms: ['x'] }))).toBe(DENIED);
    expect(await create('u_sales', 'template_versions/wording_v3', v('wording', 3, 'u_sales', { coverLetter: 'Hi' }))).toBe(DENIED);
    expect(await create('u_admin', 'template_versions/commercial_v1', v('commercial', 1, 'u_admin', { terms: ['x'] }))).toBe(OK);
    expect(await update('u_admin', 'template_versions/wording_v1', v('wording', 1, 'u_admin', { coverLetter: 'overwrite' }))).toBe(DENIED);
  });
});
