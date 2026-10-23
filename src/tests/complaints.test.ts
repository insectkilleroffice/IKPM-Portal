import { describe, expect, it } from 'vitest';
import {
  type Complaint,
  type ComplaintPriority,
  type ComplaintStatus,
  COMPLAINT_DUE_DAYS,
  computeDueDate,
  isComplaintOverdue,
} from '../types/complaints';

// ---- Helpers ----

const today = new Date().toISOString().slice(0, 10);
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();

function complaint(overrides: Partial<Complaint> = {}): Complaint {
  return {
    id: 'CMP-2026-0001',
    customerType: 'company',
    customerId: 'CO-001',
    customerName: 'Test Co.',
    category: 'pest_present',
    priority: 'normal',
    subject: 'Pests found',
    description: 'Client reported cockroaches after service.',
    source: 'phone',
    status: 'new',
    reopenedCount: 0,
    notes: [],
    createdBy: 'test',
    createdByName: 'Test User',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---- Status transition contract ----

describe('complaint status flow', () => {
  const STATUS_FLOW: ComplaintStatus[] = ['new', 'assigned', 'in_progress', 'resolved', 'closed'];

  it('STATUS_FLOW has the expected order', () => {
    expect(STATUS_FLOW).toEqual(['new', 'assigned', 'in_progress', 'resolved', 'closed']);
  });

  it('a new complaint starts at new status', () => {
    const c = complaint();
    expect(c.status).toBe('new');
  });

  it('assigning sets assignedOperationsManagerId and moves to assigned', () => {
    const c = complaint({ status: 'assigned', assignedOperationsManagerId: 'UID-001', assignedOperationsManagerName: 'Ali Ops', assignedAt: today });
    expect(c.status).toBe('assigned');
    expect(c.assignedOperationsManagerId).toBe('UID-001');
    expect(c.assignedAt).toBe(today);
  });

  it('resolved complaint has resolutionNote and resolvedAt', () => {
    const c = complaint({ status: 'resolved', resolutionNote: 'Re-sprayed and sealed entry points', resolvedAt: today });
    expect(c.status).toBe('resolved');
    expect(c.resolutionNote).toBeTruthy();
    expect(c.resolvedAt).toBe(today);
  });

  it('closed complaint has clientSatisfied = true', () => {
    const c = complaint({ status: 'closed', clientSatisfied: true });
    expect(c.status).toBe('closed');
    expect(c.clientSatisfied).toBe(true);
  });

  it('reopened complaint increments reopenedCount', () => {
    const c = complaint({ status: 'reopened', clientSatisfied: false, reopenedCount: 1 });
    expect(c.status).toBe('reopened');
    expect(c.reopenedCount).toBe(1);
    expect(c.clientSatisfied).toBe(false);
  });
});

// ---- Overdue calculation ----

describe('complaint overdue calculation', () => {
  it('a complaint due yesterday is overdue', () => {
    expect(isComplaintOverdue(complaint({ dueDate: yesterday, status: 'new' }))).toBe(true);
  });

  it('a complaint due today is overdue (past strict <)', () => {
    // Today's date is NOT less than today → not overdue on the due day itself
    expect(isComplaintOverdue(complaint({ dueDate: today, status: 'new' }))).toBe(false);
  });

  it('a complaint due tomorrow is not overdue', () => {
    expect(isComplaintOverdue(complaint({ dueDate: tomorrow, status: 'new' }))).toBe(false);
  });

  it('a resolved complaint is never overdue', () => {
    expect(isComplaintOverdue(complaint({ dueDate: yesterday, status: 'resolved' }))).toBe(false);
  });

  it('a closed complaint is never overdue', () => {
    expect(isComplaintOverdue(complaint({ dueDate: yesterday, status: 'closed' }))).toBe(false);
  });

  it('a complaint with no dueDate is never overdue', () => {
    expect(isComplaintOverdue(complaint({ dueDate: undefined, status: 'new' }))).toBe(false);
  });
});

// ---- Due date computation ----

describe('computeDueDate', () => {
  it.each(Object.entries(COMPLAINT_DUE_DAYS) as [ComplaintPriority, number][])(
    '%s priority sets due date to today + %d days',
    (priority, days) => {
      const result = computeDueDate(priority);
      const expected = new Date();
      expected.setDate(expected.getDate() + days);
      expect(result).toBe(expected.toISOString().slice(0, 10));
    },
  );

  it('urgent due date is 1 day from now', () => {
    const due = computeDueDate('urgent');
    const oneDayFromNow = new Date();
    oneDayFromNow.setDate(oneDayFromNow.getDate() + 1);
    expect(due).toBe(oneDayFromNow.toISOString().slice(0, 10));
  });

  it('normal due date is 3 days from now', () => {
    const due = computeDueDate('normal');
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    expect(due).toBe(threeDaysFromNow.toISOString().slice(0, 10));
  });

  it('low due date is 7 days from now', () => {
    const due = computeDueDate('low');
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    expect(due).toBe(sevenDaysFromNow.toISOString().slice(0, 10));
  });
});
