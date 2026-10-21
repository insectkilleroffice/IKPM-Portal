import React, { useRef, useState } from 'react';
import { Camera, Images, Trash2, Loader2, AlertTriangle, CloudOff, Check, RotateCcw } from 'lucide-react';
import { uploadFile } from '../../lib/cloudinary';
import { compressImage, blobToDataUrl } from '../../lib/imageUtils';
import { integrations } from '../../config/env';
import type { SitePhoto } from '../../types/operations';

export interface PhotoCategory {
  value: string;
  label: string;
}

/** Max photos kept on the device without internet (stored inline on the record until reconnecting). */
const MAX_OFFLINE = 4;

interface Pending {
  id: string;
  file: File;
  preview: string;
  type: string;
  progress: number;
  error?: string;
}

interface Props<T extends SitePhoto> {
  /** Cloudinary sub-folder, e.g. `job/JB-2026-0001/photos`. */
  folder: string;
  /** Prefix for uploaded file names, usually the record id. */
  idPrefix: string;
  categories: PhotoCategory[];
  photos: T[];
  onChange: (photos: T[]) => void;
  onNotify?: (kind: 'success' | 'warning' | 'error', title: string, message: string) => void;
  /** Categories that need at least one photo; shows a numbered checklist over the buttons. */
  required?: string[];
  emptyText?: string;
}

