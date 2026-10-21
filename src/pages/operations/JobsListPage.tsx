import React, { useState, useEffect } from 'react';
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
  ArrowRight,
  ShieldCheck,
  Receipt,
  FileCheck2,
  CheckCircle,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { formatDate, generatePermanentId } from '../../lib/formatters';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { usePdfAction } from '../../hooks/usePdfAction';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import type { ServiceJob, JobStatus, SupervisorVerification } from '../../types/operations';
import type { PestType } from '../../types/crm';
import { UnifiedWorkflowStatusBar } from '../../components/common/UnifiedWorkflowStatusBar';
import { getJobNextAction } from '../../lib/workflow';

export const JobsListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { success, warning, error } = useNotification();
  const pdfAction = usePdfAction();
  const { userProfile, effectiveRole } = useAuth();
  useDataStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedJob, setSelectedJob] = useState<ServiceJob | null>(null);
  const [showNewJobModal, setShowNewJobModal] = useState(
    searchParams.get('action') === 'new_job' || Boolean(searchParams.get('fromProposal'))
  );

  // Supervisor QC Verification Modal
  const [showVerifyModal, setShowVerifyModal] = useState<ServiceJob | null>(null);
  const [verifyForm, setVerifyForm] = useState({
    supervisorName: userProfile?.displayName || 'Muhammad Asif (QC Supervisor)',
    qcRating: 'excellent' as 'excellent' | 'satisfactory' | 'needs_revisit' | 'rejected',
    supervisorNotes: 'Dosage calibrations, safety protocols, and pest eradication coverage confirmed compliant with standard IPM operating specs.',
  });

  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const jobs = dataService.getJobs();
  const technicians = dataService.getStaff(['technician']);

  // If fromProposal or customerId query params are provided, pre-fill
  const fromPropId = searchParams.get('fromProposal');
  const paramCustomerId = searchParams.get('customerId');
  const paramCustomerType = (searchParams.get('customerType') as 'company' | 'individual') || 'company';
  const paramBranchId = searchParams.get('branchId') || undefined;
  const linkedProposal = fromPropId ? dataService.getProposalById(fromPropId) : undefined;

  const [newJob, setNewJob] = useState({
    customerId: linkedProposal?.customerId || paramCustomerId || companies[0]?.id || '',
    customerType: linkedProposal?.customerType || paramCustomerType,
    proposalId: linkedProposal?.id || '',
    scheduledDate: new Date().toISOString().split('T')[0],
    timeSlot: 'morning' as const,
    serviceType: linkedProposal?.scopeOfWork || 'Preventive Cockroach & Rodent IPM',
    targetPests: (linkedProposal?.lineItems.map((li) => li.targetPest) as PestType[]) || ['cockroaches', 'rodents_rats'],
    leadPcoId: '',
    leadPcoName: '',
  });

  useEffect(() => {
    if (linkedProposal) {
      setNewJob({
        customerId: linkedProposal.customerId,
        customerType: linkedProposal.customerType,
        proposalId: linkedProposal.id,
        scheduledDate: new Date().toISOString().split('T')[0],
        timeSlot: 'morning',
        serviceType: linkedProposal.scopeOfWork,
        targetPests: linkedProposal.lineItems.map((li) => li.targetPest) as PestType[],
        leadPcoId: '',
        leadPcoName: '',
      });
      setShowNewJobModal(true);
    } else if (paramCustomerId) {
      setNewJob((prev) => ({
        ...prev,
        customerId: paramCustomerId,
        customerType: paramCustomerType,
      }));
      setShowNewJobModal(true);
    }
  }, [linkedProposal, paramCustomerId, paramCustomerType]);

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

    // Guard Rail 2: No job without an assigned technician
    if (!newJob.leadPcoName || newJob.leadPcoName.trim() === '' || newJob.leadPcoName === 'Unassigned') {
      warning('Technician Assignment Mandatory', 'Guard Rail: Cannot schedule service visit without assigning a certified technician.');
      return;
    }

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
      branchId: paramBranchId || undefined,
      proposalId: newJob.proposalId || undefined,
      siteId: 'SITE-01',
      siteName,
      siteAddress,
      serviceType: newJob.serviceType,
      targetPests: newJob.targetPests,
      scheduledDate: newJob.scheduledDate,
      timeSlot: newJob.timeSlot,
      // Real staff uids: technicians only receive jobs listed here (enforced by firestore.rules)
      assignedTechnicianIds: [newJob.leadPcoId],
      assignedTechnicianNames: [newJob.leadPcoName],
      leadPcoId: newJob.leadPcoId,
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

  const handleVerifyQC = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showVerifyModal) return;

    const verification: SupervisorVerification = {
      isVerified: true,
      supervisorId: 'sup_01',
      supervisorName: verifyForm.supervisorName,
      verifiedAt: new Date().toISOString(),
      qcRating: verifyForm.qcRating,
      supervisorNotes: verifyForm.supervisorNotes,
    };

    const updated: ServiceJob = {
      ...showVerifyModal,
      supervisorVerification: verification,
    };

    dataService.saveJob(updated, userProfile?.email);
    success('Report QC Verified', `Job ${updated.id} certified by ${verification.supervisorName}. Invoicing is now unlocked.`);
    setShowVerifyModal(null);
    if (selectedJob?.id === updated.id) {
      setSelectedJob(updated);
    }
  };

  const handleExecuteJobAction = (job: ServiceJob) => {
    const nextAct = getJobNextAction(job, dataService.getInvoiceForJob(job.id));
    if (nextAct.actionType === 'start_job') {
      handleUpdateStatus(job, 'in_progress');
    } else if (nextAct.actionType === 'complete_job') {
      navigate('/pco-field');
    } else if (nextAct.actionType === 'verify_report') {
      setShowVerifyModal(job);
    } else if (nextAct.actionType === 'create_invoice') {
      // Guard Rail 1: No invoice before a verified report
      if (!job.supervisorVerification?.isVerified) {
        warning(
          'Invoice Blocked by Guard Rail',
          'Guard Rail: Statutory sales tax invoices cannot be issued until the service report is verified by an authorized supervisor.'
        );
        return;
      }
      navigate(`/finance/invoices?action=new_invoice&fromJob=${job.id}`);
    } else if (nextAct.actionType === 'record_payment') {
      navigate(`/finance/invoices?action=payment&fromJob=${job.id}`);
    }
  };

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Field Operations & Service Jobs' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Field Operations & Service Jobs</h1>
          <p className="page-subtitle">
            Workflow: Scheduled ─► In Progress ─► Completed ─► Verified Report ─► Invoiced. Enforced supervisor QC verification.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={() => navigate('/pco-field')}>
            <Truck size={15} />
            <span>PCO Mobile View</span>
          </button>
          <button className="btn btn-primary" onClick={() => setShowNewJobModal(true)}>
            <Plus size={16} />
            <span>+ Schedule Service Visit</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {['all', 'scheduled', 'in_progress', 'completed', 'cancelled'].map((st) => (
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

        <div style={{ position: 'relative', width: '280px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search job ID, customer, technician..."
            className="form-input"
            style={{ paddingLeft: '2.2rem', height: '34px', fontSize: '0.8rem' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Jobs Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Customer Name</th>
              <th>Site & Address</th>
              <th>Scheduled Date</th>
              <th>Time Slot</th>
              <th>Lead Technician</th>
              <th>QC Verification</th>
              <th>Status</th>
              <th>Next Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.map((j) => {
              const invoice = dataService.getInvoiceForJob(j.id);
              const nextAct = getJobNextAction(j, invoice);

              return (
                <tr key={j.id}>
                  <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>
                    <div>{j.id}</div>
                    {j.contractId && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--ikpm-navy-700)' }}>AMC: {j.contractId}</div>
                    )}
                  </td>
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
                    {j.supervisorVerification?.isVerified ? (
                      <span className="badge-status badge-emerald" title={`Verified by ${j.supervisorVerification.supervisorName}`}>
                        <CheckCircle size={11} style={{ marginRight: '3px' }} />
                        Verified (QC: {j.supervisorVerification.qcRating})
                      </span>
                    ) : j.status === 'completed' ? (
                      <span className="badge-status badge-amber">QC Pending</span>
                    ) : (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Awaiting visit</span>
                    )}
                  </td>
                  <td><StatusBadge status={j.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button
                        className={`btn ${
                          nextAct.actionType === 'create_invoice'
                            ? 'btn-primary'
                            : nextAct.actionType === 'verify_report'
                            ? 'btn-outline-emerald'
                            : 'btn-primary'
                        }`}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                        onClick={() => handleExecuteJobAction(j)}
                      >
                        <span>{nextAct.label}</span>
                        <ArrowRight size={11} />
                      </button>

                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                        onClick={() => setSelectedJob(j)}
                      >
                        Details
                      </button>

                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.45rem', fontSize: '0.72rem' }}
                        title="Download Service Report PDF"
                        onClick={() => pdfAction.run(j.id, () => pdfGenerator.generateJobReportPDF(j))}
                        disabled={pdfAction.busy === j.id}
                      >
                        <Download size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal: Schedule Job (Guard Rail: Mandatory Technician) */}
      <Modal
        isOpen={showNewJobModal}
        onClose={() => setShowNewJobModal(false)}
        title="Schedule Operations Service Visit"
        subtitle={linkedProposal ? `Pre-filled from Approved Proposal ${linkedProposal.id}` : 'Assign technicians, prevent schedule conflicts, and allocate chemical checklists.'}
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
                <option value="night_shift">Night Shift (Plant Off-Hours)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Service Type Scope</label>
              <input
                type="text"
                className="form-input"
                value={newJob.serviceType}
                onChange={(e) => setNewJob({ ...newJob, serviceType: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Assigned Technician <span className="required">* (Guard Rail)</span>
              </label>
              <select
                className="form-select"
                required
                value={newJob.leadPcoId}
                onChange={(e) => {
                  const tech = technicians.find((t) => t.uid === e.target.value);
                  setNewJob({ ...newJob, leadPcoId: tech?.uid || '', leadPcoName: tech?.displayName || '' });
                }}
              >
                <option value="">Select a technician…</option>
                {technicians.map((t) => (
                  <option key={t.uid} value={t.uid}>
                    {t.displayName}{t.teamName ? ` · ${t.teamName}` : ''}
                  </option>
                ))}
              </select>
              {technicians.length === 0 && (
                <div className="form-hint">No technicians yet. The super admin can add them under Team & Access with the Technician role.</div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowNewJobModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              <Clock size={15} />
              <span>Schedule Service Visit</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Supervisor QC Verification (Guard Rail 1: Unlocks Invoicing) */}
      {showVerifyModal && (
        <Modal
          isOpen={Boolean(showVerifyModal)}
          onClose={() => setShowVerifyModal(null)}
          title={`Supervisor QC Verification: ${showVerifyModal.id}`}
          subtitle={`Customer: ${showVerifyModal.customerName} • Site: ${showVerifyModal.siteName}`}
          maxWidth="640px"
        >
          <form onSubmit={handleVerifyQC}>
            <div
              style={{
                padding: '0.75rem',
                backgroundColor: 'var(--ikpm-emerald-50)',
                border: '1px solid var(--ikpm-emerald-200)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '1rem',
                fontSize: '0.825rem',
                color: 'var(--ikpm-emerald-800)',
              }}
            >
              <strong>Quality Control Gate:</strong> Verifying this report will certify that chemical application, PPE compliance, and client sign-off meet quality standards. This unlocks the single-click &ldquo;Create Invoice&rdquo; action.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Verifying Supervisor Name <span className="required">*</span></label>
                <input
                  type="text"
                  required
                  className="form-input"
                  value={verifyForm.supervisorName}
                  onChange={(e) => setVerifyForm({ ...verifyForm, supervisorName: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">QC Assessment Rating</label>
                <select
                  className="form-select"
                  value={verifyForm.qcRating}
                  onChange={(e) => setVerifyForm({ ...verifyForm, qcRating: e.target.value as any })}
                >
                  <option value="excellent">Excellent (Zero Deviations)</option>
                  <option value="satisfactory">Satisfactory (Acceptable Standard)</option>
                  <option value="needs_revisit">Needs Revisit</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Supervisor Quality Observations & Notes</label>
              <textarea
                className="form-input"
                rows={3}
                value={verifyForm.supervisorNotes}
                onChange={(e) => setVerifyForm({ ...verifyForm, supervisorNotes: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowVerifyModal(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                <ShieldCheck size={15} />
                <span>Certify Report & Unlock Invoicing</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: View Job Details with Unified Workflow Status Bar */}
      {selectedJob && (
        <Modal
          isOpen={Boolean(selectedJob)}
          onClose={() => setSelectedJob(null)}
          title={`Job Record: ${selectedJob.id}`}
          subtitle={`Client: ${selectedJob.customerName} • Site: ${selectedJob.siteName}`}
          maxWidth="720px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <button
                className="btn btn-secondary"
                onClick={() => pdfAction.run(selectedJob.id, () => pdfGenerator.generateJobReportPDF(selectedJob))}
                disabled={pdfAction.busy === selectedJob.id}
              >
                <Download size={14} />
                <span>Download Report PDF</span>
              </button>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    handleExecuteJobAction(selectedJob);
                    setSelectedJob(null);
                  }}
                >
                  <span>{getJobNextAction(selectedJob, dataService.getInvoiceForJob(selectedJob.id)).label}</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
            {/* Unified 6-Stage Status Bar */}
            <UnifiedWorkflowStatusBar
              job={selectedJob}
              invoice={dataService.getInvoiceForJob(selectedJob.id)}
              nextAction={getJobNextAction(selectedJob, dataService.getInvoiceForJob(selectedJob.id))}
              onExecuteNextAction={() => {
                handleExecuteJobAction(selectedJob);
                setSelectedJob(null);
              }}
            />

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

            {selectedJob.customerSignOff && (
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--ikpm-emerald-50)', border: '1px solid var(--ikpm-emerald-200)', borderRadius: 'var(--radius-sm)' }}>
                <strong>Client Sign-off Verified:</strong> {selectedJob.customerSignOff.acknowledgedByName} (Rating: {selectedJob.customerSignOff.feedbackRating} / 5 ⭐)
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Signed at: {formatDate(selectedJob.customerSignOff.signedAt)}
                </div>
              </div>
            )}

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
