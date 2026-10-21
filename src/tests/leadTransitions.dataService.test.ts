// Stage rules enforced by dataService (Firestore is mocked; state lives in memory).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => {
  const noop = () => () => {};
  return {
    collection: vi.fn(() => ({})),
    doc: vi.fn(() => ({})),
    limit: vi.fn(),
    orderBy: vi.fn(),
    query: vi.fn(() => ({})),
    where: vi.fn(),
    onSnapshot: vi.fn(noop),
    setDoc: vi.fn(() => Promise.resolve()),
    writeBatch: vi.fn(() => ({ set: vi.fn(), update: vi.fn(), commit: vi.fn(() => Promise.resolve()) })),
  };
});
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/cloudinary', () => ({ deleteFromCloudinary: vi.fn(() => Promise.resolve()) }));

const { dataService } = await import('../services/dataService');
import type { Lead } from '../types/crm';
import type { Proposal } from '../types/proposal';

let n = 0;
const newLead = (): Lead =>
  dataService.createLead({
    title: `Lead ${++n}`,
    companyName: `Lead ${n} (Pvt) Ltd`,
    customerType: 'company',
    source: 'referral',
    city: 'Karachi',
    area: 'Korangi',
    propertyAddress: 'Plot 1',
    contacts: [{ id: 'c1', name: 'Ali', phone: `0300${String(1000000 + n)}`, isPrimary: true }],
    contactName: '',
    phone: '',
    pestIssues: [],
    stage: 'new',
  } as unknown as Lead, 'tester@ikpm.pk');

const proposalFor = (lead: Lead, id: string, status: Proposal['status'] = 'draft'): Proposal =>
  ({
    id,
    revisionNumber: 0,
    templateType: 'commercial',
    customerType: 'company',
    customerId: 'CO-X',
    customerName: lead.title,
    leadId: lead.id,
    preparedByUserId: 'u1',
    preparedByName: 'Tester',
    scopeOfWork: '',
    warrantyPeriodMonths: 0,
    lineItems: [],
    subtotal: 10000,
    discountPercent: 0,
    discountAmount: 0,
    taxPercent: 0,
    taxAmount: 0,
    totalAmount: 10000,
    validityDays: 30,
    paymentTerms: '',
    status,
    revisionsHistory: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }) as unknown as Proposal;

const stage = (l: Lead) => dataService.getLeadById(l.id)!.stage;
const toEngaged = (l: Lead) => dataService.logLeadContact(l.id, { channel: 'call', outcome: 'engaged' }, 'tester@ikpm.pk');
const toScheduled = (l: Lead) => {
  toEngaged(l);
  dataService.scheduleLeadInspection(l.id, { date: '2026-02-01', timeSlot: 'morning', inspectorIds: [] }, 'tester@ikpm.pk');
};
const findings = { pestTypesFound: ['rodents_rats' as const], infestationSeverity: 'moderate' as const, areaSqFt: 1000, criticalFindings: 'Gap under door', recommendedTreatment: 'Door sweep' };
const toInspected = (l: Lead) => {
  toScheduled(l);
  dataService.recordInspectionFindings(l.id, findings, 'tester@ikpm.pk');
};

beforeEach(() => {
  dataService.setSession(null);
  dataService.setSession({ uid: 'u1', email: 'tester@ikpm.pk', name: 'Tester', role: 'super_admin', dataScope: 'company' });
});

