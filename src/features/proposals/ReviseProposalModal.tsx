import React, { useRef, useState } from 'react';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { dataService } from '../../services/dataService';
import { formatPKR } from '../../lib/formatters';
import { planPricing, tenureEnd } from '../../lib/proposalPlan';
import { fileProposalPdf } from './proposalFiles';
import { approverStamp, initialApproval } from './proposalApproval';
import type { Proposal, ProposalLineItem, ProposalBranchBreakdown, TemplateType } from '../../types/proposal';
import type { ServicePlanItem } from '../../lib/proposalPlan';
import type { PestType } from '../../types/crm';
import { mergeRatsAndMice, servicesMissingFormula, TREATMENT_TYPES, withCleanFormulas, treatmentLabel } from '../../lib/treatments';
import { Check } from 'lucide-react';
import { TreatmentDatalists } from './TreatmentDatalists';
import { SiteTreatments } from './SiteTreatments';
import { ServiceSelection } from './ServiceSelection';

interface Props {
  proposal: Proposal;
  onClose: () => void;
  onRevised: (revised: Proposal) => void;
  /**
   * 'revise' (default): a new revision R+1 with its own id, for a proposal already sent.
   * 'edit': change this draft in place (e.g. after "Changes requested") — same id and revision.
   * 'approve': the admin edits a proposal waiting for approval in place and approves it; the note of
   *   changes is kept on the approval and shown to the client when the proposal is sent.
   */
  mode?: 'revise' | 'edit' | 'approve';
}

