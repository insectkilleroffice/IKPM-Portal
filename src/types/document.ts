// Document library (IKPM's own company papers), client documents, pitch packs and outreach logs

import type { FolderMeta, TemplateStamp } from './folders';
import type { OnboardingItem } from '../lib/onboarding';

export type CompanyDocCategory =
  | 'authority_letter' // Principal / manufacturer authority & dealership letters
  | 'registration_tax' // NTN, SRB/PRA/KPRA sales tax registration, SECP incorporation
  | 'license_permit' // Pesticide dealer / PCO license, Agriculture Dept. permits
  | 'company_profile' // Company profile, client list, capability statement
  | 'msds_chemical' // MSDS / SDS and chemical registration certificates
  | 'insurance_bank' // Insurance cover, bank details / account maintenance letter
  | 'certification' // ISO, HACCP, training certificates
  | 'service_report' // Field inspection & pest control service reports
  | 'other';

export const COMPANY_DOC_CATEGORIES: { value: CompanyDocCategory; label: string }[] = [
  { value: 'authority_letter', label: 'Authority Letters' },
  { value: 'registration_tax', label: 'Registration & Tax (NTN / SRB / SECP)' },
  { value: 'license_permit', label: 'Licenses & Permits' },
  { value: 'company_profile', label: 'Company Profile' },
  { value: 'msds_chemical', label: 'MSDS & Chemical Registrations' },
  { value: 'insurance_bank', label: 'Insurance & Bank Letters' },
  { value: 'certification', label: 'Certifications (ISO / HACCP)' },
  { value: 'service_report', label: 'Service & Inspection Reports' },
  { value: 'other', label: 'Other' },
];

export type ClientFolder =
  | 'agreements'
  | 'service_reports'
  | 'invoices'
  | 'certificates'
  | 'client_papers'
  | 'old_records';

export interface ClientFolderDef {
  value: ClientFolder;
  label: string;
  hint: string;
}

export const CLIENT_FOLDERS: ClientFolderDef[] = [
  { value: 'agreements', label: 'Agreements', hint: 'Signed contracts, AMCs & service agreements' },
  { value: 'service_reports', label: 'Service Reports', hint: 'Field visit reports, PCO checklists & inspections' },
  { value: 'invoices', label: 'Invoices & Receipts', hint: 'Tax invoices, credit notes & payment receipts' },
  { value: 'certificates', label: 'Certificates', hint: 'Pest eradication certificates & warranties' },
  { value: 'client_papers', label: 'Client Papers', hint: 'NTN, CNIC, registration papers & client documents' },
  { value: 'old_records', label: 'Old Records', hint: 'Historical legacy scans organized by year' },
];

export const folderLabel = (f?: ClientFolder): string => {
  const match = CLIENT_FOLDERS.find((cf) => cf.value === f);
  return match ? match.label : 'Client Papers';
};

export type DocumentOwner =
  | { kind: 'library' } // IKPM's own company documents, shared with clients during pitching
  | { kind: 'company' | 'client' | 'branch' | 'lead' | 'proposal' | 'job'; id: string };

export interface StoredFile {
  url: string; // Cloudinary secure_url (or data URL in local fallback mode)
  publicId?: string; // Cloudinary public_id
  resourceType?: string; // image | raw | video
  fileName: string;
  fileSize: number;
  fileType: string;
  storage: 'cloudinary' | 'local';
}

export interface PortalDocument extends FolderMeta, TemplateStamp {
  id: string;
  title: string;
  category: CompanyDocCategory;
  owner: DocumentOwner;
  file: StoredFile;
  folder?: ClientFolder;
  year?: number;
  source?: 'uploaded' | 'generated';
  jobId?: string;
  issuedBy?: string; // e.g. "FMC Pakistan", "Sindh Revenue Board"
  expiryDate?: string; // ISO date — authority letters and licenses expire
  notes?: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
}

export interface DocumentPack extends FolderMeta {
  id: string;
  name: string; // e.g. "Corporate Tender Pack"
  description?: string;
  categories: CompanyDocCategory[]; // Auto-includes all valid docs in these categories
  documentIds: string[]; // Plus specific documents

  // ---- Client onboarding pack (kind 'onboarding'); library packs leave these empty
  kind?: 'library' | 'onboarding';
  proposalId?: string;
  contractId?: string;
  /** Products used for this client (an MSDS is needed for each). */
  chemicals?: string[];
  /** Assigned PCOs whose certificates go in the pack. */
  technicianIds?: string[];
  items?: OnboardingItem[];
  /** Inputs of the last generated SOP (to regenerate it). */
  sop?: SopInput;
  sentAt?: string;
  sentByName?: string;
  sentVia?: OutreachChannel[];
  createdAt?: string;
  updatedAt?: string;
}

/** Client SOP ("Pest Management Plan") generated from the template. */
export interface SopInput {
  clientName: string;
  documentNo: string;
  effectiveDate: string;
  reviewDate?: string;
  siteName?: string;
  address?: string;
  /** People authorised to sign off / contact for pest issues. */
  authorizedPersons: { name: string; designation?: string; organisation: 'client' | 'ikpm' }[];
  contacts: { name: string; role?: string; phone?: string; email?: string }[];
  products: { name: string; use?: string }[];
  preparedBy: string;
  approvedBy?: string;
}

export type OutreachChannel = 'whatsapp' | 'email';

export interface OutreachLog extends FolderMeta {
  id: string;
  channel: OutreachChannel;
  mode: 'api' | 'link'; // api = sent by server, link = opened wa.me / mailto for the user to send
  status: 'sent' | 'opened' | 'failed';
  error?: string;
  recipientName: string;
  recipient: string; // phone or email
  senderEmail?: string; // business address an email was sent from
  subject?: string;
  message: string;
  documentIds: string[];
  attachmentUrls: string[];
  related: { kind: 'lead' | 'proposal' | 'company' | 'client' | 'branch'; id: string; title: string };
  sentBy: string;
  sentByName: string;
  sentAt: string;
}
