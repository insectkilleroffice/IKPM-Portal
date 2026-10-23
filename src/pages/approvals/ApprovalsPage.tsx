import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Clock, Ban, Filter } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { useNotification } from '../../contexts/NotificationContext';
import { canEditModule } from '../../lib/permissions';
import { dataService } from '../../services/dataService';
import { formatDate } from '../../lib/formatters';
import { APPROVAL_TYPE_LABELS, APPROVAL_STATUS_LABELS } from '../../types/approvals';
import type { ApprovalStatus, ApprovalType } from '../../types/approvals';

const STATUS_BADGE: Record<ApprovalStatus, string> = {
  pending: 'badge-amber',
  approved: 'badge-emerald',
  rejected: 'badge-red',
  cancelled: 'badge-gray',
};

const ENTITY_LINKS: Record<string, (id: string) => string> = {
  proposal: (id) => `/proposals?proposal=${id}`,
  contract: (id) => `/contracts?contract=${id}`,
  invoice: (id) => `/finance/invoices?invoice=${id}`,
  complaint: (id) => `/complaints?id=${id}`,
};

export const ApprovalsPage: React.FC = () => {
  const navigate = useNavigate();
  const { userProfile, effectiveRole } = useAuth();
  useDataStore();
  const { success, error } = useNotification();

  const canApprove = canEditModule(effectiveRole, 'approvals');
  const uid = userProfile?.uid ?? '';

  // Managers see all; requesters see only their own
  const all = canApprove
    ? dataService.getApprovals()
    : dataService.getApprovals(uid);

  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<ApprovalType | 'all'>('all');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  const filtered = all.filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (typeFilter !== 'all' && a.type !== typeFilter) return false;
    return true;
  });

  const pendingCount = all.filter((a) => a.status === 'pending').length;

  const decide = (id: string, decision: 'approved' | 'rejected') => {
    if (!decisionNote.trim()) {
      error('Comment required', 'Please enter a decision comment before proceeding.');
      return;
    }
    try {
      dataService.decideApproval(
        id,
        decision,
        decisionNote.trim(),
        userProfile?.email ?? '',
        userProfile?.displayName ?? userProfile?.email ?? '',
        uid,
        userProfile?.email,
      );
      success(
        decision === 'approved' ? 'Request approved' : 'Request rejected',
        `Approval ${id} has been ${decision}.`,
      );
      setDeciding(null);
      setDecisionNote('');
    } catch (err) {
      error('Could not update approval', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', letterSpacing: '-0.02em' }}>
            Approvals
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {canApprove
              ? `${pendingCount} request${pendingCount !== 1 ? 's' : ''} pending your decision`
              : 'Your approval requests'}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={15} color="var(--text-muted)" />
        <select
          className="form-input"
          style={{ width: 'auto' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ApprovalStatus | 'all')}
        >
          <option value="all">All statuses</option>
          {(['pending', 'approved', 'rejected', 'cancelled'] as ApprovalStatus[]).map((s) => (
            <option key={s} value={s}>{APPROVAL_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select
          className="form-input"
          style={{ width: 'auto' }}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ApprovalType | 'all')}
        >
          <option value="all">All types</option>
          {(Object.keys(APPROVAL_TYPE_LABELS) as ApprovalType[]).map((t) => (
            <option key={t} value={t}>{APPROVAL_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {/* Counters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {([
          { label: 'Pending', status: 'pending', icon: Clock, color: 'var(--ikpm-amber-600)' },
          { label: 'Approved', status: 'approved', icon: CheckCircle2, color: 'var(--ikpm-emerald-600)' },
          { label: 'Rejected', status: 'rejected', icon: XCircle, color: '#DC2626' },
          { label: 'Cancelled', status: 'cancelled', icon: Ban, color: 'var(--text-muted)' },
        ] as const).map(({ label, status, icon: Icon, color }) => {
          const count = all.filter((a) => a.status === status).length;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem',
                borderRadius: 'var(--radius-md)', border: `1px solid ${statusFilter === status ? color : 'var(--border-subtle)'}`,
                backgroundColor: statusFilter === status ? 'var(--bg-surface-alt)' : 'var(--bg-surface)',
                cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color,
              }}
            >
              <Icon size={14} />
              {count} {label}
            </button>
          );
        })}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="empty-hint">No approval requests match your filters.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtered.map((a) => {
            const isDeciding = deciding === a.id;
            const entityLink = ENTITY_LINKS[a.entityType];
            return (
              <div key={a.id} className="card" style={{ padding: '1rem 1.25rem', borderLeft: `4px solid ${a.status === 'pending' ? 'var(--ikpm-amber-400)' : a.status === 'approved' ? 'var(--ikpm-emerald-400)' : 'var(--border-subtle)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{a.id}</span>
                      <span className={`badge-status ${STATUS_BADGE[a.status]}`}>{APPROVAL_STATUS_LABELS[a.status]}</span>
                      <span className="badge-status badge-navy" style={{ fontSize: '0.68rem' }}>{APPROVAL_TYPE_LABELS[a.type]}</span>
                    </div>
                    <div style={{ fontWeight: 600, marginTop: '0.35rem' }}>{a.entityTitle}</div>
                    <div className="cell-sub" style={{ marginTop: '0.2rem' }}>
                      Requested by {a.requestedByName || a.requestedBy} · {formatDate(a.requestedAt)}
                    </div>
                    <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{a.reason}</div>
                    {a.amount !== undefined && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Amount: <strong>PKR {a.amount.toLocaleString()}</strong>
                      </div>
                    )}
                    {a.status !== 'pending' && a.decidedAt && (
                      <div className="cell-sub" style={{ marginTop: '0.3rem' }}>
                        {a.status === 'approved' ? '✓ Approved' : '✗ Rejected'} by {a.decidedByName || a.decidedBy} on {formatDate(a.decidedAt)}
                        {a.decisionNote && <> · &ldquo;{a.decisionNote}&rdquo;</>}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
                    {entityLink && (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => navigate(entityLink(a.entityId))}
                      >
                        View record
                      </button>
                    )}
                    {canApprove && a.status === 'pending' && a.ownerUid !== uid && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => { setDeciding(isDeciding ? null : a.id); setDecisionNote(''); }}
                      >
                        {isDeciding ? 'Cancel' : 'Decide'}
                      </button>
                    )}
                  </div>
                </div>

                {isDeciding && (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label className="form-label">Decision comment (required)</label>
                    <textarea
                      className="form-input"
                      rows={2}
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      placeholder="Explain your decision…"
                      style={{ resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        style={{ backgroundColor: 'var(--ikpm-emerald-600)' }}
                        onClick={() => decide(a.id, 'approved')}
                      >
                        <CheckCircle2 size={14} /> Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        style={{ color: '#DC2626', borderColor: '#DC2626' }}
                        onClick={() => decide(a.id, 'rejected')}
                      >
                        <XCircle size={14} /> Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ApprovalsPage;
