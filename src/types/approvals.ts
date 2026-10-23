export type ApprovalType =
  | 'proposal_discount'
  | 'contract_cancel'
  | 'contract_reactivate'
  | 'invoice_void'
  | 'credit_note'
  | 'complaint_refund'
  | 'other';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  proposal_discount: 'Proposal discount',
  contract_cancel: 'Contract cancellation',
  contract_reactivate: 'Contract reactivation',
  invoice_void: 'Invoice void',
  credit_note: 'Credit note',
  complaint_refund: 'Complaint refund / compensation',
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
  status: ApprovalStatus;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  decisionNote?: string;
  updatedAt: string;
}
