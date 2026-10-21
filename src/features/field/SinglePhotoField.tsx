import React, { useRef, useState } from 'react';
import { Camera, Images, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import type { SitePhoto } from '../../types/operations';
import type { UploadScope } from '../../lib/folders';
import { isPhotoFile, storePhoto } from './photoUpload';

interface Props {
  photo?: SitePhoto;
  onChange: (photo: SitePhoto | undefined) => void;
  scope: UploadScope;
  subPath?: string;
  /** File name start; a timestamp is added when the photo is taken. */
  fileNamePrefix: string;
  caption: string;
  /** Photos already kept offline on this record (limits inline copies). */
  offlineCount: number;
  onNotify?: (kind: 'warning' | 'error', title: string, message: string) => void;
}

/** One photo (camera or gallery), uploaded or kept small on the device when offline. */
export const SinglePhotoField: React.FC<Props> = ({ photo, onChange, scope, subPath, fileNamePrefix, caption, offlineCount, onNotify }) => {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const take = async (files: FileList | null) => {
    const file = files?.[0];
    if (camera.current) camera.current.value = '';
    if (gallery.current) gallery.current.value = '';
    if (!file) return;
    if (!isPhotoFile(file)) return onNotify?.('error', 'Not a photo', 'Choose an image (JPG, PNG or the phone camera).');
    setFailed(null);
    setBusy(0);
    try {
      const stored = await storePhoto(file, { scope, subPath, fileName: `${fileNamePrefix}_${Date.now()}.jpg`, offlineCount, onProgress: setBusy });
      onChange({ id: `photo_${Date.now().toString(36)}`, type: 'infestation', caption: stored.offline ? `${caption} (saved offline)` : caption, imageUrl: stored.url, capturedAt: new Date().toISOString() });
      if (stored.offline) onNotify?.('warning', 'Saved on this phone', 'No internet: the photo is kept at lower quality until you are back online.');
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="single-photo">
      {photo ? (
        <figure className="photo-tile">
          <img src={photo.imageUrl} alt={photo.caption} loading="lazy" />
          {photo.imageUrl.startsWith('data:') && <span className="photo-badge offline">Offline</span>}
          <button type="button" className="photo-remove" onClick={() => onChange(undefined)} aria-label="Remove photo"><Trash2 size={14} /></button>
        </figure>
      ) : busy !== null ? (
        <div className="single-photo-empty"><Loader2 size={18} className="animate-spin" /> {busy < 100 ? `${busy}%` : 'Saving…'}</div>
      ) : (
        <div className="single-photo-empty">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => camera.current?.click()}><Camera size={14} /> Photo</button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => gallery.current?.click()} aria-label="Choose from gallery"><Images size={14} /></button>
        </div>
      )}
      {failed && <div className="error-hint" style={{ marginTop: 4 }}><AlertTriangle size={12} /> {failed}</div>}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => take(e.target.files)} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => take(e.target.files)} />
    </div>
  );
};

export default SinglePhotoField;
