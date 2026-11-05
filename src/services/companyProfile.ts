// Company letterhead details used on every generated document (proposals, invoices, receipts,
// service & inspection reports). Stored in Firestore at system_config/company_profile so the
// super admin can edit it in Settings; falls back to the VITE_COMPANY_* environment values.

import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { outreachEnv } from '../config/env';

/** @deprecated Replaced by CompanyProfile.serviceAreas. Kept so older saved profiles still load. */
export interface CompanyBranchInfo {
  id: string;
  name: string;
  address: string;
  city?: string;
  phone?: string;
}

export interface CompanyProfile {
  legalName: string;
  shortName: string;
  tagline: string;
  /** Head-office address line (street, plot, building). */
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
  /**
   * Second account used for Cash Memos (no-tax billing, mostly residential). The fields above are
   * the tax account. Empty = cash memos say "Paid in cash" and print no bank details.
   */
  cashAccount?: {
    /** Business name printed on cash memos (empty = the company name). */
    tradeName?: string;
    bankName?: string;
    bankAccountTitle?: string;
    bankAccountNo?: string;
    bankIban?: string;
    bankBranch?: string;
    notes?: string;
  };
  /** Payroll rules set in Settings → Payroll (missing values use the built-in defaults). */
  payrollRules?: {
    lateMarksPerAbsence?: number;
    absenceDeductionRatio?: number;
    jobIncentivePerUnit?: number;
    standardHoursPerDay?: number;
    overtimeMultiplier?: number;
    /** Official start time used to mark people late (HH:mm). */
    workStartTime?: string;
    /** Minutes after the start time before someone counts as late (default 0). */
    lateGraceMinutes?: number;
  };
  /** Custom logo (PNG/JPG URL). Empty = the portal's built-in logo. */
  logoUrl?: string;
  /**
   * Company stamp image (PNG URL). Shown at the end of proposals, invoices and receipts
   * instead of a signature block. If absent the documents still generate; no stamp is printed.
   */
  stampUrl?: string;
  /** Image printed faintly behind the content of every PDF (uploaded in Settings). Empty = no background. */
  watermarkUrl?: string;
  /** How strongly it prints, as a percentage (default 8). */
  watermarkOpacity?: number;
  /** Document colours as hex (#0A0A0A): headings, tables and totals use the primary, accents use the second. */
  brandColor?: string;
  accentColor?: string;
  /** @deprecated Use stampUrl instead. Kept so older Firestore documents still load without errors. */
  signatoryName?: string;
  /** @deprecated Use stampUrl instead. */
  signatoryTitle?: string;
  proposalTerms?: string;
  invoiceNotes?: string;
  /** Cities and hubs where the company provides services, printed in the footer of every PDF. */
  serviceAreas?: string[];
  /** @deprecated Use serviceAreas. No longer printed or edited. */
  branches?: CompanyBranchInfo[];
  /** "Our valued clients" logo strip printed on proposals (only clients who agreed to be listed). */
  clientLogos?: { name: string; url: string }[];
  /** "Why choose us" points printed on proposals, one per line. Empty = section not printed. */
  proposalHighlights?: string;
  /** SRS 5.6 / 19: hours a complaint may stay open before the CEO is alerted (default 48). */
  complaintEscalationHours?: number;
  /** Days between quality audits of a site; random audits pick sites not audited for this long (default 30). */
  auditIntervalDays?: number;
  /** Standard prices (PKR, before tax) for one-off jobs without a proposal price, e.g. "Cockroach treatment – 2 bed flat". */
  priceList?: { service: string; price: number }[];
  updatedAt?: string;
  updatedBy?: string;
}

/** House colours used when the profile has none (black headings, red accents). */
export const DEFAULT_BRAND_COLOR = '#0A0A0A';
export const DEFAULT_ACCENT_COLOR = '#C8102E';

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
  serviceAreas: ['Faisalabad Hub', 'Lahore'],
  // signatoryTitle kept for backwards-compat reads of old Firestore data
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
