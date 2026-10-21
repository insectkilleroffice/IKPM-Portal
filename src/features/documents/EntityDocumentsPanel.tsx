import React, { useState } from 'react';
import { Send } from 'lucide-react';
import type { OutreachLog } from '../../types/document';
import { dataService } from '../../services/dataService';
import { useDataStore } from '../../hooks/useDataStore';
import { clientRootPath } from '../../lib/folders';
import { DriveExplorer } from './DriveExplorer';
import { SendDocumentsModal } from '../outreach/SendDocumentsModal';
import { OutreachHistory } from '../outreach/OutreachHistory';

interface Props {
  owner: { kind: 'company' | 'client' | 'branch'; id: string };
  title: string;
  recipient: { name: string; phone?: string; email?: string };
}

/** Files tab for a customer: only that client's (or branch's) folder, plus what IKPM sent them. */
export const EntityDocumentsPanel: React.FC<Props> = ({ owner, title, recipient }) => {
  useDataStore();
  const [showSend, setShowSend] = useState(false);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card" style={{ padding: '1.25rem' }}>
        <DriveExplorer key={rootPath} rootPath={rootPath} rootTitle={title} ensurePaths={ensurePaths} />
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
