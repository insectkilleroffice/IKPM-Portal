import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Download, UserCheck, Truck, Send, History, FolderUp } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { OutreachHistory } from '../outreach/OutreachHistory';
import { formatDate, formatPKR } from '../../lib/formatters';
import { planPricing } from '../../lib/proposalPlan';
import type { Proposal } from '../../types/proposal';

interface Props {
  proposal: Proposal;
  canApprove: boolean;
  /** CRO and admin can record the client's accept/decline decision. */
  canAccept: boolean;
  pdfBusy: boolean;
  onClose: () => void;
  onExportPdf: () => void;
  onFilePdf: () => void;
  onApprove: () => void;
  onReject: () => void;
  /** Admin requests changes — sends proposal back to CRO as draft with feedback. */
  onRequestChanges?: () => void;
  /** CRO submits a draft proposal for admin approval. */
  onSubmitForApproval?: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onSend?: () => void;
  onAssign?: () => void;
}

/** Proposal details with approval, client decision, contract / job hand-off and sharing. */
export const ProposalDetailModal: React.FC<Props> = ({ proposal: p, canApprove, canAccept, pdfBusy, onClose, onExportPdf, onFilePdf, onApprove, onReject, onRequestChanges, onSubmitForApproval, onAccept, onDecline, onSend, onAssign }) => {
  const navigate = useNavigate();
  const isPlan = Boolean(p.servicePlan?.length);
  const pricing = isPlan
    ? planPricing({ monthlyRate: p.monthlyRate ?? 0, taxMode: p.taxMode ?? 'exclusive', taxPercent: p.taxPercent, tenureMonths: p.tenureMonths ?? 12, discountPercent: p.discountPercent })
    : null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Proposal ${p.id} (R${p.revisionNumber})`}
      subtitle={`${p.customerName}${p.branchName ? ` · ${p.branchName}` : ''} · ${p.status.replace(/_/g, ' ')} · ${formatDate(p.createdAt)}`}
      maxWidth="760px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={onExportPdf} disabled={pdfBusy}>
              <Download size={14} /> <span>PDF</span>
            </button>
            <button className="btn btn-ghost" onClick={onFilePdf} disabled={pdfBusy} title="Save the PDF in the client's Proposals folder">
              <FolderUp size={14} /> <span>Save to client folder</span>
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {p.status === 'pending_approval' && canApprove && (
              <>
                <button className="btn btn-danger" onClick={onReject}>Reject</button>
                {onRequestChanges && (
                  <button className="btn btn-secondary" onClick={onRequestChanges}>Request changes</button>
                )}
                <button className="btn btn-primary" onClick={onApprove}><CheckCircle2 size={15} /> <span>Approve</span></button>
              </>
            )}
            {onSubmitForApproval && p.status === 'draft' && (
              <button className="btn btn-primary" onClick={onSubmitForApproval}><Send size={15} /> <span>Submit for approval</span></button>
            )}
            {canAccept && ['approved', 'sent_to_client', 'negotiation'].includes(p.status) && (
              <>
                <button className="btn btn-secondary" onClick={onDecline}>Client declined</button>
                <button className="btn btn-primary" onClick={onAccept}><CheckCircle2 size={15} /> <span>Client accepted</span></button>
              </>
            )}
            {p.status === 'accepted' && (
              <>
                <button className="btn btn-outline-emerald" onClick={() => { onClose(); navigate(`/operations/jobs?action=new_job&fromProposal=${p.id}`); }} title="One-off service job from this proposal">
                  <Truck size={14} /> <span>One-off job</span>
                </button>
                {onAssign && (
                  <button className="btn btn-primary" onClick={onAssign}>
                    <UserCheck size={14} /> <span>Assign &amp; schedule</span>
                  </button>
                )}
              </>
            )}
            {onSend && (
              <button className="btn btn-secondary" onClick={onSend}><Send size={14} /> <span>Send to client</span></button>
            )}
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
        {p.revisionNumber > 1 && p.revisionsHistory.length > 0 && (() => {
          const latest = p.revisionsHistory[p.revisionsHistory.length - 1];
          return (
            <div style={{ padding: '0.5rem 0.75rem', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '0.4rem', fontSize: '0.82rem', color: '#92400E' }}>
              <strong>Revision R{latest.revisionNumber}</strong> by {latest.changedByName} on {latest.timestamp.slice(0, 10)}
              {latest.changeReason && <> — {latest.changeReason}</>}
            </div>
          );
        })()}
        {p.status === 'accepted' && (
          <div style={{ padding: '0.6rem 0.85rem', background: 'var(--ikpm-emerald-50)', border: '1px solid var(--ikpm-emerald-200)', borderRadius: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div style={{ fontWeight: 700, color: 'var(--ikpm-emerald-800)' }}>✓ Client accepted{p.acceptedDate ? ` on ${p.acceptedDate.slice(0, 10)}` : ''}</div>
            {p.suggestedStartDate && (
              <div style={{ fontSize: '0.82rem', color: 'var(--ikpm-emerald-700)' }}>
                <strong>Suggested job start date:</strong> {p.suggestedStartDate} — Operations: use this when creating the contract.
              </div>
            )}
            {p.acceptanceNote && <div style={{ fontSize: '0.82rem', color: 'var(--ikpm-emerald-700)' }}><strong>Note:</strong> {p.acceptanceNote}</div>}
          </div>
        )}
        {p.approval && p.approval.status !== 'changes_requested' && (
          <div className={p.approval.status === 'approved' ? 'info-hint' : 'error-hint'}>
            <strong>Approval:</strong> {p.approval.status} ({p.approval.ruleId}). {p.approval.ruleDescription}
            {p.approval.rejectionReason && <div><strong>Reason:</strong> {p.approval.rejectionReason}</div>}
          </div>
        )}
        {p.status === 'draft' && p.approval?.status === 'changes_requested' && (
          <div style={{ padding: '0.6rem 0.85rem', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '0.4rem', color: '#92400E', fontSize: '0.83rem' }}>
            <strong>Changes requested{p.approval.decisionByName ? ` by ${p.approval.decisionByName}` : ''}</strong>
            {p.approval.comments && <div style={{ marginTop: '0.3rem' }}>{p.approval.comments}</div>}
            <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#78350F' }}>Edit the proposal then send to client directly — no re-approval needed.</div>
          </div>
        )}

        {isPlan ? (
          <>
            {p.attentionTo && <div><span className="cell-sub">Addressed to</span><div><strong>{p.attentionTo.name}</strong>{p.attentionTo.designation ? `, ${p.attentionTo.designation}` : ''}{p.clientAddress ? ` · ${p.clientAddress}` : ''}</div></div>}
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr><th style={{ width: 36 }}>#</th><th>Monthly IPM service plan</th><th>Frequency</th></tr>
                </thead>
                <tbody>
                  {p.servicePlan!.map((row, i) => (
                    <tr key={row.id}><td>{i + 1}</td><td><strong>{row.service}</strong></td><td>{row.frequency}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="detail-list">
              <dt>Visits / month</dt><dd>{p.serviceVisitsPerMonth ?? '—'} service · {p.followUpVisitsPerMonth ?? 0} follow-up</dd>
              {(p.pcoCountMin || p.pcoCountMax) && (
                <><dt>PCOs per visit</dt><dd>{p.pcoCountMin === p.pcoCountMax ? p.pcoCountMin : `${p.pcoCountMin}–${p.pcoCountMax}`} (as per client requirement)</dd></>
              )}
              <dt>Tenure</dt><dd>{p.tenureMonths} months</dd>
              <dt>Monthly</dt><dd>{formatPKR(pricing!.monthlyBase)} + tax {p.taxPercent}% = <strong>{formatPKR(pricing!.monthlyTotal)}</strong> ({p.taxMode === 'inclusive' ? 'entered inclusive of tax' : 'exclusive of tax'})</dd>
              <dt>Payment</dt><dd>Within {p.paymentTermsDays ?? 15} days of invoice</dd>
              {p.documentationIncluded?.length ? (<><dt>Documentation</dt><dd>{p.documentationIncluded.join(', ')}</dd></>) : null}
              {p.exclusions && (<><dt>Exclusions</dt><dd>{p.exclusions}</dd></>)}
              {p.deviceOwnership && (<><dt>Devices</dt><dd>{p.deviceOwnership}</dd></>)}
            </dl>
          </>
        ) : (
          <>
            <div><strong>Scope of work</strong><p style={{ color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{p.scopeOfWork}</p></div>
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Service</th><th>Target pest</th><th>Qty</th><th>Total</th></tr></thead>
                <tbody>
                  {p.lineItems.map((li) => (
                    <tr key={li.id}>
                      <td><strong>{li.serviceName}</strong><div className="cell-sub">{li.chemicalsSuggested}</div></td>
                      <td>{li.targetPest.replace(/_/g, ' ')}</td>
                      <td>{li.quantity}</td>
                      <td style={{ fontWeight: 700 }}>{formatPKR(li.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="pricing-summary">
          <div>Subtotal: {formatPKR(p.subtotal)}</div>
          {p.discountPercent > 0 && <div>Discount ({p.discountPercent}%): -{formatPKR(p.discountAmount)}</div>}
          {p.taxPercent > 0 && <div>Sales tax ({p.taxPercent}%): {formatPKR(p.taxAmount)}</div>}
          <div className="pricing-grand">Total: {formatPKR(p.totalAmount)}</div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem' }}>
          <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 4 }}><History size={14} /> Revisions</h4>
          {p.revisionsHistory.map((rev) => (
            <div key={rev.revisionNumber} className="cell-sub" style={{ padding: '2px 0' }}>
              R{rev.revisionNumber} ({rev.timestamp.slice(0, 10)}) by {rev.changedByName}: {rev.changeReason} · {formatPKR(rev.totalAmount)}
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem' }}>
          <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 4 }}><Send size={14} /> Sent to client</h4>
          <OutreachHistory related={{ kind: 'proposal', id: p.id }} emptyText="Not shared with the client yet." />
        </div>
      </div>
    </Modal>
  );
};

export default ProposalDetailModal;
