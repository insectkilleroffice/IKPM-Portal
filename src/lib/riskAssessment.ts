// Risk assessment report helpers: quick-pick findings and how findings feed the proposal.

import type { InspectionAssessment, RiskFinding } from '../types/crm';

/** Common proofing issues seen on surveys. Picking one fills the row; every field stays editable. */
export const FINDING_SUGGESTIONS: { label: string; observation: string; risk: string; severity: 'low' | 'moderate' | 'high' | 'severe'; recommendation: string }[] = [
  {
    label: 'Gap under door',
    observation: 'Gap under the door.',
    risk: 'Entry point for rodents, lizards and crawling insects.',
    severity: 'low',
    recommendation: 'Fit a door sweep / rubber strip so the door closes without a gap.',
  },
  {
    label: 'Gap between tiles and wood',
    observation: 'Gap between the floor / wall tiles and the wooden fixture.',
    risk: 'Hiding and breeding place for cockroaches and ants.',
    severity: 'moderate',
    recommendation: 'Seal the gap with silicone sealant.',
  },
  {
    label: 'Wire / pipe gaps',
    observation: 'Open gaps around wires and pipes passing through the wall.',
    risk: 'Entry route for rodents and insects between areas.',
    severity: 'low',
    recommendation: 'Seal around wires and pipes with sealant or cement; use wire mesh for larger openings.',
  },
  {
    label: 'Drain openings',
    observation: 'Drain openings without covers.',
    risk: 'Entry and breeding point for cockroaches, drain flies and rodents.',
    severity: 'moderate',
    recommendation: 'Fit fine-mesh drain covers and keep drains clean.',
  },
];

let n = 0;
export const newFinding = (preset?: Partial<RiskFinding>): RiskFinding => ({
  id: `rf_${Date.now().toString(36)}_${(n++).toString(36)}`,
  observation: '',
  risk: '',
  recommendation: '',
  ...preset,
});

export const findingFilled = (f: RiskFinding) => Boolean(f.observation.trim() || f.recommendation.trim());

/** Recommended treatment for the proposal: the inspector's text, else the findings' recommendations. */
export function recommendedTreatmentOf(i: Partial<Pick<InspectionAssessment, 'recommendedTreatment' | 'findings'>>): string {
  if (i.recommendedTreatment?.trim()) return i.recommendedTreatment.trim();
  const recs = (i.findings ?? []).map((f) => f.recommendation.trim()).filter(Boolean);
  return Array.from(new Set(recs)).join(' ');
}

/** Short summary of the findings for older screens that only read criticalFindings. */
export function findingsSummary(findings: RiskFinding[]): string {
  return findings
    .filter(findingFilled)
    .map((f, i) => `${i + 1}. ${f.location ? `${f.location}: ` : ''}${f.observation}${f.risk ? ` Risk: ${f.risk}` : ''}`)
    .join('\n');
}
