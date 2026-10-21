// Everything that lives in a virtual folder: uploaded/generated documents plus the business
// records filed alongside them (proposals, contracts, service reports, invoices, payments,
// correspondence). Folder placement comes only from each record's folderPath.

import { dataService } from '../../services/dataService';
import type { PortalDocument } from '../../types/document';
import type { FolderMeta } from '../../types/folders';
import { parseFolderPath, UNFILED_ROOT } from '../../lib/folders';

export type FolderItemKind = 'document' | 'proposal' | 'contract' | 'job' | 'invoice' | 'payment' | 'outreach';

export interface FolderItem extends FolderMeta {
  key: string;
  kind: FolderItemKind;
  id: string;
  title: string;
  sub?: string;
  date?: string;
  /** In-app page for records. */
  href?: string;
  /** The stored file for documents. */
  doc?: PortalDocument;
}

export const KIND_LABEL: Record<FolderItemKind, string> = {
  document: 'File',
  proposal: 'Proposal',
  contract: 'Contract',
  job: 'Service report',
  invoice: 'Invoice',
  payment: 'Payment receipt',
  outreach: 'Sent message',
};

const meta = (r: FolderMeta): FolderMeta => ({
  ownerScope: r.ownerScope,
  clientId: r.clientId,
  clientType: r.clientType,
  branchId: r.branchId,
  folderPath: r.folderPath,
  fileCategory: r.fileCategory,
});

/** All folder items the signed-in person can read (the data store only holds what they may see). */
export function collectFolderItems(): FolderItem[] {
  const items: FolderItem[] = [];
  dataService.getDocuments().forEach((d) =>
    items.push({ ...meta(d), key: `document:${d.id}`, kind: 'document', id: d.id, title: d.title, sub: d.file.fileName, date: d.uploadedAt, doc: d })
  );
  dataService.getProposals().forEach((p) =>
    items.push({ ...meta(p), key: `proposal:${p.id}`, kind: 'proposal', id: p.id, title: `Proposal ${p.id}${p.revisionNumber ? ` R${p.revisionNumber}` : ''}`, sub: `${p.customerName} · ${p.status.replace(/_/g, ' ')}`, date: p.createdAt, href: `/proposals?view=${encodeURIComponent(p.id)}` })
  );
  dataService.getContracts().forEach((c) =>
    items.push({ ...meta(c), key: `contract:${c.id}`, kind: 'contract', id: c.id, title: `Contract ${c.id}`, sub: `${c.customerName} · ${c.status}`, date: c.startDate, href: `/contracts?view=${encodeURIComponent(c.id)}` })
  );
  dataService
    .getJobs()
    .filter((j) => j.status === 'completed' || j.supervisorVerification)
    .forEach((j) =>
      items.push({ ...meta(j), key: `job:${j.id}`, kind: 'job', id: j.id, title: `Service report ${j.id}`, sub: `${j.siteName || j.customerName} · ${j.supervisorVerification ? 'verified' : 'awaiting QC'}`, date: j.scheduledDate, href: `/operations/jobs?view=${encodeURIComponent(j.id)}` })
    );
  dataService.getInvoices().forEach((i) =>
    items.push({ ...meta(i), key: `invoice:${i.id}`, kind: 'invoice', id: i.id, title: `Invoice ${i.invoiceNumber}`, sub: `${i.customerName} · ${i.status.replace(/_/g, ' ')}`, date: i.issueDate, href: `/finance/invoices?view=${encodeURIComponent(i.id)}` })
  );
  dataService.getPayments().forEach((p) =>
    items.push({ ...meta(p), key: `payment:${p.id}`, kind: 'payment', id: p.id, title: `Receipt ${p.receiptNumber}`, sub: `${p.customerName} · ${p.invoiceNumber}`, date: p.paymentDate, href: `/finance/invoices?view=${encodeURIComponent(p.invoiceId)}` })
  );
  dataService.getOutreachLogs().forEach((o) =>
    items.push({ ...meta(o), key: `outreach:${o.id}`, kind: 'outreach', id: o.id, title: o.subject || `${o.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} to ${o.recipientName}`, sub: `${o.related.title} · ${o.status}`, date: o.sentAt })
  );
  return items;
}

export const itemSearchText = (i: FolderItem) => [i.title, i.sub, i.id, i.folderPath, i.doc?.file.fileName, i.doc?.notes].filter(Boolean).join(' ').toLowerCase();

/** Readable folder path with live client / branch names. */
export function prettyPath(path: string | undefined): string {
  if (!path) return UNFILED_ROOT;
  const parsed = parseFolderPath(path);
  return path
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      const i = seg.lastIndexOf('__');
      if (i < 0) return seg;
      const id = seg.slice(i + 2);
      if (parsed?.branchId === id) return dataService.getBranchById(id)?.branchName || seg.slice(0, i);
      return dataService.clientInfo(id).name || seg.slice(0, i);
    })
    .join(' / ');
}
