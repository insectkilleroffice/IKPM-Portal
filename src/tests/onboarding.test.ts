import { describe, expect, it } from 'vitest';
import { buildOnboardingItems, matchDocs, packStatus, sopDocumentNumber, type OnboardingItem } from '../lib/onboarding';

const msds = [
  { id: 'm1', title: 'MSDS Fendona 6SC' },
  { id: 'm2', title: 'K-Othrine WG 250 safety data sheet' },
  { id: 'm3', title: 'Advion Cockroach Gel MSDS', file: { fileName: 'advion_gel.pdf' } },
  { id: 'm4', title: 'Storm Wax Block (rodenticide)' },
];
const certs = [
  { id: 'c1', title: 'PCO training certificate - Imran Ali' },
  { id: 'c2', title: 'Certificate Bilal Khan 2026' },
];

describe('matchDocs', () => {
  it('matches products by name or distinctive first word', () => {
    expect(matchDocs('Fendona', msds)).toEqual(['m1']);
    expect(matchDocs('K-Othrine', msds)).toEqual(['m2']);
    expect(matchDocs('Advion gel', msds)).toEqual(['m3']);
    expect(matchDocs('Storm wax block', msds)).toEqual(['m4']);
    expect(matchDocs('Attarat', msds)).toEqual([]);
    expect(matchDocs('', msds)).toEqual([]);
  });

  it('matches technician certificates by name', () => {
    expect(matchDocs('Imran Ali', certs)).toEqual(['c1']);
    expect(matchDocs('Bilal Khan', certs)).toEqual(['c2']);
  });
});

describe('buildOnboardingItems', () => {
  const base = {
    chemicals: ['Fendona', 'fendona', 'Attarat'],
    technicians: [{ uid: 'u1', name: 'Imran Ali' }],
    msdsDocs: msds,
    certificateDocs: certs,
    sopDocs: [],
    layoutDocs: [{ id: 'L1', title: 'Pest Management Layout G-2' }],
  };

  it('builds SOP, one MSDS per product, certificates and layout', () => {
    const items = buildOnboardingItems(base);
    expect(items.map((i) => i.key)).toEqual(['sop', 'msds:fendona', 'msds:attarat', 'cert:u1', 'layout']);
    expect(items.find((i) => i.key === 'msds:fendona')?.documentIds).toEqual(['m1']);
    expect(items.find((i) => i.key === 'msds:attarat')?.documentIds).toEqual([]);
    expect(items.find((i) => i.key === 'cert:u1')?.documentIds).toEqual(['c1']);
    expect(items.find((i) => i.key === 'layout')?.documentIds).toEqual(['L1']);
    expect(items.every((i) => i.auto)).toBe(true);
  });

  it('keeps manual overrides and re-matches automatic picks', () => {
    const previous: OnboardingItem[] = [
      { key: 'msds:fendona', type: 'msds', label: 'MSDS: Fendona', documentIds: ['m9'], auto: false },
      { key: 'sop', type: 'sop', label: 'SOP', documentIds: [], auto: true },
    ];
    const items = buildOnboardingItems({ ...base, sopDocs: [{ id: 'S1', title: 'SOP' }], previous });
    expect(items.find((i) => i.key === 'msds:fendona')).toMatchObject({ documentIds: ['m9'], auto: false });
    expect(items.find((i) => i.key === 'sop')?.documentIds).toEqual(['S1']);
  });
});

describe('packStatus', () => {
  const done: OnboardingItem[] = [{ key: 'sop', type: 'sop', label: 'SOP', documentIds: ['S1'] }];
  it('is in progress until every item has a document', () => {
    expect(packStatus({ items: [] })).toBe('in_progress');
    expect(packStatus({ items: [{ ...done[0], documentIds: [] }] })).toBe('in_progress');
    expect(packStatus({ items: done })).toBe('complete');
  });
  it('is sent when sent after the last change', () => {
    expect(packStatus({ items: done, sentAt: '2026-05-02', updatedAt: '2026-05-01' })).toBe('sent');
    expect(packStatus({ items: done, sentAt: '2026-05-01', updatedAt: '2026-05-03' })).toBe('complete');
  });
});

describe('sopDocumentNumber', () => {
  it('uses client initials, city code and sequence', () => {
    expect(sopDocumentNumber('Paracha Textile Mills (Pvt) Ltd', 'Karachi', 1)).toBe('PTM-KHI-01');
    expect(sopDocumentNumber('Urban Edible', 'Lahore', 2)).toBe('UE-LHE-02');
    expect(sopDocumentNumber('Dunkin', 'Islamabad', 3)).toBe('DUN-ISB-03');
    expect(sopDocumentNumber('Al Noor', 'Mirpur', 1)).toBe('AN-MIR-01');
  });
});

import { fillTemplate } from '../lib/templateFill';
import { fillSop } from '../lib/sopTemplate';

describe('templates', () => {
  it('fills {{placeholders}} and leaves unknown ones visible', () => {
    expect(fillTemplate('PKR {{monthlyRate}} from {{ tenureStart }} for {{clientName}} {{oops}}', { monthlyRate: '85,000.00', tenureStart: '01/11/2026', clientName: 'Paracha' }))
      .toBe('PKR 85,000.00 from 01/11/2026 for Paracha {{oops}}');
  });
  it('drops the site placeholder when there is no site', () => {
    expect(fillSop('at {{clientName}} {{siteName}} under', { client: 'Dunkin', company: 'IKPM' })).toBe('at Dunkin under');
    expect(fillSop('at {{clientName}} {{siteName}} under', { client: 'Dunkin', company: 'IKPM', site: 'Johar' })).toBe('at Dunkin (Johar) under');
  });
});
