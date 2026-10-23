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
    ['engaged', 'meeting_scheduled'],
    ['engaged', 'profile_sent'],
    ['engaged', 'proposal_sent'],
    ['engaged', 'negotiation'],
    ['meeting_scheduled', 'meeting_done'],
    ['meeting_done', 'profile_sent'],
    ['meeting_done', 'proposal_sent'],
    ['meeting_done', 'negotiation'],
    ['profile_sent', 'proposal_sent'],
    ['profile_sent', 'negotiation'],
    ['proposal_sent', 'negotiation'],
    ['proposal_sent', 'won'],
    ['negotiation', 'proposal_sent'],
    ['negotiation', 'won'],
    ['lost', 'contacted'],
    // any open stage → lost
    ['new', 'lost'],
    ['contacted', 'lost'],
    ['engaged', 'lost'],
    ['meeting_scheduled', 'lost'],
    ['meeting_done', 'lost'],
    ['profile_sent', 'lost'],
    ['proposal_sent', 'lost'],
    ['negotiation', 'lost'],
  ];

  it.each(allowed)('%s → %s is allowed', (from, to) => {
    expect(() => assertStageTransition(lead(from, SKIPPED), to, SKIPPED)).not.toThrow();
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
      const ok = allowed.some(([a, b]) => a === from && b === to);
      if (!ok) illegal.push([from, to]);
    })
  );

  it('the map matches the documented rules exactly', () => {
    const fromMap = STAGES.flatMap((from) => ALLOWED_TRANSITIONS[from].map((to) => `${from}>${to}`)).sort();
    const documented = allowed.map(([a, b]) => `${a}>${b}`).sort();
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
    expect(() => assertStageTransition(lead('qualified'), 'meeting_scheduled')).not.toThrow();
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
    expect(() => assertCanCreateProposal(lead('meeting_done'))).not.toThrow();
  });

  it('is allowed from engaged only when the inspection was skipped with a reason', () => {
    expect(() => assertCanCreateProposal(lead('engaged'))).toThrow(StageTransitionError);
    expect(() => assertCanCreateProposal(lead('engaged', SKIPPED))).not.toThrow();
  });

  it.each(['profile_sent', 'proposal_sent', 'negotiation', 'lost'] as PipelineStage[])('is allowed at %s', (s) => {
    expect(() => assertCanCreateProposal(lead(s))).not.toThrow();
  });

  it.each(['new', 'contacted', 'meeting_scheduled', 'won'] as PipelineStage[])('is blocked at %s', (s) => {
    expect(() => assertCanCreateProposal(lead(s))).toThrow(StageTransitionError);
  });
});

describe('residential lead flow', () => {
  const residential = (stage: LeadStage, extra: Partial<Lead> = {}) => lead(stage, { ...extra, clientType: 'residential' });

  it.each(['new', 'contacted', 'engaged', 'meeting_done', 'profile_sent'] as PipelineStage[])(
    'can create proposal from %s without TL meeting or inspection',
    (s) => {
      expect(() => assertCanCreateProposal(residential(s))).not.toThrow();
    },
  );

  it('cannot create proposal once already won', () => {
    expect(() => assertCanCreateProposal(residential('won'))).toThrow(StageTransitionError);
  });

  it('cannot create a second proposal when proposalId already set', () => {
    expect(() => assertCanCreateProposal(residential('engaged', { proposalId: 'P-1' }))).toThrow(StageTransitionError);
  });

  it('B2B lead without clientType still cannot create proposal from new/contacted/engaged', () => {
    expect(() => assertCanCreateProposal(lead('new'))).toThrow(StageTransitionError);
    expect(() => assertCanCreateProposal(lead('contacted'))).toThrow(StageTransitionError);
    expect(() => assertCanCreateProposal(lead('engaged'))).toThrow(StageTransitionError);
  });

  it('old lead with no clientType behaves as B2B (cannot skip to proposal)', () => {
    const oldLead = lead('engaged');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (oldLead as any).clientType;
    expect(() => assertCanCreateProposal(oldLead)).toThrow(StageTransitionError);
  });

  it('residential engaged → proposal_sent stage transition bypasses skip-reason requirement', () => {
    expect(() => assertStageTransition(residential('engaged'), 'proposal_sent')).not.toThrow();
  });

  it('nextStep for a residential lead without a proposal is create_proposal', () => {
    expect(nextStep(residential('new')).action).toBe('create_proposal');
    expect(nextStep(residential('engaged')).action).toBe('create_proposal');
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
      ...STAGES.map((s) => lead(s, { existingCustomerId: 'CO-1', proposalId: s === 'proposal_sent' ? 'P-1' : undefined, inspection: (s as LeadStage) === 'meeting_scheduled' ? ({ status: 'scheduled' } as Lead['inspection']) : undefined })),
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
