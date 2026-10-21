// One source of truth for virtual folder paths.
//
// Client files:   /Clients/{ClientName}__{clientId}/{Subfolder}[/{YYYY}[/{MM}]]
// Branch files:   /Clients/{ClientName}__{clientId}/Branches/{BranchName}__{branchId}/{Subfolder}...
// IKPM's files:   /Company (IKPM)/{Subfolder}
//
// Ids are part of every client/branch segment, so renaming a client never breaks a path.
// Firestore stays flat; records only carry `folderPath` + the FolderMeta fields.

import type { ClientFolder, CompanyDocCategory } from '../types/document';
import type { FileCategory, FolderMeta, OwnerScope } from '../types/folders';

export const CLIENTS_ROOT = 'Clients';
export const COMPANY_ROOT = 'Company (IKPM)';
export const UNFILED_ROOT = 'Unfiled';
export const BRANCHES_FOLDER = 'Branches';
const ID_SEP = '__';

export const CLIENT_SUBFOLDERS = [
  'Profile',
  'Leads & Inspections',
  'Proposals',
  'Contracts',
  'Documents',
  'Service Reports',
  'Monitoring Sheets',
  'Invoices',
  'Payments',
] as const;
export type ClientSubfolder = (typeof CLIENT_SUBFOLDERS)[number];

export const COMPANY_SUBFOLDERS = [
  'Profile & Registrations',
  'SOP Templates',
  'MSDS Library',
  'Technician Certificates',
  'Proposal & Report Templates',
  'Tax Rules',
  'Internal',
] as const;
export type CompanySubfolder = (typeof COMPANY_SUBFOLDERS)[number];

export const FILE_CATEGORIES: { value: FileCategory; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'contract', label: 'Contract' },
  { value: 'service_report', label: 'Service report' },
  { value: 'inspection_report', label: 'Inspection report' },
  { value: 'risk_assessment', label: 'Risk assessment' },
  { value: 'sop', label: 'SOP / IPM plan' },
  { value: 'msds', label: 'MSDS' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'layout', label: 'Pest management layout' },
  { value: 'monitoring_sheet', label: 'Monitoring sheet' },
  { value: 'schedule', label: 'Visit schedule' },
  { value: 'payment_receipt', label: 'Payment receipt' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'other', label: 'Other' },
];

export const fileCategoryLabel = (c?: FileCategory) => FILE_CATEGORIES.find((x) => x.value === c)?.label ?? 'Other';

/**
 * Category → subfolder. `dated` adds year (and month) segments under the client subfolder.
 */
export const CATEGORY_FOLDERS: Record<FileCategory, { client: ClientSubfolder; company: CompanySubfolder; dated?: 'year' | 'year_month' }> = {
  invoice: { client: 'Invoices', company: 'Internal', dated: 'year' },
  proposal: { client: 'Proposals', company: 'Proposal & Report Templates' },
  contract: { client: 'Contracts', company: 'Internal' },
  service_report: { client: 'Service Reports', company: 'Proposal & Report Templates', dated: 'year_month' },
  inspection_report: { client: 'Leads & Inspections', company: 'Proposal & Report Templates' },
  risk_assessment: { client: 'Leads & Inspections', company: 'Proposal & Report Templates' },
  sop: { client: 'Documents', company: 'SOP Templates' },
  msds: { client: 'Documents', company: 'MSDS Library' },
  certificate: { client: 'Documents', company: 'Technician Certificates' },
  layout: { client: 'Documents', company: 'Internal' },
  monitoring_sheet: { client: 'Monitoring Sheets', company: 'Proposal & Report Templates' },
  schedule: { client: 'Documents', company: 'Internal' },
  payment_receipt: { client: 'Payments', company: 'Internal' },
  correspondence: { client: 'Documents', company: 'Internal' },
  other: { client: 'Documents', company: 'Internal' },
};

