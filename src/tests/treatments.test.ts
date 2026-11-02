import { describe, expect, it } from 'vitest';
import { formulasText, mergeRatsAndMice, servicesMissingFormula, TREATMENT_PRESETS, treatmentLabel, withCleanFormulas } from '../lib/treatments';

type Row = { service: string; formula?: string; frequency?: string };
const merge = (rows: Row[]) => mergeRatsAndMice(rows, (r) => r.service, (r, service) => ({ ...r, service }));

describe('treatments', () => {
  it('offers the standard treatments, including pre- and post-construction termite treatment', () => {
    expect(TREATMENT_PRESETS).toContain('General pest control');
    expect(TREATMENT_PRESETS).toContain('Flea & ticks control');
    expect(TREATMENT_PRESETS).toContain('Termite treatment (pre-construction)');
    expect(TREATMENT_PRESETS).toContain('Termite treatment (post-construction)');
    expect(TREATMENT_PRESETS).toContain('Beetle treatment');
  });

  it('turns Rats control + Mice control into one Rats & mice control row', () => {
    const out = merge([
      { service: 'Cockroach control' },
      { service: 'Rats control', formula: 'Brodifacoum', frequency: 'Once per month' },
      { service: 'Mice control' },
    ]);
    expect(out).toEqual([
      { service: 'Cockroach control' },
      { service: 'Rats & mice control', formula: 'Brodifacoum', frequency: 'Once per month' },
    ]);
  });

  it('leaves the list alone when only one of the two is chosen', () => {
    const rows = [{ service: 'Rats control' }, { service: 'Bed bugs control' }];
    expect(merge(rows)).toBe(rows);
  });

  it('a service may have several formulas; formula required, brand optional', () => {
    const rows = [
      { service: 'Termite treatment (pre-construction)', formulas: [{ formula: 'Fipronil 2.5%', brand: 'Termidor' }, { formula: 'Imidacloprid' }] },
      { service: 'Cockroach control', formulas: [{ formula: '  ', brand: 'Maxforce' }] },
    ];
    expect(servicesMissingFormula(rows, (r) => r.service, (r) => r.formulas)).toEqual(['Cockroach control']);
    expect(formulasText(rows[0].formulas)).toBe('Fipronil 2.5% (Termidor), Imidacloprid');
  });

  it('drops blank formula lines when saving and keeps the text copy in step', () => {
    const saved = withCleanFormulas(
      { service: 'Bed bugs control', formula: '', formulas: [{ formula: ' Deltamethrin ', brand: ' ' }, { formula: '', brand: 'X' }] },
      'formula',
    );
    expect(saved.formulas).toEqual([{ formula: 'Deltamethrin' }]);
    expect(saved.formula).toBe('Deltamethrin');
  });

  it('shows treatments saved by older proposals by name', () => {
    expect(treatmentLabel('general_fumigation')).toBe('General fumigation');
    expect(treatmentLabel('Beetle treatment')).toBe('Beetle treatment');
  });
});
