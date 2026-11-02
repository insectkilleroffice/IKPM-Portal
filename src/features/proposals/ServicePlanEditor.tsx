import React from 'react';
import { emptyPlanItem, type ServicePlanItem } from '../../lib/proposalPlan';
import { ServiceSelection } from './ServiceSelection';
import { TreatmentDatalists } from './TreatmentDatalists';

interface Props {
  items: ServicePlanItem[];
  onChange: (items: ServicePlanItem[]) => void;
}

/** The "Monthly IPM Service Plan": select the services, then give each its formula and frequency. */
export const ServicePlanEditor: React.FC<Props> = ({ items, onChange }) => (
  <>
    <TreatmentDatalists />
    <ServiceSelection<ServicePlanItem>
      label="Services in the plan"
      rows={items}
      onChange={onChange}
      fields={{ name: 'service', formulas: 'formulas', formulaText: 'formula', frequency: 'frequency' }}
      make={(service) => ({ ...emptyPlanItem(), service, frequency: 'Once per month' })}
    />
  </>
);

export default ServicePlanEditor;
