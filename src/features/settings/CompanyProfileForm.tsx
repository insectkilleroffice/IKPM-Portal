import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Building2, Eye, ImagePlus, Landmark, FileText, RotateCcw, Save } from 'lucide-react';
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
  const [uploading, setUploading] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

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
    setUploading(true);
    try {
      const stored = await uploadFile(file, { folder: 'branding', fileName: `logo_${Date.now()}.${file.type.split('/')[1]}` });
      set('logoUrl', stored.url);
      pdfGenerator.clearImageCache();
    } catch (err) {
      error('Logo upload failed', err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (logoInput.current) logoInput.current.value = '';
    }
  };

  // Preview what is on screen, even before saving
  const preview = () =>
    pdfGenerator.previewLetterhead({ ...form }).catch((err) => error('Preview failed', err instanceof Error ? err.message : String(err)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {!isSuperAdmin && <div className="info-hint">Only the super admin can change these details.</div>}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
          <Building2 size={20} color="var(--ikpm-navy-700)" />
          <div className="card-title">Letterhead</div>
          <span className="cell-sub" style={{ marginLeft: 'auto' }}>Printed on proposals, invoices, receipts and reports</span>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div className="logo-preview">
            <img src={form.logoUrl || '/ik_logo.svg'} alt="Company logo" />
          </div>
          {isSuperAdmin && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={() => logoInput.current?.click()} disabled={uploading || !integrations.cloudinary}>
                <ImagePlus size={15} /> {uploading ? 'Uploading…' : 'Upload logo'}
              </button>
              {form.logoUrl && (
                <button className="btn btn-ghost" onClick={() => set('logoUrl', '')}>
                  <RotateCcw size={15} /> Use built-in logo
                </button>
              )}
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </div>
          )}
        </div>

        <div className="form-grid-2">
          <Field label="Legal company name *">{input('legalName', 'Insect Killer Pest Management')}</Field>
          <Field label="Short name">{input('shortName', 'IKPM')}</Field>
          <Field label="Tagline" span>{input('tagline', 'Integrated Pest Management & Fumigation Services')}</Field>
          <Field label="Address">{input('address', 'Office 12, Main Boulevard')}</Field>
          <Field label="City / country">{input('city', 'Karachi, Pakistan')}</Field>
          <Field label="Phone / UAN">{input('phone', '021-111-000-000')}</Field>
          <Field label="Mobile / WhatsApp">{input('mobile', '0300 0000000')}</Field>
          <Field label="Email">{input('email', 'info@insectkiller.pk')}</Field>
          <Field label="Website">{input('website', 'www.insectkiller.pk')}</Field>
          <Field label="Document colour" hint="Company name, headings, tables and totals">{color('brandColor', DEFAULT_BRAND_COLOR)}</Field>
          <Field label="Accent colour" hint="Section labels, card edges and highlights">{color('accentColor', DEFAULT_ACCENT_COLOR)}</Field>
        </div>
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
          <div className="card-title">Bank details & signatory</div>
          <span className="cell-sub" style={{ marginLeft: 'auto' }}>Shown on invoices</span>
        </div>
        <div className="form-grid-2">
          <Field label="Account title">{input('bankAccountTitle', 'Insect Killer Pest Management')}</Field>
          <Field label="Bank">{input('bankName', 'Meezan Bank')}</Field>
          <Field label="Branch">{input('bankBranch', 'Shahrah-e-Faisal, Karachi')}</Field>
          <Field label="Account number">{input('bankAccountNo')}</Field>
          <Field label="IBAN" span>{input('bankIban', 'PK00 XXXX 0000 0000 0000 0000')}</Field>
          <Field label="Authorised signatory name">{input('signatoryName', 'e.g. Salman Ahmed')}</Field>
          <Field label="Signatory title">{input('signatoryTitle', 'Chief Executive')}</Field>
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
