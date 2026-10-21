// Upload / move destinations: which owner, client, branch, subfolder and category a file goes to.

import { dataService } from '../../services/dataService';
import { CATEGORY_FOLDERS, categoriesForSubfolder, type ClientSubfolder, type CompanySubfolder } from '../../lib/folders';
import type { DocumentOwner } from '../../types/document';
import type { FileCategory, FolderMeta, OwnerScope } from '../../types/folders';

export interface Destination {
  ownerScope: OwnerScope;
  clientId?: string;
  branchId?: string;
  subfolder: ClientSubfolder | CompanySubfolder;
  category: FileCategory;
}

export const defaultDestination = (d: Partial<Destination> & { ownerScope: OwnerScope }): Destination => {
  const subfolder = d.subfolder ?? (d.ownerScope === 'company' ? 'Internal' : 'Documents');
  return {
    ownerScope: d.ownerScope,
    clientId: d.ownerScope === 'client' ? d.clientId : undefined,
    branchId: d.ownerScope === 'client' ? d.branchId : undefined,
    subfolder,
    category: d.category ?? categoriesForSubfolder(subfolder, d.ownerScope)[0],
  };
};

/** Owner record for a destination (who the document belongs to). */
export function ownerFor(dest: Destination): DocumentOwner | null {
  if (dest.ownerScope === 'company') return { kind: 'library' };
  if (!dest.clientId) return null;
  if (dest.branchId) return { kind: 'branch', id: dest.branchId };
  if (dataService.getLeadById(dest.clientId) && !dataService.getCompanyById(dest.clientId) && !dataService.getClientById(dest.clientId)) return { kind: 'lead', id: dest.clientId };
  return { kind: dataService.clientInfo(dest.clientId).type === 'individual' ? 'client' : 'company', id: dest.clientId };
}

/** Subfolder override, only when the chosen folder differs from where the category normally goes. */
export const subfolderOverride = (dest: Destination) => {
  const mapped = dest.ownerScope === 'company' ? CATEGORY_FOLDERS[dest.category].company : CATEGORY_FOLDERS[dest.category].client;
  return mapped === dest.subfolder ? undefined : dest.subfolder;
};

/** Folder fields for a destination (single source: dataService.resolveFolder → lib/folders). */
export function destinationMeta(dest: Destination, date?: string): FolderMeta {
  return dataService.resolveFolder({
    ownerScope: dest.ownerScope,
    customerId: dest.ownerScope === 'client' ? dest.clientId : undefined,
    customerType: dest.clientId ? dataService.clientInfo(dest.clientId).type : undefined,
    branchId: dest.branchId,
    category: dest.category,
    date,
    subfolder: subfolderOverride(dest),
  });
}
