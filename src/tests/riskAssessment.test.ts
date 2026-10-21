import { describe, expect, it } from 'vitest';
import { FINDING_SUGGESTIONS, findingFilled, findingsSummary, newFinding, recommendedTreatmentOf } from '../lib/riskAssessment';

describe('risk assessment helpers', () => {
  it('offers the common proofing quick picks', () => {
    expect(FINDING_SUGGESTIONS.map((s) => s.label)).toEqual(['Gap under door', 'Gap between tiles and wood', 'Wire / pipe gaps', 'Drain openings']);
    FINDING_SUGGESTIONS.forEach((s) => expect(s.observation && s.risk && s.recommendation).toBeTruthy());
  });

  it('treats a row as filled once it has an observation or recommendation', () => {
    expect(findingFilled(newFinding())).toBe(false);
    expect(findingFilled(newFinding({ observation: 'Gap under door' }))).toBe(true);
    expect(newFinding().id).not.toBe(newFinding().id);
  });

  it('uses the typed treatment, else the unique recommendations, for the proposal', () => {
    const findings = [
      newFinding({ observation: 'a', recommendation: 'Fit door sweep.' }),
      newFinding({ observation: 'b', recommendation: 'Fit door sweep.' }),
      newFinding({ observation: 'c', recommendation: 'Seal gaps.' }),
    ];
    expect(recommendedTreatmentOf({ recommendedTreatment: 'Gel baiting', findings })).toBe('Gel baiting');
    expect(recommendedTreatmentOf({ recommendedTreatment: '  ', findings })).toBe('Fit door sweep. Seal gaps.');
  });

  it('summarises findings for screens that only read the free text', () => {
    expect(findingsSummary([newFinding({ location: 'Back door', observation: 'Gap under door.', risk: 'Rodent entry.' }), newFinding()])).toBe('1. Back door: Gap under door. Risk: Rodent entry.');
  });
});
