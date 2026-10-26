import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { dataService } from '../../services/dataService';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { formatDate, formatPKR, generatePermanentId } from '../../lib/formatters';
import { CHEMICAL_PRESETS } from '../../lib/workflow';
import { jurisdictionFor, taxRateFor } from '../../lib/taxRates';
import {
  DEFAULT_EXCLUSIONS,
  defaultTenureStart,
  DOCUMENTATION_OPTIONS,
  planFromPreset,
  planPricing,
  SERVICE_PLAN_PRESETS,
  tenureEnd,
  type ScopeSection,
  type ServicePlanItem,
  type ServicePlanPreset,
} from '../../lib/proposalPlan';
import { documentTemplates } from '../../services/documentTemplates';
import type { Proposal, ProposalBranchBreakdown, ProposalLineItem, TemplateType } from '../../types/proposal';
import type { PestType } from '../../types/crm';
import type { TaxJurisdiction } from '../../types/finance';
import { contactsOf } from '../../lib/leadWorkflow';
import { recommendedTreatmentOf } from '../../lib/riskAssessment';
import { ServicePlanEditor } from './ServicePlanEditor';
import { fileProposalPdf } from './proposalFiles';

export interface ProposalPrefill {
  fromLead?: string;
  customerType?: 'company' | 'individual';
  customerId?: string;
  city?: string;
  address?: string;
  pests?: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  prefill?: ProposalPrefill;
  onCreated?: (p: Proposal) => void;
}

const pestLabel = (p: string) => p.replace(/_/g, ' ');

const SERVICE_OPTIONS = [
  { value: 'general_fumigation', label: 'General fumigation' },
  { value: 'cockroach_gel', label: 'Cockroach gel treatment' },
  { value: 'rodent_control', label: 'Rodent control (bait stations)' },
  { value: 'termite_treatment', label: 'Termite treatment' },
  { value: 'bedbug_treatment', label: 'Bedbug treatment' },
  { value: 'mosquito_fogging', label: 'Mosquito / fly fogging' },
  { value: 'ant_treatment', label: 'Ant treatment' },
  { value: 'stored_grain_pest', label: 'Stored grain pest control' },
  { value: 'snake_reptile', label: 'Snake / reptile control' },
  { value: 'monitoring_visit', label: 'Monitoring visit' },
  { value: 'other', label: 'Other (specify)' },
];

const JURISDICTIONS: TaxJurisdiction[] = ['sindh_srb', 'punjab_pra', 'islamabad_ict', 'kpk_kpra', 'balochistan_bra'];

function oneTimeLines(pests: string[]): ProposalLineItem[] {
  const items = pests
    .map((pst, i) => {
      const preset = CHEMICAL_PRESETS[pst];
      if (!preset) return null;
      return {
        id: `li_${Date.now()}_${i}`,
        serviceName: `${pestLabel(pst)} treatment`,
        targetPest: pst as PestType,
        chemicalsSuggested: `${preset.chemicalName} (${preset.activeIngredient})`,
        treatmentMethod: preset.applicationMethod.replace(/_/g, ' '),
        quantity: 1,
        unitPrice: 0,
        totalPrice: 0,
        frequency: 'One-time',
      } as ProposalLineItem;
    })
    .filter(Boolean) as ProposalLineItem[];
  return items.length ? items : [{ id: 'li_1', serviceName: '', targetPest: 'cockroaches', chemicalsSuggested: '', treatmentMethod: '', quantity: 1, unitPrice: 0, totalPrice: 0, frequency: 'One-time' }];
}

