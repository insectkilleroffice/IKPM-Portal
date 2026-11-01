import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Save } from 'lucide-react';
import { companyProfile, type CompanyProfile } from '../../services/companyProfile';
import { DEFAULT_PAYROLL_RULES, payrollRulesFrom } from '../../lib/payroll';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';

type Rules = NonNullable<CompanyProfile['payrollRules']>;

const FIELDS: { key: keyof Rules; label: string; hint: string; step?: number }[] = [
  { key: 'workStartTime', label: 'Work start time', hint: 'Arriving after this time marks the person Late on the attendance sheet.' },
  { key: 'standardHoursPerDay', label: 'Normal hours per day', hint: 'Hourly rate = basic salary ÷ 30 ÷ these hours.', step: 0.5 },
  { key: 'overtimeMultiplier', label: 'Overtime pay multiplier', hint: '2 = double the normal hourly rate (Pakistani labour law for factories / shops). 1 = same rate.', step: 0.25 },
  { key: 'lateMarksPerAbsence', label: 'Late marks per 1 day deduction', hint: 'e.g. 3 lates = 1 day’s basic salary deducted. 0 = no late deduction.' },
  { key: 'absenceDeductionRatio', label: 'Absence deduction (× daily wage)', hint: '1 = one full day’s basic salary per absent day.', step: 0.25 },
  { key: 'jobIncentivePerUnit', label: 'PCO incentive per verified job (PKR)', hint: 'Added for each job that passed the quality check.' },
];

/** Settings → Payroll: the rules every salary cycle uses (saved in the company profile). */
export const PayrollRulesCard: React.FC = () => {
  const { isSuperAdmin, userProfile } = useAuth();
  const { success, error } = useNotification();
  const live = useSyncExternalStore(companyProfile.subscribe, companyProfile.get);
  const effective = payrollRulesFrom(live.payrollRules);
  const initial = (): Record<keyof Rules, string> => ({
    workStartTime: live.payrollRules?.workStartTime || '08:30',
    standardHoursPerDay: String(effective.standardHoursPerDay),
    overtimeMultiplier: String(effective.overtimeMultiplier),
    lateMarksPerAbsence: String(effective.lateMarksPerAbsence),
    absenceDeductionRatio: String(effective.absenceDeductionRatio),
    jobIncentivePerUnit: String(effective.jobIncentivePerUnit),
  });
  const [form, setForm] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!dirty) setForm(initial()); }, [live, dirty]);

  const hourly = Math.round(30000 / 30 / (Number(form.standardHoursPerDay) || DEFAULT_PAYROLL_RULES.standardHoursPerDay));
  const otExample = Math.round(hourly * (Number(form.overtimeMultiplier) || 0));

  const save = async () => {
    const nums = ['standardHoursPerDay', 'overtimeMultiplier', 'lateMarksPerAbsence', 'absenceDeductionRatio', 'jobIncentivePerUnit'] as const;
    const bad = nums.find((k) => form[k].trim() === '' || !(Number(form[k]) >= 0));
    if (bad) return error('Check the payroll rules', `${FIELDS.find((f) => f.key === bad)?.label} must be a number (0 or more).`);
    if (!(Number(form.standardHoursPerDay) > 0)) return error('Check the payroll rules', 'Normal hours per day must be more than 0.');
    if (!/^\d{2}:\d{2}$/.test(form.workStartTime)) return error('Check the payroll rules', 'Work start time must be like 08:30.');
    setSaving(true);
    try {
      const payrollRules: Rules = { workStartTime: form.workStartTime };
      nums.forEach((k) => { payrollRules[k] = Number(form[k]); });
      await companyProfile.save({ ...companyProfile.get(), payrollRules }, userProfile?.email || '');
      setDirty(false);
      success('Payroll rules saved', 'New salary cycles use these rules.');
    } catch (err) {
      error('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', margin: 0 }}>Attendance &amp; payroll rules</h3>
        {isSuperAdmin && (
          <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save rules'}
          </button>
        )}
      </div>
      <p className="cell-sub" style={{ marginBottom: '1rem' }}>
        Attendance is automatic: everyone counts as present unless marked late, absent, half day or leave. Overtime hours entered on the
        daily sheet are paid from each person’s salary. Applies to all employees. Only the super admin can change these.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
        {FIELDS.map((f) => (
          <div key={f.key} className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">{f.label}</label>
            <input
              className="form-input"
              type={f.key === 'workStartTime' ? 'time' : 'number'}
              min={0}
              step={f.step ?? 1}
              value={form[f.key]}
              disabled={!isSuperAdmin}
              onChange={(e) => { setForm({ ...form, [f.key]: e.target.value }); setDirty(true); }}
            />
            <span className="cell-sub">{f.hint}</span>
          </div>
        ))}
      </div>
      <div className="info-hint" style={{ marginTop: '1rem' }}>
        Example: basic salary PKR 30,000 → normal rate PKR {hourly.toLocaleString()}/hour → overtime PKR {otExample.toLocaleString()} per hour.
        A fixed overtime rate on an employee’s pay record overrides this.
      </div>
    </div>
  );
};
