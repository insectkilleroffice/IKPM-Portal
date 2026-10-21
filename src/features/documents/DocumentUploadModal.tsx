import React, { useRef, useState } from 'react';
import { UploadCloud, FileText, X } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { dataService } from '../../services/dataService';
import { uploadFile, validateFile, ACCEPT_ATTR, formatBytes } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import { documentFolderCategory } from '../../lib/folders';
import { COMPANY_DOC_CATEGORIES, type CompanyDocCategory, type DocumentOwner } from '../../types/document';
import { useDataStore } from '../../hooks/useDataStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  owner: DocumentOwner;
  defaultCategory?: CompanyDocCategory;
}

interface PendingFile {
  file: File;
  title: string;
  progress: number;
  error?: string;
}

const titleFromFile = (name: string) =>
  name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

export const DocumentUploadModal: React.FC<Props> = ({ isOpen, onClose, owner, defaultCategory = 'other' }) => {
  useDataStore(); // re-render when Firestore data arrives
  const { success, error } = useNotification();
  const { userProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<PendingFile[]>([]);
  const [category, setCategory] = useState<CompanyDocCategory>(defaultCategory);
  const [issuedBy, setIssuedBy] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next: PendingFile[] = [];
    for (const file of Array.from(list)) {
      const problem = validateFile(file);
      if (problem) error('File skipped', problem);
      else next.push({ file, title: titleFromFile(file.name), progress: 0 });
    }
    setFiles((prev) => [...prev, ...next]);
  };

  const reset = () => {
    setFiles([]);
    setIssuedBy('');
    setExpiryDate('');
    setBusy(false);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  // Same category → folder mapping the saved record uses (src/lib/folders.ts)
  const fileCategory = documentFolderCategory({ owner, category }).category;

  const handleUpload = async () => {
    if (files.length === 0) return;
    setBusy(true);
    let uploaded = 0;
    const failed = new Set<number>();

    for (let i = 0; i < files.length; i++) {
      const pending = files[i];
      try {
        const stored = await uploadFile(pending.file, {
          scope: dataService.uploadScopeFor(owner, fileCategory),
          onProgress: (pct) => setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, progress: pct } : f))),
        });
        dataService.saveDocument(
          {
            id: `DOC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: pending.title || titleFromFile(pending.file.name),
            category,
            fileCategory,
            owner,
            file: stored,
            issuedBy: issuedBy || undefined,
            expiryDate: expiryDate || undefined,
            uploadedBy: userProfile?.email || 'admin',
            uploadedByName: userProfile?.displayName || 'Admin',
            uploadedAt: new Date().toISOString(),
          },
          userProfile?.email
        );
        uploaded++;
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, progress: 100, error: undefined } : f)));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        failed.add(i);
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, error: msg } : f)));
      }
    }

    setBusy(false);
    if (uploaded > 0) success('Uploaded', `${uploaded} document(s) saved${integrations.cloudinary ? ' to Cloudinary' : ' locally'}.`);
    if (failed.size === 0) {
      reset();
      onClose();
    } else {
      // Keep only the failed files so the user can retry them
      setFiles((prev) => prev.filter((_, idx) => failed.has(idx)));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={owner.kind === 'library' ? 'Upload IKPM Company Document' : 'Upload Client Document'}
      subtitle={
        integrations.cloudinary
          ? 'Files are stored securely in Cloudinary. PDF, images, Word or Excel up to 10 MB.'
          : 'Cloudinary not configured — small files (≤750 KB) are kept on this device only.'
      }
      maxWidth="620px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', width: '100%' }}>
          <button className="btn btn-secondary" onClick={close} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={handleUpload} disabled={busy || files.length === 0}>
            <UploadCloud size={15} />
            <span>{busy ? 'Uploading…' : `Upload ${files.length || ''}`.trim()}</span>
          </button>
        </div>
      }
    >
      <div
        className={`dropzone ${dragOver ? 'is-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
      >
        <UploadCloud size={28} />
        <div style={{ fontWeight: 700 }}>Drop files here or click to browse</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>You can select several files at once</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          style={{ display: 'none' }}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1rem 0' }}>
          {files.map((f, idx) => (
            <div key={`${f.file.name}-${idx}`} className="upload-row">
              <FileText size={16} style={{ flexShrink: 0, color: 'var(--ikpm-emerald-600)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  className="form-input"
                  style={{ height: '30px', fontSize: '0.8rem' }}
                  value={f.title}
                  disabled={busy}
                  onChange={(e) => setFiles((prev) => prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                />
                <div style={{ fontSize: '0.7rem', color: f.error ? 'var(--ikpm-rose-500)' : 'var(--text-muted)', marginTop: 2 }}>
                  {f.error || `${f.file.name} • ${formatBytes(f.file.size)}`}
                </div>
                {busy && !f.error && (
                  <div className="progress-track"><div className="progress-bar" style={{ width: `${f.progress}%` }} /></div>
                )}
              </div>
              {!busy && (
                <button className="icon-btn" title="Remove" onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Category</label>
          <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value as CompanyDocCategory)} disabled={busy}>
            {COMPANY_DOC_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Valid Until (optional)</label>
          <input type="date" className="form-input" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} disabled={busy} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Issued By (optional)</label>
        <input
          className="form-input"
          placeholder="e.g. FMC Pakistan, Sindh Revenue Board, Agriculture Dept."
          value={issuedBy}
          onChange={(e) => setIssuedBy(e.target.value)}
          disabled={busy}
        />
      </div>
    </Modal>
  );
};
