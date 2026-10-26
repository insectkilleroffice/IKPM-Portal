import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Calendar,
  Clock,
  Download,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  FileCheck2,
  CheckCircle,
  MessageSquareWarning,
  Camera,
  X,
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
import type { ServiceJob, JobStatus, SupervisorVerification, ChemicalUsageRecord } from '../../types/operations';
import type { PestType } from '../../types/crm';
import { UnifiedWorkflowStatusBar } from '../../components/common/UnifiedWorkflowStatusBar';
import { getJobNextAction } from '../../lib/workflow';
import { canEditModule } from '../../lib/permissions';
import { fileGenerated } from '../../features/documents/fileGenerated';
import type { DocumentOwner } from '../../types/document';

export const JobsListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { success, warning } = useNotification();
  const pdfAction = usePdfAction();
  const { userProfile, effectiveRole } = useAuth();
  useDataStore();

  const canInvoice = canEditModule(effectiveRole, 'invoices');

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedJob, setSelectedJob] = useState<ServiceJob | null>(null);
  const [showNewJobModal, setShowNewJobModal] = useState(
    searchParams.get('action') === 'new_job' || Boolean(searchParams.get('fromProposal'))
  );

  // Reschedule modal (team leader)
  const [rescheduleJob, setRescheduleJob] = useState<ServiceJob | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleSlot, setRescheduleSlot] = useState<'morning' | 'afternoon' | 'evening' | 'night_shift'>('morning');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleReasonOther, setRescheduleReasonOther] = useState('');

  const RESCHEDULE_REASONS = [
    'Client requested a different date',
    'Team unavailable on scheduled date',
    'Chemical / equipment not ready',
    'Client site access issue',
    'Weather / safety conditions',
    'Other',
  ];

  const handleReschedule = () => {
    if (!rescheduleJob || !rescheduleDate) return;
    const reason = rescheduleReason === 'Other' ? rescheduleReasonOther.trim() : rescheduleReason;
    if (!reason) return warning('Reason required', 'Please provide a reason for rescheduling.');
    const updated: ServiceJob = {
      ...rescheduleJob,
      scheduledDate: rescheduleDate,
      scheduledTime: rescheduleTime || undefined,
      timeSlot: rescheduleSlot,
      status: 'scheduled',
      rescheduledReason: reason,
      updatedAt: new Date().toISOString(),
    };
    dataService.saveJob(updated, userProfile?.email);
    success('Job rescheduled', `${rescheduleJob.id} moved to ${formatDate(rescheduleDate)} (${rescheduleSlot}). Reason: ${reason}`);
    if (selectedJob?.id === updated.id) setSelectedJob(updated);
    setRescheduleJob(null);
    setRescheduleReason('');
    setRescheduleReasonOther('');
  };

  // Supervisor QC Verification Modal
  const [showVerifyModal, setShowVerifyModal] = useState<ServiceJob | null>(null);
  // Service report submission modal
  const [showReportModal, setShowReportModal] = useState<ServiceJob | null>(null);
  const [reportMember, setReportMember] = useState('');
  type ReportItem = { id: string; name: string; qty: number; unit: ChemicalUsageRecord['unit'] };
  const [reportItems, setReportItems] = useState<ReportItem[]>([{ id: 'item_1', name: '', qty: 1, unit: 'ml' }]);
  const [reportNotes, setReportNotes] = useState('');
  const [reportClientName, setReportClientName] = useState('');
  type ReportPhoto = { id: string; url: string; caption: string };
  const [reportFindingPhotos, setReportFindingPhotos] = useState<ReportPhoto[]>([]);
  const [reportFinalPhotos, setReportFinalPhotos] = useState<ReportPhoto[]>([]);

  useEffect(() => {
    if (!showReportModal) return;
    setReportMember('');
    setReportItems(
      showReportModal.chemicalsUsed.length
        ? showReportModal.chemicalsUsed.map((c) => ({ id: c.id, name: c.chemicalName, qty: c.quantityUsed, unit: c.unit }))
        : [{ id: `item_${Date.now()}`, name: '', qty: 1, unit: 'ml' as const }]
    );
    setReportNotes(showReportModal.executionNotes || '');
    setReportClientName(showReportModal.customerSignOff?.acknowledgedByName || '');
    setReportFindingPhotos([]);
    setReportFinalPhotos([]);
  }, [showReportModal?.id]);
  const [verifyForm, setVerifyForm] = useState({
    supervisorName: userProfile?.displayName || 'Muhammad Asif (QC Supervisor)',
    qcRating: 'excellent' as 'excellent' | 'satisfactory' | 'needs_revisit' | 'rejected',
    supervisorNotes: 'Dosage calibrations, safety protocols, and pest eradication coverage confirmed compliant with standard IPM operating specs.',
  });

  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const jobs = dataService.getJobs();
  const technicians = dataService.getStaff(['team_leader', 'operations', 'technician']);

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
    scheduledTime: '',
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
      warning('Team Leader Required', 'Guard Rail: Cannot schedule a service visit without assigning a Team Leader.');
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

    // Guard: block duplicate job from the same proposal
    if (newJob.proposalId) {
      const dupJob = jobs.find((j) => j.proposalId === newJob.proposalId && j.status !== 'cancelled');
      if (dupJob) {
        warning(
          'Job already exists',
          `${dupJob.id} was already created from proposal ${newJob.proposalId}. Cancel that job first or open it to reschedule.`
        );
        return;
      }
    }

    // Conflict detection check
    const hasConflict = dataService.checkPcoConflict(
      newJob.leadPcoName,
      newJob.scheduledDate,
      newJob.timeSlot
    );
    if (hasConflict) {
      warning(
        'Schedule Overlap Warning',
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
      scheduledTime: newJob.scheduledTime || undefined,
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

  const handleVerifyQC = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showVerifyModal) return;

    const verification: SupervisorVerification = {
      isVerified: true,
      supervisorId: userProfile?.uid || 'sup_01',
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

    // Step 15: Auto-file verified service report into client's Service Reports/{YYYY}/{MM} folder
    try {
      const owner: DocumentOwner = updated.branchId
        ? { kind: 'branch', id: updated.branchId }
        : updated.customerType === 'company'
        ? { kind: 'company', id: updated.customerId }
        : { kind: 'client', id: updated.customerId };
      const blob = await pdfGenerator.jobReportPDFBlob(updated);
      await fileGenerated(blob, {
        owner,
        category: 'service_report',
        title: `Verified Service Report - ${updated.id} (${updated.customerName})`,
        fileName: pdfGenerator.jobReportFileName(updated),
        subPath: updated.id,
        user: { email: userProfile?.email, displayName: userProfile?.displayName },
      });
    } catch (err) {
      console.warn('Auto-filing verified report background error:', err);
    }

    success('Report QC Verified & Filed', `Job ${updated.id} certified by ${verification.supervisorName}. Report auto-filed in Service Reports and invoicing unlocked.`);
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
      setShowReportModal(job);
    } else if (nextAct.actionType === 'verify_report') {
      setShowVerifyModal(job);
    } else if (nextAct.actionType === 'create_invoice') {
      if (!canInvoice) {
        warning('Finance only', 'Invoices are raised by the Accounts team. The report is verified — Finance will be notified to issue the invoice.');
        return;
      }
      // Guard Rail: no invoice before a verified report
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

  const handleSubmitReport = () => {
    if (!showReportModal) return;
    const chemicalsUsed: ChemicalUsageRecord[] = reportItems
      .filter((i) => i.name.trim())
      .map((i) => ({
        id: i.id,
        chemicalName: i.name.trim(),
        activeIngredient: '',
        dosageRate: 'As applied',
        quantityUsed: i.qty,
        unit: i.unit,
        batchNumber: '',
        targetPest: showReportModal.targetPests[0] || 'cockroaches',
        applicationMethod: 'residual_spray' as const,
      }));
    const memberNames = reportMember.trim() ? reportMember.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const now = new Date().toISOString();
    const newPhotos: import('../../types/operations').PhotoEvidence[] = [
      ...reportFindingPhotos.map((p) => ({ id: p.id, caption: p.caption || 'Findings', type: 'infestation_focus' as const, imageUrl: p.url, capturedAt: now })),
      ...reportFinalPhotos.map((p) => ({ id: p.id, caption: p.caption || 'Final report', type: 'after' as const, imageUrl: p.url, capturedAt: now })),
    ];
    const updatedJob: ServiceJob = {
      ...showReportModal,
      status: 'completed',
      chemicalsUsed,
      photoEvidence: [...(showReportModal.photoEvidence || []), ...newPhotos],
      executionNotes: reportNotes.trim() || undefined,
      assignedTechnicianIds: [showReportModal.leadPcoId],
      assignedTechnicianNames: [showReportModal.leadPcoName, ...memberNames],
      customerSignOff: reportClientName.trim()
        ? { acknowledgedByName: reportClientName.trim(), feedbackRating: 5, signedAt: now }
        : showReportModal.customerSignOff,
      updatedAt: now,
    };
    dataService.saveJob(updatedJob, userProfile?.email);
    success('Service report submitted', `${showReportModal.id} marked completed. Ready for supervisor QC.`);
    if (selectedJob?.id === updatedJob.id) setSelectedJob(updatedJob);
    setShowReportModal(null);
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

        <button className="btn btn-primary" onClick={() => setShowNewJobModal(true)}>
          <Plus size={16} />
          <span>+ Schedule Service Visit</span>
        </button>
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
              <th>Scheduled Date & Time</th>
              <th>Shift</th>
              <th>Team Leader</th>
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
                  <td style={{ fontWeight: 600 }}>
                    <div>{formatDate(j.scheduledDate)}</div>
                    {j.scheduledTime && <div style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-700)', fontWeight: 700 }}>{j.scheduledTime}</div>}
                  </td>
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
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      {j.status === 'scheduled' && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                          title="Reschedule this job with a reason"
                          onClick={() => {
                            setRescheduleJob(j);
                            setRescheduleDate(j.scheduledDate);
                            setRescheduleTime(j.scheduledTime || '');
                            setRescheduleSlot(j.timeSlot as any);
                            setRescheduleReason(j.rescheduledReason || '');
                            setRescheduleReasonOther('');
                          }}
                        >
                          <Calendar size={12} /> Reschedule
                        </button>
                      )}
                      {nextAct.actionType === 'create_invoice' && !canInvoice ? (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.25rem 0.6rem', border: '1px solid var(--border-subtle)', borderRadius: '0.35rem', whiteSpace: 'nowrap' }}>
                          Invoice — Finance
                        </span>
                      ) : (
                        <button
                          className={`btn ${nextAct.actionType === 'verify_report' ? 'btn-outline-emerald' : 'btn-primary'}`}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                          onClick={() => handleExecuteJobAction(j)}
                        >
                          <span>{nextAct.label}</span>
                          <ArrowRight size={11} />
                        </button>
                      )}

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
                      {(j.status === 'completed' || j.supervisorVerification?.isVerified) && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', color: 'var(--ikpm-rose-600)', borderColor: 'var(--ikpm-rose-200)' }}
                          title="Raise a complaint against this completed job"
                          onClick={() => navigate(`/complaints?action=log&jobId=${j.id}&customerId=${j.customerId}&customerName=${encodeURIComponent(j.customerName)}${j.contractId ? `&contractId=${j.contractId}` : ''}`)}
                        >
                          <MessageSquareWarning size={12} /> Complain
                        </button>
                      )}
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
        title="Schedule Service Visit"
        subtitle={linkedProposal ? `Pre-filled from proposal ${linkedProposal.id}` : 'Assign a team member and set the date.'}
        maxWidth="620px"
      >
        <form onSubmit={handleCreateJob}>
          <div className="form-group">
            <label className="form-label">Client <span className="required">*</span></label>
            {(linkedProposal || paramCustomerId) ? (
              <select className="form-select" value={newJob.customerId} disabled>
                <option value={newJob.customerId}>
                  {newJob.customerType === 'company' ? companies.find(c => c.id === newJob.customerId)?.legalCompanyName : clients.find(c => c.id === newJob.customerId)?.fullName} ({newJob.customerId})
                </option>
              </select>
            ) : (
              <select
                className="form-select"
                value={`${newJob.customerType}:${newJob.customerId}`}
                onChange={(e) => {
                  const [type, id] = e.target.value.split(':');
                  setNewJob({ ...newJob, customerType: type as 'company' | 'individual', customerId: id });
                }}
              >
                <optgroup label="Companies">
                  {companies.map((c) => (
                    <option key={c.id} value={`company:${c.id}`}>{c.legalCompanyName} ({c.id})</option>
                  ))}
                </optgroup>
                <optgroup label="Individual Clients">
                  {clients.map((cl) => (
                    <option key={cl.id} value={`individual:${cl.id}`}>{cl.fullName} ({cl.id})</option>
                  ))}
                </optgroup>
              </select>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
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
              <label className="form-label">Start Time</label>
              <input
                type="time"
                className="form-input"
                value={newJob.scheduledTime}
                onChange={(e) => setNewJob({ ...newJob, scheduledTime: e.target.value })}
              />
              <div className="form-hint">Optional exact time</div>
            </div>

            <div className="form-group">
              <label className="form-label">Shift</label>
              <select
                className="form-select"
                value={newJob.timeSlot}
                onChange={(e) => setNewJob({ ...newJob, timeSlot: e.target.value as any })}
              >
                <option value="morning">Morning (09:00 – 13:00)</option>
                <option value="afternoon">Afternoon (14:00 – 18:00)</option>
                <option value="evening">Evening (18:00 – 22:00)</option>
                <option value="night_shift">Night Shift (Plant Off-Hours)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Service / scope</label>
              <input
                type="text"
                className="form-input"
                value={newJob.serviceType}
                onChange={(e) => setNewJob({ ...newJob, serviceType: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Assign Team Member <span className="required">*</span>
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
                <option value="">Select a team leader…</option>
                {technicians.map((t) => (
                  <option key={t.uid} value={t.uid}>
                    {t.displayName}{t.teamName ? ` · ${t.teamName}` : ''}
                  </option>
                ))}
              </select>
              {technicians.length === 0 && (
                <div className="form-hint">No team leaders yet. Add them under Team & Access with the Team Leader role.</div>
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

      {/* Modal: Reschedule Job */}
      {rescheduleJob && (
        <Modal
          isOpen
          onClose={() => setRescheduleJob(null)}
          title={`Reschedule: ${rescheduleJob.id}`}
          subtitle={`${rescheduleJob.customerName} · Currently: ${formatDate(rescheduleJob.scheduledDate)} (${rescheduleJob.timeSlot})`}
          maxWidth="500px"
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setRescheduleJob(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleReschedule} disabled={!rescheduleDate || !rescheduleReason}>Save reschedule</button>
            </>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">New date <span className="required">*</span></label>
              <input type="date" className="form-input" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Start time</label>
              <input type="time" className="form-input" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Shift</label>
              <select className="form-select" value={rescheduleSlot} onChange={(e) => setRescheduleSlot(e.target.value as any)}>
                <option value="morning">Morning (09:00 – 13:00)</option>
                <option value="afternoon">Afternoon (14:00 – 18:00)</option>
                <option value="evening">Evening (18:00 – 22:00)</option>
                <option value="night_shift">Night Shift</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Reason for rescheduling <span className="required">*</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              {RESCHEDULE_REASONS.map((r) => (
                <label key={r} className="doc-check" style={{ border: `1px solid ${rescheduleReason === r ? 'var(--ikpm-emerald-600)' : 'var(--border-subtle)'}`, background: rescheduleReason === r ? 'var(--ikpm-emerald-50)' : undefined }}>
                  <input type="radio" name="reschedReason" checked={rescheduleReason === r} onChange={() => setRescheduleReason(r)} />
                  <span style={{ fontSize: '0.82rem' }}>{r}</span>
                </label>
              ))}
            </div>
          </div>
          {rescheduleReason === 'Other' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Specify reason</label>
              <input className="form-input" value={rescheduleReasonOther} onChange={(e) => setRescheduleReasonOther(e.target.value)} placeholder="Describe the reason…" />
            </div>
          )}
        </Modal>
      )}

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
                {getJobNextAction(selectedJob, dataService.getInvoiceForJob(selectedJob.id)).actionType === 'create_invoice' && !canInvoice ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.4rem 0.8rem', border: '1px solid var(--border-subtle)', borderRadius: '0.4rem' }}>
                    Awaiting Finance to issue invoice
                  </span>
                ) : (
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
                )}
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
                <span style={{ color: 'var(--text-muted)' }}>Team Leader:</span>
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
      {/* Modal: Submit Service Report (Team Leader submits after visit) */}
      {showReportModal && (
        <Modal
          isOpen
          onClose={() => setShowReportModal(null)}
          title={`Submit Service Report: ${showReportModal.id}`}
          subtitle={`${showReportModal.customerName} · ${showReportModal.siteName} · ${formatDate(showReportModal.scheduledDate)} (${showReportModal.timeSlot})`}
          maxWidth="720px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowReportModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSubmitReport}>
                <FileCheck2 size={15} />
                <span>Submit Report & Complete Job</span>
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Team Leader (responsible)</label>
              <input className="form-input" value={showReportModal.leadPcoName} disabled />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Team member(s) who conducted the visit</label>
              <input
                className="form-input"
                value={reportMember}
                onChange={(e) => setReportMember(e.target.value)}
                placeholder="Name(s) of team member(s) who went on site — leave blank if Team Leader went themselves"
              />
              <div className="form-hint">Separate multiple names with a comma. Leave blank if the Team Leader conducted the visit personally.</div>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Items / products used <span className="required">*</span></label>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setReportItems((prev) => [...prev, { id: `item_${Date.now()}`, name: '', qty: 1, unit: 'ml' as const }])}
                >
                  <Plus size={13} /> Add item
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Product / item name</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Qty</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Unit</span>
                  <span />
                </div>
                {reportItems.map((item, idx) => (
                  <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.4rem', alignItems: 'center' }}>
                    <input
                      className="form-input"
                      value={item.name}
                      onChange={(e) => setReportItems((prev) => prev.map((r, i) => i === idx ? { ...r, name: e.target.value } : r))}
                      placeholder="e.g. Maxforce Gel, Rodenticide"
                    />
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      step="any"
                      value={item.qty}
                      onChange={(e) => setReportItems((prev) => prev.map((r, i) => i === idx ? { ...r, qty: Number(e.target.value) } : r))}
                    />
                    <select
                      className="form-select"
                      value={item.unit}
                      onChange={(e) => setReportItems((prev) => prev.map((r, i) => i === idx ? { ...r, unit: e.target.value as ChemicalUsageRecord['unit'] } : r))}
                    >
                      <option value="grams">g (grams)</option>
                      <option value="kg">kg</option>
                      <option value="ml">ml</option>
                      <option value="litres">litres</option>
                      <option value="bait_stations">bait stations</option>
                    </select>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setReportItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)}
                      title="Remove"
                    >
                      <AlertTriangle size={13} style={{ color: 'var(--ikpm-rose-500)' }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Findings / execution notes</label>
              <textarea
                className="form-textarea"
                rows={3}
                value={reportNotes}
                onChange={(e) => setReportNotes(e.target.value)}
                placeholder="What was found on site, what was treated, any client feedback or follow-up needed…"
              />
            </div>

            {/* Findings photos */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  <Camera size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Findings photos <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem' }}>(pest activity, problem areas)</span>
                </label>
                <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Camera size={13} /> Add photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    multiple
                    onChange={(e) => {
                      Array.from(e.target.files || []).forEach((file) => {
                        const reader = new FileReader();
                        reader.onload = () => setReportFindingPhotos((p) => [...p, { id: `fp_${Date.now()}_${Math.random()}`, url: reader.result as string, caption: '' }]);
                        reader.readAsDataURL(file);
                      });
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {reportFindingPhotos.length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {reportFindingPhotos.map((p, idx) => (
                    <div key={p.id} style={{ position: 'relative', width: 80 }}>
                      <img src={p.url} alt="" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-subtle)' }} />
                      <button type="button" onClick={() => setReportFindingPhotos((prev) => prev.filter((_, i) => i !== idx))}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 2, display: 'flex' }}>
                        <X size={10} color="white" />
                      </button>
                      <input className="form-input" value={p.caption} placeholder="Caption" style={{ fontSize: '0.68rem', padding: '2px 4px', marginTop: 2 }}
                        onChange={(e) => setReportFindingPhotos((prev) => prev.map((r, i) => i === idx ? { ...r, caption: e.target.value } : r))} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Final report photos */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  <Camera size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Final report photos <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem' }}>(after treatment)</span>
                </label>
                <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Camera size={13} /> Add photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    multiple
                    onChange={(e) => {
                      Array.from(e.target.files || []).forEach((file) => {
                        const reader = new FileReader();
                        reader.onload = () => setReportFinalPhotos((p) => [...p, { id: `rp_${Date.now()}_${Math.random()}`, url: reader.result as string, caption: '' }]);
                        reader.readAsDataURL(file);
                      });
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {reportFinalPhotos.length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {reportFinalPhotos.map((p, idx) => (
                    <div key={p.id} style={{ position: 'relative', width: 80 }}>
                      <img src={p.url} alt="" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-subtle)' }} />
                      <button type="button" onClick={() => setReportFinalPhotos((prev) => prev.filter((_, i) => i !== idx))}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 2, display: 'flex' }}>
                        <X size={10} color="white" />
                      </button>
                      <input className="form-input" value={p.caption} placeholder="Caption" style={{ fontSize: '0.68rem', padding: '2px 4px', marginTop: 2 }}
                        onChange={(e) => setReportFinalPhotos((prev) => prev.map((r, i) => i === idx ? { ...r, caption: e.target.value } : r))} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Client representative name (optional sign-off)</label>
              <input
                className="form-input"
                value={reportClientName}
                onChange={(e) => setReportClientName(e.target.value)}
                placeholder="Name of client contact who acknowledged the visit"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
