import React, { useState } from 'react';
import {
  Banknote, Plus, Calendar, CheckCircle2, AlertCircle, Eye,
  ShieldCheck, FileText, ChevronRight, Check, X,
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
import { calculateSalaryLine, DEFAULT_PAYROLL_RULES } from '../../lib/payroll';
import type { SalaryCycle, SalaryCycleStatus, SalaryLine, Employee, EmployeePay, AttendanceRecord } from '../../types/hr';

const STATUS_BADGE: Record<SalaryCycleStatus, string> = {
  draft: 'badge-amber',
  verified: 'badge-blue',
  approved: 'badge-teal',
  paid: 'badge-slate',
};

const STATUS_LABEL: Record<SalaryCycleStatus, string> = {
  draft: 'Draft (HR)',
  verified: 'Verified (Finance)',
  approved: 'Approved (CEO)',
  paid: 'Paid & Disbursed',
};

export const PayrollPage: React.FC = () => {
  const store = useDataStore();
  const { effectiveRole, userProfile } = useAuth();
  const { success, error } = useNotification();

  const isSuperAdmin = effectiveRole === 'super_admin';
  const isFinance = effectiveRole === 'finance' || effectiveRole === 'super_admin' || effectiveRole === 'admin';
  const isHR = effectiveRole === 'hr' || effectiveRole === 'super_admin' || effectiveRole === 'admin';

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState<SalaryCycle | null>(null);
  const [cycleTitle, setCycleTitle] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [generating, setGenerating] = useState(false);
  const [payingCycle, setPayingCycle] = useState<SalaryCycle | null>(null);
  const [payMethod, setPayMethod] = useState('Bank Transfer');
  const [payRef, setPayRef] = useState('');

  const cycles: SalaryCycle[] = store.getSalaryCycles ? store.getSalaryCycles() : [];
  const employees: Employee[] = store.getEmployees ? store.getEmployees() : [];
  const jobs = store.getJobs ? store.getJobs() : [];

  const handleCreateCycle = async () => {
    if (!cycleTitle.trim()) {
      error('Validation', 'Cycle title is required (e.g. October 2026 Salary Cycle).');
      return;
    }
    setGenerating(true);
    try {
      // Calculate 30-day end date
      const start = new Date(startDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 29);
      const endDate = end.toISOString().slice(0, 10);

      // Fetch attendance in range
      const attendance: AttendanceRecord[] = store.getAttendance
        ? store.getAttendance(undefined, startDate, endDate)
        : [];

      // Calculate line for each active employee
      const activeEmployees = employees.filter((e) => e.status !== 'inactive');
      const lines: SalaryLine[] = activeEmployees.map((emp) => {
        // Find pay structure if exists
        const payList = (store as unknown as { s?: { employeePay?: EmployeePay[] } })?.s?.employeePay || [];
        const empPay = payList.find((p) => p.id === emp.id);
        return calculateSalaryLine(emp, empPay, attendance, jobs, DEFAULT_PAYROLL_RULES);
      });

      const totalGross = lines.reduce((sum, l) => sum + l.baseSalary + l.allowances + l.incentive, 0);
      const totalDeductions = lines.reduce((sum, l) => sum + l.totalDeductions, 0);
      const totalNet = lines.reduce((sum, l) => sum + l.netPayable, 0);

      const cycleId = 'PAY-' + startDate.slice(0, 7);
      const now = new Date().toISOString();

      const newCycle: SalaryCycle = {
        id: cycleId,
        title: cycleTitle.trim(),
        startDate,
        endDate,
        status: 'draft',
        lines,
        totalGross,
        totalDeductions,
        totalNet,
        preparedBy: userProfile?.displayName || userProfile?.email || 'HR Department',
        preparedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      await dataService.saveSalaryCycle(newCycle, userProfile?.email || 'hr');
      success('Created', `Salary cycle ${cycleId} created with ${lines.length} employee lines.`);
      setShowCreateModal(false);
      setSelectedCycle(newCycle);
    } catch (err: unknown) {
      error('Generation failed', (err instanceof Error ? err.message : String(err)));
    } finally {
      setGenerating(false);
    }
  };

  const handleVerifyCycle = async (c: SalaryCycle) => {
    if (!isFinance) {
      error('Permission denied', 'Only Finance / Accounts can verify payroll cycles.');
      return;
    }
    const updated: SalaryCycle = {
      ...c,
      status: 'verified',
      verifiedBy: userProfile?.displayName || userProfile?.email || 'Finance',
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await dataService.saveSalaryCycle(updated, userProfile?.email || 'finance');
    setSelectedCycle(updated);
    success('Verified', 'Payroll cycle verified by Finance. Ready for CEO approval.');
  };

  const handleApproveCycle = async (c: SalaryCycle) => {
    if (!isSuperAdmin) {
      error('Permission denied', 'Only CEO / Super Admin can approve payroll cycles.');
      return;
    }
    const updated: SalaryCycle = {
      ...c,
      status: 'approved',
      approvedBy: userProfile?.displayName || userProfile?.email || 'CEO',
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await dataService.saveSalaryCycle(updated, userProfile?.email || 'admin');
    setSelectedCycle(updated);
    success('Approved', 'Payroll cycle approved by CEO. Finance can disburse salaries.');
  };

  const handleMarkPaid = async () => {
    if (!payingCycle) return;
    const now = new Date().toISOString();
    const updated: SalaryCycle = {
      ...payingCycle,
      status: 'paid',
      paidOn: now.slice(0, 10),
      paymentMethod: payMethod,
      paymentRef: payRef.trim() || undefined,
      updatedAt: now,
    };
    await dataService.saveSalaryCycle(updated, userProfile?.email || 'finance');
    setPayingCycle(null);
    setSelectedCycle(updated);
    success('Paid', 'Payroll cycle marked as PAID and disbursed.');
  };

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Accounts', path: '/finance/invoices' }, { label: '30-Day Payroll' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Salary Distribution (30-Day Payroll)</h1>
          <p className="page-subtitle">
            30-day salary calculation based on daily attendance, approved jobs, and deduction rules. Verified by Finance, approved by CEO.
          </p>
        </div>
        {isHR && (
          <button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} /> New Salary Cycle
          </button>
        )}
      </div>

      {cycles.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No salary cycles yet"
          description="Prepare the first 30-day salary cycle from attendance and employee records."
          action={isHR ? { label: 'New Salary Cycle', onClick: () => setShowCreateModal(true) } : undefined}
        />
      ) : (
        <div className="table-container" style={{ marginBottom: '1.5rem' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Cycle ID</th>
                <th>Title & Period</th>
                <th>Staff Count</th>
                <th>Total Gross</th>
                <th>Deductions</th>
                <th>Net Payable</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.id}</span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.title}</div>
                    <div className="cell-sub">
                      {formatDate(c.startDate)} to {formatDate(c.endDate)}
                    </div>
                  </td>
                  <td>{c.lines?.length || 0}</td>
                  <td>PKR {c.totalGross.toLocaleString()}</td>
                  <td style={{ color: c.totalDeductions > 0 ? 'var(--ikpm-rose-600)' : 'inherit' }}>
                    PKR {c.totalDeductions.toLocaleString()}
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--ikpm-navy-900)' }}>
                    PKR {c.totalNet.toLocaleString()}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => setSelectedCycle(c)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Eye size={13} /> View Lines
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cycle Lines Detail Modal */}
      {selectedCycle && (
        <Modal
          isOpen={Boolean(selectedCycle)}
          title={`Cycle: ${selectedCycle.title} (${selectedCycle.id})`}
          onClose={() => setSelectedCycle(null)}
          maxWidth="1000px"
          footer={
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <div>
                <span className={`badge ${STATUS_BADGE[selectedCycle.status]}`}>
                  {STATUS_LABEL[selectedCycle.status]}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {selectedCycle.status === 'draft' && isFinance && (
                  <button type="button" className="btn btn-secondary" onClick={() => handleVerifyCycle(selectedCycle)}>
                    <CheckCircle2 size={15} /> Verify (Finance)
                  </button>
                )}
                {selectedCycle.status === 'verified' && isSuperAdmin && (
                  <button type="button" className="btn btn-primary" onClick={() => handleApproveCycle(selectedCycle)}>
                    <ShieldCheck size={15} /> Approve Cycle (CEO)
                  </button>
                )}
                {selectedCycle.status === 'approved' && isFinance && (
                  <button type="button" className="btn btn-primary" onClick={() => setPayingCycle(selectedCycle)}>
                    <Banknote size={15} /> Disburse & Mark Paid
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedCycle(null)}>
                  Close
                </button>
              </div>
            </div>
          }
        >
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <div className="cell-sub">Period</div>
              <div style={{ fontWeight: 600 }}>{formatDate(selectedCycle.startDate)} — {formatDate(selectedCycle.endDate)}</div>
            </div>
            <div>
              <div className="cell-sub">Total Net Payout</div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--ikpm-navy-900)' }}>
                PKR {selectedCycle.totalNet.toLocaleString()}
              </div>
            </div>
            {selectedCycle.preparedBy && (
              <div>
                <div className="cell-sub">Prepared By</div>
                <div style={{ fontWeight: 600 }}>{selectedCycle.preparedBy}</div>
              </div>
            )}
            {selectedCycle.approvedBy && (
              <div>
                <div className="cell-sub">Approved By</div>
                <div style={{ fontWeight: 600 }}>{selectedCycle.approvedBy}</div>
              </div>
            )}
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Base</th>
                  <th>Allowances</th>
                  <th>Att. Days</th>
                  <th>Lates</th>
                  <th>Deductions</th>
                  <th>Incentives</th>
                  <th style={{ textAlign: 'right' }}>Net Payable</th>
                </tr>
              </thead>
              <tbody>
                {selectedCycle.lines?.map((line) => (
                  <tr key={line.employeeId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{line.employeeName}</div>
                      <div className="cell-sub">{line.employeeId}</div>
                    </td>
                    <td>{line.role}</td>
                    <td>PKR {line.baseSalary.toLocaleString()}</td>
                    <td>PKR {line.allowances.toLocaleString()}</td>
                    <td>{line.attendanceDays}</td>
                    <td>
                      {line.lateMarks > 0 ? (
                        <span className="badge badge-amber">{line.lateMarks}</span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td style={{ color: line.totalDeductions > 0 ? 'var(--ikpm-rose-600)' : 'inherit' }}>
                      {line.totalDeductions > 0 ? `-PKR ${line.totalDeductions.toLocaleString()}` : '0'}
                    </td>
                    <td style={{ color: line.incentive > 0 ? 'var(--ikpm-teal-600)' : 'inherit' }}>
                      {line.incentive > 0 ? `+PKR ${line.incentive.toLocaleString()}` : '0'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--ikpm-navy-900)' }}>
                      PKR {line.netPayable.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {/* Create Cycle Modal */}
      {showCreateModal && (
        <Modal
          isOpen={showCreateModal}
          title="Generate 30-Day Salary Cycle"
          onClose={() => setShowCreateModal(false)}
          footer={
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleCreateCycle} disabled={generating}>
                {generating ? 'Calculating…' : 'Generate Cycle'}
              </button>
            </div>
          }
        >
          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Cycle Title *</label>
              <input
                className="form-input"
                placeholder="e.g. October 2026 Salary Cycle"
                value={cycleTitle}
                onChange={(e) => setCycleTitle(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Cycle Start Date *</label>
              <input
                type="date"
                className="form-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <span className="cell-sub" style={{ marginTop: '4px', display: 'block' }}>
                A 30-day period will be calculated starting from this date.
              </span>
            </div>
          </div>
        </Modal>
      )}

      {/* Disburse / Mark Paid Modal */}
      {payingCycle && (
        <Modal
          isOpen={Boolean(payingCycle)}
          title={`Disburse Payroll: ${payingCycle.title}`}
          onClose={() => setPayingCycle(null)}
          footer={
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setPayingCycle(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleMarkPaid}>
                Confirm Disbursement
              </button>
            </div>
          }
        >
          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.85rem' }}>
            <div className="alert-banner alert-banner-teal">
              <span>Total disbursement amount: <strong>PKR {payingCycle.totalNet.toLocaleString()}</strong> across {payingCycle.lines?.length} staff members.</span>
            </div>
            <div className="form-group">
              <label className="form-label">Payment Method *</label>
              <select className="form-select" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="Bank Transfer">Bank Transfer / Raast</option>
                <option value="Cheque">Company Cheque</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Transaction / Cheque Reference</label>
              <input
                className="form-input"
                placeholder="e.g. Cheque # 829104 or FT-93821"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
