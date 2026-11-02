import React, { useState, useEffect } from 'react';
import {
  Calendar, Check, Clock, AlertTriangle, Save,
  CalendarRange, Users, Filter, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { EmptyState } from '../../components/common/EmptyState';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { baseRoleOf, canEditModule } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { dataService } from '../../services/dataService';
import type { AttendanceRecord, AttendanceStatus, Employee } from '../../types/hr';
import { companyProfile } from '../../services/companyProfile';

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; badgeClass: string }[] = [
  { value: 'present', label: 'Present', badgeClass: 'badge-teal' },
  { value: 'late', label: 'Late', badgeClass: 'badge-amber' },
  { value: 'half_day', label: 'Half Day', badgeClass: 'badge-indigo' },
  { value: 'leave', label: 'Leave', badgeClass: 'badge-blue' },
  { value: 'absent', label: 'Absent', badgeClass: 'badge-rose' },
  { value: 'off', label: 'Off / Holiday', badgeClass: 'badge-slate' },
];

function getTodayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

interface RowState {
  employeeId: string;
  employeeName: string;
  /** Present unless the Supervisor marks an exception (late, absent, leave…) */
  status: AttendanceStatus;
  arrivalTime: string;
  lateMinutes: number;
  /** Extra hours worked; paid from the person's salary in payroll */
  overtimeHours: string;
  remarks: string;
  isExisting: boolean;
}