/** Makes a name safe for one path segment: no slashes, no "__" separator, trimmed. */
export function safeSegment(value: string | undefined, fallback = 'Unnamed'): string {
  const cleaned = (value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/_{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

const datePart = (date?: string | Date) => {
  if (typeof date === 'string' && /^\d{4}-\d{2}/.test(date)) return { y: date.slice(0, 4), m: date.slice(5, 7) };
  const d = date ? new Date(date) : new Date();
  const ok = !Number.isNaN(d.getTime()) ? d : new Date();
  return { y: String(ok.getFullYear()), m: String(ok.getMonth() + 1).padStart(2, '0') };
};

export interface FolderPathInput {
  ownerScope: OwnerScope;
  clientId?: string;
  clientName?: string;
  branchId?: string;
  branchName?: string;
  category?: FileCategory;
  /** Record date (ISO) for dated folders; defaults to today. */
  date?: string | Date;
  /** Use a specific subfolder instead of the category mapping (e.g. "Profile", "Tax Rules"). */
  subfolder?: ClientSubfolder | CompanySubfolder;
}

/** Builds the folder path for a record. Throws when scope and client don't agree. */
export function buildFolderPath(input: FolderPathInput): string {
  const category = input.category ?? 'other';
  const map = CATEGORY_FOLDERS[category] ?? CATEGORY_FOLDERS.other;

  if (input.ownerScope === 'company') {
    if (input.clientId) throw new Error('A company (IKPM) file cannot belong to a client.');
    const sub = input.subfolder && (COMPANY_SUBFOLDERS as readonly string[]).includes(input.subfolder) ? input.subfolder : map.company;
    return `/${COMPANY_ROOT}/${sub}`;
  }

  if (input.ownerScope !== 'client') throw new Error(`Unknown owner scope "${String(input.ownerScope)}".`);
  if (!input.clientId?.trim()) throw new Error('A client file needs a client id.');

  const parts = [CLIENTS_ROOT, `${safeSegment(input.clientName)}${ID_SEP}${safeSegment(input.clientId, 'unknown')}`];
  if (input.branchId) parts.push(BRANCHES_FOLDER, `${safeSegment(input.branchName)}${ID_SEP}${safeSegment(input.branchId, 'unknown')}`);
  const sub = input.subfolder && (CLIENT_SUBFOLDERS as readonly string[]).includes(input.subfolder) ? input.subfolder : map.client;
  parts.push(sub);
  if (!input.subfolder && map.dated) {
    const { y, m } = datePart(input.date);
    parts.push(y);
    if (map.dated === 'year_month') parts.push(m);
  }
  return `/${parts.join('/')}`;
}

/** buildFolderPath plus the matching FolderMeta fields, ready to spread onto a record. */
export function folderMeta(input: FolderPathInput & { clientType?: 'company' | 'individual' }): Required<Pick<FolderMeta, 'ownerScope' | 'folderPath' | 'fileCategory'>> & FolderMeta {
  return {
    ownerScope: input.ownerScope,
    ...(input.ownerScope === 'client' ? { clientId: input.clientId, clientType: input.clientType } : {}),
    ...(input.branchId && input.ownerScope === 'client' ? { branchId: input.branchId } : {}),
    fileCategory: input.category ?? 'other',
    folderPath: buildFolderPath(input),
  };
}

export interface ParsedFolderPath {
  ownerScope: OwnerScope;
  clientId?: string;
  clientName?: string;
  branchId?: string;
  branchName?: string;
  subfolder?: string;
  year?: string;
  month?: string;
}

const splitNameId = (segment: string) => {
  const i = segment.lastIndexOf(ID_SEP);
  return i < 0 ? { name: segment, id: undefined } : { name: segment.slice(0, i), id: segment.slice(i + ID_SEP.length) };
};

/** Reads a folder path back into its parts. Returns null for anything not built by buildFolderPath. */
export function parseFolderPath(path: string | undefined): ParsedFolderPath | null {
  if (!path) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === COMPANY_ROOT) return { ownerScope: 'company', subfolder: parts[1] };
  if (parts[0] !== CLIENTS_ROOT || !parts[1]) return null;
  const client = splitNameId(parts[1]);
  if (!client.id) return null;
  const out: ParsedFolderPath = { ownerScope: 'client', clientId: client.id, clientName: client.name };
  let rest = parts.slice(2);
  if (rest[0] === BRANCHES_FOLDER && rest[1]) {
    const br = splitNameId(rest[1]);
    out.branchId = br.id;
    out.branchName = br.name;
    rest = rest.slice(2);
  }
  if (rest[0]) out.subfolder = rest[0];
  if (rest[1]) out.year = rest[1];
  if (rest[2]) out.month = rest[2];
  return out;
}

export interface FolderNode {
  /** Display name (client/branch names without the "__id" suffix). */
  name: string;
  /** Full path of this folder, e.g. "/Clients/Shan Foods__CO-0001/Invoices". */
  path: string;
  /** Client or branch id when the segment carries one. */
  id?: string;
  /** Items in this folder and all subfolders. */
  count: number;
  children: FolderNode[];
}

/**
 * Builds the folder tree from records' folderPath values. The "Clients" and "Company (IKPM)"
 * roots are always present; records without a folderPath go to "Unfiled".
 * Client folders always list their standard subfolders (with 0 counts) so empty folders show.
 */
export function getFolderTree(
  items: { folderPath?: string }[],
  options: { includeEmptySubfolders?: boolean; ensurePaths?: string[]; includeCompany?: boolean } = {}
): FolderNode[] {
  const { includeEmptySubfolders = true, ensurePaths = [], includeCompany = true } = options;
  const root: FolderNode = { name: '', path: '', count: 0, children: [] };
  // Matched by id-based key, so a renamed client's old and new paths land in one folder.
  const child = (parent: FolderNode, segment: string): FolderNode => {
    const key = folderKey(`${parent.path}/${segment}`);
    let node = parent.children.find((c) => folderKey(c.path) === key);
    if (!node) {
      const { name, id } = splitNameId(segment);
      node = { name: id ? name : segment, path: `${parent.path}/${segment}`, ...(id ? { id } : {}), count: 0, children: [] };
      parent.children.push(node);
    }
    return node;
  };

  const clients = child(root, CLIENTS_ROOT);
  const company = child(root, COMPANY_ROOT);
  if (includeEmptySubfolders) COMPANY_SUBFOLDERS.forEach((s) => child(company, s));

  // Folders that must show even when empty (e.g. a client with no files yet, its branches)
  for (const path of ensurePaths) {
    let node = root;
    for (const seg of path.split('/').filter(Boolean)) node = child(node, seg);
  }

  for (const item of items) {
    const parsed = parseFolderPath(item.folderPath);
    const segments = parsed ? item.folderPath!.split('/').filter(Boolean) : [UNFILED_ROOT];
    let node = root;
    for (const seg of segments) {
      node = child(node, seg);
      node.count++;
    }
  }

  if (includeEmptySubfolders) {
    const fill = (owner: FolderNode) => {
      const subs = owner.children;
      CLIENT_SUBFOLDERS.forEach((s) => child(owner, s));
      subs.filter((c) => c.name === BRANCHES_FOLDER).forEach((b) => b.children.forEach(fill));
    };
    clients.children.forEach(fill);
  }

  const order = (a: FolderNode, b: FolderNode, parent: FolderNode) => {
    const known = parent === company ? (COMPANY_SUBFOLDERS as readonly string[]) : parent.path.startsWith(`/${CLIENTS_ROOT}/`) ? [...CLIENT_SUBFOLDERS, BRANCHES_FOLDER] : [];
    const ia = known.indexOf(a.name);
    const ib = known.indexOf(b.name);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  };
  const sortTree = (n: FolderNode) => {
    n.children.sort((a, b) => order(a, b, n));
    n.children.forEach(sortTree);
  };
  sortTree(root);
  root.children.sort((a, b) => [CLIENTS_ROOT, COMPANY_ROOT, UNFILED_ROOT].indexOf(a.name) - [CLIENTS_ROOT, COMPANY_ROOT, UNFILED_ROOT].indexOf(b.name));
  return includeCompany ? root.children : root.children.filter((n) => n !== company);
}

/** Finds a node by path in a tree from getFolderTree. */
export function findFolder(tree: FolderNode[], path: string): FolderNode | undefined {
  for (const n of tree) {
    if (isInFolder(path, n.path)) return folderKey(n.path) === folderKey(path) ? n : findFolder(n.children, path);
  }
  return undefined;
}

/**
 * Path with client/branch names removed ("/Clients/#CO-0001/Invoices"), so paths written
 * before and after a rename compare equal.
 */
export const folderKey = (path: string) =>
  path
    .split('/')
    .map((seg) => {
      const { id } = splitNameId(seg);
      return id ? `#${id}` : seg;
    })
    .join('/');

/** True when `itemPath` is the folder `folder` or inside it (ignores client/branch renames). */
export function isInFolder(itemPath: string | undefined, folder: string): boolean {
  if (!itemPath) return false;
  const a = folderKey(itemPath);
  const b = folderKey(folder);
  return a === b || a.startsWith(`${b}/`);
}

/** The client root folder for a client (or one of its branches). */
export const clientRootPath = (clientId: string, clientName?: string, branch?: { id: string; name?: string }) =>
  `/${CLIENTS_ROOT}/${safeSegment(clientName)}${ID_SEP}${safeSegment(clientId, 'unknown')}${branch ? `/${BRANCHES_FOLDER}/${safeSegment(branch.name)}${ID_SEP}${safeSegment(branch.id, 'unknown')}` : ''}`;

/** Category a new upload gets when it is dropped into a subfolder. */
export const SUBFOLDER_DEFAULT_CATEGORY: Record<ClientSubfolder | CompanySubfolder, FileCategory> = {
  Profile: 'other',
  'Leads & Inspections': 'inspection_report',
  Proposals: 'proposal',
  Contracts: 'contract',
  Documents: 'other',
  'Service Reports': 'service_report',
  'Monitoring Sheets': 'monitoring_sheet',
  Invoices: 'invoice',
  Payments: 'payment_receipt',
  'Profile & Registrations': 'other',
  'SOP Templates': 'sop',
  'MSDS Library': 'msds',
  'Technician Certificates': 'certificate',
  'Proposal & Report Templates': 'other',
  'Tax Rules': 'other',
  Internal: 'other',
};

/** Categories that can be chosen for an upload into a subfolder (first one is the default). */
export function categoriesForSubfolder(subfolder: ClientSubfolder | CompanySubfolder, scope: OwnerScope): FileCategory[] {
  const def = SUBFOLDER_DEFAULT_CATEGORY[subfolder] ?? 'other';
  const fitting = (Object.keys(CATEGORY_FOLDERS) as FileCategory[]).filter((c) => (scope === 'company' ? CATEGORY_FOLDERS[c].company : CATEGORY_FOLDERS[c].client) === subfolder);
  return [def, ...fitting.filter((c) => c !== def)];
}

/** IKPM document-library categories → company folder. */
export const LIBRARY_CATEGORY_FOLDERS: Record<CompanyDocCategory, { category: FileCategory; subfolder?: CompanySubfolder }> = {
  authority_letter: { category: 'other', subfolder: 'Profile & Registrations' },
  registration_tax: { category: 'other', subfolder: 'Profile & Registrations' },
  license_permit: { category: 'certificate', subfolder: 'Profile & Registrations' },
  company_profile: { category: 'other', subfolder: 'Profile & Registrations' },
  msds_chemical: { category: 'msds' },
  insurance_bank: { category: 'other', subfolder: 'Profile & Registrations' },
  certification: { category: 'certificate', subfolder: 'Profile & Registrations' },
  service_report: { category: 'service_report' },
  other: { category: 'other' },
};

/** Older client-folder values (Drive explorer) → category/subfolder. */
export const LEGACY_CLIENT_FOLDERS: Record<ClientFolder, { category: FileCategory; subfolder?: ClientSubfolder }> = {
  agreements: { category: 'contract' },
  service_reports: { category: 'service_report' },
  invoices: { category: 'invoice' },
  certificates: { category: 'certificate' },
  client_papers: { category: 'other', subfolder: 'Profile' },
  old_records: { category: 'other' },
};

/** Category of a document record: explicit fileCategory, else derived from its older fields. */
export function documentFolderCategory(doc: { fileCategory?: FileCategory; category: CompanyDocCategory; folder?: ClientFolder; owner: { kind: string } }): { category: FileCategory; subfolder?: ClientSubfolder | CompanySubfolder } {
  if (doc.owner.kind === 'library') {
    const lib = LIBRARY_CATEGORY_FOLDERS[doc.category] ?? LIBRARY_CATEGORY_FOLDERS.other;
    return doc.fileCategory ? { category: doc.fileCategory } : lib;
  }
  if (doc.fileCategory) return { category: doc.fileCategory };
  if (doc.folder && LEGACY_CLIENT_FOLDERS[doc.folder]) return LEGACY_CLIENT_FOLDERS[doc.folder];
  const fromLib = LIBRARY_CATEGORY_FOLDERS[doc.category]?.category ?? 'other';
  return { category: fromLib };
}

/** Where an upload belongs; required by uploadFile() so every file lands in its owner's area. */
export interface UploadScope {
  ownerScope: OwnerScope;
  clientId?: string;
  category: FileCategory;
}

/**
 * Cloud storage folder (under the configured root) for an upload:
 * "clients/{clientId}/{category}" for client files, "company/{category}" for IKPM's own files.
 * Throws when the scope and client id disagree, so a client file can never land in the
 * company area or the reverse.
 */
export function storageFolder(scope: UploadScope, subPath?: string): string {
  const category = safeStorageSegment(scope.category || 'other');
  let base: string;
  if (scope.ownerScope === 'company') {
    if (scope.clientId) throw new Error('A company (IKPM) file cannot be uploaded into a client folder.');
    base = `company/${category}`;
  } else if (scope.ownerScope === 'client') {
    if (!scope.clientId?.trim()) throw new Error('A client file needs a client id before it can be uploaded.');
    base = `clients/${safeStorageSegment(scope.clientId)}/${category}`;
  } else {
    throw new Error('Upload scope is missing: say whether the file belongs to a client or to IKPM.');
  }
  const extra = (subPath ?? '').split('/').map(safeStorageSegment).filter(Boolean).join('/');
  return extra ? `${base}/${extra}` : base;
}

/** Cloud storage path segment: letters, digits, dash and underscore only. */
export const safeStorageSegment = (v: string) => v.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

/** Rewrites a client folder path to another client (used when a lead's files move to the won customer). */
export function moveFolderPathToClient(path: string | undefined, to: { clientId: string; clientName?: string }): string | undefined {
  const parsed = parseFolderPath(path);
  if (!parsed || parsed.ownerScope !== 'client') return path;
  const parts = path!.split('/').filter(Boolean);
  parts[1] = `${safeSegment(to.clientName)}${ID_SEP}${safeSegment(to.clientId, 'unknown')}`;
  return `/${parts.join('/')}`;
}
