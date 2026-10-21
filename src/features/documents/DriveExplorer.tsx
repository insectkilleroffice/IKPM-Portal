import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Folder,
  FolderOpen,
  FileText,
  FileSpreadsheet,
  FileCheck2,
  FileSignature,
  Receipt,
  Wallet,
  MessageCircle,
  UploadCloud,
  Search,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Download,
  Edit2,
  FolderInput,
  Trash2,
  Building2,
  GitFork,
  User,
  X,
  Inbox,
  Lock,
  Wand2,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { Modal } from '../../components/common/Modal';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { RowMenu, type RowMenuItem } from '../../components/common/RowMenu';
import { formatDate } from '../../lib/formatters';
import { downloadUrl, formatBytes } from '../../lib/cloudinary';
import { canEditCompanyFiles, canEditModule, canViewCompanyFiles } from '../../lib/permissions';
import {
  BRANCHES_FOLDER,
  CLIENTS_ROOT,
  COMPANY_ROOT,
  findFolder,
  folderKey,
  getFolderTree,
  isInFolder,
  parseFolderPath,
  UNFILED_ROOT,
  type FolderNode,
} from '../../lib/folders';
import type { PortalDocument } from '../../types/document';
import { collectFolderItems, itemSearchText, KIND_LABEL, prettyPath, type FolderItem } from './folderItems';
import { FolderUploadModal, type UploadTarget } from './FolderUploadModal';
import { MoveDocumentModal } from './MoveDocumentModal';

interface Props {
  /** Lock the explorer to one folder (e.g. a client's or a branch's root). */
  rootPath?: string;
  /** Name shown for the locked root. */
  rootTitle?: string;
  /** Folders to show even when empty (the locked client's root and its branches). */
  ensurePaths?: string[];
  /** Folder to open first (unlocked explorer). */
  initialPath?: string;
}

const UNFILED_PATH = `/${UNFILED_ROOT}`;
const CLIENTS_PATH = `/${CLIENTS_ROOT}`;
const COMPANY_PATH = `/${COMPANY_ROOT}`;

/** Display name for a folder node: live client / branch names instead of the name saved in the path. */
function nodeLabel(node: FolderNode): string {
  if (!node.id) return node.name;
  const parsed = parseFolderPath(node.path);
  if (parsed?.branchId === node.id) return dataService.getBranchById(node.id)?.branchName || node.name;
  return dataService.clientInfo(node.id).name || node.name;
}

function nodeIcon(node: FolderNode, open: boolean, size = 16) {
  const parsed = parseFolderPath(node.path);
  if (node.path === UNFILED_PATH) return <Inbox size={size} color="var(--ikpm-amber-500)" />;
  if (node.path === COMPANY_PATH) return <Lock size={size} color="var(--ikpm-navy-700)" />;
  if (node.id && parsed?.branchId === node.id) return <GitFork size={size} color="var(--ikpm-emerald-600)" />;
  if (node.id) {
    return dataService.clientInfo(node.id).type === 'individual' ? <User size={size} color="var(--text-secondary)" /> : <Building2 size={size} color="var(--ikpm-navy-700)" />;
  }
  return open ? <FolderOpen size={size} color="#5F6B7A" /> : <Folder size={size} color="#5F6B7A" fill="#5F6B7A33" />;
}

function itemIcon(item: FolderItem) {
  switch (item.kind) {
    case 'proposal':
      return <FileSpreadsheet size={20} color="var(--ikpm-emerald-600)" />;
    case 'contract':
      return <FileSignature size={20} color="var(--ikpm-navy-700)" />;
    case 'job':
      return <FileCheck2 size={20} color="var(--ikpm-emerald-600)" />;
    case 'invoice':
      return <Receipt size={20} color="var(--ikpm-blue-600)" />;
    case 'payment':
      return <Wallet size={20} color="var(--ikpm-blue-600)" />;
    case 'outreach':
      return <MessageCircle size={20} color="var(--text-secondary)" />;
  }
  const ft = item.doc?.file.fileType.toLowerCase() ?? '';
  if (ft.includes('pdf')) return <FileText size={20} color="var(--ikpm-rose-500)" />;
  if (ft.includes('sheet') || ft.includes('excel') || ft.includes('xls')) return <FileSpreadsheet size={20} color="var(--ikpm-emerald-600)" />;
  if (ft.includes('image')) return <FileCheck2 size={20} color="var(--ikpm-blue-600)" />;
  return <FileText size={20} color="var(--ikpm-navy-700)" />;
}

