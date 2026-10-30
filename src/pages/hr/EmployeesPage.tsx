import React, { useState } from 'react';
import {
  Plus, Search, UserCog, Phone, Mail, Calendar,
  ChevronDown, ChevronRight, Edit2, Eye, X, Banknote, Building2, CreditCard,
} from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { canEditModule } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { dataService } from '../../services/dataService';
import type { Employee, EmployeeStatus, EmployeeRole, EmployeePay } from '../../types/hr';

// ---- Badge colours ----
const STATUS_BADGE: Record<EmployeeStatus, string> = {
  hiring: 'badge-amber',
  probation: 'badge-blue',
  permanent: 'badge-teal',
  notice: 'badge-rose',
  inactive: 'badge-slate',
};

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  hiring: 'Hiring',
  probation: 'Probation',
  permanent: 'Permanent',
  notice: 'Notice Period',
  inactive: 'Inactive',
};

const ROLE_LABELS: Record<EmployeeRole, string> = {
  pco: 'PCO / Technician',
  operations_coordinator: 'Operations Coordinator',
  team_leader: 'Operations Coordinator',
  operations_manager: 'Operations Manager',
  operations: 'Operations Manager',
  cro: 'CRO',
  accounts: 'Accounts',
  hr: 'HR',
  admin: 'Admin',
  management: 'Management',
};

const ASSIGNABLE_ROLES: { role: EmployeeRole; label: string }[] = [
  { role: 'pco', label: 'PCO / Technician' },
  { role: 'operations_coordinator', label: 'Operations Coordinator' },
  { role: 'operations_manager', label: 'Operations Manager' },
  { role: 'cro', label: 'CRO' },
  { role: 'accounts', label: 'Accounts' },
  { role: 'hr', label: 'HR' },
  { role: 'admin', label: 'Admin' },
  { role: 'management', label: 'Management' },
];

const DEPARTMENTS = ['Operations', 'Sales & CRM', 'Accounts', 'HR', 'Administration', 'Management'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function blankEmployee(): Omit<Employee, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '',
    phone: '',
    email: '',
    role: 'pco',
    department: 'Operations',
    joiningDate: todayStr(),
    status: 'probation',
    reportingToRole: '',
    reportingCoordinatorId: '',
    probationEndDate: '',
  };
}

