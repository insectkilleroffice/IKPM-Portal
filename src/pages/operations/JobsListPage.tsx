import { blobToDataUrl, compressImage } from '../../lib/imageUtils';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Calendar,
  Clock,
  Download,
  ArrowRight,
  ShieldCheck,
  FileCheck2,
  CheckCircle,
  MessageSquareWarning,
  Camera,
  X,
  UserCheck,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { formatDate, generatePermanentId } from '../../lib/formatters';
import { PcoTicks } from '../../features/schedule/PcoTicks';
import { pcoEmployeeConflicts } from '../../lib/visitSchedule';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { usePdfAction } from '../../hooks/usePdfAction';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import type { ServiceJob, SupervisorVerification, ChemicalUsageRecord } from '../../types/operations';
import type { PestType } from '../../types/crm';
import { UnifiedWorkflowStatusBar } from '../../components/common/UnifiedWorkflowStatusBar';
import { getJobNextAction } from '../../lib/workflow';
import { canEditModule } from '../../lib/permissions';
import { fileGenerated } from '../../features/documents/fileGenerated';
import type { DocumentOwner } from '../../types/document';

export const JobsListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { success, warning, error } = useNotification();
  const pdfAction = usePdfAction();
  const { userProfile, effectiveRole } = useAuth();
  useDataStore();

  const canInvoice = canEditModule(effectiveRole, 'invoices');
  const canDispatch = canEditModule(effectiveRole, 'jobs');
  // Start Visit and Close Out are field steps: only the Supervisor on the job does them (in person,
  // with the PCOs). The Operations Manager assigns, reschedules and does the QC check instead.
  const isFieldStep = (a: string) => a === 'start_job' || a === 'complete_job';
  // The signed-in person is this job's Supervisor if any team field names them: by login, or by their
  // HR employee record (older jobs and the old PCO picker stored those in different fields).
  const isMyFieldJob = (j: ServiceJob) => {
    const uid = userProfile?.uid;
    if (!uid) return false;
    const me = new Set([uid, ...dataService.getEmployees().filter((e) => e.uid === uid).map((e) => e.id)]);
    return [j.assignedTeamLeaderId, j.leadPcoId, ...(j.assignedTechnicianIds ?? [])].some((id) => !!id && me.has(id));
  };

  /**
   * Field photos and challan scans. Phone photos are several MB, and a job record may not exceed
   * 1 MB in the database, so a full-size photo made the whole report fail to save. Images are shrunk
   * first, then uploaded to file storage (Cloudinary) when it is set up; otherwise kept small inline.
   */
  const fieldFileToUrl = async (file: File, job: ServiceJob | null, label: string): Promise<string> => {
    const isImage = file.type.startsWith('image/');
    const blob: Blob = isImage ? await compressImage(file, 1280, 0.62) : file;
    if (integrations.cloudinary && job) {
      try {
        const stored = await uploadFile(blob, {
          scope: dataService.uploadScopeFor({ kind: 'job', id: job.id }, 'service_report'),
          subPath: job.id,
          fileName: `${job.id}_${label}_${Date.now()}.${isImage ? 'jpg' : (file.name.split('.').pop() || 'pdf')}`,
        });
        return stored.url;
      } catch (err) {
        console.warn('Upload failed, keeping the file inline', err);
      }
    }
    if (!isImage && blob.size > 350_000) {
      throw new Error('This PDF is too large to attach without file storage. Take a photo of the signed challan instead.');
    }
    return blobToDataUrl(isImage ? await compressImage(file, 1000, 0.55) : blob);
  };
  const fileError = (err: unknown) => error('File not added', err instanceof Error ? err.message : String(err));
  /** Rough size of a job record; the database refuses anything over 1 MB. */
  const tooBig = (j: ServiceJob) => new Blob([JSON.stringify(j)]).size > 950_000;
  const supervisorOf = (j: ServiceJob) => j.assignedTeamLeaderName || (j.leadPcoName !== 'Unassigned' ? j.leadPcoName : '') || 'the Supervisor';

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const weekEndStr = new Date(Date.now() + 6 * 86400000).toISOString().split('T')[0];

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'tomorrow' | 'week' | 'custom'>('all');
  const [customDate, setCustomDate] = useState(todayStr);
  const [selectedJob, setSelectedJob] = useState<ServiceJob | null>(null);
  const [showNewJobModal, setShowNewJobModal] = useState(
    searchParams.get('action') === 'new_job' || Boolean(searchParams.get('fromProposal'))
  );

  // Reschedule modal (supervisor)
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

  // Assign supervisor to a scheduled job
  const [assignTlJob, setAssignTlJob] = useState<ServiceJob | null>(null);
  const [assignTlId, setAssignTlId] = useState('');

  const handleAssignTl = () => {
    if (!assignTlJob) return;
    const tl = dataService.getTeamLeaders().find((u) => u.uid === assignTlId);
    if (!tl) { warning('No supervisor selected', 'Please select a supervisor first.'); return; }
    // Planned PCOs stay only if they are in the new Supervisor's team
    const team = new Set(dataService.getTeamPcos(tl.uid).map((e) => e.id));
    const updated: ServiceJob = {
      ...assignTlJob,
      ...dataService.teamFields(tl.uid, tl.displayName, (assignTlJob.assignedPcoEmployeeIds ?? []).filter((id) => team.has(id))),
      updatedAt: new Date().toISOString(),
    };
    dataService.saveJob(updated, userProfile?.email);
    success('Supervisor assigned', `${tl.displayName} assigned to ${assignTlJob.id} (${formatDate(assignTlJob.scheduledDate)}).`);
    if (selectedJob?.id === updated.id) setSelectedJob(updated);
    setAssignTlJob(null);
    setAssignTlId('');
  };

  // Supervisor QC Verification Modal
  const [showVerifyModal, setShowVerifyModal] = useState<ServiceJob | null>(null);
  // Service report submission modal
  const [showReportModal, setShowReportModal] = useState<ServiceJob | null>(null);
  // PCOs have no login: the Supervisor ticks who did the work (HR employee ids)
  const [reportPcoIds, setReportPcoIds] = useState<string[]>([]);
  const [reportTlOnSite, setReportTlOnSite] = useState(false);
  const [reportBorrowReason, setReportBorrowReason] = useState('');
  const [reportOutcomeReason, setReportOutcomeReason] = useState('');
  const [reportNewDate, setReportNewDate] = useState('');
  const [reportVisitOutcome, setReportVisitOutcome] = useState<'completed' | 'partial' | 'client_blocked' | 'postponed'>('completed');
  type ReportItem = { id: string; name: string; qty: number; unit: ChemicalUsageRecord['unit'] };
  const [reportItems, setReportItems] = useState<ReportItem[]>([{ id: 'item_1', name: '', qty: 1, unit: 'ml' }]);
  const [reportNotes, setReportNotes] = useState('');
  type ReportPhoto = { id: string; url: string; caption: string };
  const [reportFindingPhotos, setReportFindingPhotos] = useState<ReportPhoto[]>([]);
  const [reportFinalPhotos, setReportFinalPhotos] = useState<ReportPhoto[]>([]);
  const [reportChallanNumber, setReportChallanNumber] = useState('');
  const [reportChallanFileUrl, setReportChallanFileUrl] = useState('');
  const [reportChallanDate, setReportChallanDate] = useState(todayStr);
  // Cash the client paid the Supervisor on site (residential); Finance confirms it later
  const [reportCashAmount, setReportCashAmount] = useState('');
  const [reportCashPhoto, setReportCashPhoto] = useState('');

  // Edit schedule / time slot modal state
  const [showEditScheduleJob, setShowEditScheduleJob] = useState<ServiceJob | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    date: todayStr,
    timeSlot: 'morning' as import('../../types/operations').ServiceJob['timeSlot'],
    windowStart: '09:00',
    windowEnd: '13:00',
    leadPcoId: '',
  });

  // Attach / Edit Challan modal state
  const [showAttachChallanJob, setShowAttachChallanJob] = useState<ServiceJob | null>(null);
  const [attachChallanNo, setAttachChallanNo] = useState('');
  const [attachChallanFileUrl, setAttachChallanFileUrl] = useState('');
  const [attachChallanDate, setAttachChallanDate] = useState(todayStr);

  useEffect(() => {
    if (!showReportModal) return;
    // Pre-tick the PCOs who did it last time (resubmission) or were planned for the visit
    setReportPcoIds(showReportModal.performedByPcoIds?.length ? showReportModal.performedByPcoIds : showReportModal.assignedPcoEmployeeIds ?? []);
    setReportTlOnSite(showReportModal.teamLeaderOnSite ?? false);
    setReportBorrowReason(showReportModal.borrowedPcoReason || '');
    setReportOutcomeReason('');
    setReportNewDate('');
    setReportVisitOutcome('completed');
    setReportItems(
      showReportModal.chemicalsUsed.length
        ? showReportModal.chemicalsUsed.map((c) => ({ id: c.id, name: c.chemicalName, qty: c.quantityUsed, unit: c.unit }))
        : [{ id: `item_${Date.now()}`, name: '', qty: 1, unit: 'ml' as const }]
    );
    setReportNotes(showReportModal.executionNotes || '');
    setReportFindingPhotos([]);
    setReportFinalPhotos([]);
    setReportChallanNumber(showReportModal.challanNumber || '');
    setReportChallanFileUrl(showReportModal.challanFileUrl || '');
    setReportChallanDate(todayStr);
    setReportCashAmount(showReportModal.cashCollection?.amount ? String(showReportModal.cashCollection.amount) : '');
    setReportCashPhoto(showReportModal.cashCollection?.receiptPhotoUrl || '');
  }, [showReportModal?.id]);
  // QC: starts empty every time — the supervisor is the logged-in person
  const [verifyForm, setVerifyForm] = useState({
    qcRating: 'satisfactory' as 'excellent' | 'satisfactory',
    supervisorNotes: '',
  });
  type ChemEntry = { id: string; name: string; qty: number; unit: ChemicalUsageRecord['unit'] };
  const blankChem = (): ChemEntry => ({ id: `qc_${Date.now()}_${Math.random()}`, name: '', qty: 0, unit: 'ml' });
  const [qcChemEntries, setQcChemEntries] = useState<ChemEntry[]>([blankChem()]);
  const [sendBackReason, setSendBackReason] = useState('');
  useEffect(() => {
    if (!showVerifyModal) return;
    setVerifyForm({ qcRating: 'satisfactory', supervisorNotes: '' });
    setQcChemEntries([blankChem()]);
    setSendBackReason('');
  }, [showVerifyModal?.id]);

  // Start gate (SRS 5.5): pre-check + before photos
  const [startJob, setStartJob] = useState<ServiceJob | null>(null);
  const [preCheck, setPreCheck] = useState({ uniform: false, safetyGear: false, chemicalsIssued: false, note: '' });
  const [beforePhotos, setBeforePhotos] = useState<{ id: string; url: string }[]>([]);
  useEffect(() => {
    if (!startJob) return;
    setPreCheck({ uniform: false, safetyGear: false, chemicalsIssued: false, note: '' });
    setBeforePhotos([]);
  }, [startJob?.id]);

  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const jobs = dataService.getJobs();
  // Field Supervisors (logins). PCOs are HR employees under them (no login).
  const technicians = dataService.getTeamLeaders();
  const allPcos = dataService.getActivePcos();
  /** "Imran Hussain (Supervisor) · Usman, Bilal" */
  const teamLabel = (j: ServiceJob) => {
    const pcos = dataService.pcoNames(j.performedByPcoIds?.length ? j.performedByPcoIds : j.assignedPcoEmployeeIds);
    return { tl: j.assignedTeamLeaderName || (j.leadPcoName !== 'Unassigned' ? j.leadPcoName : ''), pcos: pcos.join(', ') };
  };

  // If fromProposal or customerId query params are provided, pre-fill
  const fromPropId = searchParams.get('fromProposal');
  const paramCustomerId = searchParams.get('customerId');
  const paramCustomerType = (searchParams.get('customerType') as 'company' | 'individual') || 'company';
  const paramBranchId = searchParams.get('branchId') || undefined;

  // Notification links: ?job=ID opens the job, ?verify=ID opens QC
  const paramJob = searchParams.get('job');
  const paramVerify = searchParams.get('verify');
  useEffect(() => {
    const j = jobs.find((x) => x.id === (paramVerify || paramJob));
    if (!j) return;
    if (paramVerify && j.status === 'completed' && !j.supervisorVerification?.isVerified) setShowVerifyModal(j);
    else setSelectedJob(j);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramJob, paramVerify, jobs.length]);
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
    pcoIds: [] as string[],
  });

  useEffect(() => {
    if (linkedProposal) {
      setNewJob({
        customerId: linkedProposal.customerId,
        customerType: linkedProposal.customerType,
        proposalId: linkedProposal.id,
        scheduledDate: new Date().toISOString().split('T')[0],
        scheduledTime: '',
        timeSlot: 'morning',
        serviceType: linkedProposal.scopeOfWork,
        targetPests: linkedProposal.lineItems.map((li) => li.targetPest) as PestType[],
        leadPcoId: '',
        leadPcoName: '',
        pcoIds: [],
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
      !q ||
      j.id.toLowerCase().includes(q) ||
      j.customerName.toLowerCase().includes(q) ||
      j.siteName.toLowerCase().includes(q) ||
      j.leadPcoName.toLowerCase().includes(q) ||
      j.assignedTechnicianNames.some((n) => n.toLowerCase().includes(q));

    const matchStatus = statusFilter === 'all' || j.status === statusFilter;

    // Completed & cancelled jobs are historical — always show regardless of date filter
    // so staff can find past records without clearing the date picker.
    const isHistorical = j.status === 'completed' || j.status === 'cancelled';
    let matchDate = true;
    if (!isHistorical) {
      if (dateFilter === 'today') matchDate = j.scheduledDate === todayStr;
      else if (dateFilter === 'tomorrow') matchDate = j.scheduledDate === tomorrowStr;
      else if (dateFilter === 'week') matchDate = j.scheduledDate >= todayStr && j.scheduledDate <= weekEndStr;
      else if (dateFilter === 'custom') matchDate = j.scheduledDate === customDate;
  
    }

    return matchSearch && matchStatus && matchDate;
  });

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();

    // Guard Rail 2: No job without a Supervisor
    if (!newJob.leadPcoId) {
      warning('Supervisor Required', 'Choose the Supervisor who will run this visit.');
      return;
    }

    let customerName = '';
    let siteId = 'SITE-01';
    let siteName = 'Main Premises';
    let siteAddress = 'Main City Facility';

    if (newJob.customerType === 'company') {
      const co = dataService.getCompanyById(newJob.customerId);
      customerName = co?.legalCompanyName || 'Corporate Company';
      const sites = dataService.getSites(newJob.customerId, paramBranchId);
      if (sites[0]) {
        siteId = sites[0].id;
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

    // A PCO can't be on two visits in the same slot (a Supervisor can run several)
    const clash = pcoEmployeeConflicts(
      [{ key: 'new', date: newJob.scheduledDate, timeSlot: newJob.timeSlot, pcoEmployeeIds: newJob.pcoIds }],
      jobs
    ).get('new');
    if (clash) {
      warning('PCO already booked', `${dataService.pcoNames(clash).join(', ')} already on another visit in the ${newJob.timeSlot.replace('_', ' ')} slot on ${formatDate(newJob.scheduledDate)}. Untick them or pick another slot.`);
      return;
    }

    // Transactional counter: IDs never repeat even if jobs are deleted or two people save at once
    const nextId = generatePermanentId('JOB', await dataService.nextSequence('job'));
    const created: ServiceJob = {
      id: nextId,
      customerType: newJob.customerType,
      customerId: newJob.customerId,
      customerName,
      branchId: paramBranchId || undefined,
      proposalId: newJob.proposalId || undefined,
      siteId,
      siteName,
      siteAddress,
      serviceType: newJob.serviceType,
      targetPests: newJob.targetPests,
      scheduledDate: newJob.scheduledDate,
      scheduledTime: newJob.scheduledTime || undefined,
      timeSlot: newJob.timeSlot,
      // Supervisor is the login on the job (firestore.rules); PCOs are employee ids
      ...dataService.teamFields(newJob.leadPcoId, newJob.leadPcoName, newJob.pcoIds),
      status: 'scheduled',
      checklists: [
        { id: 'c1', taskDescription: 'Conduct preliminary perimeter inspection and moisture audit', isCompleted: false },
        { id: 'c2', taskDescription: 'Apply target formulation with correct calibrated dosage', isCompleted: false },
        { id: 'c3', taskDescription: 'Perform post-application sanitation check with client', isCompleted: false },
      ],
      // Filled in by the Supervisor on the report — never pre-filled
      chemicalsUsed: [],
      photoEvidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    dataService.saveJob(created, userProfile?.email);
    success('Field Service Visit Scheduled', `${created.id} assigned to ${created.leadPcoName}`);
    setShowNewJobModal(false);
  };


  /** SRS 5.5 chemical match: QC re-enters chemicals from the signed paper report. */
  const chemicalCheck = (job: ServiceJob) => {
    const key = (n: string, q: number, u: string) => `${n.trim().toLowerCase().replace(/\s+/g, ' ')}|${Number(q)}|${u}`;
    const entered = qcChemEntries.filter((c) => c.name.trim());
    const reported = job.chemicalsUsed.map((c) => key(c.chemicalName, c.quantityUsed, c.unit)).sort();
    const qc = entered.map((c) => key(c.name, c.qty, c.unit)).sort();
    const matches = reported.length === qc.length && reported.every((k, i) => k === qc[i]);
    const fmt = (list: string[]) => list.map((k) => { const [n, q, u] = k.split('|'); return `${n} ${q} ${u}`; }).join(', ') || 'nothing';
    return {
      entered,
      matches,
      summary: `Report on paper: ${fmt(qc)}. Entered by Supervisor: ${fmt(reported)}.`,
    };
  };

  const handleSendBack = () => {
    if (!showVerifyModal) return;
    const reason = sendBackReason.trim();
    if (!reason) return warning('Reason required', 'Tell the Supervisor what to fix.');
    const now = new Date().toISOString();
    const check = chemicalCheck(showVerifyModal);
    const updated: ServiceJob = {
      ...showVerifyModal,
      status: 'in_progress',
      qcReturn: { reason, byName: userProfile?.displayName || 'QC', at: now },
      qcChemicalCheck: check.entered.length ? { entries: check.entered.map(({ name, qty, unit }) => ({ name, qty, unit })), matches: check.matches, checkedAt: now } : showVerifyModal.qcChemicalCheck,
      supervisorVerification: {
        isVerified: false,
        supervisorId: userProfile?.uid || '',
        supervisorName: userProfile?.displayName || 'QC',
        verifiedAt: now,
        qcRating: 'needs_revisit',
        supervisorNotes: reason,
      },
      updatedAt: now,
    };
    dataService.saveJob(updated, userProfile?.email);
    warning('Sent back to Supervisor', `${updated.id} returned to ${updated.assignedTeamLeaderName || updated.leadPcoName}: ${reason}`);
    setShowVerifyModal(null);
    if (selectedJob?.id === updated.id) setSelectedJob(updated);
  };

  const handleVerifyQC = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showVerifyModal) return;

    const check = chemicalCheck(showVerifyModal);
    if (showVerifyModal.chemicalsUsed.length && !check.entered.length) {
      return warning('Chemical check required', 'Enter the chemicals and quantities written on the signed paper report.');
    }
    if (!check.matches) {
      setSendBackReason(`Chemical mismatch. ${check.summary} Please explain the difference or correct it.`);
      return error('Chemicals do not match', 'The signed report and the Supervisor’s entry differ. Use "Send back" so the Supervisor gives a reason.');
    }

    const now = new Date().toISOString();
    const verification: SupervisorVerification = {
      isVerified: true,
      supervisorId: userProfile?.uid || '',
      supervisorName: userProfile?.displayName || 'QC',
      verifiedAt: now,
      qcRating: verifyForm.qcRating,
      supervisorNotes: verifyForm.supervisorNotes.trim() || undefined,
    };

    const updated: ServiceJob = {
      ...showVerifyModal,
      supervisorVerification: verification,
      qcChemicalCheck: { entries: check.entered.map(({ name, qty, unit }) => ({ name, qty, unit })), matches: true, checkedAt: now },
      updatedAt: now,
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
    if (nextAct.isBlocked) {
      warning('Not yet', nextAct.blockerReason || 'This step is locked.');
      if (nextAct.actionType === 'start_job' && canDispatch) { setAssignTlJob(job); setAssignTlId(''); }
      return;
    }
    if (isFieldStep(nextAct.actionType) && !isMyFieldJob(job)) {
      warning('Supervisor only', `${nextAct.label} is done by ${supervisorOf(job)}, the Supervisor on this visit.`);
      return;
    }
    if (nextAct.actionType === 'start_job') {
      setStartJob(job);
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

  /** Start gate: uniform, safety gear, chemicals issued, and at least one before photo. */
  const handleStartJob = () => {
    if (!startJob) return;
    const missing: string[] = [];
    if (!preCheck.uniform) missing.push('uniform');
    if (!preCheck.safetyGear) missing.push('safety gear');
    if (!preCheck.chemicalsIssued) missing.push('chemicals issued');
    if (missing.length) return warning('Pre-check incomplete', `Still needed: ${missing.join(', ')}.`);

    const now = new Date().toISOString();
    const updated: ServiceJob = {
      ...startJob,
      status: 'in_progress',
      preCheck: {
        uniform: true,
        safetyGear: true,
        chemicalsIssued: true,
        chemicalsIssuedNote: preCheck.note.trim() || undefined,
        confirmedByUid: userProfile?.uid,
        confirmedByName: userProfile?.displayName || 'Supervisor',
        confirmedAt: now,
      },
      photoEvidence: [
        ...(startJob.photoEvidence || []),
        ...beforePhotos.map((p) => ({ id: p.id, caption: 'Before service', type: 'before' as const, imageUrl: p.url, capturedAt: now, uploadedBy: userProfile?.displayName })),
      ],
      updatedAt: now,
    };
    if (tooBig(updated)) return error('Photos too large', 'Remove a few before photos and try again.');
    dataService.saveJob(updated, userProfile?.email);
    success('Visit started', `${updated.id}: pre-check done. Close out the visit when the service is finished.`);
    if (selectedJob?.id === updated.id) setSelectedJob(updated);
    setStartJob(null);
  };

  const handleSubmitReport = () => {
    if (!showReportModal) return;
    const job = showReportModal;
    const outcome = reportVisitOutcome;
    // Completed / partial need full proof. Client blocked / postponed have no signed challan.
    const needsProof = outcome === 'completed' || outcome === 'partial';

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

    // Who did the work: the Supervisor's PCOs (+ borrowed ones, with a reason)
    const tlUid = job.assignedTeamLeaderId || job.leadPcoId;
    const ownTeam = new Set(dataService.getTeamPcos(tlUid).map((e) => e.id));
    const borrowed = reportPcoIds.filter((id) => !ownTeam.has(id));

    // Every missing item listed at once, in plain words
    const missing: string[] = [];
    if (needsProof) {
      if (!reportPcoIds.length && !reportTlOnSite) missing.push('who did the work (tick the PCOs, or "I did it myself")');
      if (borrowed.length && !reportBorrowReason.trim()) missing.push('why a PCO from another team was used');
      if (!chemicalsUsed.length) missing.push('at least one chemical / item used');
      if (!reportChallanNumber.trim()) missing.push('physical challan #');
      if (!reportChallanFileUrl.trim()) missing.push('photo of the signed challan');
      if (job.customerType !== 'company' && reportCashAmount.trim() && !(Number(reportCashAmount) > 0)) missing.push('a valid cash amount (or leave it empty)');
    } else if (outcome === 'client_blocked') {
      if (!reportOutcomeReason.trim()) missing.push('what happened on site');
      if (!reportFindingPhotos.length && !reportFinalPhotos.length) missing.push('a photo as proof (e.g. closed gate)');
    } else if (outcome === 'postponed') {
      if (!reportNewDate) missing.push('the new visit date');
      if (!reportOutcomeReason.trim()) missing.push('reason for postponing');
    }
    if (missing.length) {
      error('Cannot submit yet', `Still needed: ${missing.join('; ')}.`);
      return;
    }

    const now = new Date().toISOString();
    const newPhotos: import('../../types/operations').PhotoEvidence[] = [
      ...reportFindingPhotos.map((p) => ({ id: p.id, caption: p.caption || 'Findings', type: 'infestation_focus' as const, imageUrl: p.url, capturedAt: now, uploadedBy: userProfile?.displayName })),
      ...reportFinalPhotos.map((p) => ({ id: p.id, caption: p.caption || 'Final report', type: 'after' as const, imageUrl: p.url, capturedAt: now, uploadedBy: userProfile?.displayName })),
    ];
    const submittedBy = { submittedByUid: userProfile?.uid, submittedByName: userProfile?.displayName || 'Supervisor', submittedAt: now };

    // Postponed on site: straight back to the schedule on the new date
    if (outcome === 'postponed') {
      const updated: ServiceJob = {
        ...job,
        status: 'scheduled',
        visitOutcome: 'postponed',
        scheduledDate: reportNewDate,
        rescheduledReason: `Postponed on site: ${reportOutcomeReason.trim()}`,
        photoEvidence: [...(job.photoEvidence || []), ...newPhotos],
        ...submittedBy,
        updatedAt: now,
      };
      dataService.saveJob(updated, userProfile?.email);
      success('Visit rescheduled', `${job.id} moved to ${formatDate(reportNewDate)}.`);
      if (selectedJob?.id === updated.id) setSelectedJob(updated);
      setShowReportModal(null);
      return;
    }

    // Client blocked access: closed as cancelled with the reason code and proof photo
    if (outcome === 'client_blocked') {
      const updated: ServiceJob = {
        ...job,
        status: 'cancelled',
        visitOutcome: 'client_blocked',
        cancellationReasonCode: 'client_denied_access',
        cancellationReason: reportOutcomeReason.trim(),
        photoEvidence: [...(job.photoEvidence || []), ...newPhotos],
        executionNotes: reportNotes.trim() || job.executionNotes,
        ...submittedBy,
        updatedAt: now,
      };
      dataService.saveJob(updated, userProfile?.email);
      warning('Visit closed: client blocked access', `${job.id} recorded as cancelled (client denied access). Operations Manager can reschedule it.`);
      if (selectedJob?.id === updated.id) setSelectedJob(updated);
      setShowReportModal(null);
      return;
    }

    // Late = not submitted on the service day (SRS 5.5)
    const lateDays = Math.max(0, Math.round((Date.parse(todayStr) - Date.parse(job.scheduledDate.slice(0, 10))) / 86400000));
    const isLate = lateDays > 0;
    const tlName = job.assignedTeamLeaderName || job.leadPcoName;

    const updatedJob: ServiceJob = {
      ...job,
      status: 'completed',
      visitOutcome: outcome,
      chemicalsUsed,
      photoEvidence: [...(job.photoEvidence || []), ...newPhotos],
      executionNotes: reportNotes.trim() || undefined,
      // assignedTechnicianIds (logins) is left alone; PCOs are recorded by employee id
      assignedTechnicianNames: [tlName, ...dataService.pcoNames(reportPcoIds)],
      performedByPcoIds: reportPcoIds,
      leadPcoEmployeeId: reportPcoIds[0],
      teamLeaderOnSite: reportTlOnSite,
      borrowedPcoReason: borrowed.length ? reportBorrowReason.trim() : undefined,
      // Cash on site is residential only; company (B2B) work is always invoiced
      cashCollection: job.customerType !== 'company' && Number(reportCashAmount) > 0
        ? {
            ...job.cashCollection,
            amount: Number(reportCashAmount),
            collectedAt: job.cashCollection?.collectedAt || now,
            collectedByUid: userProfile?.uid,
            collectedByName: userProfile?.displayName || 'Supervisor',
            receiptPhotoUrl: reportCashPhoto || undefined,
          }
        : job.cashCollection,
      ...submittedBy,
      lateSubmission: isLate,
      lateDays: isLate ? lateDays : undefined,
      lateReason: isLate ? `Submitted ${lateDays} day(s) after the service date` : undefined,
      updatedAt: now,
    };
    if (tooBig({ ...updatedJob, challanFileUrl: reportChallanFileUrl })) {
      error('Photos too large', 'The report is too big to save. Remove a few photos (they are optional) and submit again.');
      return;
    }
    if (reportChallanNumber.trim()) {
      const cNo = reportChallanNumber.trim();
      updatedJob.challanNumber = cNo;
      updatedJob.challanFileUrl = reportChallanFileUrl || undefined;

      const challanRecord: import('../../types/operations').Challan = {
        id: `CHL-${updatedJob.id}`,
        challanNumber: cNo,
        challanKey: cNo.toLowerCase().replace(/[^a-z0-9]/g, ''),
        jobId: updatedJob.id,
        contractId: updatedJob.contractId,
        customerId: updatedJob.customerId,
        customerName: updatedJob.customerName,
        clientType: updatedJob.customerType,
        branchId: updatedJob.branchId,
        challanDate: reportChallanDate || now.slice(0, 10),
        fileUrl: reportChallanFileUrl || '',
        fileName: `Challan_${cNo}_${updatedJob.customerName}.pdf`,
        uploadedBy: userProfile?.email || 'admin',
        uploadedByName: userProfile?.displayName || 'Operations Staff',
        uploadedAt: now,
        status: 'active',
      };
      dataService.saveChallan(challanRecord, userProfile?.email);

      if (reportChallanFileUrl) {
        dataService.saveDocument({
          id: `DOC-CHL-${updatedJob.id}`,
          title: `Signed Delivery Challan #${cNo} - ${updatedJob.customerName}`,
          category: 'other',
          fileCategory: 'certificate',
          owner: { kind: 'client', id: updatedJob.customerId },
          source: 'uploaded',
          file: {
            url: reportChallanFileUrl,
            fileName: `Challan_${cNo}.png`,
            fileSize: 1024,
            fileType: 'image/png',
            storage: 'local',
          },
          uploadedBy: userProfile?.email || 'admin',
          uploadedByName: userProfile?.displayName || 'Operations Staff',
          uploadedAt: now,
        }, userProfile?.email);
      }
    }

    dataService.saveJob(updatedJob, userProfile?.email);
    success('Service report submitted', `${job.id} sent for QC${isLate ? ` (late by ${lateDays} day(s))` : ''}.`);
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
      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          {/* Status filters */}
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

          {/* Search */}
          <div style={{ position: 'relative', width: '260px' }}>
            <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search job, customer, technician…"
              className="form-input"
              style={{ paddingLeft: '2.2rem', height: '34px', fontSize: '0.8rem' }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Date quick filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Date:</span>
          <div style={{ display: 'flex', gap: '0.25rem', backgroundColor: 'var(--bg-surface-alt)', padding: '3px', borderRadius: 'var(--radius-md)' }}>
            {([
              { id: 'today', label: 'Today' },
              { id: 'tomorrow', label: 'Tomorrow' },
              { id: 'week', label: 'This Week' },
              { id: 'all', label: 'All' },
              { id: 'custom', label: 'Pick Date' },
            ] as const).map((f) => (
              <button
                key={f.id}
                className="btn"
                onClick={() => setDateFilter(f.id)}
                style={{
                  padding: '0.25rem 0.65rem', fontSize: '0.75rem', border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: dateFilter === f.id ? 'var(--bg-surface)' : 'transparent',
                  color: dateFilter === f.id ? 'var(--ikpm-navy-900)' : 'var(--text-muted)',
                  fontWeight: dateFilter === f.id ? 700 : 400,
                  boxShadow: dateFilter === f.id ? 'var(--shadow-sm)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          {dateFilter === 'custom' && (
            <input
              type="date"
              className="form-input"
              style={{ height: '32px', width: '150px', fontSize: '0.8rem' }}
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
            />
          )}
          {dateFilter !== 'all' && (
            <span style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-700)', fontWeight: 600 }}>
              {filteredJobs.length} job{filteredJobs.length !== 1 ? 's' : ''}
            </span>
          )}
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
              <th>Supervisor</th>
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
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <div>
                        {teamLabel(j).tl ? <span>{teamLabel(j).tl}</span> : <span style={{ color: '#B45309', fontStyle: 'italic' }}>No Supervisor</span>}
                        {teamLabel(j).pcos && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>PCOs: {teamLabel(j).pcos}</div>}
                      </div>
                      {canDispatch && j.status === 'scheduled' && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.15rem 0.35rem', fontSize: '0.7rem' }}
                          title="Assign / change supervisor"
                          onClick={() => { setAssignTlJob(j); setAssignTlId(j.leadPcoId || ''); }}
                        >
                          <UserCheck size={11} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    {j.supervisorVerification?.isVerified ? (
                      <span className="badge-status badge-emerald" title={`Verified by ${j.supervisorVerification.supervisorName}`}>
                        <CheckCircle size={11} style={{ marginRight: '3px' }} />
                        Verified (QC: {j.supervisorVerification.qcRating})
                      </span>
                    ) : j.status === 'completed' ? (
                      <span className="badge-status badge-amber">QC Pending</span>
                    ) : j.status === 'in_progress' && j.qcReturn ? (
                      <span className="badge-status badge-rose" title={j.qcReturn.reason}>Sent back by QC</span>
                    ) : j.status === 'cancelled' && j.visitOutcome === 'client_blocked' ? (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Client blocked access</span>
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
                      ) : isFieldStep(nextAct.actionType) && !isMyFieldJob(j) && !(nextAct.isBlocked && canDispatch) ? (
                        <span title={`${nextAct.label} is done by the Supervisor on this visit`} style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.25rem 0.6rem', border: '1px solid var(--border-subtle)', borderRadius: '0.35rem', whiteSpace: 'nowrap' }}>
                          {nextAct.actionType === 'start_job' ? 'To start' : 'In progress'}: {supervisorOf(j)}
                        </span>
                      ) : (
                        <button
                          className={`btn ${nextAct.actionType === 'verify_report' ? 'btn-outline-emerald' : 'btn-primary'}`}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                          onClick={() => handleExecuteJobAction(j)}
                        >
                          <span>{nextAct.isBlocked && nextAct.actionType === 'start_job' && canDispatch && !isMyFieldJob(j) ? 'Assign Supervisor' : nextAct.label}</span>
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
                Supervisor <span className="required">*</span>
              </label>
              <select
                className="form-select"
                required
                value={newJob.leadPcoId}
                onChange={(e) => {
                  const tech = technicians.find((t) => t.uid === e.target.value);
                  // PCOs belong to the Supervisor's team, so changing TL clears them
                  setNewJob({ ...newJob, leadPcoId: tech?.uid || '', leadPcoName: tech?.displayName || '', pcoIds: [] });
                }}
              >
                <option value="">Select a Supervisor…</option>
                {technicians.map((t) => (
                  <option key={t.uid} value={t.uid}>
                    {t.displayName}{t.teamName ? ` · ${t.teamName}` : ''}
                  </option>
                ))}
              </select>
              {technicians.length === 0 && (
                <div className="form-hint">No Supervisors yet. Add them under Team &amp; Access with the Supervisor role.</div>
              )}
            </div>
          </div>

          {newJob.leadPcoId && (
            <div className="form-group">
              <label className="form-label">PCOs for this visit <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional — the Supervisor confirms who went when closing out)</span></label>
              <PcoTicks
                pcos={dataService.getTeamPcos(newJob.leadPcoId)}
                selected={newJob.pcoIds}
                onChange={(ids) => setNewJob({ ...newJob, pcoIds: ids })}
              />
            </div>
          )}

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

      {/* Modal: Assign Supervisor to a scheduled job */}
      {assignTlJob && (
        <Modal
          isOpen
          onClose={() => setAssignTlJob(null)}
          title={`Assign supervisor: ${assignTlJob.id}`}
          subtitle={`${assignTlJob.customerName} · ${formatDate(assignTlJob.scheduledDate)} (${assignTlJob.timeSlot})`}
          maxWidth="400px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setAssignTlJob(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAssignTl} disabled={!assignTlId}>
                <UserCheck size={14} /> Assign
              </button>
            </>
          }
        >
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Supervisor <span className="required">*</span></label>
            <select
              className="form-select"
              value={assignTlId}
              onChange={(e) => setAssignTlId(e.target.value)}
            >
              <option value="">— Select —</option>
              {technicians.map((u) => (
                <option key={u.uid} value={u.uid}>{u.displayName}{u.teamName ? ` · ${u.teamName}` : ''}</option>
              ))}
            </select>
            {assignTlJob.leadPcoName && (
              <div className="cell-sub" style={{ marginTop: 4 }}>Currently: {assignTlJob.leadPcoName}</div>
            )}
          </div>
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
              <strong>Check before you verify:</strong> photos (if any), signed challan, and that the chemicals on the signed paper report match what the Supervisor entered. Only verified visits go to Accounts.
            </div>

            {/* What the Supervisor submitted */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.8rem', marginBottom: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Team:</span>
                <div style={{ fontWeight: 600 }}>{teamLabel(showVerifyModal).tl || '—'}{showVerifyModal.teamLeaderOnSite ? ' (on site)' : ''}</div>
                <div>{teamLabel(showVerifyModal).pcos || 'No PCOs ticked'}</div>
                {showVerifyModal.borrowedPcoReason && <div style={{ color: '#B45309' }}>Borrowed PCO: {showVerifyModal.borrowedPcoReason}</div>}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Submitted:</span>
                <div style={{ fontWeight: 600 }}>
                  {showVerifyModal.submittedAt ? formatDate(showVerifyModal.submittedAt) : '—'} · {showVerifyModal.visitOutcome === 'partial' ? 'Partial service' : 'Completed'}
                </div>
                {showVerifyModal.lateSubmission && <div style={{ color: '#DC2626', fontWeight: 600 }}>Late by {showVerifyModal.lateDays} day(s)</div>}
                <div>
                  Photos: {(showVerifyModal.photoEvidence || []).filter((p) => p.type === 'before').length} before · {(showVerifyModal.photoEvidence || []).filter((p) => p.type === 'after').length} after
                  {showVerifyModal.challanFileUrl && <> · <a href={showVerifyModal.challanFileUrl} target="_blank" rel="noreferrer">signed challan #{showVerifyModal.challanNumber}</a></>}
                </div>
              </div>
            </div>
            {showVerifyModal.qcReturn && (
              <div style={{ fontSize: '0.78rem', marginBottom: '0.75rem', color: '#9A3412' }}>
                Previously sent back ({formatDate(showVerifyModal.qcReturn.at)}): {showVerifyModal.qcReturn.reason}
              </div>
            )}

            {/* Chemical match (SRS 5.5) */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Chemicals on the signed paper report <span className="required">*</span>
                </label>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setQcChemEntries((p) => [...p, blankChem()])}>
                  <Plus size={13} /> Add
                </button>
              </div>
              <div className="form-hint" style={{ marginBottom: 6 }}>Type them from the paper, without looking at the Supervisor&rsquo;s entry. The system compares the two.</div>
              {qcChemEntries.map((c, idx) => (
                <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.4rem', marginBottom: 4 }}>
                  <input className="form-input" placeholder="Chemical / item" value={c.name}
                    onChange={(e) => setQcChemEntries((p) => p.map((r, i) => i === idx ? { ...r, name: e.target.value } : r))} />
                  <input className="form-input" type="number" min={0} step="any" value={c.qty}
                    onChange={(e) => setQcChemEntries((p) => p.map((r, i) => i === idx ? { ...r, qty: Number(e.target.value) } : r))} />
                  <select className="form-select" value={c.unit}
                    onChange={(e) => setQcChemEntries((p) => p.map((r, i) => i === idx ? { ...r, unit: e.target.value as ChemicalUsageRecord['unit'] } : r))}>
                    <option value="grams">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="litres">litres</option>
                    <option value="bait_stations">bait stations</option>
                  </select>
                  <button type="button" className="icon-btn" title="Remove" onClick={() => setQcChemEntries((p) => p.length > 1 ? p.filter((_, i) => i !== idx) : p)}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">QC rating</label>
                <select
                  className="form-select"
                  value={verifyForm.qcRating}
                  onChange={(e) => setVerifyForm({ ...verifyForm, qcRating: e.target.value as 'excellent' | 'satisfactory' })}
                >
                  <option value="satisfactory">Satisfactory</option>
                  <option value="excellent">Excellent</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <input
                  className="form-input"
                  value={verifyForm.supervisorNotes}
                  onChange={(e) => setVerifyForm({ ...verifyForm, supervisorNotes: e.target.value })}
                  placeholder="Anything worth recording"
                />
              </div>
            </div>

            <div className="form-group" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
              <label className="form-label">Something wrong? Reason to send back to the Supervisor</label>
              <textarea
                className="form-textarea"
                rows={2}
                value={sendBackReason}
                onChange={(e) => setSendBackReason(e.target.value)}
                placeholder="e.g. After photos are of a different area; challan not signed"
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowVerifyModal(null)}>
                Cancel
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" style={{ color: 'var(--ikpm-rose-600)' }} onClick={handleSendBack} disabled={!sendBackReason.trim()}>
                  <X size={15} />
                  <span>Send back</span>
                </button>
                <button type="submit" className="btn btn-primary">
                  <ShieldCheck size={15} />
                  <span>Verify (signed by {userProfile?.displayName || 'you'})</span>
                </button>
              </div>
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
                ) : isFieldStep(getJobNextAction(selectedJob).actionType) && !isMyFieldJob(selectedJob) ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.4rem 0.8rem', border: '1px solid var(--border-subtle)', borderRadius: '0.4rem' }}>
                    Waiting for {supervisorOf(selectedJob)} (Supervisor) to {getJobNextAction(selectedJob).actionType === 'start_job' ? 'start' : 'close out'} the visit
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
              onExecuteNextAction={isFieldStep(getJobNextAction(selectedJob).actionType) && !isMyFieldJob(selectedJob) ? undefined : () => {
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
                <span style={{ color: 'var(--text-muted)' }}>Team:</span>
                <div style={{ fontWeight: 600 }}>{teamLabel(selectedJob).tl || 'No Supervisor'}{selectedJob.teamLeaderOnSite ? ' (on site)' : ''}</div>
                <div style={{ fontSize: '0.78rem' }}>
                  {selectedJob.performedByPcoIds?.length ? 'Performed by: ' : 'Planned PCOs: '}
                  {teamLabel(selectedJob).pcos || '—'}
                </div>
              </div>
            </div>

            {selectedJob.qcReturn && selectedJob.status === 'in_progress' && (
              <div style={{ padding: '0.75rem', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 'var(--radius-sm)' }}>
                <strong>Sent back by QC ({selectedJob.qcReturn.byName}, {formatDate(selectedJob.qcReturn.at)}):</strong> {selectedJob.qcReturn.reason}
              </div>
            )}
            {selectedJob.status === 'cancelled' && selectedJob.cancellationReason && (
              <div style={{ padding: '0.75rem', background: '#F8FAFC', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <strong>Cancelled{selectedJob.visitOutcome === 'client_blocked' ? ' (client blocked access)' : ''}:</strong> {selectedJob.cancellationReason}
              </div>
            )}
            {selectedJob.preCheck && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                ✓ Pre-check by {selectedJob.preCheck.confirmedByName} ({formatDate(selectedJob.preCheck.confirmedAt)}): uniform, safety gear, chemicals issued
                {selectedJob.preCheck.chemicalsIssuedNote ? ` — ${selectedJob.preCheck.chemicalsIssuedNote}` : ''}
              </div>
            )}

            {selectedJob.customerSignOff && (
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--ikpm-emerald-50)', border: '1px solid var(--ikpm-emerald-200)', borderRadius: 'var(--radius-sm)' }}>
                <strong>Client Sign-off Verified:</strong> {selectedJob.customerSignOff.acknowledgedByName} (Rating: {selectedJob.customerSignOff.feedbackRating} / 5 ⭐)
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Signed at: {formatDate(selectedJob.customerSignOff.signedAt)}
                </div>
              </div>
            )}

            {selectedJob.challanNumber && (
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--ikpm-blue-50)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Client Signed Challan (Change 39):</span>
                    <div style={{ fontWeight: 700, color: 'var(--ikpm-navy-900)' }}>#{selectedJob.challanNumber}</div>
                  </div>
                  {selectedJob.challanFileUrl && (
                    <a href={selectedJob.challanFileUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-secondary">
                      View Signed Challan
                    </a>
                  )}
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
      {/* Modal: Submit Service Report (Supervisor submits after visit) */}
      {showReportModal && (
        <Modal
          isOpen
          onClose={() => setShowReportModal(null)}
          title={`Close Out Visit: ${showReportModal.id}`}
          subtitle={`${showReportModal.customerName} · ${showReportModal.siteName} · ${formatDate(showReportModal.scheduledDate)} (${showReportModal.timeSlot})`}
          maxWidth="720px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowReportModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSubmitReport}>
                <FileCheck2 size={15} />
                <span>
                  {reportVisitOutcome === 'postponed' ? 'Reschedule visit'
                    : reportVisitOutcome === 'client_blocked' ? 'Record & close visit'
                    : 'Submit report for QC'}
                </span>
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {showReportModal.qcReturn && (
              <div style={{ padding: '0.65rem 0.85rem', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 6, fontSize: '0.8rem' }}>
                <strong>QC sent this back:</strong> {showReportModal.qcReturn.reason}
              </div>
            )}

            {/* Step 1: what happened */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">What happened on this visit? <span className="required">*</span></label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.4rem' }}>
                {([
                  ['completed', 'Completed', 'Full service done'],
                  ['partial', 'Partial', 'Some areas done'],
                  ['client_blocked', 'Client blocked', 'No access to site'],
                  ['postponed', 'Postponed', 'Do it another day'],
                ] as const).map(([val, label, hint]) => (
                  <label key={val} className="doc-check" style={{ border: `1px solid ${reportVisitOutcome === val ? 'var(--ikpm-emerald-600)' : 'var(--border-subtle)'}`, background: reportVisitOutcome === val ? 'var(--ikpm-emerald-50)' : undefined }}>
                    <input type="radio" name="visitOutcome" checked={reportVisitOutcome === val} onChange={() => setReportVisitOutcome(val)} />
                    <span style={{ fontSize: '0.82rem' }}><strong>{label}</strong><br /><span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{hint}</span></span>
                  </label>
                ))}
              </div>
            </div>

            {(reportVisitOutcome === 'client_blocked' || reportVisitOutcome === 'postponed') && (
              <div style={{ display: 'grid', gridTemplateColumns: reportVisitOutcome === 'postponed' ? '1fr 2fr' : '1fr', gap: '0.75rem' }}>
                {reportVisitOutcome === 'postponed' && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">New visit date <span className="required">*</span></label>
                    <input type="date" className="form-input" min={todayStr} value={reportNewDate} onChange={(e) => setReportNewDate(e.target.value)} />
                  </div>
                )}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">{reportVisitOutcome === 'postponed' ? 'Reason for postponing' : 'What happened on site'} <span className="required">*</span></label>
                  <input
                    className="form-input"
                    value={reportOutcomeReason}
                    onChange={(e) => setReportOutcomeReason(e.target.value)}
                    placeholder={reportVisitOutcome === 'postponed' ? 'e.g. Client asked to come after stock-taking' : 'e.g. Gate locked, manager not reachable'}
                  />
                </div>
                {reportVisitOutcome === 'client_blocked' && (
                  <div className="form-hint">Add a photo below as proof (e.g. the closed gate). No challan is needed.</div>
                )}
              </div>
            )}

            {/* Step 2: who did the work (PCOs have no login, the Supervisor ticks them) */}
            {(reportVisitOutcome === 'completed' || reportVisitOutcome === 'partial') && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">
                  Who did the work? <span className="required">*</span>
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                    Supervisor: {showReportModal.assignedTeamLeaderName || showReportModal.leadPcoName}
                  </span>
                </label>
                <PcoTicks
                  pcos={dataService.getTeamPcos(showReportModal.assignedTeamLeaderId || showReportModal.leadPcoId)}
                  selected={reportPcoIds}
                  onChange={setReportPcoIds}
                  otherPcos={allPcos}
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', marginTop: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={reportTlOnSite} onChange={(e) => setReportTlOnSite(e.target.checked)} />
                  <span>I (Supervisor) was on site / did it myself</span>
                </label>
                {reportPcoIds.some((id) => !dataService.getTeamPcos(showReportModal.assignedTeamLeaderId || showReportModal.leadPcoId).some((e) => e.id === id)) && (
                  <input
                    className="form-input"
                    style={{ marginTop: 6 }}
                    value={reportBorrowReason}
                    onChange={(e) => setReportBorrowReason(e.target.value)}
                    placeholder="Why a PCO from another team was used (required)"
                  />
                )}
                <div className="form-hint">Every ticked PCO gets credit for this visit in payroll once QC verifies it.</div>
              </div>
            )}

            {(reportVisitOutcome === 'completed' || reportVisitOutcome === 'partial') && <div>
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
                      <X size={13} style={{ color: 'var(--ikpm-rose-500)' }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>}

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
                        fieldFileToUrl(file, showReportModal, 'finding')
                          .then((url) => setReportFindingPhotos((p) => [...p, { id: `fp_${Date.now()}_${Math.random()}`, url, caption: '' }]))
                          .catch(fileError);
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

            {(reportVisitOutcome === 'completed' || reportVisitOutcome === 'partial') && <>
            {/* Final report photos */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  <Camera size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  After photos <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem' }}>(same areas, after treatment)</span>
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
                        fieldFileToUrl(file, showReportModal, 'after')
                          .then((url) => setReportFinalPhotos((p) => [...p, { id: `rp_${Date.now()}_${Math.random()}`, url, caption: '' }]))
                          .catch(fileError);
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

            {/* Cash collected on site: residential (B2C) clients only. Company (B2B) work is always invoiced.
                Finance confirms receiving the cash and issues the Cash Memo. */}
            {showReportModal.customerType !== 'company' && (
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '0.75rem' }}>
              <label className="form-label">
                Cash collected from the client <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem' }}>(residential only · optional — only if the client paid you on site)</span>
              </label>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="number"
                  min={1}
                  className="form-input"
                  style={{ maxWidth: 180 }}
                  placeholder="Amount (PKR)"
                  value={reportCashAmount}
                  onChange={(e) => setReportCashAmount(e.target.value)}
                />
                <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Camera size={13} /> {reportCashPhoto ? 'Change receipt photo' : 'Receipt / slip photo'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // Shrunk so the job record stays well under Firestore's 1 MB document limit
                      if (file) compressImage(file, 1000, 0.6).then(blobToDataUrl).then(setReportCashPhoto).catch(() => error('Photo not added', 'Could not read that image.'));
                      e.target.value = '';
                    }}
                  />
                </label>
                {reportCashPhoto && <img src={reportCashPhoto} alt="Cash receipt" style={{ width: 54, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-subtle)' }} />}
              </div>
              {reportCashAmount.trim() !== '' && !(Number(reportCashAmount) > 0) && (
                <div style={{ color: '#DC2626', fontSize: '0.74rem', marginTop: 4 }}>Enter an amount more than 0, or leave it empty.</div>
              )}
              {Number(reportCashAmount) > 0 && (
                <div className="cell-sub" style={{ marginTop: 4 }}>Hand this cash to Finance. It appears on their Invoices page until they confirm receiving it.</div>
              )}
            </div>
            )}

            {/* Delivery & Service Challan Section (Change 39: Mandatory) */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem', background: '#F8FAFC', padding: '0.85rem', borderRadius: 8, border: '1px solid #E2E8F0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 700, margin: 0, color: '#0F5132', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>Delivery & Service Challan (Physical Signed Copy)</span>
                  <span style={{ color: '#DC2626', fontSize: '0.9rem' }}>*</span>
                </h4>
                <span className="badge badge-amber" style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                  Mandatory (Not Optional)
                </span>
              </div>
              <p style={{ margin: '0 0 0.65rem 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Field protocol requires a physical copy of the delivery &amp; service challan with client signature. Both challan number and signed document copy are required before completing the job.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.65rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    Physical Challan # <span className="required" style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={reportChallanNumber}
                    onChange={(e) => setReportChallanNumber(e.target.value)}
                    placeholder="e.g. CHL-2026-0042"
                    required
                  />
                  <div className="form-hint">Physical signed delivery/service challan number</div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    Challan Date <span className="required" style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={reportChallanDate}
                    onChange={(e) => setReportChallanDate(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">
                  Upload Signed Challan Picture / Document <span className="required" style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="form-input"
                  required
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      fieldFileToUrl(file, showReportModal, 'challan')
                        .then((url) => { setReportChallanFileUrl(url); success('Challan attached', file.name); })
                        .catch(fileError);
                    }
                  }}
                />
                {reportChallanFileUrl ? (
                  <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: '#0F5132', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span>✓ Physical signed challan copy attached and ready to archive in client Challans folder</span>
                  </div>
                ) : (
                  <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: '#DC2626', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span>⚠️ Physical signed challan copy is mandatory to submit this service report</span>
                  </div>
                )}
              </div>
            </div>
            </>}
          </div>
        </Modal>
      )}
      {/* Modal: Start Visit — pre-check + before photos (SRS 5.5 start gate) */}
      {startJob && (
        <Modal
          isOpen
          onClose={() => setStartJob(null)}
          title={`Start Visit: ${startJob.id}`}
          subtitle={`${startJob.customerName} · ${startJob.siteName} · Supervisor: ${startJob.assignedTeamLeaderName || startJob.leadPcoName}`}
          maxWidth="560px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setStartJob(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleStartJob}>
                <ArrowRight size={15} /> <span>Start visit</span>
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label className="form-label">Before starting, confirm for the whole team <span className="required">*</span></label>
              {([
                ['uniform', 'Everyone is in uniform'],
                ['safetyGear', 'Safety gear (mask, gloves, goggles) checked'],
                ['chemicalsIssued', 'Chemicals issued from store and logged'],
              ] as const).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.3rem 0', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={preCheck[key]} onChange={(e) => setPreCheck({ ...preCheck, [key]: e.target.checked })} />
                  <span>{label}</span>
                </label>
              ))}
              <input
                className="form-input"
                style={{ marginTop: 4 }}
                value={preCheck.note}
                onChange={(e) => setPreCheck({ ...preCheck, note: e.target.value })}
                placeholder="What was issued (optional), e.g. Maxforce gel 2 tubes, Premise 200 ml"
              />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  <Camera size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Before photos <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem' }}>(optional)</span>
                </label>
                <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Camera size={13} /> Add photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      Array.from(e.target.files || []).forEach((file) => {
                        fieldFileToUrl(file, startJob, 'before')
                          .then((url) => setBeforePhotos((p) => [...p, { id: `bp_${Date.now()}_${Math.random()}`, url }]))
                          .catch(fileError);
                      });
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              <div className="form-hint">Photograph the problem areas before treatment. Take the after photos of the same areas.</div>
              {beforePhotos.length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 6 }}>
                  {beforePhotos.map((p) => (
                    <div key={p.id} style={{ position: 'relative' }}>
                      <img src={p.url} alt="" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-subtle)' }} />
                      <button type="button" onClick={() => setBeforePhotos((prev) => prev.filter((x) => x.id !== p.id))}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 2, display: 'flex' }}>
                        <X size={10} color="white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Edit Schedule & Time Slot */}
      {showEditScheduleJob && (
        <Modal
          isOpen
          onClose={() => setShowEditScheduleJob(null)}
          title={`Edit Schedule & Time Slot: ${showEditScheduleJob.id}`}
          subtitle={`${showEditScheduleJob.customerName} · ${showEditScheduleJob.siteName}`}
          maxWidth="560px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowEditScheduleJob(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const updated: ServiceJob = {
                    ...showEditScheduleJob,
                    scheduledDate: scheduleForm.date,
                    timeSlot: scheduleForm.timeSlot,
                    windowStart: scheduleForm.windowStart,
                    windowEnd: scheduleForm.windowEnd,
                    scheduledTime: scheduleForm.windowStart ? `${scheduleForm.windowStart} - ${scheduleForm.windowEnd}` : undefined,
                    leadPcoId: scheduleForm.leadPcoId || showEditScheduleJob.leadPcoId,
                    leadPcoName: technicians.find((t) => t.uid === scheduleForm.leadPcoId)?.displayName || showEditScheduleJob.leadPcoName,
                    updatedAt: new Date().toISOString(),
                  };
                  dataService.saveJob(updated, userProfile?.email);
                  success('Schedule Updated', `Job ${updated.id} rescheduled to ${updated.scheduledDate} (${updated.timeSlot}).`);
                  if (selectedJob?.id === updated.id) setSelectedJob(updated);
                  setShowEditScheduleJob(null);
                }}
              >
                Save Schedule
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div className="form-group">
              <label className="form-label">Service Date *</label>
              <input
                type="date"
                className="form-input"
                value={scheduleForm.date}
                onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Time Slot Shift *</label>
              <select
                className="form-select"
                value={scheduleForm.timeSlot}
                onChange={(e) => {
                  const ts = e.target.value as import('../../types/operations').ServiceJob['timeSlot'];
                  const defaults: Record<string, [string, string]> = {
                    morning: ['09:00', '13:00'],
                    afternoon: ['13:00', '17:00'],
                    evening: ['17:00', '21:00'],
                    night_shift: ['21:00', '02:00'],
                  };
                  const [ws, we] = defaults[ts] || ['09:00', '13:00'];
                  setScheduleForm({ ...scheduleForm, timeSlot: ts, windowStart: ws, windowEnd: we });
                }}
              >
                <option value="morning">Morning Shift (09:00 - 13:00)</option>
                <option value="afternoon">Afternoon Shift (13:00 - 17:00)</option>
                <option value="evening">Evening Shift (17:00 - 21:00)</option>
                <option value="night_shift">Night Shift (21:00 - 02:00)</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Custom Start Time</label>
                <input
                  type="time"
                  className="form-input"
                  value={scheduleForm.windowStart}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, windowStart: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Custom End Time</label>
                <input
                  type="time"
                  className="form-input"
                  value={scheduleForm.windowEnd}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, windowEnd: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Assigned Supervisor / PCO</label>
              <select
                className="form-select"
                value={scheduleForm.leadPcoId}
                onChange={(e) => setScheduleForm({ ...scheduleForm, leadPcoId: e.target.value })}
              >
                <option value="">-- Keep Current Assignee --</option>
                {technicians.map((t) => (
                  <option key={t.uid} value={t.uid}>{t.displayName}</option>
                ))}
              </select>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Attach / Edit Challan */}
      {showAttachChallanJob && (
        <Modal
          isOpen
          onClose={() => setShowAttachChallanJob(null)}
          title={`Attach / Update Delivery Challan: ${showAttachChallanJob.id}`}
          subtitle={`${showAttachChallanJob.customerName} · ${showAttachChallanJob.siteName}`}
          maxWidth="560px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowAttachChallanJob(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (!attachChallanNo.trim()) {
                    warning('Challan Number Required', 'Please enter the physical challan number.');
                    return;
                  }
                  const now = new Date().toISOString();
                  const cNo = attachChallanNo.trim();
                  const updated: ServiceJob = {
                    ...showAttachChallanJob,
                    challanNumber: cNo,
                    challanFileUrl: attachChallanFileUrl || showAttachChallanJob.challanFileUrl,
                    updatedAt: now,
                  };

                  const challanRecord: import('../../types/operations').Challan = {
                    id: `CHL-${updated.id}`,
                    challanNumber: cNo,
                    challanKey: cNo.toLowerCase().replace(/[^a-z0-9]/g, ''),
                    jobId: updated.id,
                    contractId: updated.contractId,
                    customerId: updated.customerId,
                    customerName: updated.customerName,
                    clientType: updated.customerType,
                    branchId: updated.branchId,
                    challanDate: attachChallanDate || now.slice(0, 10),
                    fileUrl: attachChallanFileUrl || showAttachChallanJob.challanFileUrl || '',
                    fileName: `Challan_${cNo}_${updated.customerName}.pdf`,
                    uploadedBy: userProfile?.email || 'admin',
                    uploadedByName: userProfile?.displayName || 'Operations Staff',
                    uploadedAt: now,
                    status: 'active',
                  };
                  dataService.saveChallan(challanRecord, userProfile?.email);

                  if (attachChallanFileUrl) {
                    dataService.saveDocument({
                      id: `DOC-CHL-${updated.id}`,
                      title: `Signed Delivery Challan #${cNo} - ${updated.customerName}`,
                      category: 'other',
                      fileCategory: 'certificate',
                      owner: { kind: 'client', id: updated.customerId },
                      source: 'uploaded',
                      file: {
                        url: attachChallanFileUrl,
                        fileName: `Challan_${cNo}.png`,
                        fileSize: 1024,
                        fileType: 'image/png',
                        storage: 'local',
                      },
                      uploadedBy: userProfile?.email || 'admin',
                      uploadedByName: userProfile?.displayName || 'Operations Staff',
                      uploadedAt: now,
                    }, userProfile?.email);
                  }

                  dataService.saveJob(updated, userProfile?.email);
                  success('Challan Saved', `Challan #${cNo} linked and filed into client Challans folder.`);
                  if (selectedJob?.id === updated.id) setSelectedJob(updated);
                  setShowAttachChallanJob(null);
                }}
              >
                Save Challan
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div className="form-group">
              <label className="form-label">Physical Challan Number *</label>
              <input
                type="text"
                className="form-input"
                value={attachChallanNo}
                onChange={(e) => setAttachChallanNo(e.target.value)}
                placeholder="e.g. CHL-2026-0042"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Challan Date</label>
              <input
                type="date"
                className="form-input"
                value={attachChallanDate}
                onChange={(e) => setAttachChallanDate(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Challan Picture / Document Scan</label>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="form-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    fieldFileToUrl(file, showAttachChallanJob, 'challan')
                      .then((url) => { setAttachChallanFileUrl(url); success('Challan loaded', `${file.name} ready to save.`); })
                      .catch(fileError);
                  }
                }}
              />
              {attachChallanFileUrl && (
                <div style={{ marginTop: '0.5rem' }}>
                  <img src={attachChallanFileUrl} alt="Challan preview" style={{ maxHeight: '180px', borderRadius: 4, border: '1px solid var(--border-subtle)' }} />
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
