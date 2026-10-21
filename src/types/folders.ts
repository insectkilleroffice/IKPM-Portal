// Virtual folder metadata shared by documents, document_packs, invoices, payments, proposals,
// contracts, service_jobs and outreach_logs. Firestore stays flat: these fields only say which
// folder a record is shown in (see src/lib/folders.ts). All optional so older records still load.

/** 'client' = belongs to one client (or a lead that is not a client yet); 'company' = IKPM's own files. */
export type OwnerScope = 'company' | 'client';

export type FileCategory =
  | 'invoice'
  | 'proposal'
  | 'contract'
  | 'service_report'
  | 'inspection_report'
  | 'risk_assessment'
  | 'sop'
  | 'msds'
  | 'certificate'
  | 'layout'
  | 'monitoring_sheet'
  | 'schedule'
  | 'payment_receipt'
  | 'correspondence'
  | 'other';

export interface FolderMeta {
  ownerScope?: OwnerScope;
  /** Company / individual client id, or the lead id while the lead is not a customer yet. */
  clientId?: string;
  clientType?: 'company' | 'individual';
  branchId?: string;
  /** Built by buildFolderPath(), e.g. "/Clients/Shan Foods__CO-0001/Invoices/2026". */
  folderPath?: string;
  /**
   * Folder category. Named fileCategory (not category) because documents already use
   * `category` for the company document library categories.
   */
  fileCategory?: FileCategory;
}

/** Which template versions (Settings → Templates) a generated record used, and the text taken from them. */
export interface TemplateStamp {
  templateVersion?: { wording: number; commercial: number };
  templateSnapshot?: Record<string, unknown>;
}
