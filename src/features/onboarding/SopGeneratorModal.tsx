import React, { useState } from 'react';
import { Plus, Trash2, Download, Loader2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { dataService } from '../../services/dataService';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import { sopDocumentNumber } from '../../lib/onboarding';
import { documentTemplates } from '../../services/documentTemplates';
import { companyProfile } from '../../services/companyProfile';
import type { DocumentOwner, PortalDocument, SopInput } from '../../types/document';

interface Props {
  clientId: string;
  clientType: 'company' | 'individual';
  clientName: string;
  city?: string;
  address?: string;
  products: string[];
  previous?: SopInput;
  onClose: () => void;
  /** Called with the saved document and the inputs used. */
  onCreated: (doc: PortalDocument, sop: SopInput) => void;
}

const addMonths = (iso: string, m: number) => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + m);
  return d.toISOString().slice(0, 10);
};

/** Generates the client SOP ("Pest Management Plan") and files it in the client's Documents folder. */
export const SopGeneratorModal: React.FC<Props> = ({ clientId, clientType, clientName, city, address, products, previous, onClose, onCreated }) => {
  const { userProfile } = useAuth();
  const { success, error, warning } = useNotification();
  const profile = companyProfile.get();
  const today = new Date().toISOString().slice(0, 10);
  const existingSops = dataService.getDocuments().filter((d) => d.clientId === clientId && d.fileCategory === 'sop').length;

  const defaults = (): SopInput => {
    const co = clientType === 'company' ? dataService.getCompanyById(clientId) : undefined;
    const cl = clientType === 'individual' ? dataService.getClientById(clientId) : undefined;
    const clientPeople = co ? [co.primaryContact, ...(co.additionalContacts ?? [])].slice(0, 3) : [];
    return {
      clientName,
      documentNo: sopDocumentNumber(clientName, city, existingSops + 1),
      effectiveDate: today,
      reviewDate: addMonths(today, 12),
      address,
      authorizedPersons: [
        ...(co ? clientPeople.map((c) => ({ name: c.fullName, designation: c.designation, organisation: 'client' as const })) : cl ? [{ name: cl.fullName, organisation: 'client' as const }] : []),
        ...(profile.signatoryName ? [{ name: profile.signatoryName, designation: profile.signatoryTitle, organisation: 'ikpm' as const }] : []),
      ],
      contacts: [
        ...(co ? clientPeople.map((c) => ({ name: c.fullName, role: c.designation, phone: c.mobile || c.phone, email: c.email })) : cl ? [{ name: cl.fullName, role: 'Client', phone: cl.primaryPhone, email: cl.email }] : []),
        { name: profile.legalName, role: 'Pest control service provider', phone: profile.mobile || profile.phone, email: profile.email },
      ],
      products: products.map((name) => ({ name })),
      preparedBy: userProfile?.displayName || '',
    };
  };

  const [sop, setSop] = useState<SopInput>(() => (previous ? { ...previous, products: previous.products.length ? previous.products : products.map((name) => ({ name })) } : defaults()));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<SopInput>) => setSop((s) => ({ ...s, ...patch }));

  const problems: string[] = [];
  if (!sop.documentNo.trim()) problems.push('Enter a document number.');
  if (!sop.authorizedPersons.some((a) => a.name.trim())) problems.push('Add at least one authorised person.');
  if (!sop.preparedBy.trim()) problems.push('Enter who prepared it.');

  const clean = (): SopInput => ({
    ...sop,
    authorizedPersons: sop.authorizedPersons.filter((a) => a.name.trim()),
    contacts: sop.contacts.filter((c) => c.name.trim()),
    products: sop.products.filter((p) => p.name.trim()),
  });

  const create = async () => {
    if (problems.length) return;
    const input = clean();
    if (!integrations.cloudinary || !navigator.onLine) {
      warning('Not saved to the client folder', 'File storage is not configured or you are offline. The SOP is downloaded instead.');
      await pdfGenerator.generateSopPDF(input).catch((e) => error('Could not create PDF', String(e)));
      return;
    }
    setBusy(true);
    try {
      const owner: DocumentOwner = { kind: clientType === 'company' ? 'company' : 'client', id: clientId };
      const fileName = pdfGenerator.sopFileName(input);
      const stored = await uploadFile(await pdfGenerator.sopPDFBlob(input), { scope: dataService.uploadScopeFor(owner, 'sop'), subPath: 'onboarding', fileName });
      const doc = dataService.saveDocument(
        {
          id: `DOC-${Date.now()}-SOP`,
          title: `Pest Management Plan ${input.documentNo}`,
          category: 'other',
          fileCategory: 'sop',
          owner,
          source: 'generated',
          file: stored,
          uploadedBy: userProfile?.email || 'admin',
          uploadedByName: userProfile?.displayName || 'Staff',
          uploadedAt: new Date().toISOString(),
          templateVersion: documentTemplates.version(),
          templateSnapshot: { sopSections: documentTemplates.get().sopSections },
        },
        userProfile?.email
      );
      success('SOP created', `${input.documentNo} is saved in ${clientName} / Documents.`);
      onCreated(doc, input);
      onClose();
    } catch (err) {
      error('Could not create SOP', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => !busy && onClose()}
      title="Client SOP / Pest Management Plan"
      subtitle={clientName}
      maxWidth="820px"
      footer={
        <>
          <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={() => pdfGenerator.generateSopPDF(clean()).catch((e) => error('Could not create PDF', String(e)))} disabled={busy}>
            <Download size={14} /> Preview PDF
          </button>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={busy || problems.length > 0} title={problems.join('\n')}>
            {busy && <Loader2 size={14} className="spin" />} Create and save
          </button>
        </>
      }
    >
      <div className="form-grid-4">
        <div className="form-group">
          <label className="form-label">Document no.</label>
          <input className="form-input" value={sop.documentNo} onChange={(e) => set({ documentNo: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Effective date</label>
          <input type="date" className="form-input" value={sop.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Review date</label>
          <input type="date" className="form-input" value={sop.reviewDate ?? ''} onChange={(e) => set({ reviewDate: e.target.value || undefined })} />
        </div>
        <div className="form-group">
          <label className="form-label">Site / branch</label>
          <input className="form-input" value={sop.siteName ?? ''} onChange={(e) => set({ siteName: e.target.value || undefined })} />
        </div>
      </div>
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Prepared by</label>
          <input className="form-input" value={sop.preparedBy} onChange={(e) => set({ preparedBy: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Approved by (client)</label>
          <input className="form-input" value={sop.approvedBy ?? ''} onChange={(e) => set({ approvedBy: e.target.value || undefined })} />
        </div>
      </div>

      <div className="section-title">Authorised persons</div>
      {sop.authorizedPersons.map((a, i) => (
        <div key={i} className="sop-row">
          <input className="form-input" placeholder="Name" value={a.name} onChange={(e) => set({ authorizedPersons: sop.authorizedPersons.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
          <input className="form-input" placeholder="Designation" value={a.designation ?? ''} onChange={(e) => set({ authorizedPersons: sop.authorizedPersons.map((x, j) => (j === i ? { ...x, designation: e.target.value } : x)) })} />
          <select className="form-select" value={a.organisation} onChange={(e) => set({ authorizedPersons: sop.authorizedPersons.map((x, j) => (j === i ? { ...x, organisation: e.target.value as 'client' | 'ikpm' } : x)) })}>
            <option value="client">Client</option>
            <option value="ikpm">{profile.shortName || 'IKPM'}</option>
          </select>
          <button type="button" className="icon-btn" onClick={() => set({ authorizedPersons: sop.authorizedPersons.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => set({ authorizedPersons: [...sop.authorizedPersons, { name: '', organisation: 'client' }] })}><Plus size={14} /> Add person</button>

      <div className="section-title">Contacts</div>
      {sop.contacts.map((c, i) => (
        <div key={i} className="sop-row sop-row-4">
          <input className="form-input" placeholder="Name" value={c.name} onChange={(e) => set({ contacts: sop.contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
          <input className="form-input" placeholder="Role" value={c.role ?? ''} onChange={(e) => set({ contacts: sop.contacts.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} />
          <input className="form-input" placeholder="Phone" value={c.phone ?? ''} onChange={(e) => set({ contacts: sop.contacts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)) })} />
          <input className="form-input" placeholder="Email" value={c.email ?? ''} onChange={(e) => set({ contacts: sop.contacts.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} />
          <button type="button" className="icon-btn" onClick={() => set({ contacts: sop.contacts.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => set({ contacts: [...sop.contacts, { name: '' }] })}><Plus size={14} /> Add contact</button>

      <div className="section-title">Products</div>
      {sop.products.map((p, i) => (
        <div key={i} className="sop-row sop-row-2">
          <input className="form-input" placeholder="Product" value={p.name} onChange={(e) => set({ products: sop.products.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
          <input className="form-input" placeholder="Used for (e.g. cockroach gel baiting)" value={p.use ?? ''} onChange={(e) => set({ products: sop.products.map((x, j) => (j === i ? { ...x, use: e.target.value } : x)) })} />
          <button type="button" className="icon-btn" onClick={() => set({ products: sop.products.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => set({ products: [...sop.products, { name: '' }] })}><Plus size={14} /> Add product</button>

      <div className="info-hint" style={{ marginTop: '1rem' }}>
        Sections included: purpose & scope, responsibilities, rodent control, flying insect control, crawling insect control, emergency handling, monitoring & review.
      </div>
      {problems.length > 0 && <ul className="form-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </Modal>
  );
};

export default SopGeneratorModal;
