// Document library (IKPM's own company papers), client documents, pitch packs and outreach logs

export type CompanyDocCategory =
  | 'authority_letter' // Principal / manufacturer authority & dealership letters
  | 'registration_tax' // NTN, SRB/PRA/KPRA sales tax registration, SECP incorporation
  | 'license_permit' // Pesticide dealer / PCO license, Agriculture Dept. permits
  | 'company_profile' // Company profile, client list, capability statement
  | 'msds_chemical' // MSDS / SDS and chemical registration certificates
  | 'insurance_bank' // Insurance cover, bank details / account maintenance letter
  | 'certification' // ISO, HACCP, training certificates
  | 'other';

export const COMPANY_DOC_CATEGORIES: { value: CompanyDocCategory; label: string }[] = [
  { value: 'authority_letter', label: 'Authority Letters' },
  { value: 'registration_tax', label: 'Registration & Tax (NTN / SRB / SECP)' },
  { value: 'license_permit', label: 'Licenses & Permits' },
  { value: 'company_profile', label: 'Company Profile' },
  { value: 'msds_chemical', label: 'MSDS & Chemical Registrations' },
  { value: 'insurance_bank', label: 'Insurance & Bank Letters' },
  { value: 'certification', label: 'Certifications (ISO / HACCP)' },
  { value: 'other', label: 'Other' },
];

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

export interface PortalDocument {
  id: string;
  title: string;
  category: CompanyDocCategory;
  owner: DocumentOwner;
  file: StoredFile;
  issuedBy?: string; // e.g. "FMC Pakistan", "Sindh Revenue Board"
  expiryDate?: string; // ISO date — authority letters and licenses expire
  notes?: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
}

export interface DocumentPack {
  id: string;
  name: string; // e.g. "Corporate Tender Pack"
  description?: string;
  categories: CompanyDocCategory[]; // Auto-includes all valid docs in these categories
  documentIds: string[]; // Plus specific documents
}

export type OutreachChannel = 'whatsapp' | 'email';

export interface OutreachLog {
  id: string;
  channel: OutreachChannel;
  mode: 'api' | 'link'; // api = sent by server, link = opened wa.me / mailto for the user to send
  status: 'sent' | 'opened' | 'failed';
  error?: string;
  recipientName: string;
  recipient: string; // phone or email
  subject?: string;
  message: string;
  documentIds: string[];
  attachmentUrls: string[];
  related: { kind: 'lead' | 'proposal' | 'company' | 'client' | 'branch'; id: string; title: string };
  sentBy: string;
  sentByName: string;
  sentAt: string;
}
