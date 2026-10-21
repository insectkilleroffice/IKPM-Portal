// Company letterhead details used on every generated document (proposals, invoices, receipts,
// service & inspection reports). Stored in Firestore at system_config/company_profile so the
// super admin can edit it in Settings; falls back to the VITE_COMPANY_* environment values.

import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { outreachEnv } from '../config/env';

export interface CompanyProfile {
  legalName: string;
  shortName: string;
  tagline: string;
  address: string;
  city: string;
  phone: string;
  mobile?: string;
  email: string;
  website: string;
  ntn?: string;
  strn?: string;
  /** Provincial sales-tax registrations, e.g. "SRB: S1234567 · PRA: P7654321" */
  provincialTaxNo?: string;
  /** Pesticide / PCO licence issued by the Agriculture Department */
  pcoLicense?: string;
  bankName?: string;
  bankAccountTitle?: string;
  bankAccountNo?: string;
  bankIban?: string;
  bankBranch?: string;
  /** Custom logo (PNG/JPG URL). Empty = the portal's built-in logo. */
  logoUrl?: string;
  /** Document colours as hex (#0B1F3A): headings, tables and totals use the primary, accents use the second. */
  brandColor?: string;
  accentColor?: string;
  signatoryName?: string;
  signatoryTitle?: string;
  proposalTerms?: string;
  invoiceNotes?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** House colours used when the profile has none (navy headings, green accents). */
export const DEFAULT_BRAND_COLOR = '#0B1F3A';
export const DEFAULT_ACCENT_COLOR = '#0E8A5F';

export const DEFAULT_PROPOSAL_TERMS = [
  'Prices are valid for the period stated above and are subject to site conditions remaining as inspected.',
  'All chemicals used are registered with the Department of Plant Protection, Government of Pakistan, and applied by trained, licensed technicians.',
  'Treatment schedules will be agreed with the client; access to all treatment areas must be provided on the agreed dates.',
  'Provincial sales tax (SRB / PRA / ICT / KPRA / BRA) is charged as applicable at the prevailing rate.',
  'Withholding tax certificates must be provided for any tax deducted at source.',
].join('\n');

export const DEFAULT_INVOICE_NOTES = 'Please pay by cross cheque / pay order in favour of the account title below, or by bank transfer quoting the invoice number. Withholding tax certificates must be shared within 15 days of deduction.';

const defaults = (): CompanyProfile => ({
  legalName: outreachEnv.companyName.replace(/\s*\(IKPM\)\s*$/i, '') || 'Insect Killer Pest Management',
  shortName: 'IKPM',
  tagline: 'Integrated Pest Management & Fumigation Services',
  address: (import.meta.env.VITE_COMPANY_ADDRESS as string | undefined) || '',
  city: (import.meta.env.VITE_COMPANY_CITY as string | undefined) || 'Karachi, Pakistan',
  phone: outreachEnv.companyPhone,
  email: outreachEnv.companyEmail,
  website: outreachEnv.companyWebsite,
  ntn: (import.meta.env.VITE_COMPANY_NTN as string | undefined) || '',
  strn: (import.meta.env.VITE_COMPANY_STRN as string | undefined) || '',
  proposalTerms: DEFAULT_PROPOSAL_TERMS,
  invoiceNotes: DEFAULT_INVOICE_NOTES,
  signatoryTitle: 'Authorised Signatory',
});

let profile: CompanyProfile = defaults();
let started = false;
const listeners = new Set<() => void>();

/** Starts the live subscription (once). Safe to call before sign-in: system_config is publicly readable. */
function start() {
  if (started) return;
  started = true;
  onSnapshot(
    doc(db, 'system_config', 'company_profile'),
    (snap) => {
      profile = { ...defaults(), ...(snap.exists() ? (snap.data() as Partial<CompanyProfile>) : {}) };
      listeners.forEach((l) => l());
    },
    () => {
      // Rules not deployed yet: keep the defaults
    }
  );
}

export const companyProfile = {
  get(): CompanyProfile {
    start();
    return profile;
  },
  subscribe(listener: () => void) {
    start();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async save(next: CompanyProfile, byEmail: string) {
    const data = JSON.parse(JSON.stringify({ ...next, updatedAt: new Date().toISOString(), updatedBy: byEmail }));
    await setDoc(doc(db, 'system_config', 'company_profile'), data);
  },
  defaults,
};