/** New proposal: a monthly IPM service plan (quotation format) or a one-time treatment. */
export const ProposalBuilderModal: React.FC<Props> = ({ isOpen, onClose, prefill = {}, onCreated }) => {
  const { userProfile } = useAuth();
  const { success, warning, error } = useNotification();
  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const lead = prefill.fromLead ? dataService.getLeadById(prefill.fromLead) : undefined;
  const inspection = lead?.inspection?.status === 'completed' ? lead.inspection : undefined;
  const pests = prefill.pests?.length ? prefill.pests : inspection?.pestTypesFound ?? lead?.pestIssues ?? [];

  const [customerType, setCustomerType] = useState<'company' | 'individual'>(prefill.customerType ?? 'company');
  const [customerId, setCustomerId] = useState(prefill.customerId ?? (customerType === 'company' ? companies[0]?.id : clients[0]?.id) ?? '');
  const [branchId, setBranchId] = useState('');
  const [mode, setMode] = useState<'plan' | 'one_time'>('plan');

  const company = customerType === 'company' ? dataService.getCompanyById(customerId) : undefined;
  const client = customerType === 'individual' ? dataService.getClientById(customerId) : undefined;
  const branches = company ? dataService.getBranches().filter((b) => b.companyId === company.id) : [];
  const branch = branchId ? dataService.getBranchById(branchId) : undefined;

  // Who the letter is addressed to: the lead's primary contact, else the branch manager / company contact
  const leadContact = lead ? contactsOf(lead).find((c) => c.isPrimary) ?? contactsOf(lead)[0] : undefined;
  const addressedTo = (type: 'company' | 'individual', id: string, brId: string) => {
    const co = type === 'company' ? dataService.getCompanyById(id) : undefined;
    const cl = type === 'individual' ? dataService.getClientById(id) : undefined;
    const br = brId ? dataService.getBranchById(brId) : undefined;
    const attention = br
      ? { name: br.branchManagerName, designation: 'Branch Manager', email: br.branchEmail || undefined, phone: br.branchManagerPhone || br.branchPhone || undefined }
      : leadContact && id === prefill.customerId
        ? { name: leadContact.name, designation: leadContact.designation || '', email: leadContact.email || undefined, phone: leadContact.phone || undefined }
        : co
          ? { name: co.primaryContact.fullName, designation: co.primaryContact.designation || '', email: co.primaryContact.email || undefined, phone: co.primaryContact.mobile || undefined }
          : { name: cl?.fullName || '', designation: '', email: cl?.email || undefined, phone: cl?.primaryPhone || undefined };
    const address = br?.physicalAddress || (id === prefill.customerId ? prefill.address || lead?.propertyAddress : '') || co?.headOfficeAddress || cl?.residentialAddress || '';
    return { attention, address };
  };
  const [attention, setAttention] = useState(() => addressedTo(customerType, customerId, '').attention);
  const [clientAddress, setClientAddress] = useState(() => addressedTo(customerType, customerId, '').address);

  // Plan
  const initialPreset: ServicePlanPreset = lead?.industry && /factory|manufactur|warehouse/i.test(lead.industry) ? 'factory' : lead?.industry && /food|restaurant|hotel/i.test(lead.industry) ? 'commercial_kitchen' : 'commercial_kitchen';
  const [preset, setPreset] = useState<ServicePlanPreset>(initialPreset);
  const [plan, setPlan] = useState<ServicePlanItem[]>(() => planFromPreset(initialPreset));
  const [visits, setVisits] = useState(SERVICE_PLAN_PRESETS[initialPreset].serviceVisitsPerMonth);
  const [followUps, setFollowUps] = useState(SERVICE_PLAN_PRESETS[initialPreset].followUpVisitsPerMonth);
  const [documentation, setDocumentation] = useState<string[]>(DOCUMENTATION_OPTIONS.slice(0, 3));
  const [docToAdd, setDocToAdd] = useState(DOCUMENTATION_OPTIONS[0]);

  // Charges & tenure
  const place = branch ?? company ?? client ?? (lead ? { city: lead.city } : undefined);
  const [jurisdiction, setJurisdiction] = useState<TaxJurisdiction | 'exempt'>(() => jurisdictionFor(place));

  const rules = dataService.getTaxRules();
  const derivedTaxRate = jurisdiction === 'exempt' ? 0 : taxRateFor(rules, jurisdiction).percent;
  const [taxPct, setTaxPct] = useState<number>(() => derivedTaxRate);
  const tax = { percent: taxPct };
  const [monthlyRate, setMonthlyRate] = useState<number>(0);
  const [branchBreakdowns, setBranchBreakdowns] = useState<ProposalBranchBreakdown[]>([]);
  const [taxMode, setTaxMode] = useState<'exclusive' | 'inclusive'>('exclusive');
  const [tenureMonths, setTenureMonths] = useState(12);
  const [tenureStart, _setTenureStart] = useState(defaultTenureStart());
  const [paymentTermsDays, setPaymentTermsDays] = useState(15);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [exclusions, setExclusions] = useState(DEFAULT_EXCLUSIONS);
  const [deviceOwnership, setDeviceOwnership] = useState(() => documentTemplates.get().deviceOwnership);

  // Wording
  const templates = documentTemplates.get();
  // Carried over from the risk assessment: pests, area and the recommended treatment
  const recommended = inspection ? recommendedTreatmentOf(inspection) : '';
  const findingsText = inspection
    ? `During our inspection on ${formatDate(inspection.completedDate || inspection.scheduledDate)} we found ${inspection.pestTypesFound.map(pestLabel).join(', ') || 'pest activity'} (${inspection.infestationSeverity} level${inspection.areaSqFt ? `, about ${inspection.areaSqFt.toLocaleString()} sq ft` : ''})${inspection.findings?.length ? ` and ${inspection.findings.length} risk point${inspection.findings.length > 1 ? 's' : ''}, detailed in the attached risk assessment report` : ''}.${recommended ? ` Recommended: ${recommended}` : ''}`
    : '';
  // {{placeholders}} stay in the text and are filled when the PDF is generated
  const [coverLetter, setCoverLetter] = useState(() => [templates.coverLetter, findingsText].filter(Boolean).join('\n\n'));
  const [scopeSections, setScopeSections] = useState<ScopeSection[]>(() => templates.scopeSections.map((s) => ({ ...s })));
  const [termsText, setTermsText] = useState(() => templates.terms.join('\n'));
  const [showWording, setShowWording] = useState(false);

  // One-time
  const [templateType, setTemplateType] = useState<TemplateType>(pests.includes('termites') ? 'termite_proofing' : pests.includes('bedbugs') ? 'bedbug_eradication' : 'general_ipm');
  const [lineItems, setLineItems] = useState<ProposalLineItem[]>(() => oneTimeLines(pests));
  const [scopeOfWork, setScopeOfWork] = useState(
    [`Pest management service at ${prefill.address || lead?.propertyAddress || ''}${prefill.city ? `, ${prefill.city}` : ''}.`, pests.length ? `Target pests: ${pests.map(pestLabel).join(', ')}.` : '', inspection?.areaSqFt ? `Area: about ${inspection.areaSqFt.toLocaleString()} sq ft.` : '', recommended].filter(Boolean).join(' ')
  );

  // When branch breakdown is used, the total from branches drives pricing (not the manual monthlyRate field)
  const branchTotal = branchBreakdowns.reduce((s, b) => s + b.monthlyAmount, 0);
  const effectiveRate = branchBreakdowns.length > 0 ? branchTotal : monthlyRate;
  const pricing = planPricing({ monthlyRate: effectiveRate, taxMode, taxPercent: tax.percent, tenureMonths, discountPercent });
  const oneTimeSubtotal = mode === 'one_time' && branchBreakdowns.length > 0
    ? branchTotal
    : lineItems.reduce((a, li) => a + li.totalPrice, 0);
  const oneTimeDiscount = (oneTimeSubtotal * discountPercent) / 100;
  const oneTimeTax = ((oneTimeSubtotal - oneTimeDiscount) * tax.percent) / 100;
  const end = tenureEnd(tenureStart, tenureMonths);

  const problems: string[] = [];
  if (!customerId) problems.push('Choose the client.');
  if (mode === 'plan') {
    if (!plan.some((r) => r.service.trim())) problems.push('Add at least one row to the service plan.');
    if (!(effectiveRate > 0)) problems.push('Enter the monthly charges (or add branch breakdown with amounts).');
    if (!(tenureMonths >= 1)) problems.push('Tenure must be at least one month.');
  } else {
    const otValid = branchBreakdowns.length > 0 ? branchTotal > 0 : lineItems.some((li) => li.serviceName.trim() && li.totalPrice > 0);
    if (!otValid) problems.push('Add at least one priced service (or site with an amount).');
  }

  const changeCustomer = (type: 'company' | 'individual', id: string, brId = '') => {
    setCustomerType(type);
    setCustomerId(id);
    setBranchId(brId);
    const next = addressedTo(type, id, brId);
    setAttention(next.attention);
    setClientAddress(next.address);
    const br = brId ? dataService.getBranchById(brId) : undefined;
    const jur = jurisdictionFor(br ?? (type === 'company' ? dataService.getCompanyById(id) : dataService.getClientById(id)));
    setJurisdiction(jur);
    setTaxPct(jur === 'exempt' ? 0 : taxRateFor(rules, jur).percent);
  };

  const create = () => {
    if (problems.length) return;
    // Guard: warn if an active proposal already exists for this lead
    if (prefill.fromLead) {
      const DEAD = ['rejected', 'declined', 'expired'];
      const live = dataService.getProposals().find(
        (p) => p.leadId === prefill.fromLead && !DEAD.includes(p.status)
      );
      if (live) {
        warning(
          'Proposal already exists',
          `${live.id} (${live.status.replace(/_/g, ' ')}) is already linked to this lead. Use "Revise" on that proposal instead of creating a new one.`
        );
        return;
      }
    }
    const now = new Date().toISOString();
    const customerName = company?.legalCompanyName || client?.fullName || lead?.companyName || lead?.title || 'Client';
    const id = generatePermanentId('P', dataService.getProposals().length + 1);
    const isPlan = mode === 'plan';
    const subtotal = isPlan ? pricing.subtotal : oneTimeSubtotal;
    const discountAmount = isPlan ? pricing.discountAmount : oneTimeDiscount;
    const taxAmount = isPlan ? pricing.taxAmount : oneTimeTax;
    const totalAmount = isPlan ? pricing.totalAmount : oneTimeSubtotal - oneTimeDiscount + oneTimeTax;
    const cleanPlan = plan.filter((r) => r.service.trim());

    const proposal: Proposal = {
      id,
      revisionNumber: 0,
      templateType: isPlan ? (preset === 'commercial_kitchen' ? 'commercial_kitchen' : 'general_ipm') : templateType,
      customerType,
      customerId,
      customerName,
      leadId: prefill.fromLead,
      branchId: branchId || undefined,
      branchName: branch?.branchName,
      siteAddress: clientAddress || undefined,
      preparedByUserId: userProfile?.uid || 'admin',
      preparedByName: userProfile?.displayName || 'Staff',
      scopeOfWork: isPlan ? scopeSections.map((s) => `${s.key}. ${s.title}: ${s.body}`).join('\n') : scopeOfWork,
      exclusions: exclusions.trim() || undefined,
      lineItems: isPlan
        ? [{
            id: 'plan',
            serviceName: `Monthly IPM service plan (${tenureMonths} month${tenureMonths === 1 ? '' : 's'})`,
            targetPest: ((pests[0] as PestType) || 'general_fumigation'),
            chemicalsSuggested: '',
            treatmentMethod: cleanPlan.map((r) => r.service).slice(0, 4).join(', '),
            frequency: 'Monthly',
            quantity: tenureMonths,
            unitPrice: pricing.monthlyBase,
            totalPrice: pricing.subtotal,
          }]
        : branchBreakdowns.length > 0
          ? branchBreakdowns.map((b, i) => {
              const SVC: Record<string, string> = { general_fumigation: 'General fumigation', cockroach_gel: 'Cockroach gel', rodent_control: 'Rodent control', termite_treatment: 'Termite treatment', bedbug_treatment: 'Bedbug treatment', mosquito_fogging: 'Mosquito / fly fogging', ant_treatment: 'Ant treatment', stored_grain_pest: 'Stored grain pest control', snake_reptile: 'Snake / reptile control', monitoring_visit: 'Monitoring visit' };
              const svcNames = (b.services || []).map((sv) => SVC[sv.service] || sv.service).join(', ') || 'Treatment';
              return { id: `li_site_${i}`, serviceName: `${b.branchName}: ${svcNames}`, targetPest: 'cockroaches' as PestType, chemicalsSuggested: '', treatmentMethod: '', frequency: 'One-time', quantity: 1, unitPrice: b.monthlyAmount, totalPrice: b.monthlyAmount };
            })
          : lineItems,
      subtotal,
      discountPercent,
      discountAmount,
      taxPercent: taxPct,
      taxAmount,
      totalAmount,
      validityDays: 30,
      paymentTerms: isPlan ? `Payable within ${paymentTermsDays} days of the monthly invoice` : `Payable within ${paymentTermsDays} days of invoice`,
      status: discountPercent > 10 ? 'pending_approval' : 'draft',
      revisionsHistory: [{ revisionNumber: 0, timestamp: now, changedBy: userProfile?.email || 'admin', changedByName: userProfile?.displayName || 'Staff', changeReason: 'Initial proposal', subtotal, discountPercent, totalAmount }],
      ...(isPlan
        ? {
            attentionTo: attention.name.trim() ? { name: attention.name.trim(), designation: attention.designation.trim() || undefined, email: attention.email?.trim() || undefined, phone: attention.phone?.trim() || undefined } : undefined,
            clientAddress: clientAddress || undefined,
            coverLetter,
            scopeSections,
            terms: termsText.split('\n').map((t) => t.trim()).filter(Boolean),
            servicePlanPreset: preset,
            servicePlan: cleanPlan,
            serviceVisitsPerMonth: visits,
            followUpVisitsPerMonth: followUps,
            pcoCountMin: undefined,
            pcoCountMax: undefined,
            documentationIncluded: documentation,
            monthlyRate: effectiveRate,
            taxMode,
            tenureMonths,
            tenureStart,
            tenureEnd: end,
            paymentTermsDays,
            deviceOwnership: deviceOwnership.trim() || undefined,
            branchBreakdowns: branchBreakdowns.length > 0 ? branchBreakdowns : undefined,
          }
        : { paymentTermsDays }),
      // Template version used; tax and payment wording are kept so later template edits don't change this proposal
      templateVersion: documentTemplates.version(),
      templateSnapshot: { taxWording: templates.taxWording, paymentTerms: templates.paymentTerms },
      // The proposal date is the creation date (printed on the PDF)
      createdAt: now,
      updatedAt: now,
    };

    try {
      dataService.saveProposal(proposal, userProfile?.email);
    } catch (err) {
      error('Could not create proposal', err instanceof Error ? err.message : String(err));
      return;
    }
    if (proposal.status === 'pending_approval') warning('Approval required (AP-01)', `Discount ${discountPercent}% is above 10%. Sent for Sales Manager / CEO approval.`);
    else success('Proposal created', `${proposal.id} is saved. The PDF is being filed in the client's Proposals folder.`);
    fileProposalPdf(proposal, { email: userProfile?.email, displayName: userProfile?.displayName })
      .then((doc) => {
        if (!doc) warning('PDF not filed', 'File storage is not configured or you are offline. Download the PDF from the proposal instead.');
      })
      .catch((err) => warning('PDF not filed', err instanceof Error ? err.message : String(err)));
    onCreated?.(proposal);
    onClose();
  };

  const setLine = (i: number, patch: Partial<ProposalLineItem>) =>
    setLineItems((prev) => prev.map((li, idx) => {
      if (idx !== i) return li;
      const next = { ...li, ...patch };
      return { ...next, totalPrice: next.quantity * next.unitPrice };
    }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New proposal"
      subtitle={lead ? `From lead ${lead.id}${inspection ? ' · inspection findings carried over' : ''}` : 'Monthly IPM service plan or one-time treatment'}
      maxWidth="860px"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={problems.length > 0} title={problems.join('\n')}>Create proposal</button>
        </>
      }
    >
      {/* Client */}
      <div style={{ display: 'grid', gridTemplateColumns: customerType === 'company' ? '1fr 1fr' : '1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Client <span className="required">*</span></label>
          {prefill.customerId ? (
            <select className="form-select" value={customerId} disabled>
              <option value={customerId}>{customerType === 'company' ? companies.find(c => c.id === customerId)?.legalCompanyName : clients.find(c => c.id === customerId)?.fullName} ({customerId})</option>
            </select>
          ) : (
            <select
              className="form-select"
              value={`${customerType}:${customerId}`}
              onChange={(e) => {
                const [type, id] = e.target.value.split(':');
                changeCustomer(type as 'company' | 'individual', id);
              }}
            >
              <optgroup label="Companies">
                {companies.map((c) => (
                  <option key={c.id} value={`company:${c.id}`}>{c.legalCompanyName} ({c.id})</option>
                ))}
              </optgroup>
              <optgroup label="Individual Clients">
                {clients.map((cl) => (
                  <option key={cl.id} value={`individual:${cl.id}`}>{cl.fullName} ({cl.id})</option>
                ))}
              </optgroup>
            </select>
          )}
        </div>
        {customerType === 'company' && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Branch</label>
            <select className="form-select" value={branchId} onChange={(e) => changeCustomer(customerType, customerId, e.target.value)}>
              <option value="">Head office / all branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.branchName}</option>)}
            </select>
            {customerId && (
              <div style={{ fontSize: '0.72rem', marginTop: '0.2rem' }}>
                <a href={`/customers/company/${customerId}?tab=branches`} style={{ color: 'var(--ikpm-emerald-600)' }}>＋ Add new branch</a>
              </div>
            )}
          </div>
        )}
      </div>
      {(() => {
        const dupes = dataService.getProposals().filter(
          (p) => p.customerId === customerId &&
            (p.branchId || undefined) === (branchId || undefined) &&
            !['declined', 'expired', 'rejected'].includes(p.status)
        );
        return dupes.length > 0 ? (
          <div className="form-hint" style={{ marginBottom: '0.75rem', color: 'var(--ikpm-amber-700)' }}>
            Note: {dupes.length} open proposal{dupes.length > 1 ? 's' : ''} already exist{dupes.length === 1 ? 's' : ''} for this client{branchId ? ' / branch' : ''} ({dupes.map((p) => p.id).join(', ')}).
          </div>
        ) : null;
      })()}

      <div className="chip-row" role="tablist" style={{ margin: '0.25rem 0 1rem' }}>
        <button type="button" className={`chip ${mode === 'plan' ? 'chip-on' : ''}`} onClick={() => setMode('plan')}>Monthly IPM service plan</button>
        <button type="button" className={`chip ${mode === 'one_time' ? 'chip-on' : ''}`} onClick={() => setMode('one_time')}>One-time treatment</button>
      </div>

      {mode === 'plan' ? (
        <>
          {/* ── Section 1: Service plan ── */}
          <div className="section-title" style={{ marginTop: 0 }}>Service plan</div>
          <ServicePlanEditor
            preset={preset}
            items={plan}
            onPresetChange={(p) => {
              setPreset(p);
              setVisits(SERVICE_PLAN_PRESETS[p].serviceVisitsPerMonth);
              setFollowUps(SERVICE_PLAN_PRESETS[p].followUpVisitsPerMonth);
            }}
            onChange={setPlan}
          />
          {branchBreakdowns.length === 0 && (
            <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Total visits / month</label>
                <input type="number" min={0} className="form-input" value={visits} onChange={(e) => setVisits(Number(e.target.value))} />
                <div className="form-hint" style={{ marginTop: '0.2rem' }}>Multiple treatments done in one visit</div>
              </div>
              <div className="form-group">
                <label className="form-label">Follow-up visits / month</label>
                <input type="number" min={0} className="form-input" value={followUps} onChange={(e) => setFollowUps(Number(e.target.value))} />
              </div>
            </div>
          )}
          <div className="form-group" style={{ marginTop: '0.75rem' }}>
            <label className="form-label">Documentation included</label>
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.45rem' }}>
              <select className="form-select" style={{ flex: 1 }} value={docToAdd} onChange={(e) => setDocToAdd(e.target.value)}>
                {DOCUMENTATION_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <button type="button" className="btn btn-sm btn-secondary"
                onClick={() => { if (docToAdd && !documentation.includes(docToAdd)) setDocumentation((prev) => [...prev, docToAdd]); }}>
                <Plus size={13} /> Add
              </button>
            </div>
            <div className="chip-row" style={{ marginBottom: 0 }}>
              {documentation.map((d) => (
                <span key={d} className="chip chip-on" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {d}
                  <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit', fontSize: '1rem' }}
                    onClick={() => setDocumentation((prev) => prev.filter((x) => x !== d))}>×</button>
                </span>
              ))}
              {documentation.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>None added yet</span>}
            </div>
          </div>

          {/* ── Section 2: Site-by-site breakdown (multi-site, company only) ── */}
          {customerType === 'company' && (() => {
            const siteOptions = [
              { id: '__hq__', name: 'Head Office (HQ)', address: company?.headOfficeAddress || '' },
              ...branches.map((br) => ({ id: br.id, name: br.branchName, address: br.physicalAddress || '' })),
            ];
            const allUsed = branchBreakdowns.length >= siteOptions.length;
            return (
              <div style={{ marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <div className="section-title" style={{ margin: 0 }}>
                    Site breakdown
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 8 }}>optional — add HQ, branches, or both with individual services &amp; prices</span>
                  </div>
                  <button type="button" className="btn btn-sm btn-secondary" disabled={allUsed}
                    title={allUsed ? 'All sites already added' : undefined}
                    onClick={() => {
                      const usedIds = new Set(branchBreakdowns.map((x) => x.branchId));
                      const first = siteOptions.find((s) => !usedIds.has(s.id));
                      if (!first) return;
                      setBranchBreakdowns((prev) => [...prev, { branchId: first.id, branchName: first.name, address: first.address, services: [{ service: 'general_fumigation' }], visitsPerMonth: 1, monthlyAmount: 0 }]);
                    }}>
                    <Plus size={13} /> Add site
                  </button>
                </div>

                {branchBreakdowns.map((b, idx) => {
                  const upd = (patch: Partial<ProposalBranchBreakdown>) =>
                    setBranchBreakdowns((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
                  const usedElsewhere = branchBreakdowns.map((x, i) => i !== idx ? x.branchId : null).filter(Boolean) as string[];
                  const siteObj = siteOptions.find((x) => x.id === b.branchId);
                  return (
                    <div key={idx} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '0.75rem', background: 'var(--surface-raised)' }}>
                      {/* Card header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--ikpm-emerald-700)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {b.branchName || `Site ${idx + 1}`}
                          {b.branchId === '__hq__' && <span style={{ fontSize: '0.68rem', background: 'var(--ikpm-emerald-100)', color: 'var(--ikpm-emerald-700)', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>HQ</span>}
                        </div>
                        <button type="button" className="icon-btn" onClick={() => setBranchBreakdowns((prev) => prev.filter((_, i) => i !== idx))}>
                          <Trash2 size={14} color="var(--ikpm-rose-500)" />
                        </button>
                      </div>

                      {/* Site + address */}
                      <div className="form-grid-2" style={{ marginBottom: '0.75rem' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Site</label>
                          <select className="form-select" value={b.branchId}
                            onChange={(e) => {
                              const site = siteOptions.find((s) => s.id === e.target.value);
                              upd({ branchId: e.target.value, branchName: site?.name || e.target.value, address: site?.address || '' });
                            }}>
                            {siteOptions.map((s) => (
                              <option key={s.id} value={s.id} disabled={usedElsewhere.includes(s.id)}>
                                {s.name}{usedElsewhere.includes(s.id) ? ' (already added)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Address</label>
                          <input className="form-input" value={b.address ?? siteObj?.address ?? ''} onChange={(e) => upd({ address: e.target.value })} placeholder="Site address" />
                        </div>
                      </div>

                      {/* Services */}
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                          <label className="form-label" style={{ marginBottom: 0 }}>Services / treatments</label>
                          <button type="button" className="btn btn-sm btn-ghost"
                            onClick={() => upd({ services: [...(b.services || []), { service: 'general_fumigation' }] })}>
                            <Plus size={11} /> Add treatment
                          </button>
                        </div>
                        {(b.services || []).length === 0 && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No treatments added yet</div>
                        )}
                        {(b.services || []).map((sv, si) => (
                          <div key={si} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <select className="form-select" value={sv.service}
                              onChange={(e) => {
                                const updated = (b.services || []).map((s, i) => i === si ? { ...s, service: e.target.value } : s);
                                upd({ services: updated });
                              }}>
                              {SERVICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <button type="button" className="icon-btn"
                              onClick={() => upd({ services: (b.services || []).filter((_, i) => i !== si) })}>
                              <Trash2 size={13} color="var(--ikpm-rose-400)" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Pricing row */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Monthly charges (PKR)</label>
                          <input type="number" min={0} className="form-input" value={b.monthlyAmount || ''}
                            onChange={(e) => upd({ monthlyAmount: Number(e.target.value) })} placeholder="e.g. 25000" />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Visits / month</label>
                          <input type="number" min={0} className="form-input" value={b.visitsPerMonth}
                            onChange={(e) => upd({ visitsPerMonth: Number(e.target.value) })} placeholder="e.g. 2" />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Follow-up visits / month</label>
                          <input type="number" min={0} className="form-input" value={b.followUpVisitsPerMonth ?? 0}
                            onChange={(e) => upd({ followUpVisitsPerMonth: Number(e.target.value) })} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ── Section 3: Charges & tenure ── */}
          <div className="section-title">Charges &amp; tenure</div>

          {branchBreakdowns.length > 0 && (
            <div style={{ marginBottom: '1rem', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-raised)' }}>
                    <th style={{ padding: '0.45rem 0.7rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', borderBottom: '1px solid var(--border-subtle)' }}>Site</th>
                    <th style={{ padding: '0.45rem 0.7rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', borderBottom: '1px solid var(--border-subtle)' }}>Treatments</th>
                    <th style={{ padding: '0.45rem 0.7rem', textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>Visits/mo</th>
                    <th style={{ padding: '0.45rem 0.7rem', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>Monthly (PKR)</th>
                  </tr>
                </thead>
                <tbody>
                  {branchBreakdowns.map((b, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '0.4rem 0.7rem', fontWeight: 600 }}>
                        {b.branchName || `Site ${i + 1}`}
                        {b.address && <div style={{ fontWeight: 400, fontSize: '0.72rem', color: 'var(--text-muted)' }}>{b.address}</div>}
                      </td>
                      <td style={{ padding: '0.4rem 0.7rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        {(b.services || []).map((sv) => SERVICE_OPTIONS.find((o) => o.value === sv.service)?.label || sv.service).join(', ') || '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.7rem', textAlign: 'center' }}>{b.visitsPerMonth}</td>
                      <td style={{ padding: '0.4rem 0.7rem', textAlign: 'right', fontWeight: 700 }}>{b.monthlyAmount > 0 ? b.monthlyAmount.toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--ikpm-emerald-50, #f0fdf4)' }}>
                    <td colSpan={3} style={{ padding: '0.45rem 0.7rem', fontWeight: 700, color: 'var(--ikpm-emerald-800, #065f46)' }}>Total monthly charges</td>
                    <td style={{ padding: '0.45rem 0.7rem', textAlign: 'right', fontWeight: 700, fontSize: '0.95rem', color: 'var(--ikpm-emerald-700, #047857)' }}>{branchTotal.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Monthly charges (PKR) <span className="required">*</span></label>
              {branchBreakdowns.length > 0 ? (
                <div className="form-input" style={{ background: 'var(--surface-raised)', color: 'var(--ikpm-emerald-700)', fontWeight: 700, cursor: 'default' }}>
                  {formatPKR(branchTotal)} <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--text-muted)' }}>auto-calculated</span>
                </div>
              ) : (
                <input type="number" min={0} className="form-input" value={monthlyRate || ''} onChange={(e) => setMonthlyRate(Number(e.target.value))} placeholder="e.g. 85000" />
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Tax mode</label>
              <select className="form-select" value={taxMode} onChange={(e) => setTaxMode(e.target.value as 'exclusive' | 'inclusive')}>
                <option value="exclusive">Exclusive of tax</option>
                <option value="inclusive">Inclusive of tax</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Tax rate (%)</label>
              <input type="number" min={0} max={100} className="form-input" value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))} placeholder="e.g. 13" />
              <div className="form-hint" style={{ marginTop: '0.2rem' }}>0 if exempt</div>
            </div>
            <div className="form-group">
              <label className="form-label">Tenure (months)</label>
              <input type="number" min={1} className="form-input" value={tenureMonths} onChange={(e) => setTenureMonths(Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">Payment within (days)</label>
              <input type="number" min={0} className="form-input" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value))} />
            </div>
          </div>

          <div className="pricing-summary">
            <div>Monthly before tax: <strong>{formatPKR(pricing.monthlyBase)}</strong></div>
            {tax.percent > 0 && <div>Tax ({tax.percent}%) / month: <strong>{formatPKR(pricing.monthlyTax)}</strong></div>}
            <div>Monthly total: <strong>{formatPKR(pricing.monthlyTotal)}</strong></div>
            <div className="pricing-grand">Total for {tenureMonths} month{tenureMonths === 1 ? '' : 's'}: {formatPKR(pricing.totalAmount)}</div>
          </div>

          {/* ── Section 4: Proposal letter & terms (collapsible) ── */}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => setShowWording((v) => !v)}>
            {showWording ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Proposal letter &amp; terms
          </button>
          {showWording && (
            <div style={{ marginTop: '0.75rem' }}>
              <div className="section-title" style={{ marginTop: 0 }}>Addressed to</div>
              <div className="form-grid-3">
                <div className="form-group">
                  <label className="form-label">Attention (name)</label>
                  <input className="form-input" value={attention.name} onChange={(e) => setAttention({ ...attention, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Designation</label>
                  <input className="form-input" value={attention.designation} onChange={(e) => setAttention({ ...attention, designation: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Client address</label>
                  <input className="form-input" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Contact email <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(for sending proposal)</span></label>
                  <input className="form-input" type="email" placeholder="procurement@client.com" value={attention.email ?? ''} onChange={(e) => setAttention({ ...attention, email: e.target.value || undefined })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Contact phone <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(WhatsApp)</span></label>
                  <input className="form-input" placeholder="03001234567" value={attention.phone ?? ''} onChange={(e) => setAttention({ ...attention, phone: e.target.value || undefined })} />
                </div>
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Exclusions</label>
                  <textarea className="form-textarea" rows={2} value={exclusions} onChange={(e) => setExclusions(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Devices (ownership)</label>
                  <textarea className="form-textarea" rows={2} value={deviceOwnership} onChange={(e) => setDeviceOwnership(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Cover letter</label>
                <textarea className="form-textarea" rows={5} value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} />
              </div>
              {scopeSections.map((sec, i) => (
                <div key={sec.key} className="form-group">
                  <label className="form-label">Scope {sec.key}</label>
                  <input className="form-input" value={sec.title} onChange={(e) => setScopeSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, title: e.target.value } : s)))} style={{ marginBottom: 4 }} />
                  <textarea className="form-textarea" rows={2} value={sec.body} onChange={(e) => setScopeSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, body: e.target.value } : s)))} />
                </div>
              ))}
              <div className="form-group">
                <label className="form-label">Terms (one per line, printed as (a), (b), (c)…)</label>
                <textarea className="form-textarea" rows={8} value={termsText} onChange={(e) => setTermsText(e.target.value)} />
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* ── Section 1: Treatment details ── */}
          <div className="section-title" style={{ marginTop: 0 }}>Treatment details</div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Treatment type</label>
              <select className="form-select" value={templateType} onChange={(e) => setTemplateType(e.target.value as TemplateType)}>
                <option value="general_ipm">General pest control</option>
                <option value="termite_proofing">Termite proofing</option>
                <option value="bedbug_eradication">Bedbug treatment</option>
                <option value="rodent_control">Rodent control</option>
                <option value="commercial_kitchen">Commercial kitchen</option>
                <option value="fumigation_export">Fumigation (cargo / warehouse)</option>
                <option value="cockroach_gel">Cockroach gel</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Sales tax</label>
              <select className="form-select" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value as TaxJurisdiction | 'exempt')}>
                {JURISDICTIONS.map((j) => {
                  const r = taxRateFor(rules, j);
                  return <option key={j} value={j}>{r.title}: {r.percent}%</option>;
                })}
                <option value="exempt">Exempt / zero-rated</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Scope of work</label>
            <textarea className="form-textarea" rows={3} value={scopeOfWork} onChange={(e) => setScopeOfWork(e.target.value)} />
          </div>

          {/* ── Section 2: Site breakdown (company only) ── */}
          {customerType === 'company' && (() => {
            const siteOptions = [
              { id: '__hq__', name: 'Head Office (HQ)', address: company?.headOfficeAddress || '' },
              ...branches.map((br) => ({ id: br.id, name: br.branchName, address: br.physicalAddress || '' })),
            ];
            const allUsed = branchBreakdowns.length >= siteOptions.length;
            return (
              <div style={{ marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <div className="section-title" style={{ margin: 0 }}>
                    Site breakdown
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 8 }}>optional — different treatments and prices per site</span>
                  </div>
                  <button type="button" className="btn btn-sm btn-secondary" disabled={allUsed}
                    title={allUsed ? 'All sites already added' : undefined}
                    onClick={() => {
                      const usedIds = new Set(branchBreakdowns.map((x) => x.branchId));
                      const first = siteOptions.find((s) => !usedIds.has(s.id));
                      if (!first) return;
                      setBranchBreakdowns((prev) => [...prev, { branchId: first.id, branchName: first.name, address: first.address, services: [{ service: 'general_fumigation' }], visitsPerMonth: 1, monthlyAmount: 0 }]);
                    }}>
                    <Plus size={13} /> Add site
                  </button>
                </div>
                {branchBreakdowns.map((b, idx) => {
                  const upd = (patch: Partial<ProposalBranchBreakdown>) =>
                    setBranchBreakdowns((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
                  const usedElsewhere = branchBreakdowns.map((x, i) => i !== idx ? x.branchId : null).filter(Boolean) as string[];
                  const siteObj = siteOptions.find((x) => x.id === b.branchId);
                  return (
                    <div key={idx} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '0.75rem', background: 'var(--surface-raised)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--ikpm-emerald-700)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {b.branchName || `Site ${idx + 1}`}
                          {b.branchId === '__hq__' && <span style={{ fontSize: '0.68rem', background: 'var(--ikpm-emerald-100)', color: 'var(--ikpm-emerald-700)', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>HQ</span>}
                        </div>
                        <button type="button" className="icon-btn" onClick={() => setBranchBreakdowns((prev) => prev.filter((_, i) => i !== idx))}>
                          <Trash2 size={14} color="var(--ikpm-rose-500)" />
                        </button>
                      </div>
                      <div className="form-grid-2" style={{ marginBottom: '0.75rem' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Site</label>
                          <select className="form-select" value={b.branchId}
                            onChange={(e) => {
                              const site = siteOptions.find((s) => s.id === e.target.value);
                              upd({ branchId: e.target.value, branchName: site?.name || e.target.value, address: site?.address || '' });
                            }}>
                            {siteOptions.map((s) => (
                              <option key={s.id} value={s.id} disabled={usedElsewhere.includes(s.id)}>
                                {s.name}{usedElsewhere.includes(s.id) ? ' (already added)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Address</label>
                          <input className="form-input" value={b.address ?? siteObj?.address ?? ''} onChange={(e) => upd({ address: e.target.value })} placeholder="Site address" />
                        </div>
                      </div>
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                          <label className="form-label" style={{ marginBottom: 0 }}>Treatments at this site</label>
                          <button type="button" className="btn btn-sm btn-ghost"
                            onClick={() => upd({ services: [...(b.services || []), { service: 'general_fumigation' }] })}>
                            <Plus size={11} /> Add treatment
                          </button>
                        </div>
                        {(b.services || []).length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No treatments added yet</div>}
                        {(b.services || []).map((sv, si) => (
                          <div key={si} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <select className="form-select" value={sv.service}
                              onChange={(e) => {
                                const updated = (b.services || []).map((s, i) => i === si ? { ...s, service: e.target.value } : s);
                                upd({ services: updated });
                              }}>
                              {SERVICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <button type="button" className="icon-btn"
                              onClick={() => upd({ services: (b.services || []).filter((_, i) => i !== si) })}>
                              <Trash2 size={13} color="var(--ikpm-rose-400)" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Treatment amount — this site (PKR)</label>
                          <input type="number" min={0} className="form-input" value={b.monthlyAmount || ''}
                            onChange={(e) => upd({ monthlyAmount: Number(e.target.value) })} placeholder="e.g. 35000" />
                        </div>
                      </div>
                    </div>
                  );
                })}
                {branchBreakdowns.length > 0 && (
                  <div style={{ marginBottom: '0.5rem', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                      <thead>
                        <tr style={{ background: 'var(--surface-raised)' }}>
                          <th style={{ padding: '0.45rem 0.7rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', borderBottom: '1px solid var(--border-subtle)' }}>Site</th>
                          <th style={{ padding: '0.45rem 0.7rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', borderBottom: '1px solid var(--border-subtle)' }}>Treatments</th>
                          <th style={{ padding: '0.45rem 0.7rem', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>Amount (PKR)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branchBreakdowns.map((b, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '0.4rem 0.7rem', fontWeight: 600 }}>
                              {b.branchName || `Site ${i + 1}`}
                              {b.address && <div style={{ fontWeight: 400, fontSize: '0.72rem', color: 'var(--text-muted)' }}>{b.address}</div>}
                            </td>
                            <td style={{ padding: '0.4rem 0.7rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                              {(b.services || []).map((sv) => SERVICE_OPTIONS.find((o) => o.value === sv.service)?.label || sv.service).join(', ') || '—'}
                            </td>
                            <td style={{ padding: '0.4rem 0.7rem', textAlign: 'right', fontWeight: 700 }}>{b.monthlyAmount > 0 ? b.monthlyAmount.toLocaleString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'var(--ikpm-emerald-50, #f0fdf4)' }}>
                          <td colSpan={2} style={{ padding: '0.45rem 0.7rem', fontWeight: 700, color: 'var(--ikpm-emerald-800, #065f46)' }}>Total</td>
                          <td style={{ padding: '0.45rem 0.7rem', textAlign: 'right', fontWeight: 700, fontSize: '0.95rem', color: 'var(--ikpm-emerald-700, #047857)' }}>{branchTotal.toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Section 3: Services (single site / no breakdown) ── */}
          {branchBreakdowns.length === 0 && (
            <>
              <div className="section-title">Services</div>
              {lineItems.map((li, i) => (
                <div key={li.id} className="line-item-row">
                  <input className="form-input" placeholder="Service" value={li.serviceName} onChange={(e) => setLine(i, { serviceName: e.target.value })} />
                  <input className="form-input" placeholder="Chemicals / method" value={li.chemicalsSuggested} onChange={(e) => setLine(i, { chemicalsSuggested: e.target.value })} />
                  <input type="number" min={1} className="form-input" aria-label="Quantity" value={li.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                  <input type="number" min={0} className="form-input" aria-label="Rate" placeholder="Rate" value={li.unitPrice || ''} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} />
                  <button type="button" className="icon-btn" onClick={() => setLineItems((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove line"><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setLineItems((prev) => [...prev, { id: `li_${Date.now()}`, serviceName: '', targetPest: 'cockroaches', chemicalsSuggested: '', treatmentMethod: '', quantity: 1, unitPrice: 0, totalPrice: 0, frequency: 'One-time' }])}>
                <Plus size={14} /> Add service
              </button>
            </>
          )}

          <div className="pricing-summary" style={{ marginTop: '1rem' }}>
            <div>Subtotal: <strong>{formatPKR(oneTimeSubtotal)}</strong></div>
            {discountPercent > 0 && <div>Discount: -{formatPKR(oneTimeDiscount)}</div>}
            {tax.percent > 0 && <div>Tax ({tax.percent}%): <strong>{formatPKR(oneTimeTax)}</strong></div>}
            <div className="pricing-grand">Total: {formatPKR(oneTimeSubtotal - oneTimeDiscount + oneTimeTax)}</div>
          </div>
        </>
      )}

      <div className="form-group" style={{ marginTop: '1rem' }}>
        <label className="form-label">
          Discount
          {discountPercent > 10 && <span style={{ color: 'var(--ikpm-amber-500)', marginLeft: 6, fontWeight: 400 }}>(above 10% — needs approval, AP-01)</span>}
        </label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '0 0 120px' }}>
            <input
              type="number" min={0} max={100} step={0.5}
              className="form-input"
              style={{ paddingRight: '2rem' }}
              value={discountPercent || ''}
              placeholder="0"
              onChange={(e) => setDiscountPercent(Math.min(100, Math.max(0, Number(e.target.value))))}
            />
            <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', fontSize: '0.85rem' }}>%</span>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>or</span>
          <div style={{ position: 'relative', flex: '0 0 160px' }}>
            {(() => {
              const base = mode === 'plan' ? pricing.subtotal : oneTimeSubtotal;
              const fixedAmt = base > 0 ? Math.round(base * discountPercent / 100) : 0;
              return (
                <>
                  <input
                    type="number" min={0} className="form-input"
                    style={{ paddingRight: '2.6rem' }}
                    value={fixedAmt || ''}
                    placeholder="0"
                    onChange={(e) => {
                      const base2 = mode === 'plan' ? pricing.subtotal : oneTimeSubtotal;
                      if (base2 > 0) setDiscountPercent(Math.min(100, Math.round((Number(e.target.value) / base2) * 1000) / 10));
                    }}
                  />
                  <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', fontSize: '0.82rem' }}>PKR</span>
                </>
              );
            })()}
          </div>
          {discountPercent > 0 && (
            <span style={{ fontSize: '0.82rem', color: 'var(--ikpm-emerald-700)', fontWeight: 600 }}>
              {discountPercent}% off
            </span>
          )}
        </div>
      </div>

      {problems.length > 0 && <ul className="form-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </Modal>
  );
};

export default ProposalBuilderModal;
