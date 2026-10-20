import React, { useState } from 'react';
import { Upload, Send, FolderLock, AlertTriangle, CheckCircle2, Package, Cloud, MessageCircle } from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { EmptyState } from '../../components/common/EmptyState';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { integrations } from '../../config/env';
import { COMPANY_DOC_CATEGORIES, type CompanyDocCategory, type PortalDocument } from '../../types/document';
import { DocumentTable } from './DocumentTable';
import { DocumentUploadModal } from './DocumentUploadModal';
import { expiryState } from './documentUtils';
import { SendDocumentsModal } from '../outreach/SendDocumentsModal';
import { OutreachHistory } from '../outreach/OutreachHistory';

/** IKPM's own company papers (authority letters, NTN/SRB, licenses, profile…) — uploaded once, shared on every pitch. */
export const DocumentLibraryPage: React.FC = () => {
  const store = useDataStore();
  const { hasRole, userProfile } = useAuth();
  const { success } = useNotification();
  const canManage = hasRole(['super_admin', 'management', 'sales']);

  const [category, setCategory] = useState<CompanyDocCategory | 'all'>('all');
  const [showUpload, setShowUpload] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [toRemove, setToRemove] = useState<PortalDocument | null>(null);

  const docs = store.getLibraryDocuments();
  const packs = store.getDocumentPacks();
  const visible = category === 'all' ? docs : docs.filter((d) => d.category === category);
  const expiring = docs.filter((d) => expiryState(d) === 'expiring');
  const expired = docs.filter((d) => expiryState(d) === 'expired');
  const missingCategories = COMPANY_DOC_CATEGORIES.filter(
    (c) => ['authority_letter', 'registration_tax', 'license_permit', 'company_profile'].includes(c.value) && !docs.some((d) => d.category === c.value)
  );

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Document Library' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Company Document Library</h1>
          <p className="page-subtitle">
            Upload IKPM's authority letters, NTN / SRB certificates, licenses and company profile once — share them with any client in one click over WhatsApp or email.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => setShowSend(true)} disabled={docs.length === 0}>
            <Send size={15} />
            <span>Quick Send</span>
          </button>
          {canManage && (
            <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
              <Upload size={15} />
              <span>Upload Documents</span>
            </button>
          )}
        </div>
      </div>

      {/* Status strip */}
      <div className="status-strip">
        <div className="status-pill">
          <FolderLock size={15} /> <strong>{docs.length}</strong> documents
        </div>
        <div className={`status-pill ${expiring.length ? 'warn' : ''}`}>
          <AlertTriangle size={15} /> <strong>{expiring.length}</strong> expiring in 30 days
        </div>
        <div className={`status-pill ${expired.length ? 'bad' : ''}`}>
          <AlertTriangle size={15} /> <strong>{expired.length}</strong> expired (excluded from packs)
        </div>
        <div className={`status-pill ${integrations.cloudinary ? 'ok' : 'warn'}`} title="VITE_CLOUDINARY_CLOUD_NAME / VITE_CLOUDINARY_UPLOAD_PRESET">
          <Cloud size={15} /> Cloudinary {integrations.cloudinary ? 'connected' : 'not configured'}
        </div>
        <div className={`status-pill ${integrations.outreachApi ? 'ok' : ''}`} title="VITE_OUTREACH_API_URL">
          <MessageCircle size={15} /> {integrations.outreachApi ? 'Auto-send on' : 'WhatsApp / email via links'}
        </div>
      </div>

      {missingCategories.length > 0 && docs.length > 0 && (
        <div className="empty-hint" style={{ marginBottom: '1rem' }}>
          Clients usually ask for these too — not uploaded yet: <strong>{missingCategories.map((c) => c.label).join(', ')}</strong>.
        </div>
      )}

      {/* Pitch packs */}
      <div className="pack-grid">
        {packs.map((p) => {
          const count = store.resolvePack(p.id).length;
          return (
            <div key={p.id} className="pack-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>
                <Package size={15} color="var(--ikpm-emerald-600)" /> {p.name}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flex: 1 }}>{p.description}</div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                {count > 0 ? <CheckCircle2 size={13} color="var(--ikpm-emerald-600)" /> : <AlertTriangle size={13} color="var(--ikpm-amber-500)" />}
                {count} document(s) ready
              </div>
            </div>
          );
        })}
      </div>

      <div className="tab-bar">
        <button className={`tab-btn ${category === 'all' ? 'active' : ''}`} onClick={() => setCategory('all')}>
          All ({docs.length})
        </button>
        {COMPANY_DOC_CATEGORIES.map((c) => {
          const n = docs.filter((d) => d.category === c.value).length;
          return (
            <button key={c.value} className={`tab-btn ${category === c.value ? 'active' : ''}`} onClick={() => setCategory(c.value)}>
              {c.label} ({n})
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={FolderLock}
          title={docs.length === 0 ? 'Your library is empty' : 'No documents in this category'}
          description="Start with the documents clients ask for most: principal authority letters, NTN & SRB certificates, pesticide license and company profile."
          action={canManage ? { label: 'Upload Documents', onClick: () => setShowUpload(true) } : undefined}
        />
      ) : (
        <DocumentTable documents={visible} showCategory={category === 'all'} onRemove={canManage ? setToRemove : undefined} />
      )}

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: '0.75rem' }}>Recently shared</h3>
        <OutreachHistory limit={8} emptyText="Documents you send to clients will appear here." />
      </div>

      <DocumentUploadModal
        isOpen={showUpload}
        onClose={() => setShowUpload(false)}
        owner={{ kind: 'library' }}
        defaultCategory={category === 'all' ? 'authority_letter' : category}
      />

      <SendDocumentsModal
        isOpen={showSend}
        onClose={() => setShowSend(false)}
        recipient={{ name: '' }}
        related={{ kind: 'company', id: 'ad-hoc', title: 'Quick send from library' }}
      />

      <ConfirmDialog
        isOpen={Boolean(toRemove)}
        onClose={() => setToRemove(null)}
        onConfirm={() => {
          if (!toRemove) return;
          store.removeDocument(toRemove.id, userProfile?.email);
          success('Removed', `"${toRemove.title}" removed from the library.`);
          setToRemove(null);
        }}
        title="Remove document?"
        message={`"${toRemove?.title}" will no longer be offered when pitching. The file stays in Cloudinary.`}
        confirmLabel="Remove"
      />
    </div>
  );
};
