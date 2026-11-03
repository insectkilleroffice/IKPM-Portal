// Proposal approval helpers.
// Admins and the super admin are the approvers, so a proposal they prepare (or revise) is approved
// straight away instead of waiting in their own queue, where nobody may decide their own request.

import type { ApprovalRequest, Proposal } from '../../types/proposal';

interface Who {
  email?: string;
  displayName?: string;
}

/** Approval stamp for a proposal prepared by an approver. */
export function approverStamp(user: Who | null | undefined, changesNote?: string, base?: ApprovalRequest): ApprovalRequest {
  const ts = new Date().toISOString();
  return {
    ruleId: base?.ruleId || 'AP-ADMIN',
    ruleDescription: base?.ruleDescription || 'Prepared or reviewed by an admin / super admin: approved.',
    requiredRole: base?.requiredRole || 'admin',
    requestedAt: base?.requestedAt || ts,
    requestedBy: base?.requestedBy || user?.email || '',
    requestedByName: base?.requestedByName || user?.displayName || '',
    ...(base?.comments ? { comments: base.comments } : {}),
    status: 'approved',
    decisionAt: ts,
    decisionBy: user?.email || '',
    decisionByName: user?.displayName || '',
    ...(changesNote?.trim() ? { changesNote: changesNote.trim() } : {}),
  };
}

/** Status and approval for a new proposal or revision: approvers skip the queue. */
export function initialApproval(isApprover: boolean, discountPercent: number, user: Who | null | undefined): Pick<Proposal, 'status' | 'approval'> {
  if (isApprover) return { status: 'approved', approval: approverStamp(user) };
  return { status: discountPercent > 10 ? 'pending_approval' : 'draft', approval: undefined };
}

/** Text added to the client message when the approver changed the proposal. */
export function changesNoteForClient(p: Pick<Proposal, 'approval'>): string | undefined {
  const note = p.approval?.status === 'approved' ? p.approval.changesNote?.trim() : undefined;
  return note ? `Changes made on review: ${note}` : undefined;
}
