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
import type { Proposal, ProposalLineItem, TemplateType } from '../../types/proposal';
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
      ? { name: br.branchManagerName, designation: 'Branch Manager' }
      : leadContact && id === prefill.customerId
        ? { name: leadContact.name, designation: leadContact.designation || '' }
        : co
          ? { name: co.primaryContact.fullName, designation: co.primaryContact.designation || '' }
          : { name: cl?.fullName || '', designation: '' };
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
  const [pcoMin, setPcoMin] = useState(1);
  const [pcoMax, setPcoMax] = useState(2);
  const [documentation, setDocumentation] = useState<string[]>(DOCUMENTATION_OPTIONS.slice(0, 3));

  // Charges & tenure
  const place = branch ?? company ?? client ?? (lead ? { city: lead.city } : undefined);
  const [jurisdiction, setJurisdiction] = useState<TaxJurisdiction | 'exempt'>(() => jurisdictionFor(place));

  const rules = dataService.getTaxRules();
  const tax = jurisdiction === 'exempt' ? { percent: 0, title: 'Exempt / zero-rated', fromRules: true } : taxRateFor(rules, jurisdiction);
  const [monthlyRate, setMonthlyRate] = useState<number>(0);
  const [taxMode, setTaxMode] = useState<'exclusive' | 'inclusive'>('exclusive');
  const [tenureMonths, setTenureMonths] = useState(12);
  const [tenureStart, setTenureStart] = useState(defaultTenureStart());
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

  const pricing = planPricing({ monthlyRate, taxMode, taxPercent: tax.percent, tenureMonths, discountPercent });
  const oneTimeSubtotal = lineItems.reduce((a, li) => a + li.totalPrice, 0);
  const oneTimeDiscount = (oneTimeSubtotal * discountPercent) / 100;
  const oneTimeTax = ((oneTimeSubtotal - oneTimeDiscount) * tax.percent) / 100;
  const end = tenureEnd(tenureStart, tenureMonths);

  const problems: string[] = [];
  if (!customerId) problems.push('Choose the client.');
  if (mode === 'plan') {
    if (!plan.some((r) => r.service.trim())) problems.push('Add at least one row to the service plan.');
    if (!(monthlyRate > 0)) problems.push('Enter the monthly charges.');
    if (!(tenureMonths >= 1)) problems.push('Tenure must be at least one month.');
  } else if (!lineItems.some((li) => li.serviceName.trim() && li.totalPrice > 0)) {
    problems.push('Add at least one priced service line.');
  }

  const changeCustomer = (type: 'company' | 'individual', id: string, brId = '') => {
    setCustomerType(type);
    setCustomerId(id);
    setBranchId(brId);
    const next = addressedTo(type, id, brId);
    setAttention(next.attention);
    setClientAddress(next.address);
    const br = brId ? dataService.getBranchById(brId) : undefined;
    setJurisdiction(jurisdictionFor(br ?? (type === 'company' ? dataService.getCompanyById(id) : dataService.getClientById(id))));
  };

  const create = () => {
    if (problems.length) return;
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
        : lineItems,
      subtotal,
      discountPercent,
      discountAmount,
      taxPercent: tax.percent,
      taxAmount,
      totalAmount,
      validityDays: 30,
      paymentTerms: isPlan ? `Payable within ${paymentTermsDays} days of the monthly invoice` : `Payable within ${paymentTermsDays} days of invoice`,
      status: discountPercent > 10 ? 'pending_approval' : 'draft',
      revisionsHistory: [{ revisionNumber: 0, timestamp: now, changedBy: userProfile?.email || 'admin', changedByName: userProfile?.displayName || 'Staff', changeReason: 'Initial proposal', subtotal, discountPercent, totalAmount }],
      ...(isPlan
        ? {
            attentionTo: attention.name.trim() ? { name: attention.name.trim(), designation: attention.designation.trim() || undefined } : undefined,
            clientAddress: clientAddress || undefined,
            coverLetter,
            scopeSections,
            terms: termsText.split('\n').map((t) => t.trim()).filter(Boolean),
            servicePlanPreset: preset,
            servicePlan: cleanPlan,
            serviceVisitsPerMonth: visits,
            followUpVisitsPerMonth: followUps,
            pcoCountMin: pcoMin,
            pcoCountMax: Math.max(pcoMin, pcoMax),
            documentationIncluded: documentation,
            monthlyRate,
            taxMode,
            tenureMonths,
            tenureStart,
            tenureEnd: end,
            paymentTermsDays,
            deviceOwnership: deviceOwnership.trim() || undefined,
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
      <div className="form-grid-3">
        <div className="form-group">
          <label className="form-label">Client type</label>
          <select className="form-select" value={customerType} onChange={(e) => {
            const t = e.target.value as 'company' | 'individual';
            changeCustomer(t, (t === 'company' ? companies[0]?.id : clients[0]?.id) || '');
          }} disabled={Boolean(prefill.customerId)}>
            <option value="company">Company</option>
            <option value="individual">Individual</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Client <span className="required">*</span></label>
          <select className="form-select" value={customerId} onChange={(e) => changeCustomer(customerType, e.target.value)} disabled={Boolean(prefill.customerId)}>
            {(customerType === 'company' ? companies.map((c) => ({ id: c.id, name: c.legalCompanyName })) : clients.map((c) => ({ id: c.id, name: c.fullName }))).map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
            ))}
          </select>
        </div>
        {branches.length > 0 && (
          <div className="form-group">
            <label className="form-label">Branch</label>
            <select className="form-select" value={branchId} onChange={(e) => changeCustomer(customerType, customerId, e.target.value)}>
              <option value="">Head office / all</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.branchName}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="chip-row" role="tablist" style={{ margin: '0.25rem 0 1rem' }}>
        <button type="button" className={`chip ${mode === 'plan' ? 'chip-on' : ''}`} onClick={() => setMode('plan')}>Monthly IPM service plan</button>
        <button type="button" className={`chip ${mode === 'one_time' ? 'chip-on' : ''}`} onClick={() => setMode('one_time')}>One-time treatment</button>
      </div>

      {mode === 'plan' ? (
        <>
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
          </div>

          <div className="section-title">Monthly IPM service plan</div>
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
          <div className="form-grid-4" style={{ marginTop: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Service visits / month</label>
              <input type="number" min={0} className="form-input" value={visits} onChange={(e) => setVisits(Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">Follow-up visits / month</label>
              <input type="number" min={0} className="form-input" value={followUps} onChange={(e) => setFollowUps(Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">PCOs (min)</label>
              <input type="number" min={1} className="form-input" value={pcoMin} onChange={(e) => setPcoMin(Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">PCOs (max)</label>
              <input type="number" min={1} className="form-input" value={pcoMax} onChange={(e) => setPcoMax(Number(e.target.value))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Documentation included</label>
            <div className="chip-row" style={{ marginBottom: 0 }}>
              {DOCUMENTATION_OPTIONS.map((d) => (
                <button key={d} type="button" className={`chip ${documentation.includes(d) ? 'chip-on' : ''}`} onClick={() => setDocumentation((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}>{d}</button>
              ))}
            </div>
          </div>

          <div className="section-title">Charges & tenure</div>
          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Monthly charges (PKR) <span className="required">*</span></label>
              <input type="number" min={0} className="form-input" value={monthlyRate || ''} onChange={(e) => setMonthlyRate(Number(e.target.value))} placeholder="e.g. 85000" />
            </div>
            <div className="form-group">
              <label className="form-label">The amount is</label>
              <select className="form-select" value={taxMode} onChange={(e) => setTaxMode(e.target.value as 'exclusive' | 'inclusive')}>
                <option value="exclusive">Exclusive of sales tax</option>
                <option value="inclusive">Inclusive of sales tax</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Sales tax</label>
              <select className="form-select" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value as TaxJurisdiction | 'exempt')}>
                {JURISDICTIONS.map((j) => {
                  const r = taxRateFor(rules, j);
                  return <option key={j} value={j}>{r.title}: {r.percent}%{r.fromRules ? '' : ' (no tax rule saved)'}</option>;
                })}
                <option value="exempt">Exempt / zero-rated</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Tenure (months)</label>
              <input type="number" min={1} className="form-input" value={tenureMonths} onChange={(e) => setTenureMonths(Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">Tenure starts</label>
              <input type="date" className="form-input" value={tenureStart} onChange={(e) => setTenureStart(e.target.value)} />
              <div className="cell-sub">Ends {formatDate(end)}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Payment within (days)</label>
              <input type="number" min={0} className="form-input" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value))} />
            </div>
          </div>

          <div className="pricing-summary">
            <div>Monthly before tax: <strong>{formatPKR(pricing.monthlyBase)}</strong></div>
            <div>Sales tax ({tax.percent}%) per month: <strong>{formatPKR(pricing.monthlyTax)}</strong></div>
            <div>Monthly including tax: <strong>{formatPKR(pricing.monthlyTotal)}</strong></div>
            <div className="pricing-grand">Total for {tenureMonths} months: {formatPKR(pricing.totalAmount)}</div>
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

          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowWording((v) => !v)}>
            {showWording ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Letter, scope of services and terms
          </button>
          {showWording && (
            <div style={{ marginTop: '0.75rem' }}>
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
          <div className="pricing-summary">
            <div>Subtotal: <strong>{formatPKR(oneTimeSubtotal)}</strong></div>
            {discountPercent > 0 && <div>Discount: -{formatPKR(oneTimeDiscount)}</div>}
            <div>Sales tax ({tax.percent}%): <strong>{formatPKR(oneTimeTax)}</strong></div>
            <div className="pricing-grand">Total: {formatPKR(oneTimeSubtotal - oneTimeDiscount + oneTimeTax)}</div>
          </div>
        </>
      )}

      <div className="form-group" style={{ marginTop: '1rem' }}>
        <label className="form-label">
          Discount {discountPercent}%{discountPercent > 10 && <span style={{ color: 'var(--ikpm-amber-500)', marginLeft: 6 }}>(needs approval, AP-01)</span>}
        </label>
        <input type="range" min={0} max={35} value={discountPercent} onChange={(e) => setDiscountPercent(Number(e.target.value))} style={{ width: '100%' }} />
      </div>

      {problems.length > 0 && <ul className="form-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </Modal>
  );
};

export default ProposalBuilderModal;