export const DriveExplorer: React.FC<Props> = ({ rootPath, rootTitle, ensurePaths = [], initialPath }) => {
  const store = useDataStore();
  const version = store.getVersion();
  const navigate = useNavigate();
  const { userProfile, effectiveRole } = useAuth();
  const { success, error } = useNotification();

  const canSeeCompany = canViewCompanyFiles(effectiveRole);
  const canEditClientFiles = canEditModule(effectiveRole, 'files');
  const canEditCompany = canEditCompanyFiles(effectiveRole);
  const canEditAt = (path: string | undefined) =>
    path && isInFolder(path, COMPANY_PATH) ? canEditCompany : canEditClientFiles;

  const [path, setPath] = useState<string>(rootPath || initialPath || CLIENTS_PATH);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([CLIENTS_PATH, COMPANY_PATH, rootPath || '', initialPath || ''].filter(Boolean)));
  const [query, setQuery] = useState('');
  const [upload, setUpload] = useState<{ target: UploadTarget; files: File[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<PortalDocument | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [moveTarget, setMoveTarget] = useState<PortalDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PortalDocument | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Everything the person may see, limited to the locked root when there is one
  const items = useMemo(() => {
    const all = collectFolderItems().filter((i) => canSeeCompany || i.ownerScope !== 'company');
    return rootPath ? all.filter((i) => isInFolder(i.folderPath, rootPath)) : all;
    // version: recompute when Firestore data arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, rootPath, canSeeCompany]);

  const tree = useMemo(() => {
    const full = getFolderTree(items, { ensurePaths: rootPath ? [rootPath, ...ensurePaths] : ensurePaths, includeCompany: canSeeCompany && !rootPath });
    if (!rootPath) return full.filter((n) => n.path !== UNFILED_PATH || n.count > 0);
    const node = findFolder(full, rootPath);
    return node ? [node] : [];
  }, [items, rootPath, ensurePaths, canSeeCompany]);

  const current = findFolder(tree, path) ?? tree[0];
  const currentPath = current?.path ?? path;
  const filesHere = items.filter((i) =>
    currentPath === UNFILED_PATH ? !parseFolderPath(i.folderPath) : i.folderPath && folderKey(i.folderPath) === folderKey(currentPath)
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return items.filter((i) => itemSearchText(i).includes(q) || prettyPath(i.folderPath).toLowerCase().includes(q)).slice(0, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, items, version]);

  const open = (p: string) => {
    setPath(p);
    setQuery('');
    setExpanded((prev) => {
      const next = new Set(prev);
      // Expand every ancestor so the tree shows where we are
      const parts = p.split('/').filter(Boolean);
      parts.forEach((_, i) => next.add(`/${parts.slice(0, i + 1).join('/')}`));
      return next;
    });
  };

  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  // Upload target from the current folder: scope, client, branch and subfolder are pre-filled
  const targetFor = (p: string): UploadTarget => {
    if (isInFolder(p, COMPANY_PATH)) return { ownerScope: 'company', subfolder: parseFolderPath(p)?.subfolder as UploadTarget['subfolder'] };
    const parsed = parseFolderPath(p);
    if (!parsed) return { ownerScope: 'client' };
    return {
      ownerScope: 'client',
      clientId: parsed.clientId,
      branchId: parsed.branchId,
      subfolder: (parsed.subfolder && parsed.subfolder !== BRANCHES_FOLDER ? parsed.subfolder : undefined) as UploadTarget['subfolder'],
      locked: Boolean(rootPath),
    };
  };
  const canUploadHere = currentPath !== UNFILED_PATH && canEditAt(currentPath === CLIENTS_PATH ? undefined : currentPath);

  const openItem = (item: FolderItem) => {
    if (item.doc) window.open(item.doc.file.url, '_blank', 'noopener');
    else if (item.href) navigate(item.href);
  };

  const fileAutomatically = (item: FolderItem) => {
    try {
      if (item.kind === 'document') {
        const moved = dataService.moveDocument(item.id, {}, userProfile?.email);
        if (!moved.folderPath) throw new Error('This file is not linked to a client. Use "Move to folder" to choose one.');
        success('Filed', `${item.title} → ${prettyPath(moved.folderPath)}`);
      } else {
        const meta = dataService.fileUnfiledRecord(item.kind, item.id, userProfile?.email);
        success('Filed', `${item.title} → ${prettyPath(meta.folderPath)}`);
      }
    } catch (err) {
      error('Could not file', err instanceof Error ? err.message : String(err));
    }
  };

  const menuFor = (item: FolderItem): RowMenuItem[] => {
    const editable = canEditAt(item.folderPath ?? undefined);
    const unfiled = !parseFolderPath(item.folderPath);
    const d = item.doc;
    return [
      { icon: ExternalLink, label: d ? 'Open file' : `Open ${KIND_LABEL[item.kind].toLowerCase()}`, run: () => openItem(item), hide: !d && !item.href },
      { icon: FolderOpen, label: 'Go to folder', run: () => open(item.folderPath!), hide: unfiled },
      { icon: Wand2, label: 'File automatically', run: () => fileAutomatically(item), hide: !unfiled || !editable },
      { icon: Edit2, label: 'Rename', run: () => { setRenameTarget(d!); setNewTitle(d!.title); }, hide: !d || !editable },
      { icon: FolderInput, label: unfiled ? 'Move to folder' : 'Move', run: () => setMoveTarget(d!), hide: !d || !editable },
      { icon: Trash2, label: 'Delete', run: () => setDeleteTarget(d!), hide: !d || !editable, danger: true },
    ];
  };

  const handleRename = () => {
    if (!renameTarget) return;
    const trimmed = newTitle.trim();
    if (!trimmed) return error('Title required', 'Give the file a name.');
    dataService.saveDocument({ ...renameTarget, title: trimmed }, userProfile?.email);
    success('Renamed', `Now called "${trimmed}".`);
    setRenameTarget(null);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    dataService.removeDocument(deleteTarget.id, userProfile?.email);
    success('Deleted', `Removed "${deleteTarget.title}".`);
    setDeleteTarget(null);
  };

  const crumbs = (() => {
    const base = rootPath ? rootPath.split('/').filter(Boolean).length : 0;
    const parts = currentPath.split('/').filter(Boolean);
    return parts.map((_, i) => `/${parts.slice(0, i + 1).join('/')}`).filter((_, i) => i + 1 >= Math.max(1, base));
  })();

  const renderTree = (nodes: FolderNode[], depth = 0): React.ReactNode =>
    nodes.map((n) => {
      const isOpen = expanded.has(n.path);
      const active = folderKey(n.path) === folderKey(currentPath);
      const label = depth === 0 && rootPath && rootTitle ? rootTitle : nodeLabel(n);
      return (
        <li key={n.path} role="treeitem" aria-expanded={n.children.length ? isOpen : undefined} aria-selected={active}>
          <div className={`folder-tree-row ${active ? 'active' : ''}`} style={{ paddingLeft: `${0.35 + depth * 0.85}rem` }}>
            <button type="button" className="folder-tree-caret" onClick={() => toggle(n.path)} aria-label={isOpen ? 'Collapse' : 'Expand'} style={{ visibility: n.children.length ? 'visible' : 'hidden' }}>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <button type="button" className="folder-tree-label" onClick={() => open(n.path)} title={prettyPath(n.path)}>
              {nodeIcon(n, isOpen, 15)}
              <span className="folder-tree-name">{label}</span>
              {n.count > 0 && <span className="folder-tree-count">{n.count}</span>}
            </button>
          </div>
          {isOpen && n.children.length > 0 && <ul role="group">{renderTree(n.children, depth + 1)}</ul>}
        </li>
      );
    });

  const renderItemRow = (item: FolderItem, showPath = false) => (
    <div className="drive-file" key={item.key}>
      <div className="drive-file-main" onClick={() => openItem(item)} title={item.doc ? 'Open file' : item.href ? 'Open record' : undefined}>
        <div style={{ flexShrink: 0 }}>{itemIcon(item)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="drive-file-title">
            <span>{item.title}</span>
            {item.kind !== 'document' && <span className="badge-status badge-slate" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>{KIND_LABEL[item.kind]}</span>}
            {item.doc?.source === 'generated' && <span className="badge-status badge-blue" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>Auto-generated</span>}
          </div>
          <div className="drive-file-sub">
            {showPath ? (
              <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); if (item.folderPath) open(item.folderPath); else open(UNFILED_PATH); }} title="Go to folder">
                <FolderOpen size={12} /> {prettyPath(item.folderPath)}
              </button>
            ) : (
              <span>{item.sub}</span>
            )}
          </div>
        </div>
      </div>
      <div className="drive-col">{item.doc ? item.doc.uploadedByName || item.doc.uploadedBy : KIND_LABEL[item.kind]}</div>
      <div className="drive-col">{formatDate(item.date)}</div>
      <div className="drive-col">{item.doc ? formatBytes(item.doc.file.fileSize) : '—'}</div>
      <div className="drive-file-actions">
        {item.doc && (
          <a href={downloadUrl(item.doc.file)} download={item.doc.file.fileName} target="_blank" rel="noreferrer" className="icon-btn" title="Download">
            <Download size={15} color="var(--text-secondary)" />
          </a>
        )}
        <RowMenu items={menuFor(item)} minWidth={190} iconSize={15} iconColor="var(--text-secondary)" />
      </div>
    </div>
  );

  const listHead = (
    <div className="drive-list-head">
      <span>Name</span>
      <span>By / type</span>
      <span>Date</span>
      <span>Size</span>
      <span />
    </div>
  );

  return (
    <div
      className={`folder-explorer ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if (!canUploadHere) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!canUploadHere) return;
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) setUpload({ target: targetFor(currentPath), files: Array.from(e.dataTransfer.files) });
      }}
    >
      <div className="drive-toolbar">
        <nav className="drive-crumbs" aria-label="Folder path">
          {crumbs.map((c, i) => (
            <React.Fragment key={c}>
              {i > 0 && <ChevronRight size={14} className="drive-crumb-sep" />}
              <button type="button" className={`drive-crumb-btn ${i === crumbs.length - 1 ? 'active' : ''}`} onClick={() => open(c)}>
                {i === 0 && <Folder size={14} />}
                <span>{i === 0 && rootPath && rootTitle ? rootTitle : prettyPath(c).split(' / ').pop()}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="drive-tools">
          <div className="drive-search">
            <Search size={15} color="var(--text-muted)" />
            <input placeholder={rootPath ? 'Search these files…' : 'Search all folders…'} value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <button type="button" className="icon-btn" onClick={() => setQuery('')} style={{ padding: 2, height: 'auto', width: 'auto' }} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          {canUploadHere && (
            <button type="button" className="btn btn-primary" onClick={() => setUpload({ target: targetFor(currentPath), files: [] })}>
              <UploadCloud size={16} />
              <span>Upload</span>
            </button>
          )}
        </div>
      </div>

      <div className="folder-layout">
        <aside className="folder-tree" aria-label="Folders">
          <ul role="tree">{renderTree(tree)}</ul>
        </aside>

        <section className="folder-pane">
          {results ? (
            <div className="drive-section animate-fade-in">
              <div className="folder-pane-head">
                <h3>Results for “{query}”</h3>
                <span className="cell-sub">{results.length} item{results.length === 1 ? '' : 's'}</span>
              </div>
              {results.length === 0 ? (
                <div className="drive-empty">Nothing matches. Search looks at titles, file names, ids and folder names.</div>
              ) : (
                <div className="drive-list">
                  {listHead}
                  {results.map((i) => renderItemRow(i, true))}
                </div>
              )}
            </div>
          ) : (
            <div className="drive-section animate-fade-in">
              <div className="folder-pane-head">
                <h3>
                  {current ? nodeIcon(current, true, 18) : null}
                  {current && rootPath && folderKey(current.path) === folderKey(rootPath) && rootTitle ? rootTitle : current ? nodeLabel(current) : ''}
                </h3>
                <span className="cell-sub">{current?.count ?? 0} item{current?.count === 1 ? '' : 's'} in this folder and below</span>
              </div>

              {currentPath === UNFILED_PATH && (
                <div className="info-hint" style={{ marginBottom: '1rem' }}>
                  These records were saved before folders existed. Use <strong>File automatically</strong> (uses the record's client) or <strong>Move to folder</strong>. The backfill script files them all at once.
                </div>
              )}
              {isInFolder(currentPath, COMPANY_PATH) && !canEditCompany && (
                <div className="info-hint" style={{ marginBottom: '1rem' }}>
                  <Lock size={13} style={{ verticalAlign: '-2px' }} /> IKPM's own files. You can view and send them; only roles with Company (IKPM) folder edit access can change them.
                </div>
              )}

              {current && current.children.length > 0 && (
                <div className="drive-grid" style={{ marginBottom: filesHere.length ? '1.25rem' : 0 }}>
                  {current.children.map((c) => (
                    <div key={c.path} className="drive-folder" role="button" tabIndex={0} onClick={() => open(c.path)} onKeyDown={(e) => e.key === 'Enter' && open(c.path)}>
                      <div className="drive-folder-icon">{nodeIcon(c, false, 22)}</div>
                      <div className="drive-folder-text">
                        <div className="drive-folder-title">{nodeLabel(c)}</div>
                        <div className="drive-folder-sub">{c.count} item{c.count === 1 ? '' : 's'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {filesHere.length > 0 ? (
                <div className="drive-list">
                  {listHead}
                  {filesHere
                    .slice()
                    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                    .map((i) => renderItemRow(i))}
                </div>
              ) : (
                current && current.children.length === 0 && (
                  <div className="drive-drop-empty">
                    <UploadCloud size={40} color="var(--text-muted)" style={{ marginBottom: '0.5rem' }} />
                    <div style={{ fontWeight: 600, color: 'var(--ikpm-navy-900)', fontSize: '0.95rem' }}>This folder is empty</div>
                    {canUploadHere && (
                      <>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.825rem', margin: '4px 0 1rem 0' }}>Drop files here or upload them.</p>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUpload({ target: targetFor(currentPath), files: [] })}>
                          <UploadCloud size={14} /> <span>Upload to this folder</span>
                        </button>
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </section>
      </div>

      {renameTarget && (
        <Modal
          isOpen
          onClose={() => setRenameTarget(null)}
          title="Rename file"
          subtitle={renameTarget.file.fileName}
          maxWidth="440px"
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setRenameTarget(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleRename}>Save</button>
            </>
          }
        >
          <div className="form-group">
            <label className="form-label">Title</label>
            <input type="text" className="form-input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} autoFocus />
          </div>
        </Modal>
      )}

      {moveTarget && <MoveDocumentModal doc={moveTarget} onClose={() => setMoveTarget(null)} onMoved={(p) => open(p)} />}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete file?"
        message={`"${deleteTarget?.title}" (${deleteTarget?.file.fileName}) will be removed. This is recorded in the audit trail.`}
        confirmLabel="Delete"
        isDestructive
      />

      {upload && (
        <FolderUploadModal
          target={upload.target}
          initialFiles={upload.files}
          onClose={() => setUpload(null)}
          onUploaded={(p) => p && open(p)}
        />
      )}
    </div>
  );
};

export default DriveExplorer;
