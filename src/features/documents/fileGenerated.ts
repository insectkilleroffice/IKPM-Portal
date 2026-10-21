// Files a generated PDF / Excel into a client folder (src/lib/folders.ts decides the path from
// the owner and fileCategory). Falls back to a download when file storage is off or offline.

import { dataService } from '../../services/dataService';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import { downloadBlob } from '../../lib/opsPdf';
import type { DocumentOwner, PortalDocument } from '../../types/document';
import type { FileCategory, TemplateStamp } from '../../types/folders';

export async function fileGenerated(
  blob: Blob,
  opts: {
    owner: DocumentOwner;
    category: FileCategory;
    title: string;
    fileName: string;
    subPath?: string;
    user: { email?: string; displayName?: string };
  } & TemplateStamp
): Promise<PortalDocument | null> {
  if (!integrations.cloudinary || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    downloadBlob(blob, opts.fileName);
    return null;
  }
  const stored = await uploadFile(blob, { scope: dataService.uploadScopeFor(opts.owner, opts.category), subPath: opts.subPath, fileName: opts.fileName });
  return dataService.saveDocument(
    {
      id: `DOC-${Date.now()}-${opts.category}`,
      title: opts.title,
      category: 'other',
      fileCategory: opts.category,
      owner: opts.owner,
      source: 'generated',
      file: stored,
      uploadedBy: opts.user.email || 'admin',
      uploadedByName: opts.user.displayName || 'Staff',
      uploadedAt: new Date().toISOString(),
      templateVersion: opts.templateVersion,
      templateSnapshot: opts.templateSnapshot,
    },
    opts.user.email
  );
}
