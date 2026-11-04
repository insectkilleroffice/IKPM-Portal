import React, { useState, useSyncExternalStore } from 'react';
import { companyProfile } from '../../services/companyProfile';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';

/** Operations rules that the portal really uses: late grace period, complaint escalation, audit interval. */
export const OperationsRulesCard: React.FC = () => {
  const live = useSyncExternalStore(companyProfile.subscribe, companyProfile.get);
  const { userProfile, isSuperAdmin } = useAuth();
  const { success, error } = useNotification();
  const [grace, setGrace] = useState(String(live.payrollRules?.lateGraceMinutes ?? 0));
  const [escalation, setEscalation] = useState(String(live.complaintEscalationHours ?? 48));
  const [audit, setAudit] = useState(String(live.auditIntervalDays ?? 30));
  const [busy, setBusy] = useState(false);
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  const save = async () => {
    if (num(escalation) < 1) return error('Check the rules', 'Complaint escalation must be at least 1 hour.');
    if (num(audit) < 1) return error('Check the rules', 'Audit interval must be at least 1 day.');
    setBusy(true);
    try {
      const cur = companyProfile.get();
      await companyProfile.save({
        ...cur,
        payrollRules: { ...cur.payrollRules, lateGraceMinutes: num(grace) },
        complaintEscalationHours: num(escalation),
        auditIntervalDays: num(audit),
      }, userProfile?.email || '');
      success('Rules saved', 'Attendance, complaint alerts and audit scheduling now use them.');
    } catch (err) {
      error('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      <div className="form-group">
        <label className="form-label">Late arrival grace period (minutes)</label>
        <input type="number" min={0} className="form-input" value={grace} disabled={!isSuperAdmin} onChange={(e) => setGrace(e.target.value)} />
        <span className="cell-sub">Arriving within this many minutes of the work start time is not marked Late.</span>
      </div>
      <div className="form-group">
        <label className="form-label">Complaint escalation (hours)</label>
        <input type="number" min={1} className="form-input" value={escalation} disabled={!isSuperAdmin} onChange={(e) => setEscalation(e.target.value)} />
        <span className="cell-sub">Complaints open longer than this alert the CEO.</span>
      </div>
      <div className="form-group">
        <label className="form-label">Quality audit interval (days)</label>
        <input type="number" min={1} className="form-input" value={audit} disabled={!isSuperAdmin} onChange={(e) => setAudit(e.target.value)} />
        <span className="cell-sub">Random entomologist audits pick sites not audited for this many days.</span>
      </div>
      {isSuperAdmin && (
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save rules'}</button>
        </div>
      )}
    </div>
  );
};