export const ReviseProposalModal: React.FC<Props> = ({ proposal: p, onClose, onRevised, mode = 'revise' }) => {
  const approving = mode === 'approve';
  const editing = mode === 'edit' || approving;
  const { userProfile, canApproveProposals } = useAuth();
  const { success, error, warning } = useNotification();

  const isPlan = Boolean(p.servicePlan?.length);

  // --- Shared ---
  const [changeReason, setChangeReason] = useState('');
  const [discountPercent, setDiscountPercent] = useState(p.discountPercent);

  // --- Plan fields ---
  const [tenureStart, setTenureStart] = useState(p.tenureStart || new Date().toISOString().split('T')[0]);
  const [tenureMonths, setTenureMonths] = useState(p.tenureMonths ?? 12);
  const [monthlyRate, setMonthlyRate] = useState(p.monthlyRate ?? 0);
  const [plan, setPlanRaw] = useState<ServicePlanItem[]>(p.servicePlan ? p.servicePlan.map((r) => ({ ...r })) : []);
  // Rats control + Mice control -> one "Rats & mice control" row
  const setPlan = (update: (prev: ServicePlanItem[]) => ServicePlanItem[]) =>
    setPlanRaw((prev) => mergeRatsAndMice(update(prev), (r) => r.service, (r, service) => ({ ...r, service })));
  const [branchBreakdowns, setBranchBreakdowns] = useState<ProposalBranchBreakdown[]>(
    p.branchBreakdowns ? p.branchBreakdowns.map((b) => ({ ...b })) : []
  );

  // --- One-time fields ---
  const [lineItems, setLineItemsRaw] = useState<ProposalLineItem[]>(
    p.lineItems.map((li) => ({ ...li }))
  );
  const setLineItems = (update: (prev: ProposalLineItem[]) => ProposalLineItem[]) =>
    setLineItemsRaw((prev) => mergeRatsAndMice(update(prev), (li) => li.serviceName, (li, serviceName) => ({ ...li, serviceName })));
  // One-time sales tax: set for this proposal (starts at the current revision's rate)
  const [otTaxPct, setOtTaxPct] = useState<string>(isPlan ? '' : String(p.taxPercent ?? ''));
  const otTaxPercent = isPlan ? p.taxPercent : Number(otTaxPct) || 0;
  // One-time treatment types (several may be combined)
  const [templateTypes, setTemplateTypes] = useState<TemplateType[]>(p.templateTypes?.length ? p.templateTypes : [p.templateType]);

  // Derived pricing
  const branchTotal = branchBreakdowns.reduce((s, b) => s + b.monthlyAmount, 0);
  const effectiveRate = branchBreakdowns.length > 0 ? branchTotal : monthlyRate;
  const pricing = isPlan
    ? planPricing({ monthlyRate: effectiveRate, taxMode: p.taxMode ?? 'exclusive', taxPercent: p.taxPercent, tenureMonths, discountPercent })
    : null;
  const end = isPlan ? tenureEnd(tenureStart, tenureMonths) : undefined;

  const otSubtotal = branchBreakdowns.length > 0 ? branchTotal : lineItems.reduce((s, li) => s + li.totalPrice, 0);
  const otDiscount = (otSubtotal * discountPercent) / 100;
  const otTax = ((otSubtotal - otDiscount) * otTaxPercent) / 100;

  const problems: string[] = [];
  if (!editing && !changeReason.trim()) problems.push('Enter a reason for this revision.');
  if (approving && !changeReason.trim()) problems.push('Write a short note of the changes (the client sees it with the proposal).');
  if (isPlan && !(effectiveRate > 0)) problems.push('Monthly charges must be greater than zero.');
  if (isPlan && !plan.some((r) => r.service.trim())) problems.push('Add at least one service row.');
  if (!isPlan) {
    const otValid = branchBreakdowns.length > 0 ? branchTotal > 0 : lineItems.some((li) => li.serviceName.trim() && li.totalPrice > 0);
    if (!otValid) problems.push('Add at least one priced service.');
    if (otTaxPct.trim() === '') problems.push('Enter the sales tax % (type 0 if no tax).');
    else if (!(Number(otTaxPct) >= 0 && Number(otTaxPct) <= 100)) problems.push('Sales tax must be between 0 and 100%.');
    if (!templateTypes.length) problems.push('Select at least one treatment type.');
  }
  {
    const legacy = (text?: string) => (text ? [{ formula: text }] : []);
    const noFormula = [
      ...(isPlan ? servicesMissingFormula(plan, (r) => r.service, (r) => r.formulas ?? legacy(r.formula)) : []),
      ...branchBreakdowns.flatMap((b) => servicesMissingFormula(b.services ?? [], (sv) => sv.service, (sv) => sv.formulas ?? legacy(sv.formula))),
      ...(!isPlan && branchBreakdowns.length === 0
        ? servicesMissingFormula(lineItems, (li) => li.serviceName, (li) => li.formulas ?? legacy(li.chemicalsSuggested))
        : []),
    ];
    if (noFormula.length) problems.push(`Enter a formula for: ${Array.from(new Set(noFormula)).join(', ')}.`);
  }


  // One save at a time: the new proposal number comes from the server, and clicks during that wait
  // used to create the same proposal several times
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const once = (fn: () => Promise<void>) => async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await fn();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSave = once(async () => {
    if (problems.length) return;
    const now = new Date().toISOString();
    const proposals = dataService.getProposals();
    const id = editing ? p.id : await dataService.newRecordId('P', 'proposal', proposals.map((x) => x.id), 'proposals');
    const newRev = editing ? p.revisionNumber : p.revisionNumber + 1;

    const subtotal = isPlan ? pricing!.subtotal : otSubtotal;
    const discountAmount = isPlan ? pricing!.discountAmount : otDiscount;
    const taxAmount = isPlan ? pricing!.taxAmount : otTax;
    const totalAmount = isPlan ? pricing!.totalAmount : otSubtotal - otDiscount + otTax;
    // Blank formula lines are dropped
    const cleanPlan = plan.filter((r) => r.service.trim()).map((r) => withCleanFormulas(r, 'formula'));
    const cleanBreakdowns = branchBreakdowns.map((b) => ({ ...b, services: b.services?.filter((sv) => sv.service.trim()).map((sv) => withCleanFormulas(sv, 'formula')) }));

    const note = changeReason.trim();
    const revised: Proposal = {
      ...p,
      id,
      revisionNumber: newRev,
      // Editing keeps the draft's status and the approver's feedback (it can then be sent);
      // a discount above 10% still goes back for approval (saveProposal)
      ...(approving
        // Approver's edit: approved now, with the note of changes for the client
        ? { status: 'approved' as const, approval: approverStamp(userProfile, note, p.approval) }
        : editing
        ? { status: p.status, approval: p.approval }
        // Revisions by an admin / super admin are approved straight away
        : { parentProposalId: p.parentProposalId || p.id, ...initialApproval(canApproveProposals(), discountPercent, userProfile) }),
      sentDate: undefined,
      acceptedDate: undefined,
      pdfUrl: undefined,
      discountPercent,
      discountAmount,
      subtotal,
      taxAmount,
      totalAmount,
      revisionsHistory: editing
        // Same revision: its history line gets the new totals (and what was changed)
        ? p.revisionsHistory.map((h) => h.revisionNumber === p.revisionNumber
            ? { ...h, subtotal, discountPercent, totalAmount, timestamp: now, changedBy: userProfile?.email || h.changedBy, changedByName: userProfile?.displayName || h.changedByName, changeReason: note ? `${h.changeReason} · ${approving ? 'Edited on approval' : 'Edited'}: ${note}` : `${h.changeReason} · Edited` }
            : h)
        : [
        ...p.revisionsHistory,
        {
          revisionNumber: newRev,
          timestamp: now,
          changedBy: userProfile?.email || 'admin',
          changedByName: userProfile?.displayName || 'Staff',
          changeReason: changeReason.trim(),
          subtotal,
          discountPercent,
          totalAmount,
        },
      ],
      ...(isPlan
        ? {
            monthlyRate: effectiveRate,
            tenureMonths,
            tenureStart,
            tenureEnd: end,
            servicePlan: cleanPlan,
            branchBreakdowns: cleanBreakdowns.length > 0 ? cleanBreakdowns : undefined,
            lineItems: [
              {
                id: 'plan',
                serviceName: `Monthly IPM service plan (${tenureMonths} month${tenureMonths === 1 ? '' : 's'})`,
                targetPest: (p.lineItems[0]?.targetPest || 'general_fumigation') as PestType,
                chemicalsSuggested: cleanPlan.map((r) => r.formula?.trim()).filter(Boolean).slice(0, 4).join(', '),
                treatmentMethod: cleanPlan.map((r) => r.service).slice(0, 4).join(', '),
                frequency: 'Monthly',
                quantity: tenureMonths,
                unitPrice: pricing!.monthlyBase,
                totalPrice: pricing!.subtotal,
              },
            ],
          }
        : {
            lineItems: branchBreakdowns.length > 0
              ? branchBreakdowns.map((b, i) => {
                  const svcs = (b.services || []).filter((sv) => sv.service.trim());
                  const freqs = Array.from(new Set(svcs.map((sv) => sv.frequency?.trim()).filter(Boolean)));
                  return {
                    id: `li_site_${i}`,
                    serviceName: svcs.length ? `${b.branchName}: ${svcs.map((sv) => treatmentLabel(sv.service)).join(', ')}` : b.branchName,
                    targetPest: 'cockroaches' as PestType,
                    chemicalsSuggested: svcs.map((sv) => sv.formula?.trim()).filter(Boolean).join(', '),
                    treatmentMethod: '',
                    frequency: freqs.join(' / ') || 'One-time',
                    quantity: 1,
                    unitPrice: b.monthlyAmount,
                    totalPrice: b.monthlyAmount,
                  };
                })
              : lineItems.filter((li) => li.serviceName.trim()).map((li) => withCleanFormulas(li, 'chemicalsSuggested')),
            taxPercent: otTaxPercent,
            templateType: templateTypes[0],
            templateTypes,
            branchBreakdowns: cleanBreakdowns.length > 0 ? cleanBreakdowns : undefined,
          }),
      createdAt: editing ? p.createdAt : now,
      updatedAt: now,
    };

    try {
      dataService.saveProposal(revised, userProfile?.email);
    } catch (err) {
      error(editing ? 'Could not save the proposal' : 'Could not create revision', err instanceof Error ? err.message : String(err));
      return;
    }

    if (revised.status === 'pending_approval') {
      warning('Approval required (AP-01)', `Discount ${discountPercent}% is above 10%. Sent for CRO Manager / CEO approval.`);
    } else if (approving) {
      success('Edited and approved', `${id} is approved. Your note of changes goes to the client with the proposal.`);
    } else if (!editing && revised.status === 'approved') {
      success('Revision created and approved', `${id} (R${newRev}) is ready to send.`);
    } else if (editing) {
      success('Proposal updated', `${id} is saved. You can send it to the client now.`);
    } else {
      success('Revision created', `${id} (R${newRev}) is a draft.`);
    }

    fileProposalPdf(revised, { email: userProfile?.email, displayName: userProfile?.displayName })
      .then((doc) => { if (!doc) warning('PDF not filed', 'File storage is not configured or you are offline.'); })
      .catch((err) => warning('PDF not filed', err instanceof Error ? err.message : String(err)));

    onRevised(revised);
    onClose();
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={approving ? `Edit & approve proposal ${p.id}` : editing ? `Edit proposal ${p.id}` : `Revise proposal ${p.id}`}
      subtitle={editing ? `${p.customerName} · R${p.revisionNumber}` : `${p.customerName} · R${p.revisionNumber} → R${p.revisionNumber + 1}`}
      maxWidth="700px"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || problems.length > 0} title={problems.join('\n')}>
            {approving ? 'Save & approve' : editing ? 'Save changes' : 'Create revision'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <TreatmentDatalists />

        {/* What the approver asked for */}
        {editing && p.approval?.status === 'changes_requested' && (
          <div style={{ padding: '0.6rem 0.85rem', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '0.4rem', color: '#92400E', fontSize: '0.83rem' }}>
            <strong>Changes requested{p.approval.decisionByName ? ` by ${p.approval.decisionByName}` : ''}</strong>
            {p.approval.comments && <div style={{ marginTop: '0.3rem' }}>{p.approval.comments}</div>}
          </div>
        )}

        {/* Change reason */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">
            {approving
              ? <>Note of changes for the client <span className="required">*</span></>
              : editing ? <>What did you change? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></> : <>Reason for revision <span className="required">*</span></>}
          </label>
          <input
            className="form-input"
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            placeholder={approving ? 'e.g. Monthly rate revised to PKR 45,000 and quarterly fumigation added' : editing ? 'e.g. Added the missing formulas' : 'e.g. Client requested price reduction, added one site'}
          />
          {approving && <div className="cell-sub" style={{ marginTop: 4 }}>Shown to the client in the message the proposal is sent with, and kept on the proposal.</div>}
        </div>

        {/* ── Plan-specific fields ── */}
        {isPlan && (
          <>
            <div className="section-title" style={{ marginTop: '0.25rem' }}>Tenure</div>
            <div className="form-grid-2">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Start date</label>
                <input
                  type="date"
                  className="form-input"
                  value={tenureStart}
                  onChange={(e) => setTenureStart(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Duration (months)</label>
                <input
                  type="number"
                  min={1}
                  className="form-input"
                  value={tenureMonths}
                  onChange={(e) => setTenureMonths(Number(e.target.value))}
                />
              </div>
            </div>
            {end && (
              <div className="form-hint" style={{ marginTop: '-0.5rem' }}>
                End date: <strong>{end}</strong>
              </div>
            )}

            <div className="section-title">Service plan</div>
            <ServiceSelection<ServicePlanItem>
              label="Services in the plan"
              rows={plan}
              onChange={(rows) => setPlan(() => rows)}
              fields={{ name: 'service', formulas: 'formulas', formulaText: 'formula', frequency: 'frequency' }}
              make={(service) => ({ id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, service, frequency: 'Once per month' })}
            />

            {/* Per-branch pricing if applicable */}
            {branchBreakdowns.length > 0 && (
              <>
                <div className="section-title">Site charges</div>
                {branchBreakdowns.map((b, idx) => (
                  <SiteCard key={idx} b={b} amountLabel="Monthly amount (PKR)"
                    onChange={(patch) => setBranchBreakdowns((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))} />
                ))}
                {branchBreakdowns.length > 0 && (
                  <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.85rem', color: 'var(--ikpm-emerald-700)' }}>
                    Total: {formatPKR(branchTotal)} / month
                  </div>
                )}
              </>
            )}

            {branchBreakdowns.length === 0 && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Monthly charges (PKR) <span className="required">*</span></label>
                <input
                  type="number"
                  min={0}
                  className="form-input"
                  value={monthlyRate || ''}
                  onChange={(e) => setMonthlyRate(Number(e.target.value))}
                  placeholder="e.g. 85000"
                />
              </div>
            )}
          </>
        )}

        {/* ── One-time fields ── */}
        {!isPlan && (
          <>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Treatment type <span className="required">*</span> <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(select one or more)</span></label>
              <div className="chip-row" style={{ marginBottom: 0 }}>
                {TREATMENT_TYPES.map((t) => {
                  const on = templateTypes.includes(t.value);
                  return (
                    <button key={t.value} type="button" className={`chip ${on ? 'chip-on' : ''}`} aria-pressed={on}
                      onClick={() => setTemplateTypes((prev) => (on ? prev.filter((x) => x !== t.value) : [...prev, t.value]))}>
                      {on && <Check size={13} />} {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {branchBreakdowns.length > 0 ? (
              <>
                <div className="section-title" style={{ marginTop: '0.25rem' }}>Sites &amp; treatments</div>
                {branchBreakdowns.map((b, idx) => (
                  <SiteCard key={idx} b={b} amountLabel="Treatment amount (PKR)" defaultFrequency="One-time"
                    onChange={(patch) => setBranchBreakdowns((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))} />
                ))}
              </>
            ) : (
              <>
                <div className="section-title" style={{ marginTop: '0.25rem' }}>Treatment</div>
                <ServiceSelection<ProposalLineItem>
                  label="Services"
                  rows={lineItems}
                  onChange={(rows) => setLineItems(() => rows.map((li) => ({ ...li, totalPrice: (li.quantity || 0) * (li.unitPrice || 0) })))}
                  fields={{ name: 'serviceName', formulas: 'formulas', formulaText: 'chemicalsSuggested', frequency: 'frequency' }}
                  make={(serviceName) => ({ id: `li_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, serviceName, targetPest: 'cockroaches' as PestType, chemicalsSuggested: '', treatmentMethod: '', quantity: 1, unitPrice: 0, totalPrice: 0, frequency: 'One-time' })}
                  extraHead={['Qty', 'Rate (PKR)']}
                  extra={(li, set) => (
                    <>
                      <input type="number" min={1} className="form-input" aria-label="Quantity" value={li.quantity} onChange={(e) => set({ quantity: Number(e.target.value) })} />
                      <input type="number" min={0} className="form-input" aria-label="Rate" placeholder="Rate" value={li.unitPrice || ''} onChange={(e) => set({ unitPrice: Number(e.target.value) })} />
                    </>
                  )}
                />
              </>
            )}

            <div className="form-group" style={{ marginBottom: 0, maxWidth: 260 }}>
              <label className="form-label">Sales tax (%) <span className="required">*</span></label>
              <input type="number" min={0} max={100} step={0.01} className="form-input" value={otTaxPct} placeholder="Enter rate, e.g. 15" onChange={(e) => setOtTaxPct(e.target.value)} />
              <div className="form-hint" style={{ marginTop: '0.2rem' }}>Type 0 if no tax is charged.</div>
            </div>
          </>
        )}

        {/* Discount */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">
            Discount
            {discountPercent > 10 && (
              <span style={{ color: 'var(--ikpm-amber-500)', marginLeft: 6, fontWeight: 400 }}>(above 10% — needs approval, AP-01)</span>
            )}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '0 0 120px' }}>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="form-input"
                style={{ paddingRight: '2rem' }}
                value={discountPercent || ''}
                placeholder="0"
                onChange={(e) => setDiscountPercent(Math.min(100, Math.max(0, Number(e.target.value))))}
              />
              <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', fontSize: '0.85rem' }}>%</span>
            </div>
          </div>
        </div>

        {/* Pricing summary */}
        <div className="pricing-summary">
          {isPlan && pricing ? (
            <>
              <div>Monthly before tax: <strong>{formatPKR(pricing.monthlyBase)}</strong></div>
              {p.taxPercent > 0 && <div>Tax ({p.taxPercent}%) / month: <strong>{formatPKR(pricing.monthlyTax)}</strong></div>}
              <div>Monthly total: <strong>{formatPKR(pricing.monthlyTotal)}</strong></div>
              <div className="pricing-grand">Total for {tenureMonths} month{tenureMonths === 1 ? '' : 's'}: {formatPKR(pricing.totalAmount)}</div>
            </>
          ) : (
            <>
              <div>Subtotal: <strong>{formatPKR(otSubtotal)}</strong></div>
              {discountPercent > 0 && <div>Discount: -{formatPKR(otDiscount)}</div>}
              {otTaxPercent > 0 && <div>Sales tax ({otTaxPercent}%): <strong>{formatPKR(otTax)}</strong></div>}
              <div className="pricing-grand">Total: {formatPKR(otSubtotal - otDiscount + otTax)}</div>
            </>
          )}
        </div>

        {problems.length > 0 && (
          <ul className="form-problems">{problems.map((pr) => <li key={pr}>{pr}</li>)}</ul>
        )}
      </div>
    </Modal>
  );
};

/** One site in a revision: its treatments and its amount. */
const SiteCard: React.FC<{
  b: ProposalBranchBreakdown;
  amountLabel: string;
  defaultFrequency?: string;
  onChange: (patch: Partial<ProposalBranchBreakdown>) => void;
}> = ({ b, amountLabel, defaultFrequency, onChange }) => (
  <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.75rem', marginBottom: '0.5rem' }}>
    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{b.branchName}</div>
    <SiteTreatments services={b.services || []} defaultFrequency={defaultFrequency} onChange={(services) => onChange({ services })} />
    <div className="form-group" style={{ marginBottom: 0, maxWidth: 260 }}>
      <label className="form-label">{amountLabel}</label>
      <input type="number" min={0} className="form-input" value={b.monthlyAmount || ''} onChange={(e) => onChange({ monthlyAmount: Number(e.target.value) })} />
    </div>
  </div>
);

export default ReviseProposalModal;
