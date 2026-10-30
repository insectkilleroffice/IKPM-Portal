import React, { useState, useEffect } from 'react';
import {
  Calendar, Check, Clock, AlertTriangle, Save, CheckCircle2,
  CalendarRange, Users, Filter, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { EmptyState } from '../../components/common/EmptyState';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { canEditModule } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { dataService } from '../../services/dataService';
import type { AttendanceRecord, AttendanceStatus, Employee } from '../../types/hr';

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
  status: AttendanceStatus;
  arrivalTime: string;
  lateMinutes: number;
  remarks: string;
  isExisting: boolean;
}

export const AttendancePage: React.FC = () => {
  const store = useDataStore();
  const { effectiveRole, userProfile, currentUser } = useAuth();
  const { success, error, info } = useNotification();

  const canEdit = canEditModule(effectiveRole, 'attendance') || effectiveRole === 'super_admin' || effectiveRole === 'admin';

  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr());
  const [rows, setRows] = useState<RowState[]>([]);
  const [saving, setSaving] = useState(false);
  const [roleFilter, setRoleFilter] = useState<'pco' | 'all'>('pco');

  const employees: Employee[] = store.getEmployees ? store.getEmployees() : [];
  const existingAttendance: AttendanceRecord[] = store.getAttendance ? store.getAttendance(undefined, selectedDate, selectedDate) : [];

  // Check 2-day editing barrier for coordinator (unless super_admin / admin)
  const isSuperAdmin = effectiveRole === 'super_admin' || effectiveRole === 'admin';
  const today = getTodayStr();
  const daysDiff = Math.floor((new Date(today).getTime() - new Date(selectedDate).getTime()) / (1000 * 60 * 60 * 24));
  const isLocked = !isSuperAdmin && daysDiff > 2;

  // Re-build rows whenever selectedDate, employees, or roleFilter changes
  useEffect(() => {
    const activeStaff = employees.filter((e) => {
      if (e.status === 'inactive') return false;
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
          arrivalTime: match.arrivalTime || '08:30',
          lateMinutes: match.lateMinutes || 0,
          remarks: match.remarks || '',
          isExisting: true,
        };
      }
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        status: 'present',
        arrivalTime: '08:30',
        lateMinutes: 0,
        remarks: '',
        isExisting: false,
      };
    });

    setRows(newRows);
  }, [selectedDate, roleFilter, employees.length, existingAttendance.length]);

  const updateRow = (empId: string, updates: Partial<RowState>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.employeeId !== empId) return r;
        const next = { ...r, ...updates };
        // Auto-calculate late minutes if status is late or arrival time changes
        if (updates.arrivalTime !== undefined || updates.status === 'late') {
          const [h, m] = next.arrivalTime.split(':').map(Number);
          // Official start time 08:30
          const startM = 8 * 60 + 30;
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

  const handleMarkAllPresent = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        status: 'present',
        arrivalTime: '08:30',
        lateMinutes: 0,
      }))
    );
    info('Marked Present', 'All marked present. Adjust exceptions and click Save.');
  };

  const handleSaveAll = async () => {
    if (isLocked) {
      error('Locked', 'Editing past records older than 2 days is restricted to Super Admin.');
      return;
    }
    if (rows.length === 0) return;

    setSaving(true);
    try {
      const now = new Date().toISOString();
      for (const row of rows) {
        const record: AttendanceRecord = {
          id: row.employeeId + '_' + selectedDate,
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          date: selectedDate,
          status: row.status,
          arrivalTime: row.arrivalTime,
          lateMinutes: row.lateMinutes,
          remarks: row.remarks ? row.remarks.trim() : undefined,
          markedBy: currentUser?.uid || 'coordinator',
          markedByName: userProfile?.displayName || 'Operations Coordinator',
          markedAt: now,
        };
        await dataService.saveAttendance(record, userProfile?.email || 'coordinator');
      }
      success('Attendance Saved', `Attendance for ${rows.length} staff members saved successfully.`);
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
            Operations Coordinator daily muster roll for PCOs and field staff. Feeds the 30-day payroll cycle.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {canEdit && !isLocked && (
            <>
              <button type="button" className="btn btn-secondary" onClick={handleMarkAllPresent}>
                <CheckCircle2 size={16} /> Mark All Present
              </button>
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
        </div>

        {/* Attendance Summary KPIs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span className="badge badge-teal">Present: {presentCount}</span>
          <span className="badge badge-amber">Late: {lateCount}</span>
          <span className="badge badge-rose">Absent: {absentCount}</span>
          <span className="badge badge-blue">Leave/Half: {leaveCount}</span>
          <span className="cell-sub">Total: {rows.length}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No employees found"
          description="Enroll PCOs or staff members in Employee Management to mark attendance."
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
                <th style={{ width: '110px' }}>Late (min)</th>
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
                      <span className="cell-sub" title="Unsaved changes">
                        Pending
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
