// One photo from the camera / gallery → a stored URL, or a small inline copy when offline.
// Shared by PhotoCapture (photo grids) and SinglePhotoField (one photo per finding row).

import { uploadFile } from '../../lib/cloudinary';
import { compressImage, blobToDataUrl } from '../../lib/imageUtils';
import { integrations } from '../../config/env';
import type { UploadScope } from '../../lib/folders';

/** Max photos kept on the device without internet (stored inline on the record until reconnecting). */
export const MAX_OFFLINE_PHOTOS = 4;

export const isPhotoFile = (f: File) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name);

export async function storePhoto(
  file: File,
  opts: { scope: UploadScope; subPath?: string; fileName: string; onProgress?: (pct: number) => void; offlineCount: number }
): Promise<{ url: string; offline: boolean }> {
  if (navigator.onLine && integrations.cloudinary) {
    // Phones may give formats the browser can't redraw (HEIC on Android); Cloudinary converts the original
    const blob = await compressImage(file, 1600, 0.82).catch(() => file);
    const stored = await uploadFile(blob, { scope: opts.scope, subPath: opts.subPath, fileName: opts.fileName, onProgress: opts.onProgress });
    return { url: stored.url, offline: false };
  }
  // No connection: keep a small copy on the record so reports still have it
  if (opts.offlineCount >= MAX_OFFLINE_PHOTOS) {
    throw new Error(`Offline limit reached (${MAX_OFFLINE_PHOTOS} photos). Connect to the internet to add more.`);
  }
  const small = await compressImage(file, 900, 0.6);
  return { url: await blobToDataUrl(small), offline: true };
}
