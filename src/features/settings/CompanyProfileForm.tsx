import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Building2, Eye, ImagePlus, Landmark, FileText, Plus, RotateCcw, Save, Trash2, Stamp as StampIcon } from 'lucide-react';
import { companyProfile, DEFAULT_ACCENT_COLOR, DEFAULT_BRAND_COLOR, DEFAULT_INVOICE_NOTES, DEFAULT_PROPOSAL_TERMS, type CompanyProfile } from '../../services/companyProfile';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { uploadFile, validateFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';

const Field: React.FC<{ label: string; hint?: string; span?: boolean; children: React.ReactNode }> = ({ label, hint, span, children }) => (
  <div className="form-group" style={span ? { gridColumn: '1 / -1' } : undefined}>
    <label className="form-label">{label}</label>
    {children}
    {hint && <div className="form-hint">{hint}</div>}
  </div>
);

/** Letterhead details printed on every generated document. Editable by the super admin. */
export const CompanyProfileForm: React.FC = () => {
  const { isSuperAdmin, userProfile } = useAuth();
  const { success, error } = useNotification();
  const live = useSyncExternalStore(companyProfile.subscribe, companyProfile.get);
  const [form, setForm] = useState<CompanyProfile>(live);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);

  // Pick up changes saved elsewhere until the person starts editing
  useEffect(() => {
    if (!dirty) setForm(live);
  }, [live, dirty]);

  const set = <K extends keyof CompanyProfile>(k: K, v: CompanyProfile[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const color = (k: 'brandColor' | 'accentColor', fallback: string) => (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <input type="color" value={form[k] || fallback} onChange={(e) => set(k, e.target.value)} disabled={!isSuperAdmin} style={{ width: 44, height: 36, padding: 2, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)' }} />
      <span className="cell-sub">{(form[k] || fallback).toUpperCase()}</span>
      {isSuperAdmin && form[k] && form[k] !== fallback && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => set(k, '')}><RotateCcw size={13} /> Default</button>
      )}
    </div>
  );
  const input = (k: keyof CompanyProfile, placeholder = '') => (
    <input className="form-input" value={(form[k] as string) || ''} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} disabled={!isSuperAdmin} />
  );

  type CashKey = keyof NonNullable<CompanyProfile['cashAccount']>;
  const cashInput = (k: CashKey, placeholder = '') => (
    <input
      className="form-input"
      value={form.cashAccount?.[k] || ''}
      onChange={(e) => set('cashAccount', { ...(form.cashAccount ?? {}), [k]: e.target.value })}
      placeholder={placeholder}
      disabled={!isSuperAdmin}
    />
  );

  const save = async () => {
    if (!form.legalName.trim()) return error('Company name required', 'Enter the legal company name.');
    setSaving(true);
    try {
      await companyProfile.save(form, userProfile?.email || '');
      pdfGenerator.clearImageCache();
      setDirty(false);
      success('Company profile saved', 'New documents will use these details.');
    } catch (err) {
      const code = (err as { code?: string }).code;
      error('Could not save', code === 'permission-denied' ? 'Only the super admin can change the company profile (and the latest rules must be deployed).' : err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return error('Unsupported logo', 'Use a PNG or JPG image (transparent PNG looks best).');
    const problem = validateFile(file);
    if (problem) return error('Logo not accepted', problem);
    setUploadingLogo(true);
    try {
      const stored = await uploadFile(file, { scope: { ownerScope: 'company', category: 'other' }, subPath: 'branding', fileName: `logo_${Date.now()}.${file.type.split('/')[1]}` });
      set('logoUrl', stored.url);
      pdfGenerator.clearImageCache();
    } catch (err) {
      error('Logo upload failed', err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingLogo(false);
      if (logoInput.current) logoInput.current.value = '';
    }
  };

  const uploadStamp = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return error('Unsupported stamp image', 'Use a PNG or JPG image (transparent PNG recommended).');
    const problem = validateFile(file);
    if (problem) return error('Stamp not accepted', problem);
    setUploadingStamp(true);
    try {
      const stored = await uploadFile(file, { scope: { ownerScope: 'company', category: 'other' }, subPath: 'branding', fileName: `stamp_${Date.now()}.${file.type.split('/')[1]}` });
      set('stampUrl', stored.url);
      pdfGenerator.clearImageCache();
    } catch (err) {
      error('Stamp upload failed', err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingStamp(false);
      if (stampInput.current) stampInput.current.value = '';
    }
  };

  const uploadBackground = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return error('Unsupported image', 'Use a PNG or JPG image (transparent PNG looks best).');
    const problem = validateFile(file);
    if (problem) return error('Image not accepted', problem);
    setUploadingBackground(true);
    try {
      const stored = await uploadFile(file, { scope: { ownerScope: 'company', category: 'other' }, subPath: 'branding', fileName: `background_${Date.now()}.${file.type.split('/')[1]}` });
      set('watermarkUrl', stored.url);
      pdfGenerator.clearImageCache();
    } catch (err) {
      error('Upload failed', err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingBackground(false);
      if (backgroundInput.current) backgroundInput.current.value = '';
    }
  };

  // "Our valued clients" logos for proposals
  const clientLogoInput = useRef<HTMLInputElement>(null);
  const [uploadingClientLogo, setUploadingClientLogo] = useState(false);
  const [clientLogoName, setClientLogoName] = useState('');
  const uploadClientLogo = async (file?: File) => {
    if (!file) return;
    if (!clientLogoName.trim()) return error('Client name needed', 'Type the client’s name first, then choose their logo.');
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return error('Unsupported logo', 'Use a PNG or JPG image.');
    const problem = validateFile(file);
    if (problem) return error('Logo not accepted', problem);
    setUploadingClientLogo(true);
    try {
      const stored = await uploadFile(file, { scope: { ownerScope: 'company', category: 'other' }, subPath: 'branding/clients', fileName: `client_${Date.now()}.${file.type.split('/')[1]}` });
      set('clientLogos', [...(form.clientLogos ?? []), { name: clientLogoName.trim(), url: stored.url }]);
      setClientLogoName('');
      pdfGenerator.clearImageCache();
    } catch (err) {
      error('Logo upload failed', err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingClientLogo(false);
      if (clientLogoInput.current) clientLogoInput.current.value = '';
    }
  };

  const serviceAreas = form.serviceAreas ?? [];

  // Preview what is on screen, even before saving
  const preview = () =>
    pdfGenerator.previewLetterhead({ ...form }).catch((err) => error('Preview failed', err instanceof Error ? err.message : String(err)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {!isSuperAdmin && <div className="info-hint">Only the super admin can change these details.</div>}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
          <Building2 size={20} color="var(--ikpm-navy-700)" />
          <div className="card-title">Letterhead & Head Quarter</div>
          <span className="cell-sub" style={{ marginLeft: 'auto' }}>Printed on proposals, invoices, receipts and reports</span>
        </div>

        <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <div>
            <label className="form-label">Company Logo</label>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div className="logo-preview">
                <img src={form.logoUrl || '/ik_logo.svg'} alt="Company logo" />
              </div>
              {isSuperAdmin && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => logoInput.current?.click()} disabled={uploadingLogo || !integrations.cloudinary}>
                    <ImagePlus size={14} /> {uploadingLogo ? 'Uploading…' : 'Upload logo'}
                  </button>
                  {form.logoUrl && (
                    <button className="btn btn-ghost btn-sm" onClick={() => set('logoUrl', '')}>
                      <RotateCcw size={13} /> Use built-in
                    </button>
                  )}
                  <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="form-label">Official Company Stamp</label>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div className="logo-preview" style={{ width: 90, height: 90, border: '1px dashed var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
                {form.stampUrl ? (
                  <img src={form.stampUrl} alt="Company stamp" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <StampIcon size={28} color="var(--text-muted)" />
                )}
              </div>
              {isSuperAdmin && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => stampInput.current?.click()} disabled={uploadingStamp || !integrations.cloudinary}>
                    <StampIcon size={14} /> {uploadingStamp ? 'Uploading…' : form.stampUrl ? 'Change stamp' : 'Upload stamp'}
                  </button>
                  {form.stampUrl && (
                    <button className="btn btn-ghost btn-sm" onClick={() => set('stampUrl', '')}>
                      <Trash2 size={13} /> Remove stamp
                    </button>
                  )}
                  <input ref={stampInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadStamp(e.target.files?.[0])} />
                </div>
              )}
            </div>
            <div className="form-hint" style={{ marginTop: '0.35rem' }}>Replaces signature lines at the end of proposals, invoices and receipts.</div>
          </div>

          <div>
            <label className="form-label">Document Background</label>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div className="logo-preview" style={{ width: 90, height: 90, border: '1px dashed var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
                {form.watermarkUrl ? (
                  <img src={form.watermarkUrl} alt="Document background" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <ImagePlus size={28} color="var(--text-muted)" />
                )}
              </div>
              {isSuperAdmin && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => backgroundInput.current?.click()} disabled={uploadingBackground || !integrations.cloudinary}>
                    <ImagePlus size={14} /> {uploadingBackground ? 'Uploading…' : form.watermarkUrl ? 'Change image' : 'Upload image'}
                  </button>
                  {form.watermarkUrl && (
                    <button className="btn btn-ghost btn-sm" onClick={() => set('watermarkUrl', '')}>
                      <Trash2 size={13} /> Remove image
                    </button>
                  )}
                  <input ref={backgroundInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadBackground(e.target.files?.[0])} />
                </div>
              )}
            </div>
            {form.watermarkUrl && (
              <label className="form-hint" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
                Strength
                <input type="range" min={3} max={30} value={form.watermarkOpacity ?? 8} onChange={(e) => set('watermarkOpacity', Number(e.target.value))} disabled={!isSuperAdmin} />
                {form.watermarkOpacity ?? 8}%
              </label>
            )}
            <div className="form-hint" style={{ marginTop: '0.35rem' }}>Printed faintly behind every PDF. Transparent PNG looks best.</div>
          </div>
        </div>

        <div className="form-grid-2">
          <Field label="Legal company name *">{input('legalName', 'Insect Killer Pest Management')}</Field>
          <Field label="Short name">{input('shortName', 'IKPM')}</Field>
          <Field label="Tagline" span>{input('tagline', 'Integrated Pest Management & Fumigation Services')}</Field>
          <Field label="Head quarter address">{input('address', 'Office 12, Main Boulevard')}</Field>
          <Field label="City / country">{input('city', 'Karachi, Pakistan')}</Field>
          <Field label="Phone / UAN">{input('phone', '021-111-000-000')}</Field>
          <Field label="Mobile / WhatsApp">{input('mobile', '0300 0000000')}</Field>
          <Field label="Email">{input('email', 'info@insectkiller.pk')}</Field>
          <Field label="Website">{input('website', 'www.insectkiller.pk')}</Field>
          <Field label="Document colour" hint="Company name, headings, tables and totals">{color('brandColor', DEFAULT_BRAND_COLOR)}</Field>
          <Field label="Accent colour" hint="Section labels, card edges and highlights">{color('accentColor', DEFAULT_ACCENT_COLOR)}</Field>
        </div>
      </div>

      {/* Service areas */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div>
            <div className="card-title">Service areas</div>
            <div className="cell-sub">Cities and hubs where we provide services. Printed in the footer of every PDF, followed by "& nearby cities".</div>
          </div>
          {isSuperAdmin && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => set('serviceAreas', [...serviceAreas, ''])}>
              <Plus size={14} /> Add area
            </button>
          )}
        </div>

        {serviceAreas.length === 0 ? (
          <div className="cell-sub" style={{ padding: '0.75rem 0' }}>No service areas added, so none will be printed.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
            {serviceAreas.map((area, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <input
                  className="form-input"
                  placeholder="e.g. Faisalabad Hub"
                  value={area}
                  onChange={(e) => set('serviceAreas', serviceAreas.map((a, i) => (i === idx ? e.target.value : a)))}
                  disabled={!isSuperAdmin}
                />
                {isSuperAdmin && (
                  <button type="button" className="icon-btn" onClick={() => set('serviceAreas', serviceAreas.filter((_, i) => i !== idx))} title="Remove area">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
          <FileText size={20} color="var(--ikpm-navy-700)" />
          <div className="card-title">Tax & licences</div>
        </div>
        <div className="form-grid-2">
          <Field label="NTN">{input('ntn', '1234567-8')}</Field>
          <Field label="STRN (FBR)">{input('strn', '17-00-0000-000-00')}</Field>
          <Field label="Provincial sales tax registration" hint="e.g. SRB: S1234567 · PRA: P7654321">{input('provincialTaxNo')}</Field>
          <Field label="PCO / pesticide licence no." hint="Agriculture Department licence shown on service reports">{input('pcoLicense')}</Field>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
          <Landmark size={20} color="var(--ikpm-navy-700)" />
          <div className="card-title">Tax account — bank details</div>
          <span className="cell-sub" style={{ marginLeft: 'auto' }}>Shown on Sales Tax Invoices</span>
        </div>
        <div className="form-grid-2">
          <Field label="Account title">{input('bankAccountTitle', 'Insect Killer Pest Management')}</Field>
          <Field label="Bank">{input('bankName', 'Meezan Bank')}</Field>
          <Field label="Branch">{input('bankBranch', 'Shahrah-e-Faisal, Karachi')}</Field>
          <Field label="Account number">{input('bankAccountNo')}</Field>
          <Field label="IBAN" span>{input('bankIban', 'PK00 XXXX 0000 0000 0000 0000')}</Field>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
          <Landmark size={20} color="var(--ikpm-amber-600, #D97706)" />
          <div className="card-title">Cash account — Cash Memos</div>
          <span className="cell-sub" style={{ marginLeft: 'auto' }}>No-tax billing, mostly residential</span>
        </div>
        <div className="info-hint" style={{ marginBottom: '0.9rem' }}>
          Cash memos print no NTN / STRN and no tax lines. If the company is registered for sales tax, confirm with your tax
          accountant that this account may bill without tax (often it is a separate, unregistered business name).
          Leave the bank fields empty to print “Payable in cash” instead.
        </div>
        <div className="form-grid-2">
          <Field label="Business name on cash memos" hint="Empty = the company name">{cashInput('tradeName', form.legalName)}</Field>
          <Field label="Account title">{cashInput('bankAccountTitle')}</Field>
          <Field label="Bank">{cashInput('bankName')}</Field>
          <Field label="Branch">{cashInput('bankBranch')}</Field>
          <Field label="Account number">{cashInput('bankAccountNo')}</Field>
          <Field label="IBAN">{cashInput('bankIban', 'PK00 XXXX 0000 0000 0000 0000')}</Field>
          <Field label="Note printed on cash memos" span>{cashInput('notes', 'e.g. Cash received by our Supervisor against a signed slip.')}</Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: '1rem' }}>Default wording</div>
        <Field label="Proposal terms & conditions" hint="One term per line. Payment, validity and warranty lines are added automatically from each proposal.">
          <textarea className="form-textarea" rows={6} value={form.proposalTerms || ''} onChange={(e) => set('proposalTerms', e.target.value)} disabled={!isSuperAdmin} />
        </Field>
        {isSuperAdmin && (
          <button className="btn btn-sm btn-ghost" style={{ marginTop: '-0.5rem', marginBottom: '0.75rem' }} onClick={() => set('proposalTerms', DEFAULT_PROPOSAL_TERMS)}>
            <RotateCcw size={13} /> Restore default terms
          </button>
        )}
        <Field label="Invoice payment note">
          <textarea className="form-textarea" rows={3} value={form.invoiceNotes || ''} onChange={(e) => set('invoiceNotes', e.target.value)} disabled={!isSuperAdmin} />
        </Field>
        {isSuperAdmin && (
          <button className="btn btn-sm btn-ghost" style={{ marginTop: '-0.5rem' }} onClick={() => set('invoiceNotes', DEFAULT_INVOICE_NOTES)}>
            <RotateCcw size={13} /> Restore default note
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: '0.35rem' }}>Proposal presentation</div>
        <div className="form-hint" style={{ marginBottom: '1rem' }}>Printed on every proposal / quotation to build trust. Only list clients who have agreed to be named.</div>
        <Field label="Our valued clients (logos)" hint="Shown as a logo strip near the end of proposals. Up to 12 logos are printed.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.6rem' }}>
            {(form.clientLogos ?? []).map((c, i) => (
              <div key={`${c.url}_${i}`} style={{ width: 110, border: '1px solid var(--border-subtle)', borderRadius: 6, padding: 6, textAlign: 'center', background: '#fff' }}>
                <img src={c.url} alt={c.name} style={{ maxWidth: '100%', height: 40, objectFit: 'contain' }} />
                <div className="cell-sub" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                {isSuperAdmin && (
                  <button className="btn btn-ghost btn-sm" style={{ padding: '0 4px' }} onClick={() => set('clientLogos', (form.clientLogos ?? []).filter((_, j) => j !== i))}>
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </div>
            ))}
            {!(form.clientLogos ?? []).length && <span className="cell-sub">No client logos yet.</span>}
          </div>
          {isSuperAdmin && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="form-input" style={{ maxWidth: 240 }} value={clientLogoName} onChange={(e) => setClientLogoName(e.target.value)} placeholder="Client name, e.g. Dunkin' Pakistan" />
              <button className="btn btn-secondary btn-sm" onClick={() => clientLogoInput.current?.click()} disabled={uploadingClientLogo || !integrations.cloudinary || !clientLogoName.trim()}>
                <ImagePlus size={14} /> {uploadingClientLogo ? 'Uploading…' : 'Add logo'}
              </button>
              <input ref={clientLogoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadClientLogo(e.target.files?.[0])} />
            </div>
          )}
        </Field>
        <Field label="Why choose us (one point per line)" hint="Printed as a short box on proposals. Leave empty to skip. Write only what is true for your company.">
          <textarea
            className="form-textarea"
            rows={4}
            value={form.proposalHighlights || ''}
            onChange={(e) => set('proposalHighlights', e.target.value)}
            placeholder={'Licensed and trained PCOs\nApproved chemicals with MSDS provided\nSigned service report after every visit\nSame-day complaint response'}
            disabled={!isSuperAdmin}
          />
        </Field>
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: '1rem' }}>Workflow rules</div>
        <Field label="Complaint escalation (hours)" hint="If a complaint is still open after this many hours, the CEO (Super Admin) is alerted. Default 48.">
          <input
            type="number"
            min={1}
            className="form-input"
            style={{ maxWidth: 160 }}
            value={form.complaintEscalationHours ?? ''}
            placeholder="48"
            onChange={(e) => set('complaintEscalationHours', e.target.value ? Number(e.target.value) : undefined)}
            disabled={!isSuperAdmin}
          />
        </Field>
      </div>

      <div className="sticky-actions">
        <button className="btn btn-secondary" onClick={preview}>
          <Eye size={15} /> Preview letterhead
        </button>
        {isSuperAdmin && (
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
            <Save size={15} /> {saving ? 'Saving…' : dirty ? 'Save company profile' : 'Saved'}
          </button>
        )}
      </div>
    </div>
  );
};
