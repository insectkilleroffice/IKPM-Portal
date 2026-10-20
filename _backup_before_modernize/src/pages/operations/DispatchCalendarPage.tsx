import React, { useState } from 'react';
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
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatDate } from '../../lib/formatters';

export const DispatchCalendarPage: React.FC = () => {
  const navigate = useNavigate();
  const jobs = dataService.getJobs();

  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedTechnician, setSelectedTechnician] = useState<string>('all');

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

  const timeSlots = ['morning', 'afternoon', 'evening', 'night_shift'] as const;

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
          <h1>Operations Dispatch Calendar</h1>
          <p className="page-subtitle">
            Technician workload scheduling, vehicle dispatch, and double-booking conflict mitigation.
          </p>
        </div>

        <button className="btn btn-primary" onClick={() => navigate('/operations/jobs?action=new_job')}>
          <Plus size={16} />
          <span>+ Schedule Visit</span>
        </button>
      </div>

      {/* Calendar Controls */}
      <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <CalendarDays size={18} color="var(--ikpm-emerald-600)" />
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>PCO Dispatch Schedule</span>
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
              <option value="all">All Field Technicians</option>
              <option value="Kamran Abbasi">Kamran Abbasi (PCO)</option>
              <option value="Irfan Jameel">Irfan Jameel (Technician)</option>
              <option value="Muhammad Asif">Muhammad Asif (Supervisor)</option>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
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
                      {job.siteName}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.65rem' }}>
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
    </div>
  );
};
