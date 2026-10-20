import { COMPANY_DOC_CATEGORIES, type CompanyDocCategory, type PortalDocument } from '../../types/document';

export type ExpiryState = 'none' | 'valid' | 'expiring' | 'expired';

const DAY = 24 * 60 * 60 * 1000;

export function expiryState(doc: PortalDocument, warnDays = 30): ExpiryState {
  if (!doc.expiryDate) return 'none';
  const diff = new Date(doc.expiryDate).getTime() - Date.now();
  if (diff < -DAY) return 'expired';
  if (diff < warnDays * DAY) return 'expiring';
  return 'valid';
}

export const isShareable = (doc: PortalDocument) => expiryState(doc) !== 'expired';

export const categoryLabel = (c: CompanyDocCategory) =>
  COMPANY_DOC_CATEGORIES.find((x) => x.value === c)?.label ?? c;
