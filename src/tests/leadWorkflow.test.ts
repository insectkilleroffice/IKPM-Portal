import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  assertCanCreateProposal,
  assertStageTransition,
  availableActions,
  nextStep,
  PIPELINE,
  STAGE_ACTIONS,
  stageOf,
  StageTransitionError,
  type PipelineStage,
} from '../lib/leadWorkflow';
import type { Lead, LeadStage } from '../types/crm';

const STAGES = PIPELINE.map((p) => p.stage);

const lead = (stage: LeadStage, extra: Partial<Lead> = {}): Lead =>
  ({
    id: 'LD-2026-0001',
    title: 'Test Foods',
    stage,
    source: 'referral',
    customerType: 'company',
    contactName: 'Ali',
    phone: '03001234567',
    city: 'Karachi',
    area: 'Korangi',
    propertyAddress: 'Plot 1',
    pestIssues: [],
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'test',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  }) as Lead;

const SKIPPED = { inspectionSkipped: { reason: 'Repeat client, site known', at: '2026-01-01', by: 'Sales' } };

describe('stage transitions', () => {
  const allowed: [PipelineStage, PipelineStage][] = [
    ['new', 'contacted'],
    ['contacted', 'engaged'],
    ['engaged', 'inspection_scheduled'],
    ['inspection_scheduled', 'inspection_completed'],
    ['inspection_completed', 'proposal_sent'],
    ['proposal_sent', 'won'],
    ['proposal_sent', 'lost'],
    ['lost', 'contacted'],
    // any open stage → lost
    ['new', 'lost'],
    ['contacted', 'lost'],
    ['engaged', 'lost'],
    ['inspection_scheduled', 'lost'],
    ['inspection_completed', 'lost'],
  ];

  it.each(allowed)('%s → %s is allowed', (from, to) => {
    expect(() => assertStageTransition(lead(from), to)).not.toThrow();
  });

  it('engaged → proposal is allowed only with a skip reason', () => {
    expect(() => assertStageTransition(lead('engaged'), 'proposal_sent')).toThrow(StageTransitionError);
    expect(() => assertStageTransition(lead('engaged'), 'proposal_sent', { inspectionSkipped: { reason: '   ', at: '', by: '' } })).toThrow(StageTransitionError);
    expect(() => assertStageTransition(lead('engaged'), 'proposal_sent', SKIPPED)).not.toThrow();
  });

  it('staying on the same stage is always allowed', () => {
    STAGES.forEach((s) => expect(() => assertStageTransition(lead(s), s)).not.toThrow());
  });

  // Every pair not in the allowed list must throw
  const illegal: [PipelineStage, PipelineStage][] = [];
  STAGES.forEach((from) =>
    STAGES.forEach((to) => {
      if (from === to) return;
      const ok = allowed.some(([a, b]) => a === from && b === to) || (from === 'engaged' && to === 'proposal_sent');
      if (!ok) illegal.push([from, to]);
    })
  );

  it('the map matches the documented rules exactly', () => {
    const fromMap = STAGES.flatMap((from) => ALLOWED_TRANSITIONS[from].map((to) => `${from}>${to}`)).sort();
    const documented = [...allowed.map(([a, b]) => `${a}>${b}`), 'engaged>proposal_sent'].sort();
    expect(fromMap).toEqual(documented);
  });

  it.each(illegal)('%s → %s throws', (from, to) => {
    expect(() => assertStageTransition(lead(from, SKIPPED), to, SKIPPED)).toThrow(StageTransitionError);
  });

  it('won is final', () => {
    STAGES.filter((s) => s !== 'won').forEach((to) => expect(() => assertStageTransition(lead('won'), to)).toThrow());
  });
});

describe('legacy stage names', () => {
  it('map to the current pipeline', () => {
    expect(stageOf({ stage: 'qualified' })).toBe('engaged');
    expect(stageOf({ stage: 'proposal_drafted' })).toBe('proposal_sent');
    expect(stageOf({ stage: 'won' })).toBe('won');
  });

  it('follow the same transition rules', () => {
    expect(() => assertStageTransition(lead('qualified'), 'inspection_scheduled')).not.toThrow();
    expect(() => assertStageTransition(lead('proposal_drafted'), 'won')).not.toThrow();
    expect(() => assertStageTransition(lead('qualified'), 'won')).toThrow(StageTransitionError);
    // proposal_drafted is the same stage as proposal_sent
    expect(() => assertStageTransition(lead('proposal_drafted'), 'proposal_sent')).not.toThrow();
  });

  it('get the menu of their mapped stage', () => {
    expect(availableActions(lead('qualified')).map((a) => a.id)).toEqual(STAGE_ACTIONS.engaged);
    expect(nextStep(lead('proposal_drafted', { proposalId: 'P-1' })).action).toBe('open_proposal');
  });
});

describe('proposal creation', () => {
  it('is allowed after inspection findings', () => {
    expect(() => assertCanCreateProposal(lead('inspection_completed'))).not.toThrow();
  });

  it('is allowed from engaged only when the inspection was skipped with a reason', () => {
    expect(() => assertCanCreateProposal(lead('engaged'))).toThrow(StageTransitionError);
    expect(() => assertCanCreateProposal(lead('engaged', SKIPPED))).not.toThrow();
  });

  it('blocks a duplicate proposal', () => {
    expect(() => assertCanCreateProposal(lead('inspection_completed', { proposalId: 'P-2026-0001' }))).toThrow(/already has proposal/);
  });

  it.each(['new', 'contacted', 'inspection_scheduled', 'proposal_sent', 'won', 'lost'] as PipelineStage[])('is blocked at %s', (s) => {
    expect(() => assertCanCreateProposal(lead(s))).toThrow(StageTransitionError);
  });
});

describe('availableActions / nextStep', () => {
  it('never offers manual "won"', () => {
    STAGES.forEach((s) => expect(availableActions(lead(s)).some((a) => a.id === 'mark_won')).toBe(false));
  });

  it('disables create_proposal with a reason once a proposal exists', () => {
    const acts = availableActions(lead('inspection_completed', { proposalId: 'P-1' }));
    const create = acts.find((a) => a.id === 'create_proposal');
    expect(create?.enabled).toBe(false);
    expect(create?.disabledReason).toMatch(/P-1/);
    expect(acts.find((a) => a.id === 'open_proposal')?.enabled).toBe(true);
    expect(nextStep(lead('inspection_completed', { proposalId: 'P-1' })).action).toBe('open_proposal');
  });

  it('hides open_proposal at inspection done when there is no proposal', () => {
    expect(availableActions(lead('inspection_completed')).some((a) => a.id === 'open_proposal')).toBe(false);
  });

  it('next step is always an enabled action of the stage', () => {
    const samples = [
      ...STAGES.map((s) => lead(s, { existingCustomerId: 'CO-1', proposalId: s === 'proposal_sent' ? 'P-1' : undefined, inspection: s === 'inspection_scheduled' ? ({ status: 'scheduled' } as Lead['inspection']) : undefined })),
      lead('inspection_completed', { proposalId: 'P-1' }),
    ];
    samples.forEach((l) => {
      const step = nextStep(l);
      const a = availableActions(l).find((x) => x.id === step.action);
      expect(a, `${l.stage} → ${step.action}`).toBeDefined();
      expect(a?.enabled).toBe(true);
    });
  });
});
