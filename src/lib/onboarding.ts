// Onboarding pack after a lead is won: client SOP, MSDS for every product used, certificates of
// the assigned technicians and the site / pest management layout. Pure helpers (unit-tested);
// the pack itself is stored in document_packs with kind 'onboarding'.

export type OnboardingItemType = 'sop' | 'msds' | 'certificate' | 'layout';

export interface OnboardingItem {
  /** Stable key: 'sop', 'layout', 'msds:<product>', 'cert:<uid>'. */
  key: string;
  type: OnboardingItemType;
  label: string;
  documentIds: string[];
  chemical?: string;
  technicianUid?: string;
  /** True while the documents were picked automatically (a manual pick turns it off). */
  auto?: boolean;
}

export interface NamedDoc {
  id: string;
  title: string;
  file?: { fileName?: string };
}

/** Product names often used on IKPM proposals; the MSDS library adds the rest. */
export const COMMON_PRODUCTS = ['Fendona', 'K-Othrine', 'Advion', 'Storm wax block', 'Attarat'];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (s: string) => norm(s).replace(/\s+/g, '');

/**
 * Documents whose title or file name mention the product / person. Matches on the whole name, or
 * on its first word when that word is distinctive (4+ letters), e.g. "Fendona 6SC" ↔ "MSDS Fendona".
 */
export function matchDocs(name: string, docs: NamedDoc[]): string[] {
  const whole = compact(name);
  if (!whole) return [];
  const first = norm(name).split(' ')[0] ?? '';
  return docs
    .filter((d) => {
      const hay = compact(`${d.title} ${d.file?.fileName ?? ''}`);
      return hay.includes(whole) || (first.length >= 4 && hay.includes(first.replace(/\s+/g, '')));
    })
    .map((d) => d.id);
}

/**
 * Checklist items for the pack. Items the user already picked by hand keep their documents;
 * automatic items are re-matched against the current libraries.
 */
export function buildOnboardingItems(input: {
  chemicals: string[];
  technicians: { uid: string; name: string }[];
  msdsDocs: NamedDoc[];
  certificateDocs: NamedDoc[];
  sopDocs: NamedDoc[];
  layoutDocs: NamedDoc[];
  previous?: OnboardingItem[];
}): OnboardingItem[] {
  const prev = new Map((input.previous ?? []).map((i) => [i.key, i]));
  const item = (base: Omit<OnboardingItem, 'documentIds' | 'auto'>, auto: string[]): OnboardingItem => {
    const old = prev.get(base.key);
    return old && !old.auto ? { ...base, documentIds: old.documentIds, auto: false } : { ...base, documentIds: auto, auto: true };
  };
  const unique = (list: string[]) => Array.from(new Map(list.filter((x) => x.trim()).map((x) => [norm(x), x.trim()])).values());

  return [
    item({ key: 'sop', type: 'sop', label: 'IPM / SOP document for the client' }, input.sopDocs.slice(0, 1).map((d) => d.id)),
    ...unique(input.chemicals).map((c) => item({ key: `msds:${norm(c)}`, type: 'msds', label: `MSDS: ${c}`, chemical: c }, matchDocs(c, input.msdsDocs).slice(0, 1))),
    ...input.technicians.map((t) => item({ key: `cert:${t.uid}`, type: 'certificate', label: `Certificate: ${t.name}`, technicianUid: t.uid }, matchDocs(t.name, input.certificateDocs))),
    item({ key: 'layout', type: 'layout', label: 'Site / pest management layout' }, input.layoutDocs.slice(0, 1).map((d) => d.id)),
  ];
}

export type PackStatus = 'in_progress' | 'complete' | 'sent';

/** Complete when every item has a document; Sent once it was sent after the last change. */
export function packStatus(pack: { items?: OnboardingItem[]; sentAt?: string; updatedAt?: string }): PackStatus {
  const items = pack.items ?? [];
  const complete = items.length > 0 && items.every((i) => i.documentIds.length > 0);
  if (pack.sentAt && (!pack.updatedAt || pack.sentAt >= pack.updatedAt)) return 'sent';
  return complete ? 'complete' : 'in_progress';
}

export const PACK_STATUS_LABEL: Record<PackStatus, string> = { in_progress: 'In progress', complete: 'Complete (not sent)', sent: 'Sent' };

const CITY_CODES: Record<string, string> = {
  karachi: 'KHI', lahore: 'LHE', islamabad: 'ISB', rawalpindi: 'RWP', faisalabad: 'FSD', multan: 'MUX',
  peshawar: 'PEW', quetta: 'UET', hyderabad: 'HDD', sialkot: 'SKT', gujranwala: 'GRW',
};

/** SOP document number like "PTM-KHI-01": client initials, city code, sequence. Always editable. */
export function sopDocumentNumber(clientName: string, city: string | undefined, sequence: number): string {
  const words = norm(clientName.replace(/\((pvt|private)\)|ltd|limited|pvt/gi, '')).split(' ').filter((w) => w.length > 1);
  const initials = (words.length >= 2 ? words.slice(0, 3).map((w) => w[0]).join('') : (words[0] ?? 'CL').slice(0, 3)).toUpperCase();
  const c = norm(city ?? '');
  const code = CITY_CODES[c] ?? (c ? c.replace(/\s/g, '').slice(0, 3).toUpperCase() : 'PK');
  return `${initials}-${code}-${String(Math.max(1, sequence)).padStart(2, '0')}`;
}
