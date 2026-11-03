import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, FolderTree, LayoutList, Send } from 'lucide-react';
import type { OutreachLog } from '../../types/document';
import { dataService } from '../../services/dataService';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { baseRoleOf, canEditModule } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { BRANCHES_FOLDER, CLIENT_SUBFOLDERS, clientRootPath, isInFolder, parseFolderPath } from '../../lib/folders';
import { DriveExplorer } from './DriveExplorer';
import { collectFolderItems, KIND_LABEL, remapLeadItems, type FolderItem } from './folderItems';
import { SendDocumentsModal } from '../outreach/SendDocumentsModal';
import { OutreachHistory } from '../outreach/OutreachHistory';

interface Props {
  owner: { kind: 'company' | 'client' | 'branch'; id: string };
  title: string;
  recipient: { name: string; phone?: string; email?: string };
}

/**
 * Files tab for a customer: every document and record of that client (or branch) in one place,
 * grouped by category, or as folders; plus what IKPM sent them. Files filed under the customer's
 * leads before it became a customer (meeting / inspection reports) are included.
 */
export const EntityDocumentsPanel: React.FC<Props> = ({ owner, title, recipient }) => {
  const store = useDataStore();
  const version = store.getVersion();
  const { userProfile, effectiveRole } = useAuth();
  const [showSend, setShowSend] = useState(false);
  const [view, setView] = useState<'categories' | 'folders'>('categories');
  const related: OutreachLog['related'] = { kind: owner.kind, id: owner.id, title };

  let rootPath: string;
  let ensurePaths: string[] = [];
  if (owner.kind === 'branch') {
    const br = dataService.getBranchById(owner.id);
    rootPath = clientRootPath(br?.companyId || owner.id, br?.companyName, { id: owner.id, name: br?.branchName });
  } else {
    rootPath = clientRootPath(owner.id, title);
    if (owner.kind === 'company') {
      ensurePaths = dataService
        .getBranches()
        .filter((b) => b.companyId === owner.id)
        .map((b) => clientRootPath(owner.id, title, { id: b.id, name: b.branchName }));
    }
  }
  const leadIds = owner.kind === 'branch' ? [] : dataService.leadIdsOfCustomer(owner.id);
  const leadKey = leadIds.join('|');

  // Move reports still in the lead's folder into the customer's folder (people who file / see all records)
  const base = baseRoleOf(effectiveRole);
  const canRefile = canEditModule(effectiveRole, 'files') || base === 'super_admin' || base === 'admin';
  useEffect(() => {
    if (!canRefile || owner.kind === 'branch' || !leadKey) return;
    try {
      dataService.refileCustomerLeadFiles(owner.id, userProfile?.email);
    } catch (err) {
      console.warn('Could not move lead files to the customer folder:', err);
    }
  }, [canRefile, owner.id, owner.kind, leadKey, userProfile?.email]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
          <button type="button" className={`chip ${view === 'categories' ? 'chip-on' : ''}`} onClick={() => setView('categories')}>
            <LayoutList size={13} /> All documents by category
          </button>
          <button type="button" className={`chip ${view === 'folders' ? 'chip-on' : ''}`} onClick={() => setView('folders')}>
            <FolderTree size={13} /> Folders
          </button>
        </div>
        {view === 'categories'
          ? <CategorizedDocuments rootPath={rootPath} leadIds={leadIds} version={version} />
          : <DriveExplorer key={rootPath} rootPath={rootPath} rootTitle={title} ensurePaths={ensurePaths} leadIds={leadIds} />}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 800 }}>Sent to this client</h3>
          <button className="btn btn-primary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }} onClick={() => setShowSend(true)}>
            <Send size={13} /> <span>Send IKPM Docs</span>
          </button>
        </div>
        <OutreachHistory related={owner} emptyText="No IKPM documents sent to this client yet." />
      </div>

      <SendDocumentsModal isOpen={showSend} onClose={() => setShowSend(false)} recipient={recipient} related={related} />
    </div>
  );
};

/** Every file and record of the customer in one list, grouped by category (Leads & Inspections, Proposals, …). */
const CategorizedDocuments: React.FC<{ rootPath: string; leadIds: string[]; version: number }> = ({ rootPath, leadIds, version }) => {
  const navigate = useNavigate();
  const leadKey = leadIds.join('|');
  const groups = useMemo(() => {
    const items = remapLeadItems(collectFolderItems(), rootPath, leadIds).filter((i) => isInFolder(i.folderPath, rootPath));
    const byCat = new Map<string, FolderItem[]>();
    items.forEach((i) => {
      const sub = parseFolderPath(i.folderPath)?.subfolder;
      const cat = sub && sub !== BRANCHES_FOLDER ? sub : 'Other';
      byCat.set(cat, [...(byCat.get(cat) ?? []), i]);
    });
    const order = [...CLIENT_SUBFOLDERS, 'Other'] as string[];
    return [...byCat.entries()]
      .sort(([a], [b]) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)))
      .map(([cat, list]) => ({ cat, list: list.sort((a, b) => (b.date || '').localeCompare(a.date || '')) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, leadKey, version]);

  if (!groups.length) return <div className="empty-hint">No documents for this client yet.</div>;

  const open = (i: FolderItem) => {
    if (i.doc) window.open(i.doc.file.url, '_blank', 'noopener');
    else if (i.href) navigate(i.href);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {groups.map(({ cat, list }) => (
        <details key={cat} open style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.5rem 0.75rem' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{cat} ({list.length})</summary>
          <div className="table-container" style={{ marginTop: '0.5rem' }}>
            <table className="data-table">
              <tbody>
                {list.map((i) => {
                  const branch = parseFolderPath(i.folderPath)?.branchId;
                  return (
                    <tr key={i.key}>
                      <td style={{ width: 120 }}><span className="badge-status badge-slate">{KIND_LABEL[i.kind]}</span></td>
                      <td>
                        <div className="cell-title">{i.title}</div>
                        <div className="cell-sub">{[i.sub, branch && `Branch: ${dataService.getBranchById(branch)?.branchName || branch}`].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="cell-sub" style={{ whiteSpace: 'nowrap' }}>{i.date ? formatDate(i.date) : ''}</td>
                      <td style={{ textAlign: 'right' }}>
                        {(i.doc || i.href) && (
                          <button className="icon-btn" title="Open" onClick={() => open(i)}><ExternalLink size={14} /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
};
