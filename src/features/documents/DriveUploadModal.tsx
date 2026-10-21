import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Camera, Trash2, CheckCircle2, AlertCircle, FileText, Loader2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { dataService } from '../../services/dataService';
import { uploadFile, validateFile, ACCEPT_ATTR, formatBytes } from '../../lib/cloudinary';
import { CLIENT_FOLDERS, type ClientFolder } from '../../types/document';
import {
  type EntityRef,
  useEntities,
  asOwner,
  yearOptions,
  currentYear,
} from './driveUtils';
import { useDataStore } from '../../hooks/useDataStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  lockedEntity?: EntityRef;
  initialEntity?: EntityRef;
  initialFolder?: ClientFolder;
  initialYear?: number;
  initialFiles?: File[];
}

interface PendingFile {
  file: File;
  title: string;
  progress: number;
  error?: string;
  isComplete?: boolean;
}

const titleFromFile = (name: string) =>
  name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

export const DriveUploadModal: React.FC<Props> = ({
  isOpen,
  onClose,
  lockedEntity,
  initialEntity,
  initialFolder = 'client_papers',
  initialYear = currentYear(),
  initialFiles = [],
}) => {
  useDataStore(); // re-render when Firestore data arrives
  const { success, error, warning } = useNotification();
  const { userProfile } = useAuth();
  const { entities, companies, branches, clients, findEntity } = useEntities();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Selected client entity key: `${kind}:${id}`
  const defaultEntity = lockedEntity || initialEntity || entities[0];
  const [selectedEntityKey, setSelectedEntityKey] = useState<string>(
    defaultEntity ? `${defaultEntity.kind}:${defaultEntity.id}` : ''
  );
  const [folder, setFolder] = useState<ClientFolder>(initialFolder);
  const [year, setYear] = useState<number>(initialYear);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  // Sync state whenever modal opens or props change
  useEffect(() => {
    if (isOpen) {
      const active = lockedEntity || initialEntity || entities[0];
      if (active) {
        setSelectedEntityKey(`${active.kind}:${active.id}`);
      }
      setFolder(initialFolder);
      setYear(initialYear);

      if (initialFiles && initialFiles.length > 0) {
        const next: PendingFile[] = [];
        for (const file of initialFiles) {
          const problem = validateFile(file);
          if (problem) {
            warning('File skipped', problem);
          } else {
            next.push({ file, title: titleFromFile(file.name), progress: 0 });
          }
        }
        setFiles(next);
      } else {
        setFiles([]);
      }
      setBusy(false);
    }
  }, [isOpen, lockedEntity, initialEntity, initialFolder, initialYear, initialFiles]);

  const getActiveEntity = (): EntityRef | undefined => {
    if (lockedEntity) return lockedEntity;
    if (!selectedEntityKey) return entities[0];
    const [kind, id] = selectedEntityKey.split(':');
    return findEntity(kind as any, id);
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const array = Array.from(list);
    const next: PendingFile[] = [];
    for (const file of array) {
      const problem = validateFile(file);
      if (problem) {
        warning('File skipped', problem);
      } else {
        next.push({ file, title: titleFromFile(file.name), progress: 0 });
      }
    }
    setFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (idx: number) => {
    if (busy) return;
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateTitle = (idx: number, newTitle: string) => {
    setFiles((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, title: newTitle } : f))
    );
  };

  const handleUpload = async () => {
    const activeEntity = getActiveEntity();
    if (!activeEntity) {
      error('Client selection required', 'Please choose a client or company account for these documents.');
      return;
    }
    if (files.length === 0) {
      warning('No files selected', 'Please add at least one document or photo scan to upload.');
      return;
    }

    setBusy(true);
    let uploadedCount = 0;
    const remainingPending: PendingFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const pending = files[i];
      try {
        setFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, progress: 20, error: undefined } : f))
        );

        const storageFolder = `clients/${activeEntity.kind}/${activeEntity.id}/${folder}${
          folder === 'old_records' ? `/${year}` : ''
        }`;

        const stored = await uploadFile(pending.file, {
          folder: storageFolder,
          fileName: pending.file.name,
          onProgress: (pct) =>
            setFiles((prev) =>
              prev.map((f, idx) => (idx === i ? { ...f, progress: Math.max(20, pct) } : f))
            ),
        });

        const docRecord = {
          id: `DOC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: pending.title.trim() || titleFromFile(pending.file.name),
          category: 'other' as const,
          owner: asOwner(activeEntity),
          folder,
          year: folder === 'old_records' ? year : undefined,
          source: 'uploaded' as const,
          file: stored,
          uploadedBy: userProfile?.email || 'admin',
          uploadedByName: userProfile?.displayName || 'Admin',
          uploadedAt: new Date().toISOString(),
        };

        dataService.saveDocument(docRecord, userProfile?.email);
        uploadedCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        remainingPending.push({ ...pending, progress: 0, error: msg });
      }
    }

    setBusy(false);

    if (uploadedCount > 0) {
      success(
        'Upload Successful',
        `Successfully saved ${uploadedCount} document${uploadedCount === 1 ? '' : 's'} to ${activeEntity.name} / ${
          CLIENT_FOLDERS.find((f) => f.value === folder)?.label || folder
        }.`
      );
    }

    if (remainingPending.length > 0) {
      error(
        'Some files failed to upload',
        `${remainingPending.length} file${remainingPending.length === 1 ? '' : 's'} could not be uploaded. You can retry them.`
      );
      setFiles(remainingPending);
    } else {
      setFiles([]);
      onClose();
    }
  };

  const activeEntity = getActiveEntity();

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Upload or scan files"
      subtitle="Organize client records, agreements, invoices, certificates, and legacy scans"
      maxWidth="680px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', width: '100%' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleUpload}
            disabled={busy || files.length === 0}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Uploading...</span>
              </>
            ) : (
              <>
                <UploadCloud size={16} />
                <span>Upload {files.length > 0 ? `(${files.length})` : ''}</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Destination Target Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: folder === 'old_records' ? '1.5fr 1.2fr 0.8fr' : '1.5fr 1.2fr', gap: '1rem' }}>
          {/* Client Selection (Locked if opened inside client) */}
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              Client / Account
            </label>
            {lockedEntity ? (
              <div
                style={{
                  padding: '0.55rem 0.75rem',
                  backgroundColor: 'var(--bg-surface-alt)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--ikpm-navy-900)',
                }}
              >
                {lockedEntity.name}
              </div>
            ) : (
              <select
                className="form-select"
                value={selectedEntityKey}
                onChange={(e) => setSelectedEntityKey(e.target.value)}
                disabled={busy}
                style={{ fontSize: '0.85rem' }}
              >
                {companies.length > 0 && (
                  <optgroup label="Corporate Companies">
                    {companies.map((c) => (
                      <option key={`company:${c.id}`} value={`company:${c.id}`}>
                        {c.name} ({c.id})
                      </option>
                    ))}
                  </optgroup>
                )}
                {branches.length > 0 && (
                  <optgroup label="Branches">
                    {branches.map((b) => (
                      <option key={`branch:${b.id}`} value={`branch:${b.id}`}>
                        {b.name} ({b.id})
                      </option>
                    ))}
                  </optgroup>
                )}
                {clients.length > 0 && (
                  <optgroup label="Individual Clients">
                    {clients.map((cl) => (
                      <option key={`client:${cl.id}`} value={`client:${cl.id}`}>
                        {cl.name} ({cl.id})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </div>

          {/* Folder Selection */}
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              Destination Folder
            </label>
            <select
              className="form-select"
              value={folder}
              onChange={(e) => setFolder(e.target.value as ClientFolder)}
              disabled={busy}
              style={{ fontSize: '0.85rem' }}
            >
              {CLIENT_FOLDERS.map((cf) => (
                <option key={cf.value} value={cf.value}>
                  📁 {cf.label}
                </option>
              ))}
            </select>
          </div>

          {/* Year Selection (Visible only for Old Records) */}
          {folder === 'old_records' && (
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                Archive Year
              </label>
              <select
                className="form-select"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                disabled={busy}
                style={{ fontSize: '0.85rem' }}
              >
                {yearOptions().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Dropzone & Phone Camera Scan Actions */}
        <div
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
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--ikpm-navy-700)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '1.75rem 1rem',
            textAlign: 'center',
            backgroundColor: dragOver ? 'rgba(10, 34, 64, 0.04)' : 'var(--bg-surface-alt)',
            cursor: busy ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <UploadCloud
            size={36}
            color={dragOver ? 'var(--ikpm-navy-700)' : 'var(--text-muted)'}
            style={{ margin: '0 auto 0.5rem auto' }}
          />
          <div style={{ fontWeight: 600, color: 'var(--ikpm-navy-900)', fontSize: '0.95rem' }}>
            Choose files or drag & drop here
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            PDF, JPG, PNG, WEBP, DOCX, XLSX (up to 10 MB each)
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '0.75rem',
              marginTop: '1rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              Browse Files
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => cameraInputRef.current?.click()}
              disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Camera size={14} color="var(--ikpm-navy-700)" />
              <span>Scan with phone camera</span>
            </button>
          </div>

          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
            style={{ display: 'none' }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
            style={{ display: 'none' }}
          />
        </div>

        {/* Selected / Pending Files List */}
        {files.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '280px', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Selected Files ({files.length}):
            </div>
            {files.map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.65rem 0.85rem',
                  backgroundColor: 'var(--bg-surface)',
                  border: `1px solid ${item.error ? 'var(--ikpm-rose-500)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <FileText size={20} color="var(--ikpm-navy-700)" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input
                    type="text"
                    className="form-input"
                    value={item.title}
                    onChange={(e) => updateTitle(idx, e.target.value)}
                    disabled={busy}
                    placeholder="Document title"
                    style={{ fontSize: '0.825rem', padding: '0.3rem 0.5rem', height: '28px', marginBottom: '2px' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <span>{item.file.name}</span>
                    <span>•</span>
                    <span>{formatBytes(item.file.size)}</span>
                  </div>

                  {item.progress > 0 && item.progress < 100 && (
                    <div style={{ height: '4px', backgroundColor: 'var(--border-subtle)', borderRadius: '2px', marginTop: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${item.progress}%`,
                          backgroundColor: 'var(--ikpm-navy-700)',
                          transition: 'width 0.2s',
                        }}
                      />
                    </div>
                  )}

                  {item.error && (
                    <div style={{ color: 'var(--ikpm-rose-500)', fontSize: '0.72rem', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertCircle size={12} />
                      <span>{item.error}</span>
                    </div>
                  )}
                </div>

                {!busy && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => removeFile(idx)}
                    title="Remove file"
                  >
                    <Trash2 size={16} color="var(--ikpm-rose-500)" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
