import React from 'react';
import { treatmentLabel } from '../../lib/treatments';
import type { BranchServiceLine } from '../../types/proposal';
import { ServiceSelection } from './ServiceSelection';

interface Props {
  services: BranchServiceLine[];
  onChange: (next: BranchServiceLine[]) => void;
  /** Frequency for a newly selected service. */
  defaultFrequency?: string;
  label?: string;
}

/** The services at one site: select them, then give each its formula / brand and frequency. */
export const SiteTreatments: React.FC<Props> = ({ services, onChange, defaultFrequency = 'Once per month', label = 'Services at this site' }) => (
  <ServiceSelection<BranchServiceLine>
    label={label}
    rows={services}
    onChange={onChange}
    fields={{ name: 'service', formulas: 'formulas', formulaText: 'formula', frequency: 'frequency' }}
    make={(service) => ({ service, frequency: defaultFrequency })}
  />
);

/** "Cockroach control — Maxforce gel (Twice per month)" for summaries. */
export const treatmentSummary = (sv: BranchServiceLine) =>
  `${treatmentLabel(sv.service) || 'Treatment'}${sv.formula?.trim() ? ` — ${sv.formula.trim()}` : ''}${sv.frequency ? ` (${sv.frequency})` : ''}`;

export default SiteTreatments;
