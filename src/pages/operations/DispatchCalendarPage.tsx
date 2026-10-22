import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  Truck,
  Plus,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Clock,
  User,
  Download,
  FileText,
  Layers,
  Calendar,
  Store,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatDate } from '../../lib/formatters';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { opsPdf } from '../../lib/opsPdf';
import { fileGenerated } from '../../features/documents/fileGenerated';
import { ScheduleGeneratorModal } from '../../features/schedule/ScheduleGeneratorModal';
import type { Contract, ServiceJob } from '../../types/operations';
import type { DocumentOwner } from '../../types/document';

export const DispatchCalendarPage: React.FC = () => {
  useDataStore(); // re-render when Firestore data arrives
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { success, error } = useNotification();

  const jobs = dataService.getJobs();
  const contracts = dataService.getContracts();

  const [activeTab, setActiveTab] = useState<'calendar' | 'schedules'>('calendar');
  const [selectedTechnician, setSelectedTechnician] = useState<string>('all');
  const [selectedContractId, setSelectedContractId] = useState<string>(contracts[0]?.id || '');
  const [scheduleModalContract, setScheduleModalContract] = useState<Contract | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const filteredJobs = jobs.filter((j) => {
    const matchTech = selectedTechnician === 'all' || j.leadPcoName.includes(selectedTechnician);
    return matchTech;
  });

  // Group jobs by date
  const jobsByDate = filteredJobs.reduce((acc, job) => {
    const date = job.scheduledDate;
    if (!acc[date]) acc[date] = [];
    acc[date].push(job);
    return acc;
  }, {} as Record<string, typeof jobs>);

  // Selected contract for the schedule view
  const activeContract = useMemo(() => {
    return contracts.find((c) => c.id === selectedContractId) || contracts[0];
  }, [contracts, selectedContractId]);

  // Jobs linked to the active contract
  const contractJobs = useMemo(() => {
    if (!activeContract) return [];
    return jobs.filter((j) => j.contractId === activeContract.id);
  }, [jobs, activeContract]);

  // Group visits by month for the Dunkin Schedule view
  const scheduleByMonth = useMemo(() => {
    if (!contractJobs.length) return {};
    const map: Record<string, ServiceJob[]> = {};
    contractJobs.forEach((j) => {
      const month = j.scheduledDate.slice(0, 7);
      if (!map[month]) map[month] = [];
      map[month].push(j);
    });
    return map;
  }, [contractJobs]);

  const handleExportSchedulePdf = async () => {
    if (!activeContract || !contractJobs.length) return;
    try {
      setIsExporting(true);
      const scheduleInput = {
        clientName: activeContract.customerName,
        contractId: activeContract.id,
        preparedBy: userProfile?.displayName || 'Operations Staff',
        visits: contractJobs.map((j) => ({
          branchName: j.branchName || j.siteName,
          closingTime: (j.branchId ? dataService.getBranchById(j.branchId)?.closingTime : undefined) || undefined,
          date: j.scheduledDate,
          kind: (j.visitKind || 'service') as 'service' | 'follow_up',
          pcoName: j.leadPcoName,
        })),
      };

      const blob = await opsPdf.scheduleBlob(scheduleInput);
      const fileName = opsPdf.scheduleFileName(scheduleInput);
      const title = `Visit Schedule - ${activeContract.customerName} (${activeContract.id})`;

      const owner: DocumentOwner = activeContract.branchId
        ? { kind: 'branch', id: activeContract.branchId }
        : activeContract.customerType === 'company'
        ? { kind: 'company', id: activeContract.customerId }
        : { kind: 'client', id: activeContract.customerId };

      await fileGenerated(blob, {
        owner,
        category: 'schedule',
        title,
        fileName,
        subPath: activeContract.id,
        user: { email: userProfile?.email, displayName: userProfile?.displayName },
      });

      success('Schedule Exported & Auto-Filed', `Saved ${fileName} into client's Documents folder.`);
    } catch (err) {
      error('Export Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <Breadcrumbs
        items={[
          { label: 'Field Operations', path: '/operations/jobs' },
          { label: 'Dispatch Calendar' },
        ]}
      />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Operations Dispatch & Visit Schedules</h1>
          <p className="page-subtitle">
            PCO workload calendar, vehicle dispatch, and Dunkin-style contractual visit schedules.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {activeContract && (
            <button
              className="btn btn-secondary"
              onClick={() => setScheduleModalContract(activeContract)}
            >
              <Calendar size={15} />
              <span>Generate Visit Schedule</span>
            </button>
          )}
          <button className="btn btn-primary" onClick={() => navigate('/operations/jobs?action=new_job')}>
            <Plus size={16} />
            <span>+ Schedule Visit</span>
          </button>
        </div>
      </div>

      {/* View Toggle Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <button
          className={`btn ${activeTab === 'calendar' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('calendar')}
        >
          <CalendarDays size={15} />
          <span>Dispatch Daily Grid</span>
        </button>
        <button
          className={`btn ${activeTab === 'schedules' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('schedules')}
        >
          <Layers size={15} />
          <span>Contract Visit Schedules (Dunkin Format)</span>
        </button>
      </div>

      {activeTab === 'calendar' ? (
        <>
          {/* Calendar Controls */}
          <div
            className="card"
            style={{
              padding: '1rem 1.25rem',
              marginBottom: '1.5rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <CalendarDays size={18} color="var(--ikpm-emerald-600)" />
              <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>PCO Dispatch Daily Grid</span>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                <span>Filter PCO:</span>
                <select
                  className="form-select"
                  style={{ width: '190px', height: '34px', fontSize: '0.8rem' }}
                  value={selectedTechnician}
                  onChange={(e) => setSelectedTechnician(e.target.value)}
                >
                  <option value="all">All Team Leaders</option>
                  {dataService.getStaff(['team_leader']).map((t) => (
                    <option key={t.uid} value={t.displayName}>
                      {t.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Daily Dispatch Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
            {Object.keys(jobsByDate).map((date) => {
              const dateJobs = jobsByDate[date];
              return (
                <div
                  key={date}
                  className="card"
                  style={{
                    borderTop: '3px solid var(--ikpm-navy-700)',
                    padding: '1.25rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '1rem',
                      borderBottom: '1px solid var(--border-subtle)',
                      paddingBottom: '0.5rem',
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--ikpm-navy-900)' }}>
                      {formatDate(date)}
                    </div>
                    <span className="badge-status badge-navy">{dateJobs.length} Visits</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {dateJobs.map((job) => (
                      <div
                        key={job.id}
                        onClick={() => navigate(`/operations/jobs?job=${job.id}`)}
                        style={{
                          padding: '0.85rem',
                          backgroundColor: 'var(--bg-surface-alt)',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          transition: 'transform 0.1s',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{job.customerName}</span>
                          <span className="badge-status badge-slate" style={{ fontSize: '0.65rem' }}>
                            {job.timeSlot.replace('_', ' ')}
                          </span>
                        </div>

                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          <MapPin size={11} style={{ display: 'inline', marginRight: '3px' }} />
                          {job.branchName || job.siteName}
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: '0.65rem',
                          }}
                        >
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            <User size={11} style={{ display: 'inline', marginRight: '3px' }} />
                            {job.leadPcoName}
                          </span>
                          <StatusBadge status={job.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        /* Contract Schedules (Dunkin Format View) */
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div
            className="card"
            style={{
              padding: '1rem 1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Store size={18} color="var(--ikpm-navy-700)" />
              <div style={{ fontWeight: 700 }}>Select AMC Contract:</div>
              <select
                className="form-select"
                style={{ width: '280px', height: '34px', fontSize: '0.85rem' }}
                value={selectedContractId}
                onChange={(e) => setSelectedContractId(e.target.value)}
              >
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} — {c.customerName} ({c.totalJobsScheduled || 0} visits)
                  </option>
                ))}
              </select>
            </div>

            {activeContract && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-outline-navy"
                  disabled={isExporting || contractJobs.length === 0}
                  onClick={handleExportSchedulePdf}
                >
                  <Download size={14} />
                  <span>{isExporting ? 'Exporting...' : 'Export Dunkin PDF Schedule'}</span>
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setScheduleModalContract(activeContract)}
                >
                  <Calendar size={14} />
                  <span>Plan / Edit Schedule</span>
                </button>
              </div>
            )}
          </div>

          {activeContract ? (
            <div className="card" style={{ padding: '1.25rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  paddingBottom: '0.75rem',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', margin: 0 }}>
                    {activeContract.customerName} — AMC Visit Schedule
                  </h2>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Contract: {activeContract.id} • Term: {formatDate(activeContract.startDate)} to {formatDate(activeContract.endDate)} • Frequency: {activeContract.frequency}
                  </div>
                </div>
                <span className="badge-status badge-emerald" style={{ fontSize: '0.8rem' }}>
                  {contractJobs.length} Visits Scheduled
                </span>
              </div>

              {contractJobs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                  <CalendarDays size={36} style={{ margin: '0 auto 0.75rem auto', opacity: 0.5 }} />
                  <div style={{ fontWeight: 600 }}>No service visits generated yet for this contract.</div>
                  <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    Click &ldquo;Plan / Edit Schedule&rdquo; above to generate visits per branch respecting closing times.
                  </p>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: '0.75rem' }}
                    onClick={() => setScheduleModalContract(activeContract)}
                  >
                    Generate Visit Schedule
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {Object.keys(scheduleByMonth).map((month) => {
                    const monthJobs = scheduleByMonth[month];
                    const branches = [...new Set(monthJobs.map((j) => j.branchName || j.siteName))].sort();
                    const monthTitle = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', {
                      month: 'long',
                      year: 'numeric',
                    });

                    return (
                      <div key={month}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '0.925rem',
                            color: 'var(--ikpm-navy-800)',
                            marginBottom: '0.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <Calendar size={14} />
                          <span>{monthTitle}</span>
                        </div>

                        <div className="table-container">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Branch / Outlet</th>
                                <th>Closing Time / Window</th>
                                <th>1st Service Date</th>
                                <th>2nd Service Date</th>
                                <th>Follow-up Dates</th>
                                <th>Assigned Technician</th>
                              </tr>
                            </thead>
                            <tbody>
                              {branches.map((bName) => {
                                const bJobs = monthJobs.filter((j) => (j.branchName || j.siteName) === bName);
                                const serviceVisits = bJobs
                                  .filter((j) => j.visitKind !== 'follow_up')
                                  .map((j) => j.scheduledDate)
                                  .sort();
                                const followUpVisits = bJobs
                                  .filter((j) => j.visitKind === 'follow_up')
                                  .map((j) => j.scheduledDate)
                                  .sort();
                                const techNames = [...new Set(bJobs.map((j) => j.leadPcoName))].join(', ');

                                return (
                                  <tr key={bName}>
                                    <td style={{ fontWeight: 700 }}>{bName}</td>
                                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                      {bJobs[0]?.timeSlot === 'night_shift'
                                        ? 'Closes 23:00 (Night Shift)'
                                        : 'Regular Service Window'}
                                    </td>
                                    <td style={{ fontWeight: 600, color: 'var(--ikpm-emerald-700)' }}>
                                      {serviceVisits[0] ? formatDate(serviceVisits[0]) : '—'}
                                    </td>
                                    <td style={{ fontWeight: 600, color: 'var(--ikpm-emerald-700)' }}>
                                      {serviceVisits[1] ? formatDate(serviceVisits[1]) : '—'}
                                    </td>
                                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                      {[...serviceVisits.slice(2).map(formatDate), ...followUpVisits.map(formatDate)].join(', ') || '—'}
                                    </td>
                                    <td style={{ fontSize: '0.8rem' }}>{techNames || 'Unassigned'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {scheduleModalContract && (
        <ScheduleGeneratorModal
          contract={scheduleModalContract}
          onClose={() => setScheduleModalContract(null)}
        />
      )}
    </div>
  );
};
