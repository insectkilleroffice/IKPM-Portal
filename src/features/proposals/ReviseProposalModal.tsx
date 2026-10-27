import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { dataService } from '../../services/dataService';
import { formatPKR, generatePermanentId } from '../../lib/formatters';
import { planPricing, tenureEnd } from '../../lib/proposalPlan';
import { fileProposalPdf } from './proposalFiles';
import type { Proposal, ProposalLineItem, ProposalBranchBreakdown } from '../../types/proposal';
import type { ServicePlanItem } from '../../lib/proposalPlan';
import type { PestType } from '../../types/crm';

interface Props {
  proposal: Proposal;
  onClose: () => void;
  onRevised: (revised: Proposal) => void;
}

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

export const ReviseProposalModal: React.FC<Props> = ({ proposal: p, onClose, onRevised }) => {
  const { userProfile } = useAuth();
  const { success, error, warning } = useNotification();

  const isPlan = Boolean(p.servicePlan?.length);

  // --- Shared ---
  const [changeReason, setChangeReason] = useState('');
  const [discountPercent, setDiscountPercent] = useState(p.discountPercent);

  // --- Plan fields ---
  const [tenureStart, setTenureStart] = useState(p.tenureStart || new Date().toISOString().split('T')[0]);
  const [tenureMonths, setTenureMonths] = useState(p.tenureMonths ?? 12);
  const [monthlyRate, setMonthlyRate] = useState(p.monthlyRate ?? 0);
  const [plan, setPlan] = useState<ServicePlanItem[]>(p.servicePlan ? p.servicePlan.map((r) => ({ ...r })) : []);
  const [branchBreakdowns, setBranchBreakdowns] = useState<ProposalBranchBreakdown[]>(
    p.branchBreakdowns ? p.branchBreakdowns.map((b) => ({ ...b })) : []
  );

  // --- One-time fields ---
  const [lineItems, setLineItems] = useState<ProposalLineItem[]>(
    p.lineItems.map((li) => ({ ...li }))
  );

  // Derived pricing
  const branchTotal = branchBreakdowns.reduce((s, b) => s + b.monthlyAmount, 0);
  const effectiveRate = branchBreakdowns.length > 0 ? branchTotal : monthlyRate;
  const pricing = isPlan
    ? planPricing({ monthlyRate: effectiveRate, taxMode: p.taxMode ?? 'exclusive', taxPercent: p.taxPercent, tenureMonths, discountPercent })
    : null;
  const end = isPlan ? tenureEnd(tenureStart, tenureMonths) : undefined;

  const otSubtotal = branchBreakdowns.length > 0 ? branchTotal : lineItems.reduce((s, li) => s + li.totalPrice, 0);
  const otDiscount = (otSubtotal * discountPercent) / 100;
  const otTax = ((otSubtotal - otDiscount) * p.taxPercent) / 100;

  const problems: string[] = [];
  if (!changeReason.trim()) problems.push('Enter a reason for this revision.');
  if (isPlan && !(effectiveRate > 0)) problems.push('Monthly charges must be greater than zero.');
  if (isPlan && !plan.some((r) => r.service.trim())) problems.push('Add at least one service row.');
  if (!isPlan) {
    const otValid = branchBreakdowns.length > 0 ? branchTotal > 0 : lineItems.some((li) => li.serviceName.trim() && li.totalPrice > 0);
    if (!otValid) problems.push('Add at least one priced service.');
  }

  const setLine = (i: number, patch: Partial<ProposalLineItem>) =>
    setLineItems((prev) =>
      prev.map((li, idx) => {
        if (idx !== i) return li;
        const next = { ...li, ...patch };
        return { ...next, totalPrice: next.quantity * next.unitPrice };
      })
    );

  const handleSave = () => {
    if (problems.length) return;
    const now = new Date().toISOString();
    const proposals = dataService.getProposals();
    const id = generatePermanentId('P', proposals.length + 1);
    const newRev = p.revisionNumber + 1;

    const subtotal = isPlan ? pricing!.subtotal : otSubtotal;
    const discountAmount = isPlan ? pricing!.discountAmount : otDiscount;
    const taxAmount = isPlan ? pricing!.taxAmount : otTax;
    const totalAmount = isPlan ? pricing!.totalAmount : otSubtotal - otDiscount + otTax;
    const cleanPlan = plan.filter((r) => r.service.trim());

    const revised: Proposal = {
      ...p,
      id,
      revisionNumber: newRev,
      parentProposalId: p.parentProposalId || p.id,
      status: discountPercent > 10 ? 'pending_approval' : 'draft',
      approval: undefined,
      sentDate: undefined,
      acceptedDate: undefined,
      pdfUrl: undefined,
      discountPercent,
      discountAmount,
      subtotal,
      taxAmount,
      totalAmount,
      revisionsHistory: [
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
            branchBreakdowns: branchBreakdowns.length > 0 ? branchBreakdowns : undefined,
            lineItems: [
              {
                id: 'plan',
                serviceName: `Monthly IPM service plan (${tenureMonths} month${tenureMonths === 1 ? '' : 's'})`,
                targetPest: (p.lineItems[0]?.targetPest || 'general_fumigation') as PestType,
                chemicalsSuggested: '',
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
              ? branchBreakdowns.map((b, i) => ({
                  id: `li_site_${i}`,
                  serviceName: b.branchName,
                  targetPest: 'cockroaches' as PestType,
                  chemicalsSuggested: '',
                  treatmentMethod: '',
                  frequency: 'One-time',
                  quantity: 1,
                  unitPrice: b.monthlyAmount,
                  totalPrice: b.monthlyAmount,
                }))
              : lineItems,
            branchBreakdowns: branchBreakdowns.length > 0 ? branchBreakdowns : undefined,
          }),
      createdAt: now,
      updatedAt: now,
    };

    try {
      dataService.saveProposal(revised, userProfile?.email);
    } catch (err) {
      error('Could not create revision', err instanceof Error ? err.message : String(err));
      return;
    }

    if (revised.status === 'pending_approval') {
      warning('Approval required (AP-01)', `Discount ${discountPercent}% is above 10%. Sent for Sales Manager / CEO approval.`);
    } else {
      success('Revision created', `${id} (R${newRev}) is a draft.`);
    }

    fileProposalPdf(revised, { email: userProfile?.email, displayName: userProfile?.displayName })
      .then((doc) => { if (!doc) warning('PDF not filed', 'File storage is not configured or you are offline.'); })
      .catch((err) => warning('PDF not filed', err instanceof Error ? err.message : String(err)));

    onRevised(revised);
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Revise proposal ${p.id}`}
      subtitle={`${p.customerName} · R${p.revisionNumber} → R${p.revisionNumber + 1}`}
      maxWidth="700px"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={problems.length > 0} title={problems.join('\n')}>
            Create revision
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Change reason */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Reason for revision <span className="required">*</span></label>
          <input
            className="form-input"
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            placeholder="e.g. Client requested price reduction, added one site"
          />
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
            {plan.map((row, i) => (
              <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.4rem', alignItems: 'center', marginBottom: '0.3rem' }}>
                <input
                  className="form-input"
                  placeholder="Service / treatment"
                  value={row.service}
                  onChange={(e) => setPlan((prev) => prev.map((r, idx) => idx === i ? { ...r, service: e.target.value } : r))}
                />
                <input
                  className="form-input"
                  placeholder="Frequency (e.g. Once per week)"
                  value={row.frequency}
                  onChange={(e) => setPlan((prev) => prev.map((r, idx) => idx === i ? { ...r, frequency: e.target.value } : r))}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setPlan((prev) => prev.filter((_, idx) => idx !== i))}
                  title="Remove row"
                >
                  <Trash2 size={14} color="var(--ikpm-rose-400)" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setPlan((prev) => [...prev, { id: `sp_${Date.now()}`, service: '', frequency: '' }])}
            >
              <Plus size={13} /> Add service row
            </button>

            {/* Per-branch pricing if applicable */}
            {branchBreakdowns.length > 0 && (
              <>
                <div className="section-title">Site charges</div>
                {branchBreakdowns.map((b, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.2rem' }}>{b.branchName}</div>
                      <input
                        type="number"
                        min={0}
                        className="form-input"
                        value={b.monthlyAmount || ''}
                        placeholder="Monthly amount (PKR)"
                        onChange={(e) => setBranchBreakdowns((prev) => prev.map((r, i) => i === idx ? { ...r, monthlyAmount: Number(e.target.value) } : r))}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        style={{ marginTop: '1.4rem' }}
                        onClick={() => {
                          const svcOpts = p.branchBreakdowns?.find((bb) => bb.branchId === b.branchId)?.services || [];
                          setBranchBreakdowns((prev) => prev.map((r, i) => i === idx ? { ...r, services: [...(r.services || svcOpts), { service: 'general_fumigation' }] } : r));
                        }}
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  </div>
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
            <div className="section-title" style={{ marginTop: '0.25rem' }}>Services</div>
            {lineItems.map((li, i) => (
              <div key={li.id} className="line-item-row">
                <input
                  className="form-input"
                  placeholder="Service"
                  value={li.serviceName}
                  onChange={(e) => setLine(i, { serviceName: e.target.value })}
                />
                <input
                  type="number"
                  min={1}
                  className="form-input"
                  aria-label="Quantity"
                  value={li.quantity}
                  onChange={(e) => setLine(i, { quantity: Number(e.target.value) })}
                />
                <input
                  type="number"
                  min={0}
                  className="form-input"
                  aria-label="Unit price"
                  placeholder="Unit price"
                  value={li.unitPrice || ''}
                  onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setLineItems((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() =>
                setLineItems((prev) => [
                  ...prev,
                  { id: `li_${Date.now()}`, serviceName: '', targetPest: 'cockroaches' as PestType, chemicalsSuggested: '', treatmentMethod: '', quantity: 1, unitPrice: 0, totalPrice: 0, frequency: 'One-time' },
                ])
              }
            >
              <Plus size={13} /> Add service
            </button>
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
              {p.taxPercent > 0 && <div>Tax ({p.taxPercent}%): <strong>{formatPKR(otTax)}</strong></div>}
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

export default ReviseProposalModal;
