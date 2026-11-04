// Real workflow checks for firestore.rules, run in the Firestore emulator (needs Java + firebase-tools):
//   npm run test:rules
// Each test sends the same write the portal sends (a merge of only the changed top-level fields, like
// dataService.write) as the role that does it in real use, and checks the server's answer.
// Skipped in the normal `npm test` run, where FIRESTORE_EMULATOR_HOST is not set.
import { beforeAll, describe, expect, it } from 'vitest';

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-ikpm';
const ROOT = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;

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
const token = (uid: string) => {
  const t = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, user_id: uid, email: `${uid}@ikpm.test`,
    iat: t, exp: t + 3600, auth_time: t, firebase: { sign_in_provider: 'password', identities: {} },
  })}.`;
};
const auth = (as: string) => ({ Authorization: `Bearer ${as === 'owner' ? 'owner' : token(as)}`, 'Content-Type': 'application/json' });

/** Seed bypassing the rules (full document). */
const seed = (path: string, data: { [k: string]: Json }) =>
  fetch(`${ROOT}/${path}`, { method: 'PATCH', headers: auth('owner'), body: JSON.stringify({ fields: toFields(data) }) }).then((r) => r.status);
/** Same as the portal's setDoc(…, { merge: true }) with only the changed top-level fields. */
const save = (as: string, path: string, data: { [k: string]: Json }) => {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  return fetch(`${ROOT}/${path}?${mask}`, { method: 'PATCH', headers: auth(as), body: JSON.stringify({ fields: toFields(data) }) })
    .then(async (r) => { if (process.env.RULES_DEBUG && r.status !== 200) console.log(`[${as} → ${path}]`, (await r.text()).slice(0, 600)); return r.status; });
};
const create = (as: string, path: string, data: { [k: string]: Json }) =>
  fetch(`${ROOT}/${path}?currentDocument.exists=false`, { method: 'PATCH', headers: auth(as), body: JSON.stringify({ fields: toFields(data) }) }).then((r) => r.status);
const get = (as: string, path: string) => fetch(`${ROOT}/${path}`, { headers: auth(as) }).then((r) => r.status);
/** List query like the portal's query(col, where(field, op, value)). */
const list = (as: string, collection: string, field?: string, op?: 'EQUAL' | 'ARRAY_CONTAINS', value?: Json) =>
  fetch(`${ROOT}:runQuery`, {
    method: 'POST',
    headers: auth(as),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        ...(field ? { where: { fieldFilter: { field: { fieldPath: field }, op, value: toValue(value as Json) } } } : {}),
      },
    }),
  }).then((r) => r.status);

const OK = 200;
const DENIED = 403;
const NOW = '2026-11-02T10:00:00.000Z';

// Staff profiles as stored in users/{uid}
const staff: Record<string, { role: string; dataScope: string; isActive?: boolean; teamId?: string; isEntomologist?: boolean }> = {
  u_ceo: { role: 'super_admin', dataScope: 'company' },
  u_admin: { role: 'admin', dataScope: 'company' },
  // CROs who are also entomologists (audits are a tick on the profile, not a role)
  u_ent: { role: 'sales', dataScope: 'own', isEntomologist: true },
  u_ent2: { role: 'sales', dataScope: 'own', isEntomologist: true },
  u_cro: { role: 'sales', dataScope: 'own' },
  u_cro2: { role: 'sales', dataScope: 'own' },
  u_cro_co: { role: 'sales', dataScope: 'company' },
  u_ops: { role: 'operations', dataScope: 'own' }, // Ops Manager sees all regardless
  u_ops_legacy: { role: 'operations_manager', dataScope: 'company' },
  u_sup: { role: 'team_leader', dataScope: 'own' },
  u_sup_legacy: { role: 'operations_coordinator', dataScope: 'company' },
  u_sup_custom: { role: 'person_u_sup_custom', dataScope: 'own' },
  u_fin: { role: 'finance', dataScope: 'company' },
  u_hr: { role: 'hr', dataScope: 'company' },
  u_off: { role: 'sales', dataScope: 'company', isActive: false },
  u_cro_teamA: { role: 'sales', dataScope: 'team', teamId: 'T_A' },
  u_cro_teamB: { role: 'sales', dataScope: 'team', teamId: 'T_B' },
};

describe.skipIf(!HOST)('firestore.rules: real portal workflows per role', () => {
  beforeAll(async () => {
    await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    for (const [uid, p] of Object.entries(staff)) {
      await seed(`users/${uid}`, { uid, displayName: uid, email: `${uid}@ikpm.test`, isActive: p.isActive ?? true, role: p.role, dataScope: p.dataScope, ...(p.teamId ? { teamId: p.teamId } : {}), ...(p.isEntomologist ? { isEntomologist: true } : {}) });
    }
    // Role documents as an older portal saved them: some levels differ from today's defaults
    await seed('roles/team_leader', { id: 'team_leader', name: 'Team Leader', basedOn: 'team_leader', modules: { dashboard: 'edit', jobs: 'view', inspections: 'view' } });
    await seed('roles/sales', { id: 'sales', name: 'Sales', basedOn: 'sales', modules: { dashboard: 'edit', crm: 'edit', proposals: 'edit', contracts: 'edit' } });
    // A personal access profile made in Team & Access (based on Supervisor)
    await seed('roles/person_u_sup_custom', { id: 'person_u_sup_custom', name: 'Supervisor · X', basedOn: 'team_leader', personalFor: 'u_sup_custom', modules: { dashboard: 'view', jobs: 'edit', pco: 'edit', challans: 'edit' } });

    await seed('employees/EMP-0100', { name: 'Supervisor by employee id', uid: 'u_sup', role: 'supervisor' });

    // Leads
    await seed('leads/L_CRO', { title: 'Cro lead', stage: 'contacted', ownerUid: 'u_cro', contacts: [], activities: [], updatedAt: NOW });
    await seed('leads/L_CRO2', { title: 'Other cro lead', stage: 'contacted', ownerUid: 'u_cro2', contacts: [], activities: [], updatedAt: NOW });
    await seed('leads/L_MEET', {
      title: 'Meeting lead', stage: 'engaged', ownerUid: 'u_cro', contacts: [], activities: [], updatedAt: NOW,
      inspectorIds: ['u_sup'], assignedTeamLeaderId: 'u_sup', inspection: { status: 'scheduled', scheduledDate: '2026-11-03', assignedTeamLeaderId: 'u_sup' },
    });
    // Contract + jobs
    await seed('contracts/CT1', { customerId: 'C1', ownerUid: 'u_cro', status: 'active', monthlyRate: 10000, totalJobsCompleted: 0, assignedTeamLeaderId: 'u_sup', updatedAt: NOW });
    await seed('service_jobs/J1', {
      customerId: 'C1', contractId: 'CT1', ownerUid: 'u_ops', status: 'scheduled', scheduledDate: '2026-11-02',
      assignedTeamLeaderId: 'u_sup', assignedTechnicianIds: ['u_sup'], leadPcoId: 'u_sup', updatedAt: NOW,
    });
    await seed('service_jobs/J_OLD', {
      customerId: 'C1', ownerUid: 'u_ops', status: 'scheduled', scheduledDate: '2026-11-02', leadPcoId: 'EMP-0100', updatedAt: NOW,
    });
    await seed('service_jobs/J_OTHER', {
      customerId: 'C2', ownerUid: 'u_ops', status: 'scheduled', scheduledDate: '2026-11-02',
      assignedTeamLeaderId: 'u_someone', assignedTechnicianIds: ['u_someone'], updatedAt: NOW,
    });
    // Invoice
    await seed('invoices/INV1', { invoiceNumber: 'IKPM-TX-2026-0001', customerId: 'C1', status: 'posted', isPosted: true, subtotal: 1000, grossPayable: 1150, balanceDue: 1150, amountPaid: 0, lineItems: [], updatedAt: NOW });
  });

  // ---- 1. CRO edits their own lead's stage ----
  it('CRO moves their own lead to the next stage (own data access)', async () => {
    expect(await save('u_cro', 'leads/L_CRO', { stage: 'engaged', activities: [{ note: 'met' }], updatedAt: NOW })).toBe(OK);
  });
  it('CRO with company data access moves a colleague’s lead', async () => {
    expect(await save('u_cro_co', 'leads/L_CRO2', { stage: 'engaged', updatedAt: NOW })).toBe(OK);
  });
  it('CRO with own data access cannot change another CRO’s lead', async () => {
    expect(await save('u_cro', 'leads/L_CRO2', { stage: 'lost', updatedAt: NOW })).toBe(DENIED);
  });
  it('CRO cannot take over a lead (owner field is protected)', async () => {
    expect(await save('u_cro', 'leads/L_CRO', { ownerUid: 'u_cro2' })).toBe(DENIED);
  });
  it('a paused (inactive) account cannot change anything', async () => {
    expect(await save('u_off', 'leads/L_CRO', { stage: 'lost' })).toBe(DENIED);
    expect(await get('u_off', 'leads/L_CRO')).toBe(DENIED);
  });

  // ---- 2. Ops Manager assigns an Operations Manager / Supervisor ----
  it('Ops Manager assigns an Operations Manager to a contract', async () => {
    expect(await save('u_ops', 'contracts/CT1', { assignedOperationsManagerId: 'u_ops', assignedOperationsManagerName: 'Ops', assignedAt: NOW, updatedAt: NOW })).toBe(OK);
  });
  it('Ops Manager (older role id) assigns a contract too', async () => {
    expect(await save('u_ops_legacy', 'contracts/CT1', { assignedOperationsManagerId: 'u_ops_legacy', assignedAt: NOW, updatedAt: NOW })).toBe(OK);
  });
  it('Contract price: Ops Manager (Contracts: edit) may change it, a Supervisor may not', async () => {
    expect(await save('u_ops', 'contracts/CT1', { monthlyRate: 1 })).toBe(OK); // Ops Manager has Contracts: edit
    expect(await save('u_sup', 'contracts/CT1', { monthlyRate: 999999 })).toBe(DENIED); // Supervisor does not
  });
  it('Ops Manager assigns a Supervisor to a CRO’s meeting', async () => {
    expect(await save('u_ops', 'leads/L_MEET', {
      inspection: { status: 'scheduled', scheduledDate: '2026-11-04', assignedTeamLeaderId: 'u_sup', assignedTeamLeaderName: 'Sup' },
      inspectorIds: ['u_sup'], assignedTeamLeaderId: 'u_sup', assignedTeamLeaderName: 'Sup', activities: [{ note: 'assigned' }], updatedAt: NOW,
    })).toBe(OK);
  });
  it('Ops Manager cannot change a CRO lead’s contacts', async () => {
    expect(await save('u_ops', 'leads/L_MEET', { contacts: [{ name: 'x' }] })).toBe(DENIED);
  });

  // ---- 3. Supervisor runs their visit ----
  it('Supervisor loads their jobs, meetings (the queries the portal runs)', async () => {
    expect(await list('u_sup', 'service_jobs', 'assignedTechnicianIds', 'ARRAY_CONTAINS', 'u_sup')).toBe(OK);
    expect(await list('u_sup', 'service_jobs', 'assignedTeamLeaderId', 'EQUAL', 'u_sup')).toBe(OK);
    expect(await list('u_sup', 'service_jobs', 'leadPcoId', 'EQUAL', 'u_sup')).toBe(OK);
    expect(await list('u_sup', 'leads', 'inspectorIds', 'ARRAY_CONTAINS', 'u_sup')).toBe(OK);
    expect(await list('u_sup', 'leads', 'assignedTeamLeaderId', 'EQUAL', 'u_sup')).toBe(OK);
    expect(await list('u_sup', 'leads', 'siteInspection.teamLeaderId', 'EQUAL', 'u_sup')).toBe(OK);
  });
  it('Supervisor starts and closes out their visit', async () => {
    expect(await save('u_sup', 'service_jobs/J1', { status: 'in_progress', preCheck: { uniform: true }, updatedAt: NOW })).toBe(OK);
    expect(await create('u_sup', 'challans/CHL-J1', { challanNumber: '101', jobId: 'J1', status: 'active' })).toBe(OK);
    expect(await create('u_sup', 'documents/DOC-CHL-J1', {
      title: 'Signed challan', ownerUid: 'u_sup', owner: { kind: 'company', id: 'C1' }, ownerScope: 'client', clientId: 'C1',
    })).toBe(OK);
    expect(await save('u_sup', 'service_jobs/J1', { status: 'completed', performedByPcoIds: ['EMP-1'], challanNumber: '101', updatedAt: NOW })).toBe(OK);
    expect(await save('u_sup', 'contracts/CT1', { totalJobsCompleted: 1, updatedAt: NOW })).toBe(OK);
  });
  it('Supervisor saved under the old "Operations Coordinator" id runs a visit', async () => {
    expect(await save('u_sup_legacy', 'service_jobs/J_OTHER', { status: 'in_progress', updatedAt: NOW })).toBe(OK);
  });
  it('Supervisor named on an older job by their employee id runs it', async () => {
    expect(await save('u_sup', 'service_jobs/J_OLD', { status: 'in_progress', updatedAt: NOW })).toBe(OK);
  });
  it('Supervisor with a personal access profile runs their visit', async () => {
    await seed('service_jobs/J_CUSTOM', { customerId: 'C1', ownerUid: 'u_ops', status: 'scheduled', assignedTeamLeaderId: 'u_sup_custom', assignedTechnicianIds: ['u_sup_custom'], updatedAt: NOW });
    expect(await save('u_sup_custom', 'service_jobs/J_CUSTOM', { status: 'in_progress', updatedAt: NOW })).toBe(OK);
  });
  it('Supervisor cannot move a job to another customer or reassign it', async () => {
    expect(await save('u_sup', 'service_jobs/J1', { customerId: 'C9' })).toBe(DENIED);
    expect(await save('u_sup', 'service_jobs/J1', { assignedTeamLeaderId: 'u_sup2' })).toBe(DENIED);
  });
  it('Supervisor cannot read client accounts or invoices', async () => {
    await seed('companies/C1', { legalCompanyName: 'Client', ownerUid: 'u_cro' });
    expect(await get('u_sup', 'companies/C1')).toBe(DENIED);
    expect(await get('u_sup', 'invoices/INV1')).toBe(DENIED);
  });
  it('Ops Manager cannot start a visit (field step is the Supervisor’s)', async () => {
    await seed('service_jobs/J2', { customerId: 'C1', ownerUid: 'u_ops', status: 'scheduled', assignedTeamLeaderId: 'u_sup', assignedTechnicianIds: ['u_sup'] });
    expect(await save('u_ops', 'service_jobs/J2', { status: 'in_progress' })).toBe(DENIED);
  });

  // ---- 4. Finance ----
  it('Finance records a payment and the invoice balance', async () => {
    expect(await create('u_fin', 'payments/REC1', { invoiceId: 'INV1', cashAmountReceived: 1150 })).toBe(OK);
    expect(await save('u_fin', 'invoices/INV1', { amountPaid: 1150, balanceDue: 0, status: 'paid', updatedAt: NOW })).toBe(OK);
  });
  it('Finance cannot change a posted invoice’s amounts', async () => {
    expect(await save('u_fin', 'invoices/INV1', { grossPayable: 1, status: 'paid' })).toBe(DENIED);
  });
  it('CRO cannot read invoices', async () => {
    expect(await get('u_cro', 'invoices/INV1')).toBe(DENIED);
  });

  // ---- 5. Admin / HR ----
  it('Admin adds a staff member; a CRO cannot', async () => {
    expect(await create('u_admin', 'users/u_new', { uid: 'u_new', role: 'sales', isActive: true, dataScope: 'own' })).toBe(OK);
    expect(await create('u_cro', 'users/u_new2', { uid: 'u_new2', role: 'sales', isActive: true, dataScope: 'own' })).toBe(DENIED);
  });
  it('Nobody but the CEO can make a Super Admin', async () => {
    expect(await create('u_admin', 'users/u_boss', { uid: 'u_boss', role: 'super_admin', isActive: true })).toBe(DENIED);
  });
  it('A person cannot raise their own role', async () => {
    expect(await save('u_cro', 'users/u_cro', { role: 'admin' })).toBe(DENIED);
  });
  it('Only HR and the CEO read private HR data', async () => {
    await seed('employee_private/EMP-0100', { cnic: '42101-0000000-1' });
    expect(await get('u_hr', 'employee_private/EMP-0100')).toBe(OK);
    expect(await get('u_ceo', 'employee_private/EMP-0100')).toBe(OK);
    expect(await get('u_admin', 'employee_private/EMP-0100')).toBe(DENIED);
    expect(await get('u_ops', 'employee_private/EMP-0100')).toBe(DENIED);
  });

  // ---- 6. Creating records and other everyday work ----
  it('CRO creates a lead, a proposal and a contract they own', async () => {
    expect(await create('u_cro', 'leads/L_NEW', { title: 'New', stage: 'new', ownerUid: 'u_cro' })).toBe(OK);
    expect(await create('u_cro', 'proposals/P_NEW', { customerId: 'C1', status: 'draft', ownerUid: 'u_cro' })).toBe(OK);
    expect(await create('u_cro', 'contracts/CT_NEW', { customerId: 'C1', status: 'active', ownerUid: 'u_cro' })).toBe(OK);
  });
  it('CRO cannot create a record in someone else’s name', async () => {
    expect(await create('u_cro', 'leads/L_FAKE', { title: 'x', stage: 'new', ownerUid: 'u_cro2' })).toBe(DENIED);
  });
  it('Team data access: a teammate’s lead is editable, another team’s is not', async () => {
    await seed('leads/L_TA', { title: 'A', stage: 'contacted', ownerUid: 'u_other_a', teamId: 'T_A' });
    expect(await save('u_cro_teamA', 'leads/L_TA', { stage: 'engaged', updatedAt: NOW })).toBe(OK);
    expect(await save('u_cro_teamB', 'leads/L_TA', { stage: 'lost', updatedAt: NOW })).toBe(DENIED);
    expect(await list('u_cro_teamA', 'leads', 'teamId', 'EQUAL', 'T_A')).toBe(OK);
    expect(await list('u_cro_teamA', 'leads', 'ownerUid', 'EQUAL', 'u_cro_teamA')).toBe(OK);
  });
  it('Ops Manager creates, reschedules, QC-verifies and sends back a job', async () => {
    expect(await create('u_ops', 'service_jobs/J_NEW', { customerId: 'C1', status: 'scheduled', ownerUid: 'u_ops', assignedTeamLeaderId: 'u_sup', assignedTechnicianIds: ['u_sup'] })).toBe(OK);
    expect(await save('u_ops', 'service_jobs/J_NEW', { scheduledDate: '2026-11-09', rescheduledReason: 'client', updatedAt: NOW })).toBe(OK);
    await seed('service_jobs/J_DONE', { customerId: 'C1', status: 'completed', ownerUid: 'u_ops', assignedTeamLeaderId: 'u_sup', assignedTechnicianIds: ['u_sup'] });
    expect(await save('u_ops', 'service_jobs/J_DONE', { supervisorVerification: { isVerified: true }, updatedAt: NOW })).toBe(OK);
    expect(await save('u_ops', 'service_jobs/J_DONE', { status: 'in_progress', qcReturn: { reason: 'redo' }, updatedAt: NOW })).toBe(OK);
  });
  it('All roles load the lists their screens use', async () => {
    expect(await list('u_ops', 'leads')).toBe(OK);
    expect(await list('u_ops', 'service_jobs')).toBe(OK);
    expect(await list('u_ops', 'contracts')).toBe(OK);
    expect(await list('u_cro_co', 'leads')).toBe(OK);
    expect(await list('u_cro', 'leads', 'ownerUid', 'EQUAL', 'u_cro')).toBe(OK);
    expect(await list('u_fin', 'invoices')).toBe(OK);
    expect(await list('u_fin', 'service_jobs')).toBe(OK);
    expect(await list('u_ceo', 'approvals')).toBe(OK);
    expect(await list('u_cro', 'approvals', 'ownerUid', 'EQUAL', 'u_cro')).toBe(OK);
    expect(await list('u_sup', 'contracts', 'assignedTeamLeaderId', 'EQUAL', 'u_sup')).toBe(OK);
  });
  it('Finance creates a draft invoice but cannot post one; a CRO cannot create any', async () => {
    expect(await create('u_fin', 'invoices/INV_NEW', { invoiceNumber: 'DRAFT-INV_NEW', customerId: 'C1', status: 'pending_approval', isPosted: false })).toBe(OK);
    expect(await create('u_fin', 'invoices/INV_POSTED', { invoiceNumber: 'IKPM-CM-2026-0001', customerId: 'C1', status: 'posted', isPosted: true })).toBe(DENIED);
    expect(await create('u_cro', 'invoices/INV_X', { invoiceNumber: 'X', customerId: 'C1', status: 'draft' })).toBe(DENIED);
  });
  it('A CRO forwards their own lead to another CRO, but not someone else\'s', async () => {
    await seed('leads/L_FWD', { title: 'Forward me', stage: 'contacted', ownerUid: 'u_cro', contacts: [], activities: [], updatedAt: NOW });
    // Forwarding must not change anything else on the lead
    expect(await save('u_cro', 'leads/L_FWD', { ownerUid: 'u_cro2', ownerName: 'CRO 2', stage: 'won', updatedAt: NOW })).toBe(DENIED);
    expect(await save('u_cro', 'leads/L_FWD', { ownerUid: 'u_cro2', ownerName: 'CRO 2', assignedToUserId: 'u_cro2', activities: [{ note: 'forwarded' }], updatedAt: NOW })).toBe(OK);
    expect(await save('u_cro', 'leads/L_CRO2', { ownerUid: 'u_cro', updatedAt: NOW })).toBe(DENIED);
  });
  it('Quality audits: super admin schedules; only the assigned entomologist (a CRO here) sees and submits; nobody else reads them', async () => {
    const audit = { auditNumber: 'QA-2026-0001', entomologistUid: 'u_ent', status: 'scheduled', surprise: true, scheduledDate: '2026-11-10', updatedAt: NOW };
    expect(await create('u_admin', 'quality_audits/QA1', audit)).toBe(DENIED);
    expect(await create('u_ceo', 'quality_audits/QA0', { ...audit, entomologistUid: 'u_cro' })).toBe(DENIED); // not an entomologist
    expect(await create('u_ceo', 'quality_audits/QA1', audit)).toBe(OK);
    expect(await get('u_ent', 'quality_audits/QA1')).toBe(OK);
    expect(await get('u_ent2', 'quality_audits/QA1')).toBe(DENIED);
    expect(await get('u_sup', 'quality_audits/QA1')).toBe(DENIED);
    expect(await save('u_ent', 'quality_audits/QA1', { status: 'verified', updatedAt: NOW })).toBe(DENIED);
    expect(await save('u_ent', 'quality_audits/QA1', { report: { score: 4 }, status: 'submitted', submittedAt: NOW, updatedAt: NOW })).toBe(OK);
    expect(await save('u_ent', 'quality_audits/QA1', { report: { score: 5 }, updatedAt: NOW })).toBe(DENIED); // submitted: locked
    expect(await save('u_ceo', 'quality_audits/QA1', { status: 'verified', updatedAt: NOW })).toBe(OK);
  });
  it('A physical challan number belongs to one job only', async () => {
    expect(await create('u_sup', 'challan_numbers/ch0099', { jobId: 'J1', challanNumber: 'CH-0099' })).toBe(OK);
    expect(await save('u_sup', 'challan_numbers/ch0099', { jobId: 'J_OTHER', challanNumber: 'CH-0099' })).toBe(DENIED);
    expect(await save('u_sup', 'challan_numbers/ch0099', { jobId: 'J1', challanNumber: 'ch 0099' })).toBe(OK);
  });
  it('Employee letters (pay, CNIC) are HR and super admin only, and never deleted', async () => {
    const letter = { employeeId: 'EMP-0100', kind: 'offer_letter', status: 'issued', refNo: 'IKPM/HR/OL/2026/0001' };
    expect(await create('u_hr', 'employee_letters/EMP-0100_offer_letter_1', letter)).toBe(OK);
    expect(await get('u_ceo', 'employee_letters/EMP-0100_offer_letter_1')).toBe(OK);
    expect(await get('u_fin', 'employee_letters/EMP-0100_offer_letter_1')).toBe(DENIED);
    expect(await get('u_admin', 'employee_letters/EMP-0100_offer_letter_1')).toBe(DENIED);
    expect(await create('u_admin', 'employee_letters/EMP-0100_offer_letter_2', letter)).toBe(DENIED);
  });
  it('Only the super admin invoices a cancelled contract', async () => {
    await seed('contracts/CT_CANCEL', { customerId: 'C1', status: 'cancelled', updatedAt: NOW });
    const inv = { invoiceNumber: 'DRAFT-X', customerId: 'C1', contractId: 'CT_CANCEL', status: 'pending_approval', isPosted: false };
    expect(await create('u_fin', 'invoices/INV_CANCEL_FIN', inv)).toBe(DENIED);
    expect(await create('u_ceo', 'invoices/INV_CANCEL_SA', inv)).toBe(OK);
  });
  it('Only an admin / super admin approves a draft invoice', async () => {
    await seed('invoices/INV_D1', { invoiceNumber: 'DRAFT-INV_D1', customerId: 'C1', status: 'pending_approval', isPosted: false, isApproved: false, lineItems: [], updatedAt: NOW });
    await seed('invoices/INV_D2', { invoiceNumber: 'DRAFT-INV_D2', customerId: 'C1', status: 'pending_approval', isPosted: false, isApproved: false, lineItems: [], updatedAt: NOW });
    const approve = { invoiceNumber: 'IKPM-TX-2026-0099', status: 'posted', isPosted: true, isApproved: true, updatedAt: NOW };
    expect(await save('u_fin', 'invoices/INV_D1', approve)).toBe(DENIED);
    expect(await save('u_fin', 'invoices/INV_D1', { status: 'rejected', rejectionReason: 'self', updatedAt: NOW })).toBe(DENIED);
    expect(await save('u_fin', 'invoices/INV_D1', { notes: 'fixed', status: 'pending_approval', updatedAt: NOW })).toBe(OK);
    expect(await save('u_admin', 'invoices/INV_D1', approve)).toBe(OK);
    expect(await save('u_ceo', 'invoices/INV_D2', { status: 'rejected', rejectionReason: 'wrong rate', updatedAt: NOW })).toBe(OK);
  });
  it('Supervisor marks attendance; a CRO cannot', async () => {
    expect(await create('u_sup', 'attendance/EMP-1_2026-11-02', { employeeId: 'EMP-1', date: '2026-11-02', status: 'present' })).toBe(OK);
    expect(await create('u_cro', 'attendance/EMP-2_2026-11-02', { employeeId: 'EMP-2', date: '2026-11-02', status: 'present' })).toBe(DENIED);
  });
  it('HR adds an employee; an Ops Manager cannot', async () => {
    expect(await create('u_hr', 'employees/EMP-0200', { name: 'New PCO', role: 'pco' })).toBe(OK);
    expect(await create('u_ops', 'employees/EMP-0201', { name: 'x', role: 'pco' })).toBe(DENIED);
  });
  it('Approvals: CRO files a request, the CEO decides it, the CRO cannot decide their own', async () => {
    expect(await create('u_cro', 'approvals/AP1', { ownerUid: 'u_cro', status: 'pending', type: 'proposal_discount' })).toBe(OK);
    expect(await save('u_cro', 'approvals/AP1', { status: 'approved' })).toBe(DENIED);
    expect(await save('u_ceo', 'approvals/AP1', { status: 'approved', decidedAt: NOW })).toBe(OK);
  });
  it('Audit log entries are written in the person’s own name only', async () => {
    expect(await create('u_sup', 'audit_logs/log1', { userId: 'u_sup', action: 'update' })).toBe(OK);
    expect(await create('u_sup', 'audit_logs/log2', { userId: 'u_ceo', action: 'update' })).toBe(DENIED);
  });
});