export const EmployeesPage: React.FC = () => {
  const store = useDataStore();
  const { effectiveRole } = useAuth();
  const { success, error } = useNotification();

  const canEdit = canEditModule(effectiveRole, 'hr');
  const canManageSalary = effectiveRole === 'super_admin' || effectiveRole === 'admin' || effectiveRole === 'hr' || effectiveRole === 'finance';

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<EmployeeStatus | 'all'>('all');
  const [roleFilter, setRoleFilter] = useState<EmployeeRole | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankEmployee());
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Employee | null>(null);

  // Salary Configuration Modal state
  const [salaryEmployee, setSalaryEmployee] = useState<Employee | null>(null);
  const [salaryForm, setSalaryForm] = useState({
    basicSalary: 0,
    attendanceAllowance: 0,
    mobilePackage: 0,
    bikeMaintenance: 0,
    otherAllowance: 0,
    overtimeHourlyRate: 0,
    bankName: '',
    bankAccountNumber: '',
  });
  const [savingSalary, setSavingSalary] = useState(false);

  const employees = store.getEmployees ? store.getEmployees() : [];

  const filtered = employees.filter((e) => {
    const q = query.toLowerCase();
    const matchQ = !q || e.name.toLowerCase().includes(q) || e.phone.includes(q) || e.id.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || e.status === statusFilter;
    const matchRole = roleFilter === 'all' || e.role === roleFilter || (roleFilter === 'operations_coordinator' && e.role === 'team_leader') || (roleFilter === 'operations_manager' && e.role === 'operations');
    return matchQ && matchStatus && matchRole;
  });

  const openNew = () => {
    setEditingId(null);
    setForm(blankEmployee());
    setShowForm(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setForm({
      name: emp.name,
      phone: emp.phone,
      email: emp.email ?? '',
      role: emp.role,
      department: emp.department,
      joiningDate: emp.joiningDate,
      status: emp.status,
      probationEndDate: emp.probationEndDate ?? '',
      reportingToRole: emp.reportingToRole ?? '',
      reportingCoordinatorId: emp.reportingCoordinatorId ?? '',
      uid: emp.uid,
      photoUrl: emp.photoUrl,
      emergencyContact: emp.emergencyContact,
    });
    setShowForm(true);
  };

  const openSalaryModal = (emp: Employee) => {
    const existing = store.getEmployeePay ? store.getEmployeePay(emp.id) : undefined;
    setSalaryEmployee(emp);
    setSalaryForm({
      basicSalary: existing?.basicSalary || 0,
      attendanceAllowance: existing?.attendanceAllowance || 0,
      mobilePackage: existing?.mobilePackage || 0,
      bikeMaintenance: existing?.bikeMaintenance || 0,
      otherAllowance: existing?.otherAllowance || 0,
      overtimeHourlyRate: existing?.overtimeHourlyRate || 0,
      bankName: existing?.bankName || '',
      bankAccountNumber: existing?.bankAccountNumber || '',
    });
  };

  const totalCalculatedGross = 
    Number(salaryForm.basicSalary || 0) +
    Number(salaryForm.attendanceAllowance || 0) +
    Number(salaryForm.mobilePackage || 0) +
    Number(salaryForm.bikeMaintenance || 0) +
    Number(salaryForm.otherAllowance || 0);

  const handleSaveSalary = async () => {
    if (!salaryEmployee) return;
    if (salaryForm.basicSalary < 0) {
      error('Validation error', 'Basic salary cannot be negative.');
      return;
    }
    setSavingSalary(true);
    try {
      const now = new Date().toISOString();
      const payRecord: EmployeePay = {
        id: salaryEmployee.id,
        basicSalary: Number(salaryForm.basicSalary || 0),
        attendanceAllowance: Number(salaryForm.attendanceAllowance || 0),
        mobilePackage: Number(salaryForm.mobilePackage || 0),
        bikeMaintenance: Number(salaryForm.bikeMaintenance || 0),
        otherAllowance: Number(salaryForm.otherAllowance || 0),
        overtimeHourlyRate: Number(salaryForm.overtimeHourlyRate || 0),
        bankName: salaryForm.bankName.trim() || undefined,
        bankAccountNumber: salaryForm.bankAccountNumber.trim() || undefined,
        totalGross: totalCalculatedGross,
        updatedAt: now,
      };
      await dataService.saveEmployeePay(payRecord);
      success('Salary Saved', 'Salary structure updated for ' + salaryEmployee.name + ' (Gross: PKR ' + totalCalculatedGross.toLocaleString() + ').');
      setSalaryEmployee(null);
    } catch (err: unknown) {
      error('Save failed', (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingSalary(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { error('Validation error', 'Name is required.'); return; }
    if (!form.phone.trim()) { error('Validation error', 'Phone is required.'); return; }
    if (!form.joiningDate) { error('Validation error', 'Joining date is required.'); return; }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      let empId = editingId;
      if (!empId) {
        const seq = await dataService.nextSequence('employee');
        empId = 'EMP-' + String(seq).padStart(4, '0');
      }
      const emp: Employee = {
        id: empId,
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email?.trim() || undefined,
        role: form.role,
        department: form.department,
        joiningDate: form.joiningDate,
        status: form.status,
        probationEndDate: form.probationEndDate || undefined,
        reportingToRole: form.reportingToRole || undefined,
        reportingCoordinatorId: form.reportingCoordinatorId || undefined,
        uid: form.uid,
        photoUrl: form.photoUrl,
        emergencyContact: form.emergencyContact,
        createdAt: editingId ? (employees.find((e) => e.id === editingId)?.createdAt ?? now) : now,
        updatedAt: now,
      };
      await dataService.saveEmployee(emp);
      success('Saved', editingId ? 'Employee record updated.' : 'Employee enrolled successfully.');
      setShowForm(false);
    } catch (err: unknown) {
      error('Save failed', (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Count by status
  const countByStatus = (s: EmployeeStatus) => employees.filter((e) => e.status === s).length;
  const onProbation = countByStatus('probation');

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'HR', path: '/hr/employees' }, { label: 'Employees' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Employee Management</h1>
          <p className="page-subtitle">
            Enroll, manage, and configure salary structures for staff. Roles include Operations Manager, Operations Coordinator, PCO, CRO, and Accounts.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <Plus size={16} /> Enroll Employee
          </button>
        )}
      </div>

      {/* KPI chips */}
      <div className="kpi-row" style={{ marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {(['all', 'hiring', 'probation', 'permanent', 'notice', 'inactive'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`chip ${statusFilter === s ? 'chip-active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? `All (${employees.length})` : `${STATUS_LABELS[s]} (${countByStatus(s)})`}
          </button>
        ))}
      </div>

      {onProbation > 0 && (
        <div className="alert-banner alert-banner-amber" style={{ marginBottom: '1rem' }}>
          <Calendar size={15} />
          <span>{onProbation} employee{onProbation !== 1 ? 's' : ''} currently on probation — review probation end dates regularly.</span>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div className="drive-search" style={{ minWidth: 240, maxWidth: 400, flex: 1 }}>
          <Search size={15} color="var(--text-muted)" />
          <input
            placeholder="Search by name, phone or ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="form-select"
          style={{ width: 'auto', minHeight: 36 }}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as EmployeeRole | 'all')}
        >
          <option value="all">All Roles</option>
          {ASSIGNABLE_ROLES.map(({ role, label }) => (
            <option key={role} value={role}>{label}</option>
          ))}
        </select>
        <span className="cell-sub">{filtered.length} employee(s)</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="No employees found"
          description={query ? 'No employees match your search or filters.' : 'Enroll the first employee to get started.'}
          action={canEdit ? { label: 'Enroll Employee', onClick: openNew } : undefined}
        />
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Role / Dept</th>
                <th>Phone</th>
                <th>Salary (Gross)</th>
                <th>Joining Date</th>
                <th>Probation End</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => {
                const pay = store.getEmployeePay ? store.getEmployeePay(emp.id) : undefined;
                return (
                  <tr key={emp.id}>
                    <td><span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{emp.id}</span></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{emp.name}</div>
                      {emp.email && <div className="cell-sub">{emp.email}</div>}
                    </td>
                    <td>
                      <div>{ROLE_LABELS[emp.role] || emp.role}</div>
                      <div className="cell-sub">{emp.department}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Phone size={12} color="var(--text-muted)" /> {emp.phone}
                      </div>
                    </td>
                    <td>
                      {pay && pay.totalGross > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span className="badge badge-teal" style={{ fontWeight: 600 }}>
                            ₨ {pay.totalGross.toLocaleString()}
                          </span>
                        </div>
                      ) : (
                        <span className="cell-sub" style={{ fontStyle: 'italic' }}>Not configured</span>
                      )}
                    </td>
                    <td>{formatDate(emp.joiningDate)}</td>
                    <td>{emp.probationEndDate ? formatDate(emp.probationEndDate) : <span className="cell-sub">—</span>}</td>
                    <td><span className={`badge ${STATUS_BADGE[emp.status]}`}>{STATUS_LABELS[emp.status]}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="cell-actions" style={{ justifyContent: 'flex-end', display: 'flex', gap: '0.35rem' }}>
                        <button type="button" className="icon-btn" title="View Details" onClick={() => setSelected(emp)}><Eye size={15} /></button>
                        {canManageSalary && (
                          <button
                            type="button"
                            className="icon-btn"
                            title="Set / View Salary Structure"
                            style={{ color: pay ? 'var(--primary-dark)' : 'var(--text-muted)' }}
                            onClick={() => openSalaryModal(emp)}
                          >
                            <Banknote size={15} />
                          </button>
                        )}
                        {canEdit && <button type="button" className="icon-btn" title="Edit Employee" onClick={() => openEdit(emp)}><Edit2 size={15} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Salary Structure Modal ---- */}
      {salaryEmployee && (
        <Modal
          isOpen={Boolean(salaryEmployee)}
          title={`Salary Structure: ${salaryEmployee.name} (${salaryEmployee.id})`}
          onClose={() => setSalaryEmployee(null)}
          footer={
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                Total Monthly Gross: <span style={{ color: 'var(--primary)' }}>PKR {totalCalculatedGross.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setSalaryEmployee(null)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleSaveSalary} disabled={savingSalary}>
                  {savingSalary ? 'Saving…' : 'Save Salary Structure'}
                </button>
              </div>
            </div>
          }
        >
          <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--bg-subtle, #f8fafc)', borderRadius: 6, fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span><strong>Designation:</strong> {ROLE_LABELS[salaryEmployee.role] || salaryEmployee.role}</span>
              <span><strong>Department:</strong> {salaryEmployee.department}</span>
              <span><strong>Status:</strong> {STATUS_LABELS[salaryEmployee.status]}</span>
            </div>
          </div>

          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <div className="form-group">
              <label className="form-label">Basic Salary (PKR) *</label>
              <input
                type="number"
                min="0"
                className="form-input"
                value={salaryForm.basicSalary}
                onChange={(e) => setSalaryForm({ ...salaryForm, basicSalary: Number(e.target.value) })}
                placeholder="e.g. 30000"
              />
              <span className="cell-sub">Fixed monthly base wage</span>
            </div>

            <div className="form-group">
              <label className="form-label">Attendance Allowance (PKR)</label>
              <input
                type="number"
                min="0"
                className="form-input"
                value={salaryForm.attendanceAllowance}
                onChange={(e) => setSalaryForm({ ...salaryForm, attendanceAllowance: Number(e.target.value) })}
                placeholder="e.g. 3000"
              />
              <span className="cell-sub">Forfeited if &gt;= 2 late marks or absences</span>
            </div>

            <div className="form-group">
              <label className="form-label">Mobile Package Allowance (PKR)</label>
              <input
                type="number"
                min="0"
                className="form-input"
                value={salaryForm.mobilePackage}
                onChange={(e) => setSalaryForm({ ...salaryForm, mobilePackage: Number(e.target.value) })}
                placeholder="e.g. 2000"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Bike Maintenance Allowance (PKR)</label>
              <input
                type="number"
                min="0"
                className="form-input"
                value={salaryForm.bikeMaintenance}
                onChange={(e) => setSalaryForm({ ...salaryForm, bikeMaintenance: Number(e.target.value) })}
                placeholder="e.g. 3000"
              />
              <span className="cell-sub">Fuel / wear for field technicians</span>
            </div>

            <div className="form-group">
              <label className="form-label">Other Allowance (PKR)</label>
              <input
                type="number"
                min="0"
                className="form-input"
                value={salaryForm.otherAllowance}
                onChange={(e) => setSalaryForm({ ...salaryForm, otherAllowance: Number(e.target.value) })}
                placeholder="e.g. 0"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Overtime Hourly Rate (PKR/hr)</label>
              <input
                type="number"
                min="0"
                className="form-input"
                value={salaryForm.overtimeHourlyRate}
                onChange={(e) => setSalaryForm({ ...salaryForm, overtimeHourlyRate: Number(e.target.value) })}
                placeholder="e.g. 250"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Bank Name</label>
              <input
                type="text"
                className="form-input"
                value={salaryForm.bankName}
                onChange={(e) => setSalaryForm({ ...salaryForm, bankName: e.target.value })}
                placeholder="e.g. Meezan Bank, HBL"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Bank Account / IBAN</label>
              <input
                type="text"
                className="form-input"
                value={salaryForm.bankAccountNumber}
                onChange={(e) => setSalaryForm({ ...salaryForm, bankAccountNumber: e.target.value })}
                placeholder="e.g. PK00MEZN0000000000000000"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* ---- Enroll / Edit Modal ---- */}
      {showForm && (
        <Modal
          isOpen={showForm}
          title={editingId ? 'Edit Employee' : 'Enroll New Employee'}
          onClose={() => setShowForm(false)}
          footer={
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Update Employee' : 'Enroll Employee'}
              </button>
            </div>
          }
        >
          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Full Name *</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Muhammad Asif" />
            </div>
            <div className="form-group">
              <label className="form-label">Phone *</label>
              <input className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03xx-xxxxxxx" />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Optional" />
            </div>
            <div className="form-group">
              <label className="form-label">Role *</label>
              <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as EmployeeRole })}>
                {ASSIGNABLE_ROLES.map(({ role, label }) => (
                  <option key={role} value={role}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Department *</label>
              <select className="form-select" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Joining Date *</label>
              <input type="date" className="form-input" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EmployeeStatus })}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Probation End Date</label>
              <input type="date" className="form-input" value={form.probationEndDate ?? ''} onChange={(e) => setForm({ ...form, probationEndDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Emergency Contact</label>
              <input className="form-input" value={form.emergencyContact ?? ''} onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })} placeholder="Name and phone" />
            </div>
          </div>
        </Modal>
      )}

      {/* ---- Detail View Modal ---- */}
      {selected && (
        <Modal
          isOpen={Boolean(selected)}
          title={'Employee: ' + selected.name}
          onClose={() => setSelected(null)}
          footer={
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              {canManageSalary && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const emp = selected;
                    setSelected(null);
                    openSalaryModal(emp);
                  }}
                >
                  <Banknote size={14} /> Configure Salary
                </button>
              )}
              {canEdit && (
                <button type="button" className="btn btn-secondary" onClick={() => { setSelected(null); openEdit(selected); }}>
                  <Edit2 size={14} /> Edit Profile
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => setSelected(null)}>Close</button>
            </div>
          }
        >
          {(() => {
            const pay = store.getEmployeePay ? store.getEmployeePay(selected.id) : undefined;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  {[
                    ['Employee ID', selected.id],
                    ['Status', STATUS_LABELS[selected.status]],
                    ['Role', ROLE_LABELS[selected.role] || selected.role],
                    ['Department', selected.department],
                    ['Phone', selected.phone],
                    ['Email', selected.email ?? '—'],
                    ['Joining Date', formatDate(selected.joiningDate)],
                    ['Probation End', selected.probationEndDate ? formatDate(selected.probationEndDate) : '—'],
                    ['Emergency Contact', selected.emergencyContact ?? '—'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="cell-sub" style={{ marginBottom: 2 }}>{label}</div>
                      <div style={{ fontWeight: 600 }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem' }}>
                    <Banknote size={16} /> Salary & Compensation
                  </h4>
                  {pay ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', fontSize: '0.85rem' }}>
                      <div><span className="cell-sub">Basic Salary:</span> <strong>PKR {pay.basicSalary.toLocaleString()}</strong></div>
                      <div><span className="cell-sub">Attendance Allowance:</span> <strong>PKR {pay.attendanceAllowance.toLocaleString()}</strong></div>
                      <div><span className="cell-sub">Mobile Package:</span> <strong>PKR {pay.mobilePackage.toLocaleString()}</strong></div>
                      <div><span className="cell-sub">Bike Maintenance:</span> <strong>PKR {pay.bikeMaintenance.toLocaleString()}</strong></div>
                      <div><span className="cell-sub">Other Allowance:</span> <strong>PKR {(pay.otherAllowance || 0).toLocaleString()}</strong></div>
                      <div><span className="cell-sub">Overtime Rate:</span> <strong>PKR {(pay.overtimeHourlyRate || 0).toLocaleString()}/hr</strong></div>
                      <div style={{ gridColumn: '1 / -1', background: 'var(--bg-subtle, #f1f5f9)', padding: '0.5rem 0.75rem', borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span><strong>Total Gross Monthly Pay:</strong></span>
                        <span style={{ color: 'var(--primary)', fontWeight: 700 }}>PKR {pay.totalGross.toLocaleString()}</span>
                      </div>
                      {pay.bankName && (
                        <div style={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Bank: <strong>{pay.bankName}</strong> | Account / IBAN: <strong>{pay.bankAccountNumber || '—'}</strong>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      No salary structure configured yet. Click "Configure Salary" below to set up pay.
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
};