export const AttendancePage: React.FC = () => {
  const store = useDataStore();
  const { effectiveRole, userProfile, currentUser } = useAuth();
  const { success, error } = useNotification();

  const canEdit = canEditModule(effectiveRole, 'attendance') || ['super_admin', 'admin'].includes(baseRoleOf(effectiveRole) ?? '');

  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr());
  const [rows, setRows] = useState<RowState[]>([]);
  const [saving, setSaving] = useState(false);
  // A Supervisor marks only their own team; managers / HR can see everyone
  const isTeamLeader = baseRoleOf(effectiveRole) === 'team_leader';
  // Attendance and overtime apply to every employee; Supervisors see only their own PCOs
  const [roleFilter, setRoleFilter] = useState<'my_team' | 'pco' | 'all'>(isTeamLeader ? 'my_team' : 'all');
  const workStart = companyProfile.get().payrollRules?.workStartTime || '08:30';

  const employees: Employee[] = store.getEmployees ? store.getEmployees() : [];
  const myTeamIds = new Set(store.getTeamPcos(currentUser?.uid).map((e) => e.id));
  const existingAttendance: AttendanceRecord[] = store.getAttendance ? store.getAttendance(undefined, selectedDate, selectedDate) : [];

  // Check 2-day editing barrier for coordinator (unless super_admin / admin)
  const isSuperAdmin = ['super_admin', 'admin'].includes(baseRoleOf(effectiveRole) ?? '');
  const today = getTodayStr();
  const daysDiff = Math.floor((new Date(today).getTime() - new Date(selectedDate).getTime()) / (1000 * 60 * 60 * 24));
  const isLocked = !isSuperAdmin && daysDiff > 2;

  // Re-build rows whenever selectedDate, employees, or roleFilter changes
  useEffect(() => {
    const activeStaff = employees.filter((e) => {
      if (e.status === 'inactive') return false;
      if (roleFilter === 'my_team' || isTeamLeader) return myTeamIds.has(e.id);
      if (roleFilter === 'pco') return e.role === 'pco';
      return true;
    });

    const newRows: RowState[] = activeStaff.map((emp) => {
      const match = existingAttendance.find((a) => a.employeeId === emp.id && a.date === selectedDate);
      if (match) {
        return {
          employeeId: emp.id,
          employeeName: emp.name,
          status: match.status,
          arrivalTime: match.arrivalTime || workStart,
          lateMinutes: match.lateMinutes || 0,
          overtimeHours: match.overtimeHours ? String(match.overtimeHours) : '',
          remarks: match.remarks || '',
          isExisting: true,
        };
      }
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        status: 'present', // automatic: everyone is present unless marked otherwise
        arrivalTime: workStart,
        lateMinutes: 0,
        overtimeHours: '',
        remarks: '',
        isExisting: false,
      };
    });

    setRows(newRows);
  }, [selectedDate, roleFilter, employees.length, existingAttendance.length, myTeamIds.size]);

  const updateRow = (empId: string, updates: Partial<RowState>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.employeeId !== empId) return r;
        const next = { ...r, ...updates };
        // Auto-calculate late minutes if status is late or arrival time changes
        if (updates.arrivalTime !== undefined || updates.status === 'late') {
          const [h, m] = next.arrivalTime.split(':').map(Number);
          // Work start time from Settings → Payroll (default 08:30)
          const [sh, sm] = workStart.split(':').map(Number);
          const startM = (sh || 0) * 60 + (sm || 0);
          const curM = (h || 0) * 60 + (m || 0);
          if (curM > startM) {
            next.lateMinutes = curM - startM;
            if (next.status === 'present') next.status = 'late';
          } else {
            next.lateMinutes = 0;
            if (next.status === 'late') next.status = 'present';
          }
        }
        return next;
      })
    );
  };

  const handleSaveAll = async () => {
    if (isLocked) {
      error('Locked', 'Editing past records older than 2 days is restricted to Super Admin.');
      return;
    }
    const badOt = rows.find((r) => r.overtimeHours.trim() && !(Number(r.overtimeHours) > 0 && Number(r.overtimeHours) <= 16));
    if (badOt) {
      error('Check overtime', `${badOt.employeeName}: overtime must be between 0.5 and 16 hours (or empty).`);
      return;
    }
    if (rows.some((r) => Number(r.overtimeHours) > 0 && (r.status === 'absent' || r.status === 'off' || r.status === 'leave'))) {
      error('Check overtime', 'Overtime can only be entered for people who worked that day.');
      return;
    }
    const marked = rows;

    setSaving(true);
    try {
      const now = new Date().toISOString();
      for (const row of marked) {
        const record: AttendanceRecord = {
          id: row.employeeId + '_' + selectedDate,
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          date: selectedDate,
          status: row.status,
          arrivalTime: row.arrivalTime,
          lateMinutes: row.lateMinutes,
          overtimeHours: Number(row.overtimeHours) > 0 ? Number(row.overtimeHours) : undefined,
          remarks: row.remarks ? row.remarks.trim() : undefined,
          markedBy: currentUser?.uid || 'coordinator',
          markedByName: userProfile?.displayName || 'Supervisor',
          markedAt: now,
        };
        await dataService.saveAttendance(record, userProfile?.email || 'coordinator');
      }
      const exceptions = marked.filter((r) => r.status !== 'present').length;
      const otPeople = marked.filter((r) => Number(r.overtimeHours) > 0).length;
      success('Attendance saved', `${marked.length} ${marked.length === 1 ? 'person' : 'people'} · ${exceptions} not present${otPeople ? ` · ${otPeople} with overtime` : ''}.`);
    } catch (err: unknown) {
      error('Save failed', (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const stepDate = (deltaDays: number) => {
    const cur = new Date(selectedDate);
    cur.setDate(cur.getDate() + deltaDays);
    setSelectedDate(cur.toISOString().slice(0, 10));
  };

  // KPI counts
  const presentCount = rows.filter((r) => r.status === 'present').length;
  const lateCount = rows.filter((r) => r.status === 'late').length;
  const absentCount = rows.filter((r) => r.status === 'absent').length;
  const leaveCount = rows.filter((r) => r.status === 'leave' || r.status === 'half_day').length;

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Field operations', path: '/operations/jobs' }, { label: 'Daily Attendance' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Daily Attendance</h1>
          <p className="page-subtitle">
            {isTeamLeader
              ? 'Everyone is present automatically. Only mark who was late, absent or on leave, and add overtime hours. Feeds the 30-day payroll.'
              : 'Everyone is present automatically. Supervisors mark their PCOs; HR / managers mark other staff. Only exceptions and overtime need entering.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {canEdit && !isLocked && (
            <>
              <button type="button" className="btn btn-primary" onClick={handleSaveAll} disabled={saving}>
                <Save size={16} /> {saving ? 'Saving...' : 'Save Attendance'}
              </button>
            </>
          )}
        </div>
      </div>

      {isLocked && (
        <div className="alert-banner alert-banner-amber" style={{ marginBottom: '1.25rem' }}>
          <AlertTriangle size={16} />
          <span>This attendance sheet is older than 2 days. Changes are locked and require Super Admin override.</span>
        </div>
      )}

      {/* Date & Filter controls */}
      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <button type="button" className="icon-btn" onClick={() => stepDate(-1)} title="Previous Day">
              <ChevronLeft size={16} />
            </button>
            <input
              type="date"
              className="form-input"
              style={{ width: 'auto', minHeight: 36, fontWeight: 600 }}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <button type="button" className="icon-btn" onClick={() => stepDate(1)} title="Next Day">
              <ChevronRight size={16} />
            </button>
          </div>

          {isTeamLeader ? (
            <span className="cell-sub">My team ({myTeamIds.size} PCOs)</span>
          ) : (
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                className={`chip ${roleFilter === 'pco' ? 'chip-active' : ''}`}
                onClick={() => setRoleFilter('pco')}
              >
                PCOs Only
              </button>
              <button
                type="button"
                className={`chip ${roleFilter === 'all' ? 'chip-active' : ''}`}
                onClick={() => setRoleFilter('all')}
              >
                All Staff
              </button>
            </div>
          )}
        </div>

        {/* Attendance Summary KPIs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span className="badge badge-teal">Present: {presentCount}</span>
          <span className="badge badge-amber">Late: {lateCount}</span>
          <span className="badge badge-rose">Absent: {absentCount}</span>
          <span className="badge badge-blue">Leave/Half: {leaveCount}</span>
          {rows.some((r) => Number(r.overtimeHours) > 0) && (
            <span className="badge badge-indigo">Overtime: {rows.reduce((s, r) => s + (Number(r.overtimeHours) || 0), 0)} h</span>
          )}
          <span className="cell-sub">Total: {rows.length}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title={isTeamLeader ? 'No PCOs in your team yet' : 'No employees found'}
          description={isTeamLeader
            ? 'HR sets each PCO’s Supervisor on the Employees page. Ask HR to add your PCOs to your team.'
            : 'Enroll PCOs or staff members in Employee Management to mark attendance.'}
        />
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>EMP ID</th>
                <th>Employee Name</th>
                <th style={{ width: '160px' }}>Status</th>
                <th style={{ width: '130px' }}>Arrival Time</th>
                <th style={{ width: '90px' }}>Late (min)</th>
                <th style={{ width: '110px' }}>Overtime (h)</th>
                <th>Remarks / Reason</th>
                <th style={{ width: '90px', textAlign: 'center' }}>Saved</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.employeeId}</span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--ikpm-navy-900)' }}>{r.employeeName}</div>
                  </td>
                  <td>
                    <select
                      className="form-select"
                      style={{ minHeight: 32, padding: '2px 8px' }}
                      value={r.status}
                      disabled={isLocked || !canEdit}
                      onChange={(e) => updateRow(r.employeeId, { status: e.target.value as AttendanceStatus })}
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="time"
                      className="form-input"
                      style={{ minHeight: 32, padding: '2px 6px' }}
                      value={r.arrivalTime}
                      disabled={isLocked || !canEdit || r.status === 'absent' || r.status === 'off'}
                      onChange={(e) => updateRow(r.employeeId, { arrivalTime: e.target.value })}
                    />
                  </td>
                  <td>
                    {r.lateMinutes > 0 ? (
                      <span className="badge badge-amber" style={{ fontWeight: 700 }}>
                        +{r.lateMinutes}m
                      </span>
                    ) : (
                      <span className="cell-sub">—</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={16}
                      step={0.5}
                      className="form-input"
                      style={{ minHeight: 32, padding: '2px 6px' }}
                      placeholder="0"
                      value={r.overtimeHours}
                      disabled={isLocked || !canEdit || r.status === 'absent' || r.status === 'off' || r.status === 'leave'}
                      onChange={(e) => updateRow(r.employeeId, { overtimeHours: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="form-input"
                      style={{ minHeight: 32, padding: '2px 8px' }}
                      placeholder="Optional notes or excuse…"
                      value={r.remarks}
                      disabled={isLocked || !canEdit}
                      onChange={(e) => updateRow(r.employeeId, { remarks: e.target.value })}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {r.isExisting ? (
                      <span title="Attendance saved in database">
                        <Check size={16} color="var(--ikpm-emerald-600)" />
                      </span>
                    ) : (
                      <span className="cell-sub" title="Counted as present automatically until you save a change">
                        Auto
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
