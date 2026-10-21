import React, { useRef, useState } from 'react';
import { UploadCloud, Camera, Trash2, Loader2, AlertCircle, FileText } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { dataService } from '../../services/dataService';
import { uploadFile, validateFile, ACCEPT_ATTR, formatBytes } from '../../lib/cloudinary';
import { COMPANY_DOC_CATEGORIES, type CompanyDocCategory } from '../../types/document';
import type { FileCategory, OwnerScope } from '../../types/folders';
import type { ClientSubfolder, CompanySubfolder } from '../../lib/folders';
import { FolderDestination } from './FolderDestination';
import { defaultDestination, destinationMeta, ownerFor, type Destination } from './destinationUtils';

export interface UploadTarget {
  ownerScope: OwnerScope;
  clientId?: string;
  branchId?: string;
  subfolder?: ClientSubfolder | CompanySubfolder;
  /** Pre-selected type (e.g. 'sop' or 'layout' from the onboarding pack). */
  category?: FileCategory;
  /** Client is fixed (e.g. opened from a client's Files tab). */
  locked?: boolean;
}

interface Props {
  target: UploadTarget;
  initialFiles?: File[];
  onClose: () => void;
  /** Called with the folder the files went to and the new document ids. */
  onUploaded?: (folderPath?: string, documentIds?: string[]) => void;
}

interface PendingFile {
  file: File;
  title: string;
  progress: number;
  error?: string;
}

const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Library category for company uploads (keeps the Document Library and pitch packs working). */
const libraryCategoryFor = (subfolder: string, category: string): CompanyDocCategory => {
  if (category === 'msds') return 'msds_chemical';
  if (subfolder === 'Technician Certificates') return 'certification';
  if (category === 'service_report') return 'service_report';
  if (subfolder === 'Profile & Registrations') return 'company_profile';
  return 'other';
};

/** Upload into a folder. Scope, client, branch and folder come pre-filled from where it was opened. */
export const FolderUploadModal: React.FC<Props> = ({ target, initialFiles = [], onClose, onUploaded }) => {
  const { success, error, warning } = useNotification();
  const { userProfile } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const [dest, setDest] = useState<Destination>(() => defaultDestination(target));
  const [libraryCategory, setLibraryCategory] = useState<CompanyDocCategory>(() => libraryCategoryFor(dest.subfolder, dest.category));
  const [expiryDate, setExpiryDate] = useState('');
  const [files, setFiles] = useState<PendingFile[]>(() => accept(initialFiles));
  const [busy, setBusy] = useState(false);

  function accept(list: File[]): PendingFile[] {
    const next: PendingFile[] = [];
    for (const file of list) {
      const problem = validateFile(file);
      if (problem) warning('File skipped', problem);
      else next.push({ file, title: titleFromFile(file.name), progress: 0 });
    }
    return next;
  }

  const add = (list: FileList | null) => list && setFiles((prev) => [...prev, ...accept(Array.from(list))]);

  const owner = ownerFor(dest);
  const problems: string[] = [];
  if (!owner) problems.push('Choose the client these files belong to.');
  if (!files.length) problems.push('Add at least one file.');

  const upload = async () => {
    if (problems.length || !owner) return;
    setBusy(true);
    let done = 0;
    let lastPath: string | undefined;
    const savedIds: string[] = [];
    const failed: PendingFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const pending = files[i];
      try {
        const uploadedAt = new Date().toISOString();
        const meta = destinationMeta(dest, uploadedAt);
        if (!meta.ownerScope) throw new Error('Choose where this file belongs.');
        const stored = await uploadFile(pending.file, {
          scope: { ownerScope: meta.ownerScope, clientId: meta.clientId, category: dest.category },
          subPath: dest.branchId,
          fileName: pending.file.name,
          onProgress: (pct) => setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, progress: pct } : f))),
        });
        const saved = dataService.saveDocument(
          {
            id: `DOC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: pending.title.trim() || titleFromFile(pending.file.name),
            category: dest.ownerScope === 'company' ? libraryCategory : 'other',
            owner,
            ...meta,
            source: 'uploaded',
            file: stored,
            expiryDate: expiryDate || undefined,
            uploadedBy: userProfile?.email || 'admin',
            uploadedByName: userProfile?.displayName || 'Staff',
            uploadedAt,
          },
          userProfile?.email
        );
        lastPath = meta.folderPath;
        savedIds.push(saved.id);
        done++;
      } catch (err) {
        failed.push({ ...pending, progress: 0, error: err instanceof Error ? err.message : 'Upload failed' });
      }
    }
    setBusy(false);
    if (done) success('Uploaded', `${done} file${done === 1 ? '' : 's'} saved to ${dest.subfolder}.`);
    if (failed.length) {
      setFiles(failed);
      error('Some files failed', failed.map((f) => `${f.file.name}: ${f.error}`).join('\n'));
      return;
    }
    onUploaded?.(lastPath, savedIds);
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={() => !busy && onClose()}
      title="Upload files"
      subtitle={dest.ownerScope === 'company' ? 'Into the Company (IKPM) folder' : dest.clientId ? `Into ${dataService.clientInfo(dest.clientId).name || dest.clientId}` : 'Choose the client'}
      maxWidth="640px"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={upload} disabled={busy || problems.length > 0} title={problems.join('\n')}>
            {busy ? <Loader2 size={15} className="spin" /> : <UploadCloud size={15} />}
            <span>{busy ? 'Uploading…' : `Upload ${files.length || ''}`}</span>
          </button>
        </>
      }
    >
      <FolderDestination
        value={dest}
        onChange={(d) => {
          setDest(d);
          setLibraryCategory(libraryCategoryFor(d.subfolder, d.category));
        }}
        lockClient={target.locked}
      />

      {dest.ownerScope === 'company' && (
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">Library section</label>
            <select className="form-select" value={libraryCategory} onChange={(e) => setLibraryCategory(e.target.value as CompanyDocCategory)}>
              {COMPANY_DOC_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Valid until (optional)</label>
            <input type="date" className="form-input" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>
        </div>
      )}

      <div
        className="upload-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          add(e.dataTransfer.files);
        }}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
      >
        <UploadCloud size={28} color="var(--text-muted)" />
        <div style={{ fontWeight: 600 }}>Drop files or click to choose</div>
        <div className="cell-sub">PDF, images, Word or Excel up to 10 MB</div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', margin: '0.5rem 0 1rem' }}>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => cameraInput.current?.click()}>
          <Camera size={14} /> Scan with camera
        </button>
      </div>
      <input ref={fileInput} type="file" multiple accept={ACCEPT_ATTR} hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />

      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {files.map((f, i) => (
            <div key={`${f.file.name}-${i}`} className="contact-card" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <FileText size={18} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <input className="form-input" value={f.title} onChange={(e) => setFiles((prev) => prev.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x)))} aria-label="File title" disabled={busy} />
                <div className="cell-sub">
                  {f.file.name} · {formatBytes(f.file.size)}
                  {busy && f.progress > 0 ? ` · ${f.progress}%` : ''}
                </div>
                {f.error && <div className="error-hint" style={{ marginTop: 4 }}><AlertCircle size={13} /> {f.error}</div>}
              </div>
              <button type="button" className="icon-btn" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} disabled={busy} aria-label="Remove file">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};

export default FolderUploadModal;
