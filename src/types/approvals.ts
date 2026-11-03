export type ApprovalType =
  | 'proposal_discount'
  | 'contract_cancel'
  | 'contract_reactivate'
  | 'invoice_void'
  | 'credit_note'
  | 'complaint_refund'
  | 'contract_settlement'
  | 'other';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  proposal_discount: 'Proposal discount',
  contract_cancel: 'Contract cancellation',
  contract_reactivate: 'Contract reactivation',
  invoice_void: 'Invoice void',
  credit_note: 'Credit note',
  complaint_refund: 'Complaint refund / compensation',
  contract_settlement: 'Cancelled contract settlement',
  other: 'Other',
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export interface Approval {
  id: string;
  type: ApprovalType;
  entityType: string;
  entityId: string;
  entityTitle: string;
  /** Requester's UID — used for Firestore scoping so owners can read their own requests. */
  ownerUid: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  reason: string;
  amount?: number;
  /** Contract cancellation requests: reason category and last day of service, applied on approval. */
  cancelCategory?: string;
  effectiveDate?: string;
  status: ApprovalStatus;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  decisionNote?: string;
  /** Cancelled-contract settlement report: Finance's recommendation, and the super admin's decision. */
  settlementBasis?: 'visits_done' | 'full_month' | 'no_charge';
  settlementDecision?: 'visits_done' | 'full_month' | 'no_charge';
  /** Invoice created on the decision. */
  settlementInvoiceId?: string;
  updatedAt: string;
}
