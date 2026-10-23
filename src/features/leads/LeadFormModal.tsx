import React, { useEffect, useState } from 'react';
import { Plus, Star, Trash2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { dataService } from '../../services/dataService';
import { blankLeadBranch, contactsOf, INDUSTRIES, SOURCES, syncLeadFields } from '../../lib/leadWorkflow';
import { normalizePakistaniPhone } from '../../lib/formatters';
import type { Lead, LeadBranch, LeadContact, LeadSource } from '../../types/crm';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Edit an existing lead; omit to create a new one. */
  lead?: Lead | null;
  onSaved?: (lead: Lead) => void;
}

const CITIES = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Hyderabad', 'Quetta', 'Sialkot'];

const DESIGNATIONS = ['Owner / CEO', 'General Manager', 'Operations Manager', 'Admin Manager', 'Facility Manager', 'Procurement / Purchase', 'CMO / Marketing', 'HR Manager', 'Accounts', 'Site Supervisor'];

const blankContact = (primary: boolean): LeadContact => ({
  id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
  name: '',
  designation: '',
  phone: '',
  email: '',
  isPrimary: primary,
});

interface FormState {
  customerType: 'company' | 'individual';
  clientType: 'residential' | 'b2b';
  companyName: string;
  industry: string;
  source: LeadSource;
  city: string;
  area: string;
  propertyAddress: string;
  headquarterAddress: string;
  companyPhone: string;
  companyEmail: string;
  website: string;
  notes: string;
  contacts: LeadContact[];
  branches: LeadBranch[];
}

const fromLead = (lead?: Lead | null): FormState => ({
  customerType: lead?.customerType || 'company',
  clientType: lead?.clientType || 'b2b',
  companyName: lead?.companyName || lead?.title || '',
  industry: lead?.industry || '',
  source: lead?.source || 'inbound_phone',
  city: lead?.city || 'Karachi',
  area: lead?.area || '',
  propertyAddress: lead?.propertyAddress || '',
  headquarterAddress: lead?.headquarterAddress || lead?.propertyAddress || '',
  companyPhone: lead?.companyPhone || '',
  companyEmail: lead?.companyEmail || '',
  website: lead?.website || '',
  notes: lead?.notes || '',
  contacts: lead ? contactsOf(lead).map((c) => ({ ...c })) : [blankContact(true)],
  branches: lead?.branches?.length ? lead.branches.map((b) => ({ ...b })) : [],
});

const validEmail = (e?: string) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPhone = (p: string) => normalizePakistaniPhone(p).replace(/\D/g, '').length >= 10;

