import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Truck,
  Plus,
  Search,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  Download,
  AlertTriangle,
  UserCheck,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { formatDate, generatePermanentId } from '../../lib/formatters';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { ServiceJob, JobStatus } from '../../types/operations';
import { PestType } from '../../types/crm';

export const JobsListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { success, warning } = useNotification();
  const { userProfile, effectiveRole } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedJob, setSelectedJob] = useState<ServiceJob | null>(null);
  const [showNewJobModal, setShowNewJobModal] = useState(searchParams.get('action') === 'new_job');

  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const jobs = dataService.getJobs();

  // New Job Form State
  const [newJob, setNewJob] = useState({
    customerId: companies[0]?.id || '',
    customerType: 'company' as const,
    scheduledDate: new Date().toISOString().split('T')[0],
    timeSlot: 'morning' as const,
    serviceType: 'Preventive Cockroach & Rodent IPM',
    targetPests: ['cockroaches', 'rodents_rats'] as PestType[],
    leadPcoName: 'Kamran Abbasi (PCO)',
  });

  const filteredJobs = jobs.filter((j) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      j.id.toLowerCase().includes(q) ||
      j.customerName.toLowerCase().includes(q) ||
      j.siteName.toLowerCase().includes(q) ||
      j.leadPcoName.toLowerCase().includes(q);

    const matchStatus = statusFilter === 'all' || j.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleCreateJob = (e: React.FormEvent) => {
    e.preventDefault();
    let customerName = '';
    let siteName = 'Main Premises';
    let siteAddress = 'Main City Facility';

    if (newJob.customerType === 'company') {
      const co = dataService.getCompanyById(newJob.customerId);
      customerName = co?.legalCompanyName || 'Corporate Company';
      const sites = dataService.getSites(newJob.customerId);
      if (sites[0]) {
        siteName = sites[0].siteName;
        siteAddress = sites[0].addressLine1;
      }
    } else {
      const cl = dataService.getClientById(newJob.customerId);
      customerName = cl?.fullName || 'Individual Client';
      siteAddress = cl?.residentialAddress || 'Residence';
    }

    // Conflict detection check
    const hasConflict = dataService.checkPcoConflict(
      newJob.leadPcoName,
      newJob.scheduledDate,
      newJob.timeSlot
    );
    if (hasConflict) {
      warning(
        'Technician Schedule Overlap',
        `Warning: ${newJob.leadPcoName} already has another assignment in the ${newJob.timeSlot} slot on ${newJob.scheduledDate}.`
      );
    }

    const nextId = generatePermanentId('JOB', jobs.length + 1);
    const created: ServiceJob = {
      id: nextId,
      customerType: newJob.customerType,
      customerId: newJob.customerId,
      customerName,
      siteId: 'SITE-01',
      siteName,
      siteAddress,
      serviceType: newJob.serviceType,
      targetPests: newJob.targetPests,
      scheduledDate: newJob.scheduledDate,
      timeSlot: newJob.timeSlot,
      assignedTechnicianIds: ['pco_01'],
      assignedTechnicianNames: [newJob.leadPcoName],
      leadPcoId: 'pco_01',
      leadPcoName: newJob.leadPcoName,
      status: 'scheduled',
      checklists: [
        { id: 'c1', taskDescription: 'Conduct preliminary perimeter inspection and moisture audit', isCompleted: false },
        { id: 'c2', taskDescription: 'Apply target formulation with correct calibrated dosage', isCompleted: false },
        { id: 'c3', taskDescription: 'Perform post-application sanitation check with client', isCompleted: false },
      ],
      chemicalsUsed: [
        {
          id: 'chem_01',
          chemicalName: 'Premise 200 SC / Maxforce FC Gel',
          activeIngredient: 'Imidacloprid / Hydramethylnon',
          dosageRate: 'Standard Manufacturer Label Spec',
          quantityUsed: 1,
          unit: 'litres',
          batchNumber: 'BATCH-2026-A',
          targetPest: 'cockroaches',
          applicationMethod: 'gel_baiting',
        },
      ],
      photoEvidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    dataService.saveJob(created, userProfile?.email);
    success('Field Service Visit Scheduled', `${created.id} assigned to ${created.leadPcoName}`);
    setShowNewJobModal(false);
  };

  const handleUpdateStatus = (job: ServiceJob, newStatus: JobStatus) => {
    const updated: ServiceJob = { ...job, status: newStatus };
    dataService.saveJob(updated, userProfile?.email);
    success('Job Status Updated', `${job.id} marked ${newStatus}`);
    setSelectedJob(updated);
  };

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Service Jobs & Field Operations' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Field Service Jobs & Operations</h1>
          <p className="page-subtitle">
            Technician assignments, chemical usage logs, customer acknowledgment, and supervisor verification.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={() => navigate('/operations/calendar')}>
            <Calendar size={15} />
            <span>Calendar Board</span>
          </button>
          <button className="btn btn-primary" onClick={() => setShowNewJobModal(true)}>
            <Plus size={16} />
            <span>+ Schedule Service Visit</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {['all', 'scheduled', 'en_route', 'in_progress', 'completed', 'cancelled'].map((st) => (
            <button
              key={st}
              className={`btn ${statusFilter === st ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
              onClick={() => setStatusFilter(st)}
            >
              {st.replace(/_/g, ' ').toUpperCase()}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: '260px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search by Job #, client, PCO..."
            className="form-input"
            style={{ paddingLeft: '2.2rem', height: '34px', fontSize: '0.8rem' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Customer & Type</th>
              <th>Premises / Site</th>
              <th>Scheduled Date</th>
              <th>Time Slot</th>
              <th>Lead PCO</th>
              <th>Target Pests</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.map((j) => (
              <tr key={j.id}>
                <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{j.id}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{j.customerName}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {j.customerType}
                  </div>
                </td>
                <td>
                  <div style={{ fontWeight: 500 }}>{j.siteName}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{j.siteAddress}</div>
                </td>
                <td style={{ fontWeight: 600 }}>{formatDate(j.scheduledDate)}</td>
                <td><span className="badge-status badge-slate">{j.timeSlot}</span></td>
                <td>{j.leadPcoName}</td>
                <td>
                  <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
                    {j.targetPests.map((p) => (
                      <span key={p} className="badge-status badge-slate" style={{ fontSize: '0.65rem' }}>
                        {p.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </td>
                <td><StatusBadge status={j.status} /></td>
                <td>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      className="btn btn-outline-emerald"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                      onClick={() => setSelectedJob(j)}
                    >
                      Report Form
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                      title="Download Service Report PDF"
                      onClick={() => pdfGenerator.generateJobReportPDF(j)}
                    >
                      <Download size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal: Schedule Job */}
      <Modal
        isOpen={showNewJobModal}
        onClose={() => setShowNewJobModal(false)}
        title="Schedule Operations Service Visit"
        subtitle="Assign technicians, check schedule conflicts, and allocate chemical checklists."
        maxWidth="620px"
      >
        <form onSubmit={handleCreateJob}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Client Type</label>
              <select
                className="form-select"
                value={newJob.customerType}
                onChange={(e) => {
                  setNewJob({
                    ...newJob,
                    customerType: e.target.value as any,
                    customerId: e.target.value === 'company' ? companies[0]?.id || '' : clients[0]?.id || '',
                  });
                }}
              >
                <option value="company">Corporate Company</option>
                <option value="individual">Individual Client</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Select Customer Account <span className="required">*</span></label>
              <select
                className="form-select"
                value={newJob.customerId}
                onChange={(e) => setNewJob({ ...newJob, customerId: e.target.value })}
              >
                {newJob.customerType === 'company'
                  ? companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.legalCompanyName} ({c.id})
                      </option>
                    ))
                  : clients.map((cl) => (
                      <option key={cl.id} value={cl.id}>
                        {cl.fullName} ({cl.id})
                      </option>
                    ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Scheduled Date <span className="required">*</span></label>
              <input
                type="date"
                required
                className="form-input"
                value={newJob.scheduledDate}
                onChange={(e) => setNewJob({ ...newJob, scheduledDate: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Time Slot Shift</label>
              <select
                className="form-select"
                value={newJob.timeSlot}
                onChange={(e) => setNewJob({ ...newJob, timeSlot: e.target.value as any })}
              >
                <option value="morning">Morning (09:00 AM - 01:00 PM)</option>
                <option value="afternoon">Afternoon (02:00 PM - 06:00 PM)</option>
                <option value="evening">Evening (06:00 PM - 10:00 PM)</option>
                <option value="night_shift">Night Shift (Bakery/Plant Off-Hours)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Service Type</label>
              <input
                type="text"
                className="form-input"
                value={newJob.serviceType}
                onChange={(e) => setNewJob({ ...newJob, serviceType: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Lead PCO (Technician)</label>
              <select
                className="form-select"
                value={newJob.leadPcoName}
                onChange={(e) => setNewJob({ ...newJob, leadPcoName: e.target.value })}
              >
                <option value="Kamran Abbasi (PCO)">Kamran Abbasi (PCO)</option>
                <option value="Irfan Jameel (Technician)">Irfan Jameel (Technician)</option>
                <option value="Muhammad Asif (Supervisor)">Muhammad Asif (Supervisor)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowNewJobModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Schedule Service Visit
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: View Job Details, Checklist & Chemical Log */}
      {selectedJob && (
        <Modal
          isOpen={Boolean(selectedJob)}
          onClose={() => setSelectedJob(null)}
          title={`Job Visit: ${selectedJob.id}`}
          subtitle={`Client: ${selectedJob.customerName} • Site: ${selectedJob.siteName}`}
          maxWidth="700px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <button
                className="btn btn-secondary"
                onClick={() => pdfGenerator.generateJobReportPDF(selectedJob)}
              >
                <Download size={14} />
                <span>Download Report PDF</span>
              </button>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Status:</span>
                <select
                  className="form-select"
                  style={{ width: '150px', height: '32px', fontSize: '0.78rem' }}
                  value={selectedJob.status}
                  onChange={(e) => handleUpdateStatus(selectedJob, e.target.value as JobStatus)}
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="en_route">En Route</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Scheduled Date & Shift:</span>
                <div style={{ fontWeight: 700 }}>{formatDate(selectedJob.scheduledDate)} ({selectedJob.timeSlot})</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Assigned PCO Lead:</span>
                <div style={{ fontWeight: 600 }}>{selectedJob.leadPcoName}</div>
              </div>
            </div>

            {/* Checklist */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
              <h4 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.5rem' }}>Field Checklist Items</h4>
              {selectedJob.checklists.map((c, idx) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={c.isCompleted}
                    onChange={(e) => {
                      const next = [...selectedJob.checklists];
                      next[idx].isCompleted = e.target.checked;
                      const updated = { ...selectedJob, checklists: next };
                      dataService.saveJob(updated, userProfile?.email);
                      setSelectedJob(updated);
                    }}
                  />
                  <span>{c.taskDescription}</span>
                </div>
              ))}
            </div>

            {/* Chemicals Used Log */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
              <h4 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.5rem' }}>Chemicals Dosage & Batch Log</h4>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Chemical Formulation</th>
                      <th>Active Ingredient</th>
                      <th>Dosage & Qty</th>
                      <th>Batch Number</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedJob.chemicalsUsed.map((chem) => (
                      <tr key={chem.id}>
                        <td><strong>{chem.chemicalName}</strong></td>
                        <td>{chem.activeIngredient}</td>
                        <td>{chem.quantityUsed} {chem.unit} ({chem.dosageRate})</td>
                        <td style={{ fontFamily: 'monospace' }}>{chem.batchNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
