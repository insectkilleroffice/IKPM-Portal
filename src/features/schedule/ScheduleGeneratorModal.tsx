import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Download,
  AlertTriangle,
  CheckCircle,
  Save,
  Store,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { formatDate } from '../../lib/formatters';
import {
  pcoConflicts,
  planVisits,
  visitsPerMonth,
  type PlannedVisit,
  type ScheduleBranch,
  type TimeSlot,
} from '../../lib/visitSchedule';
import { opsPdf } from '../../lib/opsPdf';
import { fileGenerated } from '../documents/fileGenerated';
import type { Contract } from '../../types/operations';
import type { CompanyBranch } from '../../types/customer';
import type { DocumentOwner } from '../../types/document';

interface Props {
  contract: Contract;
  onClose: () => void;
}

const DEFAULT_HOLIDAYS = [
  '2026-03-23', // Pakistan Day
  '2026-05-01', // Labour Day
  '2026-08-14', // Independence Day
  '2026-11-09', // Iqbal Day
  '2026-12-25', // Quaid-e-Azam Day
];

export const ScheduleGeneratorModal: React.FC<Props> = ({ contract, onClose }) => {
  const store = useDataStore();
  const { userProfile } = useAuth();
  const { success, error } = useNotification();

  const technicians = store.getStaff(['team_leader']);
  // Exclude this contract's own jobs so regenerating a schedule doesn't flag self-conflicts
  const existingJobs = store.getJobs().filter((j) => j.contractId !== contract.id);

  // Load branches for the contract
  const companyBranches: CompanyBranch[] = useMemo(() => {
    if (contract.customerType === 'company') {
      if (contract.branchId) {
        const br = store.getBranchById(contract.branchId);
        return br ? [br] : [];
      }
      return store.getBranches(contract.customerId);
    }
    return [];
  }, [contract, store]);

  // Initial branch timing state
  const [branchConfigs, setBranchConfigs] = useState<ScheduleBranch[]>(() => {
    if (companyBranches.length > 0) {
      return companyBranches.map((b) => ({
        id: b.id,
        name: b.branchName,
        closingTime: b.closingTime || '22:00',
        windowStart: b.visitWindowStart || '',
        windowEnd: b.visitWindowEnd || '',
      }));
    }
    return [
      {
        id: contract.branchId || 'main',
        name: contract.branchName || contract.customerName || 'Main Facility',
        closingTime: '20:00',
        windowStart: '09:00',
        windowEnd: '18:00',
      },
    ];
  });

  const [skipSundays, setSkipSundays] = useState(true);
  const [followUpGapDays, setFollowUpGapDays] = useState(3);
  const [holidaysText, setHolidaysText] = useState(DEFAULT_HOLIDAYS.join(', '));
  // Pre-select from contract's assigned TL; fall back to first in list
  const [defaultPcoId, setDefaultPcoId] = useState<string>(
    () => technicians.find((t) => t.uid === contract.assignedTeamLeaderId)?.uid || technicians[0]?.uid || ''
  );
  const [isExporting, setIsExporting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const isOneOff = contract.frequency === 'one_off' || contract.contractType === 'one_time';

  // Visit rates come directly from the contract/proposal — not re-entered in the form
  const rates = useMemo(() => visitsPerMonth(contract), [contract]);
  const serviceVpm = rates.service;
  const followUpVpm = rates.followUp;

  // Actual pest-control services from the contract — visit types and operational activities
  // (Follow-up visit, Supervisor visit, Entomologist visit, Risk assessment) are excluded because
  // they describe the visit itself, not work to be done during it.
  const servicePlanItems: string[] = useMemo(() => {
    const VISIT_TYPE_KEYWORDS = ['visit', 'assessment', 'entomologist'];
    return (contract.servicePlan ?? [])
      .map((s) => s.service)
      .filter((s): s is string =>
        Boolean(s) && !VISIT_TYPE_KEYWORDS.some((kw) => s.toLowerCase().includes(kw))
      );
  }, [contract]);

  // Generate initial planned visits
  const initialVisits = useMemo(() => {
    const holidays = holidaysText
      .split(',')
      .map((h) => h.trim())
      .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h));

    const defaultTech = technicians.find((t) => t.uid === defaultPcoId);

    const planned = planVisits({
      start: contract.startDate,
      end: contract.endDate,
      serviceVisitsPerMonth: isOneOff ? 1 : serviceVpm,
      followUpVisitsPerMonth: followUpVpm,
      branches: branchConfigs,
      skipSundays,
      holidays,
      followUpGapDays,
      maxVisits: isOneOff ? 1 : undefined,
    });

    return planned.map((v) => ({
      ...v,
      pcoId: defaultTech?.uid,
      pcoName: defaultTech?.displayName,
      services: servicePlanItems.length > 0 ? [] : undefined,
    }));
  }, [contract, branchConfigs, skipSundays, holidaysText, followUpGapDays, defaultPcoId, isOneOff, serviceVpm, followUpVpm, servicePlanItems, technicians]);

  const [visits, setVisits] = useState<PlannedVisit[]>(initialVisits);

  // Re-plan with current parameters (called by Regenerate button)
  const handleRegenerate = () => {
    const holidays = holidaysText
      .split(',')
      .map((h) => h.trim())
      .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h));

    const defaultTech = technicians.find((t) => t.uid === defaultPcoId);

    const planned = planVisits({
      start: contract.startDate,
      end: contract.endDate,
      serviceVisitsPerMonth: isOneOff ? 1 : serviceVpm,
      followUpVisitsPerMonth: followUpVpm,
      branches: branchConfigs,
      skipSundays,
      holidays,
      followUpGapDays,
      maxVisits: isOneOff ? 1 : undefined,
    });

    setVisits(
      planned.map((v) => ({
        ...v,
        pcoId: defaultTech?.uid,
        pcoName: defaultTech?.displayName,
        services: servicePlanItems.length > 0 ? [] : undefined,
      }))
    );
    success('Schedule Generated', `Generated ${planned.length} visits across contract tenure.`);
  };

  // Save branch closing times and window configs to database
  const handleSaveBranchTimings = () => {
    let savedCount = 0;
    branchConfigs.forEach((bc) => {
      const orig = companyBranches.find((b) => b.id === bc.id);
      if (orig) {
        const updated: CompanyBranch = {
          ...orig,
          closingTime: bc.closingTime,
          visitWindowStart: bc.windowStart,
          visitWindowEnd: bc.windowEnd,
        };
        store.saveBranch(updated, userProfile?.email);
        savedCount++;
      }
    });
    success('Branch Timings Saved', `Updated operating hours for ${savedCount} branch(es).`);
  };

  // Inline visit update
  const handleUpdateVisit = (key: string, patch: Partial<PlannedVisit>) => {
    setVisits((prev) =>
      prev.map((v) => {
        if (v.key !== key) return v;
        const updated = { ...v, ...patch };
        if (patch.pcoId !== undefined) {
          const tech = technicians.find((t) => t.uid === patch.pcoId);
          updated.pcoName = tech?.displayName || '';
        }
        return updated;
      })
    );
  };

  // Identify double-booking conflicts
  const conflicts = useMemo(() => {
    return pcoConflicts(visits, existingJobs);
  }, [visits, existingJobs]);

  // Export PDF in Dunkin format and file into Documents folder
  const handleExportPdf = async () => {
    try {
      setIsExporting(true);
      const scheduleInput = {
        clientName: contract.customerName,
        contractId: contract.id,
        preparedBy: userProfile?.displayName || 'Operations Staff',
        visits: visits.map((v) => ({
          branchName: v.branchName,
          closingTime: v.closingTime,
          date: v.date,
          kind: v.kind,
          pcoName: v.pcoName,
        })),
      };

      const blob = await opsPdf.scheduleBlob(scheduleInput);
      const fileName = opsPdf.scheduleFileName(scheduleInput);
      const title = `Visit Schedule - ${contract.customerName} (${contract.id})`;

      const owner: DocumentOwner = contract.branchId
        ? { kind: 'branch', id: contract.branchId }
        : contract.customerType === 'company'
        ? { kind: 'company', id: contract.customerId }
        : { kind: 'client', id: contract.customerId };

      await fileGenerated(blob, {
        owner,
        category: 'schedule',
        title,
        fileName,
        subPath: contract.id,
        user: { email: userProfile?.email, displayName: userProfile?.displayName },
      });

      success('Schedule Exported & Auto-Filed', `Saved ${fileName} into client's Documents/schedules folder.`);
    } catch (err) {
      error('Export Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  };

  // Confirm schedule and create service jobs in Firestore
  const handleConfirmSchedule = () => {
    // Guard: check for existing jobs on this contract
    const existingJobs = store.getJobs().filter((j) => j.contractId === contract.id && j.status !== 'cancelled');
    if (existingJobs.length > 0) {
      const proceed = window.confirm(
        `${existingJobs.length} visits already exist for this contract.\n\nCreating a new schedule will cancel all existing scheduled visits and replace them. Proceed?`
      );
      if (!proceed) return;
      existingJobs
        .filter((j) => j.status === 'scheduled')
        .forEach((j) =>
          store.saveJob(
            { ...j, status: 'cancelled', cancellationReason: 'Schedule regenerated', updatedAt: new Date().toISOString() },
            userProfile?.email
          )
        );
    }

    if (conflicts.size > 0) {
      const confirmProceed = window.confirm(
        `There are ${conflicts.size} visits with technician scheduling conflicts (double-bookings). Do you wish to proceed anyway?`
      );
      if (!confirmProceed) return;
    }

    try {
      setIsConfirming(true);
      const created = store.createScheduledJobs(contract, visits, userProfile?.email);
      const tlName = contract.assignedTeamLeaderName || technicians.find((t) => t.uid === defaultPcoId)?.displayName;
      success(
        'Visit Schedule Dispatched',
        `${created.length} service jobs created (${created.filter((j) => j.visitKind === 'service').length} service, ${created.filter((j) => j.visitKind === 'follow_up').length} follow-up)${tlName ? ` · Notified TL: ${tlName}` : ''}.`
      );
      onClose();
    } catch (err) {
      error('Schedule Dispatch Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setIsConfirming(false);
    }
  };

  const serviceCount = visits.filter((v) => v.kind === 'service').length;
  const followUpCount = visits.filter((v) => v.kind === 'follow_up').length;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={store.getJobs().some((j) => j.contractId === contract.id && j.status !== 'cancelled') ? 'Edit Contract Visit Schedule' : 'Generate Contract Visit Schedule'}
      subtitle={`Contract: ${contract.id} • ${contract.customerName} • Term: ${formatDate(contract.startDate)} to ${formatDate(contract.endDate)}`}
      maxWidth="1100px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Top Summary Banner */}
        <div
          style={{
            padding: '1rem',
            backgroundColor: 'var(--bg-surface-alt)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            fontSize: '0.85rem',
          }}
        >
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Customer & Scope:</span>
            <div style={{ fontWeight: 700 }}>{contract.customerName}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{contract.serviceScope}</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Visits per month (from proposal):</span>
            <div style={{ fontWeight: 700 }}>
              {serviceVpm} service{followUpVpm > 0 ? ` + ${followUpVpm} follow-up` : ''} visits/month
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Multiple services can be done in one visit — assign below</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Tenure Window:</span>
            <div style={{ fontWeight: 700 }}>
              {formatDate(contract.startDate)} – {formatDate(contract.endDate)}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--ikpm-emerald-600)', fontWeight: 600 }}>
              {visits.length} Total Visits Planned ({serviceCount} Service, {followUpCount} Follow-up)
            </div>
          </div>
        </div>

        {/* Branch Timing Configurations (Dunkin Schedule Format) */}
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.9rem' }}>
              <Store size={16} color="var(--ikpm-navy-700)" />
              <span>Branch Operating Hours & Service Windows</span>
            </div>
            {companyBranches.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
                onClick={handleSaveBranchTimings}
              >
                <Save size={13} />
                <span>Save Branch Timings</span>
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
            {branchConfigs.map((b, idx) => (
              <div
                key={b.id}
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>{b.name}</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                      Closing Time
                    </label>
                    <input
                      type="time"
                      className="form-input"
                      style={{ height: '30px', fontSize: '0.78rem', padding: '0.2rem 0.4rem' }}
                      value={b.closingTime || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBranchConfigs((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, closingTime: val } : item))
                        );
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                      Window Start
                    </label>
                    <input
                      type="time"
                      className="form-input"
                      style={{ height: '30px', fontSize: '0.78rem', padding: '0.2rem 0.4rem' }}
                      value={b.windowStart || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBranchConfigs((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, windowStart: val } : item))
                        );
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                      Window End
                    </label>
                    <input
                      type="time"
                      className="form-input"
                      style={{ height: '30px', fontSize: '0.78rem', padding: '0.2rem 0.4rem' }}
                      value={b.windowEnd || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBranchConfigs((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, windowEnd: val } : item))
                        );
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Planning Parameters & Controls */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: '1rem',
            padding: '0.85rem 1rem',
            backgroundColor: 'var(--bg-surface-alt)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.825rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={skipSundays}
              onChange={(e) => setSkipSundays(e.target.checked)}
            />
            <span>Skip Sundays</span>
          </label>

          <div style={{ width: '130px' }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
              Follow-up Gap (Days)
            </label>
            <input
              type="number"
              min={1}
              max={14}
              className="form-input"
              style={{ height: '32px', fontSize: '0.8rem' }}
              value={followUpGapDays}
              onChange={(e) => setFollowUpGapDays(Number(e.target.value) || 3)}
            />
          </div>

          <div style={{ minWidth: '220px', flex: 1 }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
              Skip Public Holidays (YYYY-MM-DD)
            </label>
            <input
              type="text"
              className="form-input"
              style={{ height: '32px', fontSize: '0.8rem' }}
              value={holidaysText}
              onChange={(e) => setHolidaysText(e.target.value)}
              placeholder="2026-03-23, 2026-05-01..."
            />
          </div>

          <div style={{ minWidth: '180px' }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
              Assign to Team Leader
            </label>
            <select
              className="form-select"
              style={{ height: '32px', fontSize: '0.8rem' }}
              value={defaultPcoId}
              onChange={(e) => {
                const val = e.target.value;
                setDefaultPcoId(val);
                const tech = technicians.find((t) => t.uid === val);
                setVisits((prev) =>
                  prev.map((v) => ({
                    ...v,
                    pcoId: val,
                    pcoName: tech?.displayName || '',
                  }))
                );
              }}
            >
              <option value="">-- Unassigned --</option>
              {technicians.map((t) => (
                <option key={t.uid} value={t.uid}>
                  {t.displayName}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ height: '32px', padding: '0 0.85rem', fontSize: '0.8rem' }}
            onClick={handleRegenerate}
          >
            <Calendar size={14} />
            <span>Regenerate Plan</span>
          </button>
        </div>

        {/* Double-booking Warnings Banner */}
        {conflicts.size > 0 && (
          <div
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#FEF2F2',
              border: '1px solid #F87171',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              fontSize: '0.825rem',
              color: '#991B1B',
            }}
          >
            <AlertTriangle size={18} color="#DC2626" />
            <div>
              <strong>{conflicts.size} PCO Double-booking Conflict(s) Detected!</strong>
              <div style={{ fontSize: '0.75rem', color: '#B91C1C' }}>
                The flagged technician is assigned to multiple visits or existing jobs in the same time slot. Adjust technician or date below.
              </div>
            </div>
          </div>
        )}

        {/* Planned Visits Editable Table */}
        <div className="table-container" style={{ maxHeight: '420px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>Branch / Location</th>
                <th>Kind</th>
                <th>Services for this visit</th>
                <th>Date</th>
                <th style={{ minWidth: 220 }}>Time Slot & Custom Timing</th>
                <th>Branch Hours</th>
                <th>Assigned Team Leader</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v, i) => {
                const isConflict = conflicts.has(v.key);
                return (
                  <tr key={v.key} style={isConflict ? { backgroundColor: '#FEF2F2' } : undefined}>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{v.branchName}</td>
                    <td>
                      <span
                        className={`badge-status ${v.kind === 'service' ? 'badge-emerald' : 'badge-amber'}`}
                        style={{ fontSize: '0.7rem' }}
                      >
                        {v.kind === 'service' ? 'Service Visit' : 'Follow-up'}
                      </span>
                    </td>
                    <td style={{ minWidth: '180px' }}>
                      {servicePlanItems.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {servicePlanItems.map((svc) => {
                            const checked = v.services?.includes(svc) ?? false;
                            return (
                              <label key={svc} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const current = v.services ?? [...servicePlanItems];
                                    const next = e.target.checked
                                      ? [...current.filter((s) => s !== svc), svc]
                                      : current.filter((s) => s !== svc);
                                    handleUpdateVisit(v.key, { services: next });
                                  }}
                                />
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }}>{svc}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <input
                          type="text"
                          className="form-input"
                          style={{ height: '30px', fontSize: '0.75rem', width: '160px' }}
                          placeholder="e.g. Cockroach, Rodent…"
                          value={v.services?.join(', ') ?? ''}
                          onChange={(e) => handleUpdateVisit(v.key, { services: e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : undefined })}
                        />
                      )}
                    </td>
                    <td>
                      <input
                        type="date"
                        className="form-input"
                        style={{ height: '30px', fontSize: '0.78rem', width: '135px' }}
                        value={v.date}
                        onChange={(e) => handleUpdateVisit(v.key, { date: e.target.value })}
                      />
                    </td>
                    <td style={{ minWidth: '220px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <select
                          className="form-select"
                          style={{ height: '28px', fontSize: '0.75rem' }}
                          value={v.timeSlot}
                          onChange={(e) => {
                            const ts = e.target.value as TimeSlot;
                            const defaults: Record<TimeSlot, [string, string]> = {
                              morning: ['09:00', '13:00'],
                              afternoon: ['13:00', '17:00'],
                              evening: ['17:00', '21:00'],
                              night_shift: ['21:00', '02:00'],
                            };
                            const [ws, we] = defaults[ts] || ['', ''];
                            handleUpdateVisit(v.key, {
                              timeSlot: ts,
                              windowStart: v.windowStart || ws,
                              windowEnd: v.windowEnd || we,
                            });
                          }}
                        >
                          <option value="morning">Morning (09:00 - 13:00)</option>
                          <option value="afternoon">Afternoon (13:00 - 17:00)</option>
                          <option value="evening">Evening (17:00 - 21:00)</option>
                          <option value="night_shift">Night Shift (21:00 - 02:00)</option>
                        </select>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Custom:</span>
                          <input
                            type="time"
                            className="form-input"
                            style={{ height: '26px', fontSize: '0.75rem', padding: '1px 4px', width: '75px' }}
                            value={v.windowStart || ''}
                            onChange={(e) => handleUpdateVisit(v.key, { windowStart: e.target.value })}
                            title="Custom Start Time"
                          />
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>–</span>
                          <input
                            type="time"
                            className="form-input"
                            style={{ height: '26px', fontSize: '0.75rem', padding: '1px 4px', width: '75px' }}
                            value={v.windowEnd || ''}
                            onChange={(e) => handleUpdateVisit(v.key, { windowEnd: e.target.value })}
                            title="Custom End Time"
                          />
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {v.closingTime ? `Closes ${v.closingTime}` : 'Open hours'}
                    </td>
                    <td>
                      <select
                        className="form-select"
                        style={{
                          height: '30px',
                          fontSize: '0.78rem',
                          borderColor: isConflict ? '#DC2626' : undefined,
                        }}
                        value={v.pcoId || ''}
                        onChange={(e) => handleUpdateVisit(v.key, { pcoId: e.target.value })}
                      >
                        <option value="">-- Unassigned --</option>
                        {technicians.map((t) => (
                          <option key={t.uid} value={t.uid}>
                            {t.displayName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {isConflict ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            color: '#DC2626',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                          }}
                        >
                          <AlertTriangle size={12} /> Double-booked
                        </span>
                      ) : (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            color: 'var(--ikpm-emerald-600)',
                            fontSize: '0.72rem',
                          }}
                        >
                          <CheckCircle size={12} /> Ready
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Modal Footer Controls */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: '1rem',
          }}
        >
          <button
            type="button"
            className="btn btn-outline-navy"
            disabled={isExporting || visits.length === 0}
            onClick={handleExportPdf}
          >
            <Download size={14} />
            <span>{isExporting ? 'Generating PDF...' : 'Export Dunkin PDF Schedule'}</span>
          </button>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isConfirming || visits.length === 0}
              onClick={handleConfirmSchedule}
            >
              <Calendar size={14} />
              <span>{isConfirming ? 'Dispatching Jobs...' : `Confirm & Create ${visits.length} Service Jobs`}</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