export const LeadFormModal: React.FC<Props> = ({ isOpen, onClose, lead, onSaved }) => {
  const { success, warning } = useNotification();
  const { userProfile } = useAuth();
  const [form, setForm] = useState<FormState>(fromLead(lead));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm(fromLead(lead));
      setTouched(false);
    }
  }, [isOpen, lead]);

  const isCompany = form.customerType === 'company';
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setContact = (id: string, patch: Partial<LeadContact>) =>
    setForm((f) => ({ ...f, contacts: f.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const makePrimary = (id: string) => setForm((f) => ({ ...f, contacts: f.contacts.map((c) => ({ ...c, isPrimary: c.id === id })) }));
  const removeContact = (id: string) =>
    setForm((f) => {
      const rest = f.contacts.filter((c) => c.id !== id);
      if (rest.length && !rest.some((c) => c.isPrimary)) rest[0] = { ...rest[0], isPrimary: true };
      return { ...f, contacts: rest };
    });
  const setBranch = (id: string, patch: Partial<LeadBranch>) =>
    setForm((f) => ({ ...f, branches: f.branches.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  const removeBranch = (id: string) =>
    setForm((f) => ({ ...f, branches: f.branches.filter((b) => b.id !== id) }));

  const primary = form.contacts.find((c) => c.isPrimary) ?? form.contacts[0];
  const problems: string[] = [];
  if (!form.companyName.trim()) problems.push(isCompany ? 'Enter the company name.' : 'Enter the client\u2019s name.');
  if (!form.city.trim()) problems.push('Enter the city.');
  if (!primary?.name.trim()) problems.push('The primary contact needs a name.');
  if (!primary?.phone.trim()) problems.push('The primary contact needs a phone number.');
  else if (!validPhone(primary.phone)) problems.push('The primary contact\u2019s phone number looks incomplete.');
  form.contacts.forEach((c, i) => {
    if (!c.isPrimary && (c.name || c.phone) && c.phone && !validPhone(c.phone)) problems.push(`Contact ${i + 1}: phone number looks incomplete.`);
    if (!validEmail(c.email)) problems.push(`Contact ${i + 1}: email is not valid.`);
  });
  if (!validEmail(form.companyEmail)) problems.push('Company email is not valid.');

  const handleSave = () => {
    setTouched(true);
    if (problems.length) return;
    const contacts = form.contacts.filter((c) => c.name.trim() || c.phone.trim()).map((c) => ({
      ...c,
      name: c.name.trim(),
      phone: c.phone.trim(),
      email: c.email?.trim() || undefined,
      designation: c.designation?.trim() || undefined,
    }));
    const branches = form.branches.filter((b) => b.name.trim() || b.address.trim()).map((b) => ({
      ...b,
      name: b.name.trim(),
      address: b.address.trim(),
      city: b.city?.trim() || undefined,
      contactName: b.contactName?.trim() || undefined,
      contactPhone: b.contactPhone?.trim() || undefined,
    }));
    const fields = {
      customerType: form.customerType,
      clientType: form.customerType === 'individual' ? form.clientType : 'b2b' as const,
      companyName: isCompany ? form.companyName.trim() : undefined,
      title: form.companyName.trim(),
      industry: form.industry || undefined,
      source: form.source,
      city: form.city.trim(),
      area: form.area.trim(),
      propertyAddress: form.propertyAddress.trim(),
      headquarterAddress: form.headquarterAddress.trim() || undefined,
      companyPhone: form.companyPhone.trim() || undefined,
      companyEmail: form.companyEmail.trim() || undefined,
      website: form.website.trim() || undefined,
      notes: form.notes.trim() || undefined,
      contacts,
      branches: branches.length ? branches : undefined,
    };

    const dups = dataService.findLeadDuplicates(primary.phone, primary.email, lead?.id);
    let saved: Lead;
    if (lead) {
      saved = dataService.saveLead(syncLeadFields({ ...lead, ...fields } as Lead), userProfile?.email);
      success('Lead updated', saved.title);
    } else {
      saved = dataService.createLead({ ...fields, stage: 'new', pestIssues: [], contactName: '', phone: '' } as unknown as Lead, userProfile?.email);
      success('Lead added', `${saved.title} (${saved.id}) is in New inquiries.`);
    }
    if (dups.length) warning('Possible duplicate', dups[0]);
    onSaved?.(saved);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={lead ? `Edit ${lead.title}` : 'New lead'}
      subtitle="Company details and who to contact. Pricing comes later, after the meeting / inspection."
      maxWidth="820px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={touched && problems.length > 0}>
            {lead ? 'Save changes' : 'Add lead'}
          </button>
        </>
      }
    >
      <div className="chip-row">
        <button type="button" className={`chip ${isCompany ? 'chip-on' : ''}`} onClick={() => set('customerType', 'company')}>Company / organisation</button>
        <button type="button" className={`chip ${!isCompany ? 'chip-on' : ''}`} onClick={() => set('customerType', 'individual')}>Individual / household</button>
      </div>
      {!isCompany && (
        <div className="chip-row" style={{ marginTop: '0.4rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', alignSelf: 'center', marginRight: 4 }}>Client type:</span>
          <button type="button" className={`chip ${form.clientType === 'b2b' ? 'chip-on' : ''}`} onClick={() => set('clientType', 'b2b')}>B2B / commercial</button>
          <button type="button" className={`chip ${form.clientType === 'residential' ? 'chip-on' : ''}`} onClick={() => set('clientType', 'residential')}>Residential</button>
        </div>
      )}

      <div className="section-title" style={{ marginTop: 0 }}>{isCompany ? 'Company details' : 'Client details'}</div>
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">{isCompany ? 'Company name' : 'Client name'} <span className="required">*</span></label>
          <input className="form-input" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder={isCompany ? 'e.g. Shan Foods (Pvt) Ltd' : 'e.g. Ahmed Raza'} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Industry</label>
          <select className="form-select" value={form.industry} onChange={(e) => set('industry', e.target.value)}>
            <option value="">Select…</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">City <span className="required">*</span></label>
          <input className="form-input" list="lead-cities" value={form.city} onChange={(e) => set('city', e.target.value)} />
          <datalist id="lead-cities">{CITIES.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="form-group">
          <label className="form-label">Area</label>
          <input className="form-input" value={form.area} onChange={(e) => set('area', e.target.value)} placeholder="e.g. Korangi Industrial Area" />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Address</label>
          <input className="form-input" value={form.propertyAddress} onChange={(e) => set('propertyAddress', e.target.value)} placeholder="Plot / building, street" />
        </div>
        {isCompany && (
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Head office address</label>
            <input className="form-input" value={form.headquarterAddress} onChange={(e) => set('headquarterAddress', e.target.value)} placeholder="Full head-office address (if different from above)" />
          </div>
        )}
        {isCompany && (
          <>
            <div className="form-group">
              <label className="form-label">Company phone</label>
              <input className="form-input" value={form.companyPhone} onChange={(e) => set('companyPhone', e.target.value)} placeholder="021-3xxxxxxx" />
            </div>
            <div className="form-group">
              <label className="form-label">Company email</label>
              <input className="form-input" type="email" value={form.companyEmail} onChange={(e) => set('companyEmail', e.target.value)} placeholder="info@company.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Website</label>
              <input className="form-input" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="company.com" />
            </div>
          </>
        )}
        <div className="form-group">
          <label className="form-label">How did they find us?</label>
          <select className="form-select" value={form.source} onChange={(e) => set('source', e.target.value as LeadSource)}>
            {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0.5rem 0 0.6rem' }}>
        <div className="section-title" style={{ margin: 0 }}>Contacts</div>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => set('contacts', [...form.contacts, blankContact(form.contacts.length === 0)])}>
          <Plus size={14} /> Add contact
        </button>
      </div>
      <div className="form-hint" style={{ marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
        One contact is required. Add others (e.g. Operations Manager, CMO) if you have them. The ★ contact is called first and receives proposals.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {form.contacts.map((c, i) => (
          <div key={c.id} className="contact-card" style={{ borderColor: c.isPrimary ? 'var(--ikpm-emerald-500)' : undefined }}>
            <div className="contact-card-head">
              <button type="button" className={`chip ${c.isPrimary ? 'chip-on' : ''}`} onClick={() => makePrimary(c.id)} title="Make this the primary contact">
                <Star size={13} fill={c.isPrimary ? 'currentColor' : 'none'} /> {c.isPrimary ? 'Primary contact (required)' : `Contact ${i + 1} (optional)`}
              </button>
              {form.contacts.length > 1 && (
                <button type="button" className="icon-btn danger" onClick={() => removeContact(c.id)} title="Remove contact"><Trash2 size={15} /></button>
              )}
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Name {c.isPrimary && <span className="required">*</span>}</label>
                <input className="form-input" value={c.name} onChange={(e) => setContact(c.id, { name: e.target.value })} placeholder="e.g. Tariq Mehmood" />
              </div>
              <div className="form-group">
                <label className="form-label">Designation</label>
                <input className="form-input" list="lead-designations" value={c.designation || ''} onChange={(e) => setContact(c.id, { designation: e.target.value })} placeholder="e.g. Operations Manager" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Mobile / phone {c.isPrimary && <span className="required">*</span>}</label>
                <input className="form-input" value={c.phone} onChange={(e) => setContact(c.id, { phone: e.target.value })} placeholder="03XX XXXXXXX" inputMode="tel" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={c.email || ''} onChange={(e) => setContact(c.id, { email: e.target.value })} placeholder="name@company.com" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <datalist id="lead-designations">{DESIGNATIONS.map((d) => <option key={d} value={d} />)}</datalist>

      {isCompany && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '1rem 0 0.6rem' }}>
            <div className="section-title" style={{ margin: 0 }}>Branches</div>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => set('branches', [...form.branches, blankLeadBranch()])}>
              <Plus size={14} /> Add branch
            </button>
          </div>
          <div className="form-hint" style={{ marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
            Optional. Add branches or sites that need service. More can be added after the meeting.
          </div>
          {form.branches.map((br, i) => (
            <div key={br.id} className="contact-card" style={{ marginBottom: '0.5rem' }}>
              <div className="contact-card-head">
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Branch {i + 1}</span>
                <button type="button" className="icon-btn danger" onClick={() => removeBranch(br.id)} title="Remove branch"><Trash2 size={15} /></button>
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Branch name</label>
                  <input className="form-input" value={br.name} onChange={(e) => setBranch(br.id, { name: e.target.value })} placeholder="e.g. Johar Town branch" />
                </div>
                <div className="form-group">
                  <label className="form-label">City</label>
                  <input className="form-input" list="lead-cities" value={br.city || ''} onChange={(e) => setBranch(br.id, { city: e.target.value })} />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Address</label>
                  <input className="form-input" value={br.address} onChange={(e) => setBranch(br.id, { address: e.target.value })} placeholder="Full branch address" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Contact person</label>
                  <input className="form-input" value={br.contactName || ''} onChange={(e) => setBranch(br.id, { contactName: e.target.value })} placeholder="Branch manager name" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Contact phone</label>
                  <input className="form-input" value={br.contactPhone || ''} onChange={(e) => setBranch(br.id, { contactPhone: e.target.value })} placeholder="03XX XXXXXXX" inputMode="tel" />
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="form-group" style={{ marginTop: '1rem', marginBottom: 0 }}>
        <label className="form-label">Notes</label>
        <textarea className="form-textarea" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="What they asked about, pests mentioned, best time to call…" />
      </div>

      {touched && problems.length > 0 && <ul className="form-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </Modal>
  );
};
