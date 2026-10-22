import React, { useState } from 'react';
import { CheckCircle2, Circle, FileText, Plus, RefreshCw, Send, Upload, Wand2, X, ClipboardList, Pencil } from 'lucide-react';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { canEditModule } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { buildOnboardingItems, COMMON_PRODUCTS, PACK_STATUS_LABEL, packStatus, type OnboardingItem } from '../../lib/onboarding';
import type { DocumentPack, PortalDocument, SopInput } from '../../types/document';
import { SendDocumentsModal } from '../outreach/SendDocumentsModal';
import { FolderUploadModal } from '../documents/FolderUploadModal';
import { DocPickerModal } from './DocPickerModal';
import { SopGeneratorModal } from './SopGeneratorModal';

interface Props {
  clientId: string;
  clientType: 'company' | 'individual';
  clientName: string;
  city?: string;
  address?: string;
  recipient: { name: string; phone?: string; email?: string };
}

const STATUS_CLASS = { in_progress: 'badge-amber', complete: 'badge-blue', sent: 'badge-emerald' } as const;

/** Onboarding pack after the lead is won: SOP, MSDS per product, PCO certificates and layout. */
export const OnboardingPackPanel: React.FC<Props> = ({ clientId, clientType, clientName, city, address, recipient }) => {
  const store = useDataStore();
  const { userProfile, effectiveRole } = useAuth();
  const { success, error } = useNotification();
  const canEdit = canEditModule(effectiveRole, 'files');

  const pack = store.getOnboardingPack(clientId);
  const [picker, setPicker] = useState<OnboardingItem | null>(null);
  const [upload, setUpload] = useState<OnboardingItem | null>(null);
  const [showSop, setShowSop] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [productDraft, setProductDraft] = useState('');

  // Sources
  const library = store.getLibraryDocuments();
  const msdsDocs = library.filter((d) => d.fileCategory === 'msds' || d.category === 'msds_chemical');
  const certificateDocs = library.filter((d) => d.fileCategory === 'certificate' || d.category === 'certification');
  const sopTemplates = library.filter((d) => d.fileCategory === 'sop');
  const clientDocs = store.getDocuments().filter((d) => d.clientId === clientId);
  const clientSops = clientDocs.filter((d) => d.fileCategory === 'sop');
  const clientLayouts = clientDocs.filter((d) => d.fileCategory === 'layout');
  const accepted = store.getProposals(clientId).filter((p) => p.status === 'accepted').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const contract = store.getContracts(clientId).filter((c) => c.status === 'active').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const technicians = store.getStaff(['team_leader']);
  const assignedFromJobs = Array.from(new Set(store.getJobs(clientId).flatMap((j) => j.assignedTechnicianIds ?? [])));

  const docById = new Map([...library, ...clientDocs].map((d) => [d.id, d]));

  const rebuild = (base: Partial<DocumentPack>, chemicals: string[], technicianIds: string[], previous?: OnboardingItem[]) =>
    buildOnboardingItems({
      chemicals,
      technicians: technicianIds.map((uid) => ({ uid, name: technicians.find((t) => t.uid === uid)?.displayName || store.getUsers().find((u) => u.uid === uid)?.displayName || uid })),
      msdsDocs,
      certificateDocs,
      sopDocs: clientSops,
      layoutDocs: clientLayouts,
      previous: previous ?? base.items,
    });

  const save = (next: DocumentPack, note?: string) => {
    try {
      store.saveOnboardingPack(next, userProfile?.email, note);
    } catch (err) {
      error('Could not save the pack', err instanceof Error ? err.message : String(err));
    }
  };

  const start = () => {
    const chemicals = contract?.chemicals ?? accepted?.chemicals ?? [];
    const technicianIds = assignedFromJobs;
    const base: DocumentPack = {
      id: `PACK-ONB-${clientId}`,
      name: `Onboarding pack: ${clientName}`,
      description: 'SOP, MSDS, technician certificates and site layout',
      categories: [],
      documentIds: [],
      kind: 'onboarding',
      clientId,
      clientType,
      proposalId: accepted?.id,
      contractId: contract?.id,
      chemicals,
      technicianIds,
    };
    save({ ...base, items: rebuild(base, chemicals, technicianIds, []) }, `Started onboarding pack for ${clientName}`);
    success('Onboarding pack started', 'Documents were matched from the Company (IKPM) folder. Check each item.');
  };

  if (!pack) {
    return (
      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 800, display: 'flex', gap: 6, alignItems: 'center' }}><ClipboardList size={18} /> Onboarding pack</h3>
        <p className="cell-sub" style={{ margin: '0.4rem 0 1rem' }}>
          After the client is won, send them: their IPM / SOP document, the MSDS of every product used, the certificates of the assigned PCOs and the site / pest management layout.
          {accepted ? ` Products come from proposal ${accepted.id}.` : ''}
        </p>
        {canEdit ? (
          <button className="btn btn-primary" onClick={start}><Plus size={15} /> Start onboarding pack</button>
        ) : (
          <div className="empty-hint">Not started yet.</div>
        )}
      </div>
    );
  }

  const status = packStatus(pack);
  const items = pack.items ?? [];
  const chemicals = pack.chemicals ?? [];
  const technicianIds = pack.technicianIds ?? [];

  const update = (patch: Partial<DocumentPack>, note?: string) => {
    const merged = { ...pack, ...patch };
    const nextItems = patch.items ?? rebuild(merged, merged.chemicals ?? [], merged.technicianIds ?? [], pack.items);
    save({ ...merged, items: nextItems }, note);
  };

  const setItemDocs = (key: string, ids: string[]) =>
    update({ items: items.map((i) => (i.key === key ? { ...i, documentIds: ids, auto: false } : i)) }, `Changed documents for ${key}`);

  const addProduct = () => {
    const name = productDraft.trim();
    if (!name || chemicals.some((c) => c.toLowerCase() === name.toLowerCase())) return setProductDraft('');
    update({ chemicals: [...chemicals, name] });
    setProductDraft('');
  };

  const candidates = (item: OnboardingItem): PortalDocument[] => {
    switch (item.type) {
      case 'msds': return msdsDocs;
      case 'certificate': return certificateDocs;
      case 'sop': return [...clientSops, ...sopTemplates];
      case 'layout': return clientLayouts;
    }
  };

  const packDocs = Array.from(new Set(items.flatMap((i) => i.documentIds))).map((id) => docById.get(id)).filter(Boolean) as PortalDocument[];
  const clientPackDocs = packDocs.filter((d) => d.ownerScope === 'client');

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, display: 'flex', gap: 6, alignItems: 'center' }}>
            <ClipboardList size={18} /> Onboarding pack <span className={`badge-status ${STATUS_CLASS[status]}`}>{PACK_STATUS_LABEL[status]}</span>
          </h3>
          <div className="cell-sub">
            {pack.sentAt ? `Sent ${formatDate(pack.sentAt)} by ${pack.sentByName} via ${(pack.sentVia ?? []).join(' & ')}` : 'Not sent yet'}
            {pack.proposalId ? ` · from proposal ${pack.proposalId}` : ''}
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => update({}, 'Re-matched onboarding documents')} title="Match MSDS, certificates, SOP and layout again"><RefreshCw size={14} /> Re-match</button>
            <button className="btn btn-primary" onClick={() => setShowSend(true)} disabled={packDocs.length === 0} title={status === 'in_progress' ? 'Some items have no document yet' : undefined}>
              <Send size={14} /> Send pack
            </button>
          </div>
        )}
      </div>

      {/* Products and PCOs */}
      <div className="form-grid-2" style={{ marginTop: '1rem' }}>
        <div className="form-group">
          <label className="form-label">Products (an MSDS is needed for each)</label>
          <div className="chip-row" style={{ marginBottom: '0.4rem' }}>
            {chemicals.map((c) => (
              <span key={c} className="chip chip-on">
                {c}
                {canEdit && <button type="button" className="chip-x" onClick={() => update({ chemicals: chemicals.filter((x) => x !== c) })} aria-label={`Remove ${c}`}><X size={12} /></button>}
              </span>
            ))}
            {!chemicals.length && <span className="cell-sub">No products yet</span>}
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input className="form-input" list="onboarding-products" value={productDraft} onChange={(e) => setProductDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addProduct())} placeholder="Add product, e.g. Fendona" />
              <datalist id="onboarding-products">
                {Array.from(new Set([...COMMON_PRODUCTS, ...msdsDocs.map((d) => d.title)])).map((p) => <option key={p} value={p} />)}
              </datalist>
              <button type="button" className="btn btn-secondary" onClick={addProduct}><Plus size={14} /></button>
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Assigned PCOs (their certificates go in the pack)</label>
          <div className="chip-row" style={{ marginBottom: 0 }}>
            {technicians.map((t) => {
              const on = technicianIds.includes(t.uid);
              return (
                <button key={t.uid} type="button" className={`chip ${on ? 'chip-on' : ''}`} disabled={!canEdit} onClick={() => update({ technicianIds: on ? technicianIds.filter((x) => x !== t.uid) : [...technicianIds, t.uid] })}>
                  {t.displayName}
                </button>
              );
            })}
            {!technicians.length && <span className="cell-sub">No technicians in Team & Access yet</span>}
          </div>
        </div>
      </div>

      {/* Checklist */}
      <ul className="onboarding-list">
        {items.map((item) => {
          const docs = item.documentIds.map((id) => docById.get(id)).filter(Boolean) as PortalDocument[];
          const done = docs.length > 0;
          return (
            <li key={item.key} className={`onboarding-item ${done ? 'is-done' : ''}`}>
              {done ? <CheckCircle2 size={18} color="var(--ikpm-emerald-600)" /> : <Circle size={18} color="var(--ikpm-amber-500)" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cell-title">{item.label}{item.auto && done ? <span className="cell-sub"> · matched automatically</span> : null}</div>
                {docs.length ? (
                  docs.map((d) => (
                    <a key={d.id} className="link-btn" href={d.file.url} target="_blank" rel="noreferrer"><FileText size={12} /> {d.title}</a>
                  ))
                ) : (
                  <div className="cell-sub">
                    {item.type === 'msds' && 'No MSDS found. Upload it to Company (IKPM) › MSDS Library, then Re-match.'}
                    {item.type === 'certificate' && 'No certificate found. Upload it to Company (IKPM) › Technician Certificates.'}
                    {item.type === 'sop' && 'Generate the client SOP or upload one.'}
                    {item.type === 'layout' && 'Upload the site / pest management layout.'}
                  </div>
                )}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                  {item.type === 'sop' && <button className="btn btn-sm btn-primary" onClick={() => setShowSop(true)}><Wand2 size={13} /> {pack.sop ? 'Regenerate' : 'Generate'}</button>}
                  {(item.type === 'sop' || item.type === 'layout') && <button className="btn btn-sm btn-secondary" onClick={() => setUpload(item)}><Upload size={13} /></button>}
                  <button className="btn btn-sm btn-secondary" onClick={() => setPicker(item)} title="Choose documents"><Pencil size={13} /></button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {picker && (
        <DocPickerModal
          title={picker.label}
          subtitle={picker.type === 'msds' || picker.type === 'certificate' ? 'From the Company (IKPM) folder' : `From ${clientName}'s folder`}
          documents={candidates(picker)}
          selected={picker.documentIds}
          multiple={picker.type === 'certificate'}
          emptyText={picker.type === 'msds' ? 'The MSDS Library is empty. Upload MSDS files in Files › Company (IKPM) › MSDS Library.' : picker.type === 'certificate' ? 'No technician certificates uploaded yet.' : 'No documents yet. Use the upload button.'}
          onClose={() => setPicker(null)}
          onSave={(ids) => {
            setItemDocs(picker.key, ids);
            setPicker(null);
          }}
        />
      )}

      {upload && (
        <FolderUploadModal
          target={{ ownerScope: 'client', clientId, subfolder: 'Documents', category: upload.type === 'layout' ? 'layout' : 'sop', locked: true }}
          onClose={() => setUpload(null)}
          onUploaded={(_path, ids) => {
            if (ids?.length) setItemDocs(upload.key, ids.slice(-1));
          }}
        />
      )}

      {showSop && (
        <SopGeneratorModal
          clientId={clientId}
          clientType={clientType}
          clientName={clientName}
          city={city}
          address={address}
          products={chemicals}
          previous={pack.sop}
          onClose={() => setShowSop(false)}
          onCreated={(doc, sop: SopInput) => update({ sop, items: items.map((i) => (i.key === 'sop' ? { ...i, documentIds: [doc.id], auto: false } : i)) }, `Generated SOP ${sop.documentNo}`)}
        />
      )}

      {showSend && (
        <SendDocumentsModal
          isOpen
          onClose={() => setShowSend(false)}
          title={`Send onboarding pack to ${clientName}`}
          recipient={recipient}
          related={{ kind: clientType === 'company' ? 'company' : 'client', id: clientId, title: `${clientName} onboarding pack` }}
          extraDocuments={clientPackDocs}
          preselectIds={packDocs.map((d) => d.id)}
          onSent={(results) => {
            const ok = results.filter((r) => r.ok).map((r) => r.channel);
            if (ok.length) store.markOnboardingSent(pack.id, Array.from(new Set(ok)), userProfile?.email);
          }}
        />
      )}
    </div>
  );
};

export default OnboardingPackPanel;
