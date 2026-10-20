import React, { useState, useMemo, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  FileSpreadsheet,
  FileCheck2,
  FileSignature,
  FileArchive,
  UploadCloud,
  Search,
  ChevronRight,
  MoreVertical,
  ExternalLink,
  Download,
  Edit2,
  FolderInput,
  Trash2,
  Building2,
  GitFork,
  User,
  Calendar,
  Sparkles,
  HardDrive,
  Plus,
  ArrowLeft,
  X,
  List,
  LayoutGrid,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { formatDate } from '../../lib/formatters';
import { formatBytes } from '../../lib/cloudinary';
import {
  CLIENT_FOLDERS,
  folderLabel,
  type ClientFolder,
  type PortalDocument,
} from '../../types/document';
import {
  type EntityKind,
  type EntityRef,
  useEntities,
  docFolder,
  ownerMatches,
  asOwner,
  yearOptions,
  currentYear,
} from './driveUtils';
import { DriveUploadModal } from './DriveUploadModal';

interface Props {
  entity?: {
    kind: EntityKind;
    id: string;
    name: string;
  };
}

export const DriveExplorer: React.FC<Props> = ({ entity: lockedEntityProp }) => {
  useDataStore();
  const { userProfile } = useAuth();
  const { success, warning } = useNotification();
  const { entities, companies, branches, clients, findEntity } = useEntities();

  // Navigation State
  // activeEntity: the currently viewed entity (locked if lockedEntityProp is provided)
  const [selectedEntity, setSelectedEntity] = useState<EntityRef | null>(
    lockedEntityProp
      ? { kind: lockedEntityProp.kind, id: lockedEntityProp.id, name: lockedEntityProp.name }
      : null
  );
  const [activeFolder, setActiveFolder] = useState<ClientFolder | null>(null);
  const [activeYear, setActiveYear] = useState<number | null>(null);

  // Search & Drag-and-Drop State
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);

  // File Action Modals
  const [renameTarget, setRenameTarget] = useState<PortalDocument | null>(null);
  const [newTitle, setNewTitle] = useState('');

  const [moveTarget, setMoveTarget] = useState<PortalDocument | null>(null);
  const [moveFolder, setMoveFolder] = useState<ClientFolder>('client_papers');
  const [moveYear, setMoveYear] = useState<number>(currentYear());
  const [moveEntityKey, setMoveEntityKey] = useState<string>('');

  const [deleteTarget, setDeleteTarget] = useState<PortalDocument | null>(null);

  // Drive-style root tabs and list/grid toggle (view mode is remembered per browser)
  const [rootTab, setRootTab] = useState<'all' | 'companies' | 'clients'>('all');
  const [view, setViewState] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem('ikpm_drive_view') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const setView = (v: 'grid' | 'list') => {
    setViewState(v);
    try {
      localStorage.setItem('ikpm_drive_view', v);
    } catch {
      // Storage blocked: the choice just isn't remembered
    }
  };

  // All documents from dataService
  const allDocuments = dataService.getDocuments();

  // Locked Entity normalization
  const lockedEntity = useMemo(() => {
    if (!lockedEntityProp) return null;
    return (
      findEntity(lockedEntityProp.kind, lockedEntityProp.id) || {
        kind: lockedEntityProp.kind,
        id: lockedEntityProp.id,
        name: lockedEntityProp.name,
      }
    );
  }, [lockedEntityProp, findEntity]);

  const currentEntity = lockedEntity || selectedEntity;

  // Filtered documents for current entity
  const entityDocs = useMemo(() => {
    if (!currentEntity) return [];
    return allDocuments.filter((d) => ownerMatches(d, currentEntity.kind, currentEntity.id));
  }, [allDocuments, currentEntity]);

  // Counts per folder for current entity
  const folderCounts = useMemo(() => {
    const counts: Record<ClientFolder, number> = {
      agreements: 0,
      service_reports: 0,
      invoices: 0,
      certificates: 0,
      client_papers: 0,
      old_records: 0,
    };
    for (const doc of entityDocs) {
      const f = docFolder(doc);
      if (counts[f] !== undefined) {
        counts[f]++;
      }
    }
    return counts;
  }, [entityDocs]);

  // Years with files in Old Records
  const oldRecordsByYear = useMemo(() => {
    const map = new Map<number, number>();
    for (const doc of entityDocs) {
      if (docFolder(doc) === 'old_records') {
        const y = doc.year || new Date(doc.uploadedAt || Date.now()).getFullYear();
        map.set(y, (map.get(y) || 0) + 1);
      }
    }
    // Ensure recent years exist in the list
    const cur = currentYear();
    for (let y = cur; y >= cur - 3; y--) {
      if (!map.has(y)) map.set(y, 0);
    }
    return Array.from(map.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year);
  }, [entityDocs]);

  // Active files displayed in current folder / year view
  const activeFiles = useMemo(() => {
    if (!currentEntity || !activeFolder) return [];
    return entityDocs.filter((doc) => {
      if (docFolder(doc) !== activeFolder) return false;
      if (activeFolder === 'old_records' && activeYear !== null) {
        const docY = doc.year || new Date(doc.uploadedAt || Date.now()).getFullYear();
        return docY === activeYear;
      }
      return true;
    });
  }, [entityDocs, activeFolder, activeYear, currentEntity]);

  // Sub-branches if current entity is a company
  const childBranches = useMemo(() => {
    if (!currentEntity || currentEntity.kind !== 'company') return [];
    return branches.filter((b) => b.companyId === currentEntity.id);
  }, [currentEntity, branches]);

  // Search Results
  const searchResults = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return null;

    // Filter files
    const matchedFiles = allDocuments.filter((d) => {
      const titleMatch = d.title.toLowerCase().includes(q);
      const nameMatch = d.file.fileName.toLowerCase().includes(q);
      // If locked, limit to locked entity
      if (lockedEntity) {
        return (titleMatch || nameMatch) && ownerMatches(d, lockedEntity.kind, lockedEntity.id);
      }
      return titleMatch || nameMatch;
    });

    // Match clients/companies (if not locked)
    const matchedEntities = lockedEntity
      ? []
      : entities.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.id.toLowerCase().includes(q) ||
            (e.sub && e.sub.toLowerCase().includes(q))
        );

    return { files: matchedFiles, entities: matchedEntities };
  }, [searchQuery, allDocuments, entities, lockedEntity]);

  // Drag and drop handlers on full explorer
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setDroppedFiles(Array.from(e.dataTransfer.files));
      setIsUploadOpen(true);
    }
  };

  // Icon mapping for folders
  const getFolderIcon = (f: ClientFolder) => {
    switch (f) {
      case 'agreements':
        return <FileSignature size={28} color="var(--ikpm-navy-700)" />;
      case 'service_reports':
        return <FileCheck2 size={28} color="var(--ikpm-emerald-600)" />;
      case 'invoices':
        return <FileSpreadsheet size={28} color="var(--ikpm-blue-500)" />;
      case 'certificates':
        return <Sparkles size={28} color="var(--ikpm-amber-500)" />;
      case 'client_papers':
        return <FileText size={28} color="var(--text-secondary)" />;
      case 'old_records':
        return <FileArchive size={28} color="var(--text-muted)" />;
    }
  };

  // Rename action
  const handleRename = () => {
    if (!renameTarget) return;
    const trimmed = newTitle.trim();
    if (!trimmed) {
      warning('Title required', 'Please provide a non-empty document title.');
      return;
    }
    const updated: PortalDocument = { ...renameTarget, title: trimmed };
    dataService.saveDocument(updated, userProfile?.email);
    success('Document Renamed', `Updated to "${trimmed}".`);
    setRenameTarget(null);
  };

  // Move action
  const handleMove = () => {
    if (!moveTarget) return;
    let targetOwner = moveTarget.owner;

    if (moveEntityKey) {
      const [k, id] = moveEntityKey.split(':');
      targetOwner = { kind: k as EntityKind, id };
    }

    const updated: PortalDocument = {
      ...moveTarget,
      owner: targetOwner,
      folder: moveFolder,
      year: moveFolder === 'old_records' ? moveYear : undefined,
    };

    dataService.saveDocument(updated, userProfile?.email);
    success(
      'Document Moved',
      `Moved "${moveTarget.title}" to ${folderLabel(moveFolder)}${
        moveFolder === 'old_records' ? ` (${moveYear})` : ''
      }.`
    );
    setMoveTarget(null);
  };

  // Delete action
  const handleDelete = () => {
    if (!deleteTarget) return;
    dataService.removeDocument(deleteTarget.id, userProfile?.email);
    success('Document Deleted', `Removed "${deleteTarget.title}".`);
    setDeleteTarget(null);
  };

  return (
    <div
      className={`drive ${isDragOver ? 'is-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* DRIVE TOOLBAR */}
      <div className="drive-toolbar">
        {/* Breadcrumb Navigation */}
        <div className="drive-crumbs">
          {/* Root Link: All Clients (if not locked to a specific entity) */}
          {!lockedEntity ? (
            <button
              type="button"
              className={`drive-crumb-btn ${!currentEntity ? 'active' : ''}`}
              onClick={() => {
                setSelectedEntity(null);
                setActiveFolder(null);
                setActiveYear(null);
              }}
            >
              <Folder size={15} />
              <span>All Clients</span>
            </button>
          ) : (
            <span className="drive-crumb-btn active">
              <Folder size={15} />
              <span>{lockedEntity.name}</span>
            </span>
          )}

          {/* Current Entity (if selected and not locked) */}
          {!lockedEntity && currentEntity && (
            <>
              <ChevronRight size={14} className="drive-crumb-sep" />
              <button
                type="button"
                className={`drive-crumb-btn ${!activeFolder ? 'active' : ''}`}
                onClick={() => {
                  setActiveFolder(null);
                  setActiveYear(null);
                }}
              >
                {currentEntity.kind === 'company' && <Building2 size={14} />}
                {currentEntity.kind === 'branch' && <GitFork size={14} />}
                {currentEntity.kind === 'client' && <User size={14} />}
                <span>{currentEntity.name}</span>
              </button>
            </>
          )}

          {/* Folder */}
          {activeFolder && (
            <>
              <ChevronRight size={14} className="drive-crumb-sep" />
              <button
                type="button"
                className={`drive-crumb-btn ${activeYear === null ? 'active' : ''}`}
                onClick={() => setActiveYear(null)}
              >
                <span>{folderLabel(activeFolder)}</span>
              </button>
            </>
          )}

          {/* Year (Old Records only) */}
          {activeFolder === 'old_records' && activeYear !== null && (
            <>
              <ChevronRight size={14} className="drive-crumb-sep" />
              <span className="drive-crumb-btn active">
                <Calendar size={13} />
                <span>{activeYear}</span>
              </span>
            </>
          )}
        </div>

        {/* Toolbar Tools */}
        <div className="drive-tools">
          {/* Search Box */}
          <div className="drive-search">
            <Search size={15} color="var(--text-muted)" />
            <input
              type="text"
              placeholder={
                currentEntity
                  ? `Search in ${currentEntity.name}...`
                  : 'Search clients, files, scans...'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSearchQuery('')}
                style={{ padding: '2px', height: 'auto', width: 'auto' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="view-toggle" role="group" aria-label="View">
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title="List view">
              <List size={16} />
            </button>
            <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title="Grid view">
              <LayoutGrid size={16} />
            </button>
          </div>

          {/* Upload / Scan Action Button */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setDroppedFiles([]);
              setIsUploadOpen(true);
            }}
          >
            <UploadCloud size={16} />
            <span>Upload / Scan</span>
          </button>
        </div>
      </div>

      {/* SEARCH RESULTS VIEW */}
      {searchResults ? (
        <div className="drive-section animate-fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--ikpm-navy-900)' }}>
              Search results for &ldquo;{searchQuery}&rdquo;
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {searchResults.files.length} document{searchResults.files.length === 1 ? '' : 's'}
              {searchResults.entities.length > 0 ? `, ${searchResults.entities.length} account(s)` : ''}
            </span>
          </div>

          {/* Matched Entities */}
          {searchResults.entities.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Matching Accounts
              </div>
              <div className="drive-grid">
                {searchResults.entities.map((ent) => (
                  <div
                    key={`${ent.kind}:${ent.id}`}
                    className="drive-folder"
                    onClick={() => {
                      setSelectedEntity(ent);
                      setActiveFolder(null);
                      setActiveYear(null);
                      setSearchQuery('');
                    }}
                  >
                    <div className="drive-folder-icon">
                      {ent.kind === 'company' && <Building2 size={24} color="var(--ikpm-navy-700)" />}
                      {ent.kind === 'branch' && <GitFork size={24} color="var(--ikpm-emerald-600)" />}
                      {ent.kind === 'client' && <User size={24} color="var(--text-secondary)" />}
                    </div>
                    <div className="drive-folder-text">
                      <div className="drive-folder-title">{ent.name}</div>
                      <div className="drive-folder-sub">{ent.sub || ent.id}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Matched Files */}
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Matching Documents
            </div>
            {searchResults.files.length === 0 ? (
              <div className="drive-empty">No documents found matching this search query.</div>
            ) : (
              <div className="drive-list">
                <FileListHead />
                {searchResults.files.map((doc) => (
                  <FileRow
                    key={doc.id}
                    doc={doc}
                    onOpen={() => window.open(doc.file.url, '_blank')}
                    onRename={() => {
                      setRenameTarget(doc);
                      setNewTitle(doc.title);
                    }}
                    onMove={() => {
                      setMoveTarget(doc);
                      setMoveFolder(docFolder(doc));
                      setMoveYear(doc.year || currentYear());
                      setMoveEntityKey(`${doc.owner.kind}:${'id' in doc.owner ? doc.owner.id : ''}`);
                    }}
                    onDelete={() => setDeleteTarget(doc)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : !currentEntity ? (
        /* LEVEL 0: ALL CLIENTS — Drive-style tabs with grid or list view */
        <div className="drive-section animate-fade-in">
          <div className="tab-bar" style={{ marginBottom: '0.25rem' }} role="tablist">
            <button type="button" className={`tab-btn ${rootTab === 'all' ? 'active' : ''}`} onClick={() => setRootTab('all')}>
              <Folder size={16} /> All clients <span className="tab-count">{companies.length + clients.length}</span>
            </button>
            <button type="button" className={`tab-btn ${rootTab === 'companies' ? 'active' : ''}`} onClick={() => setRootTab('companies')}>
              <Building2 size={16} /> Companies <span className="tab-count">{companies.length}</span>
            </button>
            <button type="button" className={`tab-btn ${rootTab === 'clients' ? 'active' : ''}`} onClick={() => setRootTab('clients')}>
              <User size={16} /> Individuals <span className="tab-count">{clients.length}</span>
            </button>
          </div>

          {(() => {
            const rows = [
              ...(rootTab !== 'clients' ? companies : []),
              ...(rootTab !== 'companies' ? clients : []),
            ].map((ent) => {
              const files = allDocuments.filter((d) => ownerMatches(d, ent.kind, ent.id));
              const branchCount = ent.kind === 'company' ? branches.filter((b) => b.companyId === ent.id).length : 0;
              const last = files.reduce((m, d) => (d.uploadedAt > m ? d.uploadedAt : m), '');
              return { ent, fileCount: files.length, branchCount, last };
            });

            const open = (ent: EntityRef) => {
              setSelectedEntity(ent);
              setActiveFolder(null);
              setActiveYear(null);
            };

            if (rows.length === 0) {
              return <div className="drive-empty">No client accounts yet. Add a company or individual client under Customer Accounts.</div>;
            }

            if (view === 'list') {
              return (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Files</th>
                        <th>Last upload</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ ent, fileCount, branchCount, last }) => (
                        <tr key={`${ent.kind}:${ent.id}`} style={{ cursor: 'pointer' }} onClick={() => open(ent)}>
                          <td>
                            <div className="cell-main">
                              <Folder size={20} fill={ent.kind === 'company' ? '#5F6B7A' : '#0E8A5F'} color={ent.kind === 'company' ? '#5F6B7A' : '#0E8A5F'} />
                              <div style={{ minWidth: 0 }}>
                                <div className="cell-title">{ent.name}</div>
                                <div className="cell-sub">{ent.id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="cell-sub">
                            {ent.kind === 'company' ? `Company${branchCount ? ` · ${branchCount} branch${branchCount === 1 ? '' : 'es'}` : ''}` : 'Individual'}
                          </td>
                          <td>{fileCount}</td>
                          <td className="cell-sub">{last ? formatDate(last) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }

            return (
              <div className="drive-grid">
                {rows.map(({ ent, fileCount, branchCount }) => (
                  <div
                    key={`${ent.kind}:${ent.id}`}
                    className="drive-folder"
                    role="button"
                    tabIndex={0}
                    onClick={() => open(ent)}
                    onKeyDown={(e) => e.key === 'Enter' && open(ent)}
                  >
                    <div className="drive-folder-icon">
                      <Folder size={22} fill={ent.kind === 'company' ? '#5F6B7A' : '#0E8A5F'} color={ent.kind === 'company' ? '#5F6B7A' : '#0E8A5F'} />
                    </div>
                    <div className="drive-folder-text">
                      <div className="drive-folder-title">{ent.name}</div>
                      <div className="drive-folder-sub">
                        {fileCount} file{fileCount === 1 ? '' : 's'}
                        {ent.kind === 'company' ? ` · ${branchCount} branch${branchCount === 1 ? '' : 'es'}` : ' · Individual'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      ) : activeFolder === null ? (
        /* LEVEL 1: CLIENT ROOT FOLDER (Shows standard 6 folders + branches if company) */
        <div className="drive-section animate-fade-in">
          {/* Sub-Branches (if entity is a corporate company with branches) */}
          {childBranches.length > 0 && (
            <div style={{ marginBottom: '1.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <GitFork size={16} color="var(--ikpm-navy-700)" />
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: 'var(--ikpm-navy-900)' }}>
                  Branch Locations ({childBranches.length})
                </h4>
              </div>
              <div className="drive-grid">
                {childBranches.map((br) => {
                  const docCount = allDocuments.filter((d) => ownerMatches(d, 'branch', br.id)).length;
                  return (
                    <div
                      key={br.id}
                      className="drive-folder"
                      onClick={() => {
                        setSelectedEntity(br);
                        setActiveFolder(null);
                        setActiveYear(null);
                      }}
                    >
                      <div className="drive-folder-icon">
                        <GitFork size={24} color="var(--ikpm-emerald-600)" />
                      </div>
                      <div className="drive-folder-text">
                        <div className="drive-folder-title">{br.name}</div>
                        <div className="drive-folder-sub">
                          {docCount} file{docCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Standard 6 Google-Drive Folders */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <FolderOpen size={16} color="var(--ikpm-navy-700)" />
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: 'var(--ikpm-navy-900)' }}>
                Client Document Folders
              </h4>
            </div>
            <div className="drive-grid">
              {CLIENT_FOLDERS.map((cf) => {
                const count = folderCounts[cf.value] || 0;
                return (
                  <div
                    key={cf.value}
                    className="drive-folder"
                    onClick={() => {
                      setActiveFolder(cf.value);
                      setActiveYear(null);
                    }}
                  >
                    <div className="drive-folder-icon">{getFolderIcon(cf.value)}</div>
                    <div className="drive-folder-text">
                      <div className="drive-folder-title">{cf.label}</div>
                      <div className="drive-folder-sub">
                        {count} document{count === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : activeFolder === 'old_records' && activeYear === null ? (
        /* LEVEL 2A: OLD RECORDS YEAR FOLDERS */
        <div className="drive-section animate-fade-in">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setActiveFolder(null)}
              >
                <ArrowLeft size={14} />
                <span>Back to Folders</span>
              </button>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--ikpm-navy-900)' }}>
                Old Records — Archive Years
              </h3>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Historical documents categorized by archive year
            </span>
          </div>

          <div className="drive-grid">
            {oldRecordsByYear.map(({ year, count }) => (
              <div
                key={year}
                className="drive-folder"
                onClick={() => setActiveYear(year)}
              >
                <div className="drive-folder-icon">
                  <Calendar size={26} color="var(--ikpm-navy-700)" />
                </div>
                <div className="drive-folder-text">
                  <div className="drive-folder-title">Archive Year {year}</div>
                  <div className="drive-folder-sub">
                    {count} document{count === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* LEVEL 2B / 3: FILES LIST (Inside a specific folder or old_records year) */
        <div className="drive-section animate-fade-in">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (activeYear !== null) setActiveYear(null);
                  else setActiveFolder(null);
                }}
              >
                <ArrowLeft size={14} />
                <span>{activeYear !== null ? 'Back to Years' : 'Back to Folders'}</span>
              </button>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--ikpm-navy-900)' }}>
                {folderLabel(activeFolder)} {activeYear ? `(${activeYear})` : ''}
              </h3>
            </div>

            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {activeFiles.length} file{activeFiles.length === 1 ? '' : 's'}
            </span>
          </div>

          {activeFiles.length === 0 ? (
            <div className="drive-drop-empty">
              <UploadCloud size={40} color="var(--text-muted)" style={{ marginBottom: '0.5rem' }} />
              <div style={{ fontWeight: 600, color: 'var(--ikpm-navy-900)', fontSize: '0.95rem' }}>
                This folder is empty
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.825rem', margin: '4px 0 1rem 0' }}>
                Drag files anywhere to upload here, or click the button below.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setDroppedFiles([]);
                  setIsUploadOpen(true);
                }}
              >
                <Plus size={14} />
                <span>Upload files to this folder</span>
              </button>
            </div>
          ) : (
            <div className="drive-list">
              <FileListHead />
              {activeFiles.map((doc) => (
                <FileRow
                  key={doc.id}
                  doc={doc}
                  onOpen={() => window.open(doc.file.url, '_blank')}
                  onRename={() => {
                    setRenameTarget(doc);
                    setNewTitle(doc.title);
                  }}
                  onMove={() => {
                    setMoveTarget(doc);
                    setMoveFolder(docFolder(doc));
                    setMoveYear(doc.year || currentYear());
                    setMoveEntityKey(`${doc.owner.kind}:${'id' in doc.owner ? doc.owner.id : ''}`);
                  }}
                  onDelete={() => setDeleteTarget(doc)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* RENAME MODAL */}
      {renameTarget && (
        <Modal
          isOpen={Boolean(renameTarget)}
          onClose={() => setRenameTarget(null)}
          title="Rename Document"
          subtitle={renameTarget.file.fileName}
          maxWidth="440px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', width: '100%' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setRenameTarget(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleRename}>
                Save Title
              </button>
            </div>
          }
        >
          <div className="form-group">
            <label className="form-label">Document Title</label>
            <input
              type="text"
              className="form-input"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
            />
          </div>
        </Modal>
      )}

      {/* MOVE MODAL */}
      {moveTarget && (
        <Modal
          isOpen={Boolean(moveTarget)}
          onClose={() => setMoveTarget(null)}
          title="Move Document"
          subtitle={`Move "${moveTarget.title}" to a different folder or client`}
          maxWidth="480px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', width: '100%' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setMoveTarget(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleMove}>
                Move Here
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {!lockedEntity && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Client Account</label>
                <select
                  className="form-select"
                  value={moveEntityKey}
                  onChange={(e) => setMoveEntityKey(e.target.value)}
                >
                  {entities.map((e) => (
                    <option key={`${e.kind}:${e.id}`} value={`${e.kind}:${e.id}`}>
                      {e.name} ({e.id})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Destination Folder</label>
              <select
                className="form-select"
                value={moveFolder}
                onChange={(e) => setMoveFolder(e.target.value as ClientFolder)}
              >
                {CLIENT_FOLDERS.map((cf) => (
                  <option key={cf.value} value={cf.value}>
                    📁 {cf.label}
                  </option>
                ))}
              </select>
            </div>

            {moveFolder === 'old_records' && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Archive Year</label>
                <select
                  className="form-select"
                  value={moveYear}
                  onChange={(e) => setMoveYear(Number(e.target.value))}
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
        </Modal>
      )}

      {/* DELETE CONFIRM DIALOG */}
      {deleteTarget && (
        <ConfirmDialog
          isOpen={Boolean(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title="Delete Document"
          message={`Are you sure you want to remove "${deleteTarget.title}" (${deleteTarget.file.fileName})? This action will be logged in the audit trail.`}
          confirmLabel="Delete Document"
          isDestructive={true}
        />
      )}

      {/* UPLOAD & SCAN MODAL */}
      <DriveUploadModal
        isOpen={isUploadOpen}
        onClose={() => {
          setIsUploadOpen(false);
          setDroppedFiles([]);
        }}
        lockedEntity={lockedEntity || undefined}
        initialEntity={currentEntity || undefined}
        initialFolder={activeFolder || 'client_papers'}
        initialYear={activeYear || currentYear()}
        initialFiles={droppedFiles}
      />
    </div>
  );
};

interface FileRowProps {
  doc: PortalDocument;
  onOpen: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}

const FileListHead: React.FC = () => (
  <div className="drive-list-head">
    <span>Name</span>
    <span>Uploaded by</span>
    <span>Date</span>
    <span>Size</span>
    <span />
  </div>
);

const FileRow: React.FC<FileRowProps> = ({ doc, onOpen, onRename, onMove, onDelete }) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const getDocIcon = () => {
    const ft = doc.file.fileType.toLowerCase();
    if (ft.includes('pdf')) return <FileText size={20} color="var(--ikpm-rose-500)" />;
    if (ft.includes('sheet') || ft.includes('excel') || ft.includes('xls'))
      return <FileSpreadsheet size={20} color="var(--ikpm-emerald-600)" />;
    if (ft.includes('image')) return <FileCheck2 size={20} color="var(--ikpm-blue-500)" />;
    return <FileText size={20} color="var(--ikpm-navy-700)" />;
  };

  return (
    <div className="drive-file">
      <div className="drive-file-main" onClick={onOpen} title="Click to view file">
        <div style={{ flexShrink: 0 }}>{getDocIcon()}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="drive-file-title">
            <span>{doc.title}</span>
            {doc.source === 'generated' && (
              <span className="badge-status badge-blue" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                Auto-generated
              </span>
            )}
            {doc.file.storage === 'local' && (
              <span
                className="badge-status badge-amber"
                style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                title="Cached in browser storage on this device"
              >
                This device only
              </span>
            )}
          </div>
          <div className="drive-file-sub">
            <span>{doc.file.fileName}</span>
            <span className="drive-mobile-only">· {formatBytes(doc.file.fileSize)} · {formatDate(doc.uploadedAt)}</span>
          </div>
        </div>
      </div>

      <div className="drive-col" title={doc.uploadedBy}>{doc.uploadedByName || doc.uploadedBy}</div>
      <div className="drive-col">{formatDate(doc.uploadedAt)}</div>
      <div className="drive-col">{formatBytes(doc.file.fileSize)}</div>

      <div className="drive-file-actions" ref={menuRef}>
        <button
          type="button"
          className="icon-btn"
          onClick={onOpen}
          title="Open document in new tab"
        >
          <ExternalLink size={15} color="var(--text-secondary)" />
        </button>

        <a
          href={doc.file.url}
          download={doc.file.fileName}
          target="_blank"
          rel="noreferrer"
          className="icon-btn"
          title="Download file"
        >
          <Download size={15} color="var(--text-secondary)" />
        </a>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowMenu(!showMenu)}
            title="More actions"
          >
            <MoreVertical size={15} color="var(--text-secondary)" />
          </button>

          {showMenu && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 90 }}
                onClick={() => setShowMenu(false)}
              />
              <div className="dropdown-panel" style={{ minWidth: 170 }}>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    setShowMenu(false);
                    onRename();
                  }}
                >
                  <Edit2 size={13} color="var(--text-secondary)" />
                  <span>Rename</span>
                </button>

                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    setShowMenu(false);
                    onMove();
                  }}
                >
                  <FolderInput size={13} color="var(--text-secondary)" />
                  <span>Move</span>
                </button>

                <button
                  type="button"
                  className="dropdown-item danger"
                  onClick={() => {
                    setShowMenu(false);
                    onDelete();
                  }}
                >
                  <Trash2 size={13} color="var(--ikpm-rose-500)" />
                  <span>Delete</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