/** Camera / gallery photo evidence, uploaded to Cloudinary (or kept small on the device when offline). */
export function PhotoCapture<T extends SitePhoto>({ folder, idPrefix, categories, photos, onChange, onNotify, required, emptyText }: Props<T>) {
  const [type, setType] = useState(categories[0]?.value ?? 'general');
  const [pending, setPending] = useState<Pending[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // Keep the latest list for async uploads finishing out of order
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const labelOf = (t: string) => categories.find((c) => c.value === t)?.label ?? t;
  const countOf = (t: string) => photos.filter((p) => p.type === t).length;

  const setList = (next: T[]) => {
    photosRef.current = next;
    onChange(next);
  };

  const patchPending = (id: string, patch: Partial<Pending>) => setPending((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const dropPending = (id: string) =>
    setPending((p) => {
      const tile = p.find((x) => x.id === id);
      if (tile) URL.revokeObjectURL(tile.preview);
      return p.filter((x) => x.id !== id);
    });

  const process = async (tile: Pending) => {
    const { id, file, type: photoType } = tile;
    patchPending(id, { error: undefined, progress: 0 });
    const photo = (imageUrl: string, caption: string) =>
      ({ id, type: photoType, caption, imageUrl, capturedAt: new Date().toISOString() }) as T;

    try {
      if (navigator.onLine && integrations.cloudinary) {
        // Phones may give formats the browser can't redraw (HEIC on Android); Cloudinary converts the original
        const blob = await compressImage(file, 1600, 0.82).catch(() => file);
        const stored = await uploadFile(blob, {
          folder,
          fileName: `${idPrefix}_${photoType}_${Date.now()}.jpg`,
          onProgress: (pct) => patchPending(id, { progress: pct }),
        });
        setList([...photosRef.current, photo(stored.url, labelOf(photoType))]);
      } else {
        // No connection: keep a small copy on the record so reports still have it
        const offlineCount = photosRef.current.filter((p) => p.imageUrl.startsWith('data:')).length;
        if (offlineCount >= MAX_OFFLINE) {
          patchPending(id, { error: `Offline limit reached (${MAX_OFFLINE} photos). Connect to the internet to add more.` });
          return;
        }
        const small = await compressImage(file, 900, 0.6);
        setList([...photosRef.current, photo(await blobToDataUrl(small), `${labelOf(photoType)} (saved offline)`)]);
        onNotify?.('warning', 'Saved on this phone', 'No internet: the photo is kept at lower quality until you are back online.');
      }
      dropPending(id);
    } catch (err) {
      patchPending(id, { error: err instanceof Error ? err.message : 'Upload failed' });
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
    if (!list.length) {
      onNotify?.('error', 'Not a photo', 'Choose image files (JPG, PNG or the phone camera).');
      return;
    }
    const tiles = list.map((file, idx) => ({
      id: `photo_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      file,
      preview: URL.createObjectURL(file),
      type,
      progress: 0,
    }));
    setPending((p) => [...p, ...tiles]);
    await Promise.all(tiles.map(process));
  };

  const remove = (id: string) => setList(photosRef.current.filter((p) => p.id !== id));
  const setCaption = (id: string, caption: string) => setList(photosRef.current.map((p) => (p.id === id ? { ...p, caption } : p)));

  return (
    <div>
      {required?.length ? (
        <div className="photo-steps">
          {categories.map((c, i) => {
            const n = countOf(c.value);
            const isRequired = required.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                className={`photo-step ${type === c.value ? 'is-active' : ''} ${n > 0 ? 'is-done' : ''}`}
                onClick={() => setType(c.value)}
              >
                <span className="step-num">{n > 0 ? <Check size={14} /> : i + 1}</span>
                <span className="step-label">{c.label}</span>
                <span className="step-state">{n > 0 ? `${n} photo${n > 1 ? 's' : ''}` : isRequired ? 'Needed' : 'Optional'}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="form-label">What does the photo show?</div>
          <div className="chip-row">
            {categories.map((c) => (
              <button key={c.value} type="button" className={`chip ${type === c.value ? 'chip-on' : ''}`} onClick={() => setType(c.value)}>
                {c.label} <span className="tab-count">{countOf(c.value)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="photo-actions">
        <button type="button" className="btn btn-primary photo-action" onClick={() => cameraRef.current?.click()}>
          <Camera size={20} /> Take photo
        </button>
        <button type="button" className="btn btn-secondary photo-action" onClick={() => galleryRef.current?.click()}>
          <Images size={20} /> Choose from gallery
        </button>
        {/* capture="environment" opens the rear camera directly on phones */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFiles(e.target.files)} />
        <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
      </div>
      {!integrations.cloudinary && (
        <div className="empty-hint" style={{ marginBottom: '0.75rem' }}>
          <CloudOff size={14} style={{ verticalAlign: '-2px' }} /> Photo storage (Cloudinary) isn't configured, so photos are kept at low quality on the record.
        </div>
      )}

      {photos.length === 0 && pending.length === 0 ? (
        <div className="drive-empty">{emptyText ?? 'No photos yet.'}</div>
      ) : (
        <div className="photo-grid">
          {photos.map((p) => (
            <figure key={p.id} className="photo-tile">
              <img src={p.imageUrl} alt={p.caption} loading="lazy" />
              <span className="photo-badge">{labelOf(p.type)}</span>
              {p.imageUrl.startsWith('data:') && <span className="photo-badge offline">Offline</span>}
              <button type="button" className="photo-remove" onClick={() => remove(p.id)} aria-label="Remove photo"><Trash2 size={14} /></button>
              <input className="photo-caption" value={p.caption} onChange={(e) => setCaption(p.id, e.target.value)} placeholder="Caption" />
            </figure>
          ))}
          {pending.map((p) => (
            <figure key={p.id} className="photo-tile is-pending">
              <img src={p.preview} alt="Uploading" />
              <div className="photo-progress">
                {p.error ? (
                  <>
                    <AlertTriangle size={16} />
                    <span>{p.error}</span>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => process(p)}><RotateCcw size={12} /> Retry</button>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => dropPending(p.id)}>Dismiss</button>
                    </div>
                  </>
                ) : (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>{p.progress < 100 ? `Uploading ${p.progress}%` : 'Saving…'}</span>
                    <div className="progress-track" style={{ width: '80%' }}><div className="progress-bar" style={{ width: `${p.progress}%` }} /></div>
                  </>
                )}
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
