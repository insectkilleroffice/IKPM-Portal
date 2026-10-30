// Files a generated PDF / Excel into a client folder (src/lib/folders.ts decides the path from
// the owner and fileCategory). Works both with Cloudinary cloud storage and offline/local fallback.

import { dataService } from '../../services/dataService';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import { downloadBlob } from '../../lib/opsPdf';
import type { DocumentOwner, PortalDocument, StoredFile } from '../../types/document';
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
  let stored: StoredFile = {
    url: typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : '',
    fileName: opts.fileName,
    fileSize: blob.size,
    fileType: blob.type || 'application/pdf',
    storage: 'local',
  };

  const hasCloudinary = Boolean(integrations.cloudinary);
  const isOnline = typeof navigator === 'undefined' || navigator.onLine;

  if (hasCloudinary && isOnline) {
    try {
      stored = await uploadFile(blob, {
        scope: dataService.uploadScopeFor(opts.owner, opts.category),
        subPath: opts.subPath,
        fileName: opts.fileName,
      });
    } catch (err) {
      console.warn('Cloudinary upload fallback to local:', err);
    }
  } else {
    if (typeof window !== 'undefined') {
      try {
        downloadBlob(blob, opts.fileName);
      } catch {
        // Ignore download error
      }
    }
  }

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
