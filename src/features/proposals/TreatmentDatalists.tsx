import React from 'react';
import { FREQUENCY_LIST_ID, FREQUENCY_SUGGESTIONS, TREATMENT_LIST_ID, TREATMENT_PRESETS } from '../../lib/treatments';

/**
 * Typing suggestions for treatment and frequency fields (input list="…"). The browser shows the
 * matching presets while typing, and any other text can still be typed in.
 */
export const TreatmentDatalists: React.FC = () => (
  <>
    <datalist id={TREATMENT_LIST_ID}>
      {TREATMENT_PRESETS.map((t) => <option key={t} value={t} />)}
    </datalist>
    <datalist id={FREQUENCY_LIST_ID}>
      {FREQUENCY_SUGGESTIONS.map((f) => <option key={f} value={f} />)}
    </datalist>
  </>
);

export default TreatmentDatalists;
