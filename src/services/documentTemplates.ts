// Editable wording for proposals, contracts and the client SOP (Settings → Templates).
// Two kinds, each versioned in `template_versions/{kind}_v{n}` (a save always creates a new
// version, never overwrites):
//   wording    : cover letter, scope sections, SOP sections   (super admin + 'templates' edit)
//   commercial : contract terms, payment terms, tax wording, device ownership (super admin only)
// Older installs kept one doc at system_config/document_templates; it is read as version 0.
// Defaults below are generic; {{placeholders}} are filled at generation.

import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { DEFAULT_COVER_LETTER, DEFAULT_DEVICE_OWNERSHIP, DEFAULT_SCOPE_SECTIONS, DEFAULT_TERMS, type ScopeSection } from '../lib/proposalPlan';
import { SOP_SECTIONS, type SopSection } from '../lib/sopTemplate';

export type TemplateKind = 'wording' | 'commercial';

export interface WordingTemplates {
  coverLetter: string;
  scopeSections: ScopeSection[];
  sopSections: SopSection[];
}

export interface CommercialTemplates {
  terms: string[];
  paymentTerms: string;
  taxWording: string;
  deviceOwnership: string;
}

export type DocumentTemplates = WordingTemplates & CommercialTemplates;

/** Which saved versions a generated document used ("W3 · C2"); 0 = built-in defaults. */
export interface TemplateVersionRef {
  wording: number;
  commercial: number;
}

export interface TemplateVersion<T = Partial<DocumentTemplates>> {
  id: string;
  kind: TemplateKind;
  version: number;
  data: T;
  savedBy: string;
  savedByUid: string;
  savedAt: string;
}

export const WORDING_KEYS = ['coverLetter', 'scopeSections', 'sopSections'] as const;
export const COMMERCIAL_KEYS = ['terms', 'paymentTerms', 'taxWording', 'deviceOwnership'] as const;

export const DEFAULT_PAYMENT_TERMS = 'Payment is due within {{paymentTermsDays}} days of submission of the monthly invoice.';
export const DEFAULT_TAX_WORDING = 'Prices are {{taxMode}} of provincial sales tax.';

export const defaultTemplates = (): DocumentTemplates => ({
  coverLetter: DEFAULT_COVER_LETTER,
  scopeSections: DEFAULT_SCOPE_SECTIONS.map((s) => ({ ...s })),
  sopSections: SOP_SECTIONS.map((s) => ({ ...s, paragraphs: [...s.paragraphs], bullets: s.bullets ? [...s.bullets] : undefined })),
  terms: [...DEFAULT_TERMS],
  paymentTerms: DEFAULT_PAYMENT_TERMS,
  taxWording: DEFAULT_TAX_WORDING,
  deviceOwnership: DEFAULT_DEVICE_OWNERSHIP,
});

const pick = <K extends keyof DocumentTemplates>(t: Partial<DocumentTemplates>, keys: readonly K[]) =>
  Object.fromEntries(keys.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])) as Partial<Pick<DocumentTemplates, K>>;

/** Latest version per kind from a list of saved versions (pure; unit-tested). */
export function resolveTemplates(versions: TemplateVersion[], legacy?: Partial<DocumentTemplates>) {
  const latest = (kind: TemplateKind) => versions.filter((v) => v.kind === kind).sort((a, b) => b.version - a.version)[0];
  const w = latest('wording');
  const c = latest('commercial');
  const templates: DocumentTemplates = {
    ...defaultTemplates(),
    ...(legacy ? pick(legacy, [...WORDING_KEYS, ...COMMERCIAL_KEYS]) : {}),
    ...(w ? pick(w.data, WORDING_KEYS) : {}),
    ...(c ? pick(c.data, COMMERCIAL_KEYS) : {}),
  };
  return { templates, version: { wording: w?.version ?? 0, commercial: c?.version ?? 0 } as TemplateVersionRef, history: versions };
}

export const versionLabel = (v?: TemplateVersionRef) => (v ? `W${v.wording} · C${v.commercial}` : '—');

let versions: TemplateVersion[] = [];
let legacy: Partial<DocumentTemplates> | undefined;
let state = resolveTemplates([]);
let started = false;
const listeners = new Set<() => void>();

const refresh = () => {
  state = resolveTemplates(versions, legacy);
  listeners.forEach((l) => l());
};

function start() {
  if (started) return;
  started = true;
  getDoc(doc(db, 'system_config', 'document_templates'))
    .then((snap) => {
      legacy = snap.exists() ? (snap.data() as Partial<DocumentTemplates>) : undefined;
      refresh();
    })
    .catch(() => undefined);
  onSnapshot(
    query(collection(db, 'template_versions'), orderBy('savedAt', 'desc'), limit(60)),
    (snap) => {
      versions = snap.docs.map((d) => ({ ...(d.data() as TemplateVersion), id: d.id }));
      refresh();
    },
    () => {
      // Rules not deployed yet: keep the defaults
    }
  );
}

export const documentTemplates = {
  get(): DocumentTemplates {
    start();
    return state.templates;
  },
  version(): TemplateVersionRef {
    start();
    return { ...state.version };
  },
  history(): TemplateVersion[] {
    start();
    return state.history;
  },
  subscribe(listener: () => void) {
    start();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Saves a new version of one kind; the doc id makes a version number impossible to reuse. */
  async save(kind: TemplateKind, next: DocumentTemplates, by: { email: string; uid: string }): Promise<TemplateVersion> {
    const keys = kind === 'wording' ? WORDING_KEYS : COMMERCIAL_KEYS;
    const version = (kind === 'wording' ? state.version.wording : state.version.commercial) + 1;
    const entry: TemplateVersion = {
      id: `${kind}_v${version}`,
      kind,
      version,
      data: JSON.parse(JSON.stringify(pick(next, keys))),
      savedBy: by.email,
      savedByUid: by.uid,
      savedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'template_versions', entry.id), entry);
    return entry;
  },
};
