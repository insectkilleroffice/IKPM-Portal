// Proposal approval: admins / super admin skip their own queue; the approver's note reaches the client.
import { describe, expect, it } from 'vitest';
import { approverStamp, changesNoteForClient, initialApproval } from '../features/proposals/proposalApproval';
import { buildPitchMessage } from '../services/outreachService';

const admin = { email: 'boss@ikpm.pk', displayName: 'Boss' };

describe('proposal approval', () => {
  it('an approver\'s new proposal is approved straight away, even above 10% discount', () => {
    const r = initialApproval(true, 25, admin);
    expect(r.status).toBe('approved');
    expect(r.approval?.status).toBe('approved');
    expect(r.approval?.decisionByName).toBe('Boss');
  });

  it('a CRO\'s proposal waits for approval only above 10% discount', () => {
    expect(initialApproval(false, 25, admin).status).toBe('pending_approval');
    expect(initialApproval(false, 5, admin).status).toBe('draft');
  });

  it('keeps the original request and adds the note of changes', () => {
    const base = { ruleId: 'AP-01' as const, ruleDescription: 'Discount', requiredRole: 'ceo' as const, status: 'pending' as const, requestedAt: '2026-11-01', requestedBy: 'cro@ikpm.pk', requestedByName: 'CRO' };
    const stamp = approverStamp(admin, ' Rate lowered to 45,000 ', base);
    expect(stamp).toMatchObject({ ruleId: 'AP-01', requestedByName: 'CRO', status: 'approved', changesNote: 'Rate lowered to 45,000' });
  });

  it('the note of changes is added to the message sent to the client', () => {
    const note = changesNoteForClient({ approval: approverStamp(admin, 'Quarterly fumigation added') });
    expect(note).toBe('Changes made on review: Quarterly fumigation added');
    const { message } = buildPitchMessage({ recipientName: 'Ali Khan', senderName: 'CRO', purpose: 'proposal', proposalRef: 'P-1 R0', extraNote: note });
    expect(message).toContain('Changes made on review: Quarterly fumigation added');
    expect(changesNoteForClient({ approval: undefined })).toBeUndefined();
  });
});
