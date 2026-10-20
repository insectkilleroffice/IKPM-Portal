import React, { useState } from 'react';
import { Upload, Send, Paperclip } from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';
import { useDataStore } from '../../hooks/useDataStore';
import type { OutreachLog } from '../../types/document';
import { DocumentTable } from './DocumentTable';
import { DocumentUploadModal } from './DocumentUploadModal';
import { SendDocumentsModal } from '../outreach/SendDocumentsModal';
import { OutreachHistory } from '../outreach/OutreachHistory';

interface Props {
  owner: { kind: 'company' | 'client' | 'branch'; id: string };
  title: string;
  recipient: { name: string; phone?: string; email?: string };
}

/** Documents tab for a customer: files received from the client + IKPM documents shared with them. */
export const EntityDocumentsPanel: React.FC<Props> = ({ owner, title, recipient }) => {
  const store = useDataStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const docs = store.getDocuments(owner);
  const related: OutreachLog['related'] = { kind: owner.kind, id: owner.id, title };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', gap: '1.25rem' }} className="stack-on-mobile">
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 800 }}>Client documents ({docs.length})</h3>
          <button className="btn btn-secondary" onClick={() => setShowUpload(true)}>
            <Upload size={14} /> <span>Upload</span>
          </button>
        </div>
        {docs.length === 0 ? (
          <EmptyState
            icon={Paperclip}
            title="No client documents yet"
            description="Upload signed contracts, purchase orders, WHT certificates, site maps or vendor registration forms received from this client."
            action={{ label: 'Upload Document', onClick: () => setShowUpload(true) }}
          />
        ) : (
          <DocumentTable documents={docs} onRemove={(d) => window.confirm(`Remove "${d.title}" from this profile?`) && store.removeDocument(d.id)} />
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 800 }}>Shared with client</h3>
          <button className="btn btn-primary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }} onClick={() => setShowSend(true)}>
            <Send size={13} /> <span>Send IKPM Docs</span>
          </button>
        </div>
        <OutreachHistory related={owner} emptyText="No IKPM documents sent to this client yet." />
      </div>

      <DocumentUploadModal isOpen={showUpload} onClose={() => setShowUpload(false)} owner={owner} />
      <SendDocumentsModal isOpen={showSend} onClose={() => setShowSend(false)} recipient={recipient} related={related} />
    </div>
  );
};
