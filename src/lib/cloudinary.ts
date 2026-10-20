// Direct browser -> Cloudinary uploads using an UNSIGNED upload preset (no API secret in the frontend).
// Falls back to an inline data URL for small files when Cloudinary is not configured (demo / offline mode).

import { cloudinaryEnv, integrations, outreachEnv } from '../config/env';
import type { StoredFile } from '../types/document';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // Cloudinary free plan: 10 MB per file
const LOCAL_FALLBACK_MAX_BYTES = 750 * 1024; // keep localStorage usable

export const ACCEPTED_DOC_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx';

export function validateFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is larger than 10 MB.`;
  if (file.type && !ACCEPTED_DOC_TYPES.includes(file.type)) {
    return `${file.name}: unsupported type. Use PDF, image, Word or Excel.`;
  }
  return null;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const safeSegment = (v: string) => v.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);

/**
 * Uploads a file (or generated Blob such as a proposal PDF).
 * @param folder sub-folder inside VITE_CLOUDINARY_FOLDER, e.g. "library/authority_letter" or "company/CO-2026-0001"
 */
export async function uploadFile(
  file: File | Blob,
  options: { folder: string; fileName?: string; onProgress?: (pct: number) => void }
): Promise<StoredFile> {
  const fileName = options.fileName || (file instanceof File ? file.name : 'document.pdf');
  const fileType = file.type || 'application/octet-stream';

  if (!integrations.cloudinary) {
    if (file.size > LOCAL_FALLBACK_MAX_BYTES) {
      throw new Error('Cloudinary is not configured. Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET to upload files larger than 750 KB.');
    }
    options.onProgress?.(100);
    return { url: await readAsDataUrl(file), fileName, fileSize: file.size, fileType, storage: 'local' };
  }

  const form = new FormData();
  form.append('file', file, fileName);
  form.append('upload_preset', cloudinaryEnv.uploadPreset);
  form.append('folder', `${cloudinaryEnv.folder}/${options.folder}`.replace(/\/+/g, '/'));
  form.append('public_id', `${safeSegment(fileName.replace(/\.[^.]+$/, ''))}_${Date.now()}`);

  // PDFs go through the "image" pipeline (previews & page thumbnails); Office files must be "raw".
  const isRaw = /word|excel|spreadsheet|msword|officedocument/.test(fileType);
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudinaryEnv.cloudName}/${isRaw ? 'raw' : 'auto'}/upload`;

  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) options.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error body
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error((body.error as { message?: string })?.message || `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading. Check your connection.'));
    xhr.send(form);
  });

  return {
    url: result.secure_url as string,
    publicId: result.public_id as string,
    resourceType: result.resource_type as string,
    fileName,
    fileSize: (result.bytes as number) ?? file.size,
    fileType,
    storage: 'cloudinary',
  };
}

/** Cloudinary URL that forces a download with the original file name instead of inline display. */
export function downloadUrl(file: StoredFile): string {
  if (file.storage !== 'cloudinary' || file.resourceType === 'raw' || !file.url.includes('/upload/')) return file.url;
  return file.url.replace('/upload/', `/upload/fl_attachment:${safeSegment(file.fileName.replace(/\.[^.]+$/, ''))}/`);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Permanently deletes a file from Cloudinary through the server (/api/delete-file), which holds
 * the API secret. Returns false when the server API isn't configured (the file then stays in Cloudinary).
 */
export async function deleteFromCloudinary(file: StoredFile): Promise<boolean> {
  if (file.storage !== 'cloudinary' || !file.publicId || !integrations.outreachApi) return false;
  const { auth } = await import('./firebase');
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(`${outreachEnv.apiBaseUrl.replace(/\/$/, '')}/delete-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ publicId: file.publicId, resourceType: file.resourceType || 'image' }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Could not delete the file from Cloudinary (HTTP ${res.status})`);
  }
  return true;
}