describe('dataService lead stage enforcement', () => {
  it('walks the full happy path and audits every stage change', () => {
    const l = newLead();
    dataService.logLeadContact(l.id, { channel: 'call', outcome: 'callback' }, 'tester@ikpm.pk');
    expect(stage(l)).toBe('contacted');
    toEngaged(l);
    expect(stage(l)).toBe('engaged');
    dataService.scheduleLeadInspection(l.id, { date: '2026-02-01', timeSlot: 'morning', inspectorIds: [] }, 'tester@ikpm.pk');
    expect(stage(l)).toBe('inspection_scheduled');
    dataService.recordInspectionFindings(l.id, findings, 'tester@ikpm.pk');
    expect(stage(l)).toBe('inspection_completed');
    dataService.saveProposal(proposalFor(l, 'P-T-1'), 'tester@ikpm.pk');
    expect(stage(l)).toBe('proposal_sent');
    dataService.saveProposal(proposalFor(l, 'P-T-1', 'accepted'), 'tester@ikpm.pk');
    expect(stage(l)).toBe('won');

    const changes = dataService.getAuditLogs('lead', l.id).filter((a) => a.action === 'status_change').reverse();
    expect(changes.map((a) => `${a.beforeData?.stage}>${a.afterData?.stage}`)).toEqual([
      'new>contacted',
      'contacted>engaged',
      'engaged>inspection_scheduled',
      'inspection_scheduled>inspection_completed',
      'inspection_completed>proposal_sent',
      'proposal_sent>won',
    ]);
    expect(changes.every((a) => a.userEmail === 'tester@ikpm.pk')).toBe(true);
  });

  it('first call ending "engaged" passes through contacted', () => {
    const l = newLead();
    toEngaged(l);
    expect(stage(l)).toBe('engaged');
    const steps = dataService.getAuditLogs('lead', l.id).filter((a) => a.action === 'status_change').map((a) => a.afterData?.stage);
    expect(steps).toContain('contacted');
  });

  it('markLeadWon throws before the proposal stage and creates no customer', () => {
    const l = newLead();
    toEngaged(l);
    const companies = dataService.getCompanies().length;
    expect(() => dataService.markLeadWon(l.id, undefined, 'tester@ikpm.pk')).toThrow(/cannot move/);
    expect(dataService.getCompanies().length).toBe(companies);
    expect(stage(l)).toBe('engaged');
  });

  it('setLeadStage rejects skipping stages', () => {
    const l = newLead();
    expect(() => dataService.setLeadStage(l.id, 'inspection_completed', undefined, 'tester@ikpm.pk')).toThrow();
    expect(() => dataService.setLeadStage(l.id, 'won', undefined, 'tester@ikpm.pk')).toThrow();
    expect(stage(l)).toBe('new');
  });

  it('lost needs a reason and can be reopened to contacted only', () => {
    const l = newLead();
    expect(() => dataService.setLeadStage(l.id, 'lost', '', 'tester@ikpm.pk')).toThrow(/reason/);
    dataService.setLeadStage(l.id, 'lost', 'Price', 'tester@ikpm.pk');
    expect(() => dataService.setLeadStage(l.id, 'engaged', 'x', 'tester@ikpm.pk')).toThrow();
    dataService.setLeadStage(l.id, 'contacted', 'Reopened', 'tester@ikpm.pk');
    expect(stage(l)).toBe('contacted');
    const reasons = dataService.getAuditLogs('lead', l.id).filter((a) => a.action === 'status_change').map((a) => a.details);
    expect(reasons.some((d) => d.includes('Reason: Price'))).toBe(true);
  });

  it('cannot schedule an inspection before engaged, nor record findings before scheduling', () => {
    const l = newLead();
    expect(() => dataService.scheduleLeadInspection(l.id, { date: '2026-02-01', timeSlot: 'morning', inspectorIds: [] }, 'tester@ikpm.pk')).toThrow();
    toEngaged(l);
    expect(() => dataService.recordInspectionFindings(l.id, findings, 'tester@ikpm.pk')).toThrow(/Schedule the inspection/);
  });

  it('blocks a proposal before inspection findings', () => {
    const l = newLead();
    toScheduled(l);
    expect(() => dataService.saveProposal(proposalFor(l, 'P-T-2'), 'tester@ikpm.pk')).toThrow();
    expect(dataService.getProposalById('P-T-2')).toBeUndefined();
  });

  it('blocks a duplicate proposal for the same lead', () => {
    const l = newLead();
    toInspected(l);
    dataService.saveProposal(proposalFor(l, 'P-T-3'), 'tester@ikpm.pk');
    expect(() => dataService.saveProposal(proposalFor(l, 'P-T-4'), 'tester@ikpm.pk')).toThrow(/already has proposal/);
    expect(dataService.getProposalById('P-T-4')).toBeUndefined();
    // Editing the existing proposal is fine
    expect(() => dataService.saveProposal({ ...proposalFor(l, 'P-T-3'), scopeOfWork: 'edited' }, 'tester@ikpm.pk')).not.toThrow();
  });

  it('skip_inspection needs a reason, then allows engaged → proposal', () => {
    const l = newLead();
    toEngaged(l);
    expect(() => dataService.saveProposal(proposalFor(l, 'P-T-5'), 'tester@ikpm.pk')).toThrow();
    expect(() => dataService.skipLeadInspection(l.id, '  ', 'tester@ikpm.pk')).toThrow(/reason/);
    dataService.skipLeadInspection(l.id, 'Repeat client', 'tester@ikpm.pk');
    const audit = dataService.getAuditLogs('lead', l.id);
    expect(audit.some((a) => a.details.includes('Inspection skipped') && a.details.includes('Repeat client'))).toBe(true);
    expect(dataService.getLeadById(l.id)!.activities!.some((a) => a.note?.includes('Inspection skipped'))).toBe(true);
    dataService.saveProposal(proposalFor(l, 'P-T-5'), 'tester@ikpm.pk');
    expect(stage(l)).toBe('proposal_sent');
  });

  it('declined proposal moves the lead to lost', () => {
    const l = newLead();
    toInspected(l);
    dataService.saveProposal(proposalFor(l, 'P-T-6'), 'tester@ikpm.pk');
    dataService.saveProposal(proposalFor(l, 'P-T-6', 'declined'), 'tester@ikpm.pk');
    expect(stage(l)).toBe('lost');
  });
});

describe('risk assessment findings', () => {
  it('saves finding rows with photos and keeps the older summary fields filled', () => {
    const l = newLead();
    toScheduled(l);
    const photo = { id: 'p1', type: 'infestation', caption: 'Back door', imageUrl: 'https://img/1.jpg', capturedAt: '2026-02-01' };
    dataService.recordInspectionFindings(
      l.id,
      {
        ...findings,
        criticalFindings: '1. Gap under door.',
        findings: [{ id: 'f1', photo, location: 'Back door', observation: 'Gap under door.', risk: 'Rodent entry.', recommendation: 'Fit door sweep.' }],
        reportTitle: 'Risk Assessment Report - Test',
        observedBy: 'Store manager',
      },
      'tester@ikpm.pk'
    );
    const i = dataService.getLeadById(l.id)!.inspection!;
    expect(i.status).toBe('completed');
    expect(i.findings).toHaveLength(1);
    expect(i.observedBy).toBe('Store manager');
    expect(i.photoEvidenceUrls).toContain('https://img/1.jpg');
    expect(i.criticalFindings).toContain('Gap under door');
  });
});
