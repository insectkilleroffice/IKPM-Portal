import React, { useState, useRef, useEffect } from 'react';
import {
  Smartphone,
  Wifi,
  WifiOff,
  PenTool,
  Download,
  Save,
  CheckCircle2,
  Camera,
  ArrowRight,
  ArrowLeft,
  Play,
  RotateCcw,
  Sparkles,
  Plus,
  Trash2,
  Share2,
  Send,
  MapPin,
  Phone,
  Clock,
  Star,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { usePdfAction } from '../../hooks/usePdfAction';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import { JobPhotoCapture } from '../../features/field/JobPhotoCapture';
import { useSync } from '../../contexts/SyncContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import type { ServiceJob, ChemicalUsageRecord, CustomerSignOff, PhotoEvidence } from '../../types/operations';
import { CHEMICAL_PRESETS } from '../../lib/workflow';
import { formatPKR, formatDate } from '../../lib/formatters';
import { useDataStore } from '../../hooks/useDataStore';

type GuidedStep = 1 | 2 | 3 | 4 | 5;

export const PcoMobilePage: React.FC = () => {
  useDataStore(); // re-render when Firestore data arrives
  const { isOnline, pendingCount, enqueueOfflineAction } = useSync();
  const { success, info, warning, error } = useNotification();
  const pdfAction = usePdfAction();
  const { userProfile } = useAuth();

  const jobs = dataService.getJobs();
  const [selectedJobId, setSelectedJobId] = useState(jobs[0]?.id || '');
  const activeJob = jobs.find((j) => j.id === selectedJobId) || jobs[0];

  const [currentStep, setCurrentStep] = useState<GuidedStep>(1);

  // Step state
  const [chemicals, setChemicals] = useState<ChemicalUsageRecord[]>([]);
  const [photos, setPhotos] = useState<PhotoEvidence[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerDesignation, setCustomerDesignation] = useState('Facility Manager');
  const [feedbackRating, setFeedbackRating] = useState<1 | 2 | 3 | 4 | 5>(5);
  const [isFinished, setIsFinished] = useState(false);
  const [hasDrawnSignature, setHasDrawnSignature] = useState(false);
  const [confirmSkipPhotos, setConfirmSkipPhotos] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);

  // Sync state whenever active job changes
  useEffect(() => {
    if (activeJob) {
      setChemicals(activeJob.chemicalsUsed || []);
      setPhotos(activeJob.photoEvidence || []);
      setCustomerName(activeJob.customerSignOff?.acknowledgedByName || activeJob.customerName || '');
      setCustomerDesignation(activeJob.customerSignOff?.customerDesignation || 'Facility Manager');
      setFeedbackRating(activeJob.customerSignOff?.feedbackRating || 5);

      if (activeJob.status === 'completed') {
        setCurrentStep(5);
        setIsFinished(true);
      } else if (activeJob.status === 'in_progress') {
        setCurrentStep(2);
      } else {
        setCurrentStep(1);
        setIsFinished(false);
      }
    }
  }, [activeJob?.id]);

  // Canvas drawing handlers for signature
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    setHasDrawnSignature(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0F172A';
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawing.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawnSignature(false);
  };

  if (!activeJob) {
    return (
      <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
        <h3>No Assigned Field Jobs</h3>
        <p style={{ color: 'var(--text-muted)' }}>There are no field assignments in your work queue.</p>
      </div>
    );
  }

  // Step 1: Start Job
  const handleStartJob = () => {
    const updated: ServiceJob = {
      ...activeJob,
      status: 'in_progress',
      updatedAt: new Date().toISOString(),
    };
    if (isOnline) {
      dataService.saveJob(updated, userProfile?.email);
    } else {
      enqueueOfflineAction('service_jobs', 'update', activeJob.id, updated as unknown as Record<string, unknown>);
    }
    success('Job Started (Punched In)', `Visit timer started on site for ${activeJob.customerName}`);
    setCurrentStep(2);
  };

  // Step 2: Pick Preset Chemical
  const handleAddPresetChemical = (pestKey: string) => {
    const preset = CHEMICAL_PRESETS[pestKey] || CHEMICAL_PRESETS.cockroaches;
    const newChem: ChemicalUsageRecord = {
      ...preset,
      id: `chem_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
    };
    setChemicals([...chemicals, newChem]);
    success('Chemical Preset Applied', `${newChem.chemicalName} added with standard dose.`);
  };

  const handleRemoveChemical = (id: string) => {
    setChemicals(chemicals.filter((c) => c.id !== id));
  };

  // Step 3: save each photo on the job straight away so a reload or closed app doesn't lose it
  const handlePhotosChange = (next: PhotoEvidence[]) => {
    setPhotos(next);
    if (isOnline) {
      dataService.saveJobPhotos(activeJob.id, next);
    } else {
      enqueueOfflineAction('service_jobs', 'update', activeJob.id, { ...activeJob, photoEvidence: next } as unknown as Record<string, unknown>);
    }
  };

  const missingPhotoSteps = (['before', 'after'] as const)
    .filter((t) => !photos.some((p) => p.type === t))
    .map((t) => (t === 'before' ? 'before-treatment' : 'after-treatment'));

  const handlePhotosNext = () => {
    if (missingPhotoSteps.length) {
      setConfirmSkipPhotos(true);
      return;
    }
    setCurrentStep(4);
  };

  // Step 5: Finish & Auto Save to Client Documents with no further clicks
  const handleFinishJob = () => {
    let signatureUrl = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="10" y="35" font-family="sans-serif" font-size="16" fill="%230F172A">Digitally Signed & Verified</text></svg>';
    if (canvasRef.current && hasDrawnSignature) {
      try {
        signatureUrl = canvasRef.current.toDataURL('image/png');
      } catch {
        // fallback
      }
    }

    const signOff: CustomerSignOff = {
      acknowledgedByName: customerName || activeJob.customerName,
      customerDesignation,
      feedbackRating,
      signatureDataUrl: signatureUrl,
      signedAt: new Date().toISOString(),
    };

    const updatedJob: ServiceJob = {
      ...activeJob,
      status: 'completed',
      chemicalsUsed: chemicals,
      photoEvidence: photos,
      customerSignOff: signOff,
      updatedAt: new Date().toISOString(),
    };

    // Save job
    if (isOnline) {
      dataService.saveJob(updatedJob, userProfile?.email);
    } else {
      enqueueOfflineAction('service_jobs', 'update', activeJob.id, updatedJob as unknown as Record<string, unknown>);
    }

    // Generate the real service report (with photos & signature) and file it in the client's folder
    (async () => {
      try {
        const blob = await pdfGenerator.jobReportPDFBlob(updatedJob);
        const fileName = pdfGenerator.jobReportFileName(updatedJob);
        if (!integrations.cloudinary || !navigator.onLine) {
          warning('Report not uploaded', 'No internet or file storage. Download the report from the job once you are back online.');
          return;
        }
        const file = await uploadFile(blob, { folder: `job/${updatedJob.id}`, fileName });
        dataService.saveDocument(
          {
            id: `DOC-${Date.now()}-${updatedJob.id}`,
            title: `Service Report: ${updatedJob.id} (${updatedJob.customerName})`,
            category: 'service_report',
            folder: 'service_reports',
            year: new Date().getFullYear(),
            source: 'generated',
            jobId: updatedJob.id,
            owner: { kind: updatedJob.customerType === 'company' ? 'company' : 'client', id: updatedJob.customerId },
            file,
            uploadedBy: userProfile?.email || '',
            uploadedByName: userProfile?.displayName || updatedJob.leadPcoName,
            uploadedAt: new Date().toISOString(),
          },
          userProfile?.email
        );
      } catch (err) {
        warning('Report not saved to client files', err instanceof Error ? err.message : String(err));
      }
    })();

    setIsFinished(true);
    setCurrentStep(5);
    success('Visit completed', 'The service report PDF is being saved to the client’s files. Unlocked for supervisor QC.');
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: '640px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* Top Mobile Status Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--ikpm-navy-900)',
          color: '#FFFFFF',
          padding: '0.85rem 1.25rem',
          borderRadius: 'var(--radius-lg)',
          marginBottom: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <Smartphone size={20} color="var(--ikpm-emerald-400)" />
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Technician Field Visit</div>
            <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Guided 5-Step Workflow • Offline-First</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
          {isOnline ? (
            <span style={{ color: 'var(--ikpm-emerald-400)', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Wifi size={14} /> Online
            </span>
          ) : (
            <span style={{ color: 'var(--ikpm-amber-500)', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <WifiOff size={14} /> Offline Mode ({pendingCount})
            </span>
          )}
        </div>
      </div>

      {/* Select Assignment Bar */}
      <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Current Assignment:
          </label>
          <span className="badge-status badge-navy" style={{ fontSize: '0.7rem' }}>
            Shift: {activeJob.timeSlot.replace('_', ' ')}
          </span>
        </div>
        <select
          className="form-select"
          style={{ marginTop: '4px', fontWeight: 600 }}
          value={selectedJobId}
          onChange={(e) => setSelectedJobId(e.target.value)}
        >
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.id} — {j.customerName} ({j.siteName}) [{j.status.toUpperCase()}]
            </option>
          ))}
        </select>
      </div>

      {/* Guided Progress Bar */}
      <div
        className="card"
        style={{
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {[
          { num: 1, label: 'Start' },
          { num: 2, label: 'Chemicals' },
          { num: 3, label: 'Photos' },
          { num: 4, label: 'Sign-off' },
          { num: 5, label: 'Finish' },
        ].map((s) => {
          const isDone = currentStep > s.num || isFinished;
          const isCur = currentStep === s.num && !isFinished;
          return (
            <div
              key={s.num}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                flex: 1,
                opacity: isCur || isDone ? 1 : 0.45,
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: isDone ? 'var(--ikpm-emerald-600)' : isCur ? 'var(--ikpm-navy-900)' : 'var(--bg-surface-alt)',
                  color: isDone || isCur ? '#FFFFFF' : 'var(--text-muted)',
                  border: isCur ? '2px solid var(--ikpm-emerald-500)' : '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                }}
              >
                {isDone ? '✓' : s.num}
              </div>
              <span style={{ fontSize: '0.65rem', fontWeight: isCur ? 800 : 500, marginTop: '3px' }}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* STEP 1: START JOB */}
      {currentStep === 1 && !isFinished && (
        <div className="card animate-fade-in" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span className="badge-status badge-navy">{activeJob.id}</span>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginTop: '4px' }}>
                {activeJob.customerName}
              </h2>
            </div>
            <StatusBadge status={activeJob.status} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem', fontSize: '0.825rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MapPin size={16} color="var(--ikpm-emerald-600)" style={{ flexShrink: 0 }} />
              <div>
                <strong>{activeJob.siteName}</strong>: {activeJob.siteAddress}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={16} color="var(--ikpm-navy-700)" style={{ flexShrink: 0 }} />
              <div>Scheduled Shift: <strong>{activeJob.timeSlot}</strong> on {formatDate(activeJob.scheduledDate)}</div>
            </div>
          </div>

          <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
            <strong style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Target Pests for Treatment:</strong>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
              {activeJob.targetPests.map((p) => (
                <span key={p} className="badge-status badge-slate">
                  {p.replace('_', ' ')}
                </span>
              ))}
            </div>
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 800, justifyContent: 'center' }}
              onClick={handleStartJob}
            >
              <Play size={18} />
              <span>Start Job Visit (Punch In)</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: PICK CHEMICALS FROM PRESETS */}
      {currentStep === 2 && !isFinished && (
        <div className="card animate-fade-in" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Step 2: Chemical Presets</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                1-tap presets pre-filled with dosage & batch number from registered standards.
              </p>
            </div>
            <Sparkles size={18} color="var(--ikpm-emerald-600)" />
          </div>

          {/* Quick Preset Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              className="btn btn-outline-emerald"
              style={{ padding: '0.5rem', fontSize: '0.75rem', justifyContent: 'center' }}
              onClick={() => handleAddPresetChemical('cockroaches')}
            >
              + Maxforce Roach Gel
            </button>
            <button
              className="btn btn-outline-emerald"
              style={{ padding: '0.5rem', fontSize: '0.75rem', justifyContent: 'center' }}
              onClick={() => handleAddPresetChemical('termites')}
            >
              + Premise Termite 200SC
            </button>
            <button
              className="btn btn-outline-emerald"
              style={{ padding: '0.5rem', fontSize: '0.75rem', justifyContent: 'center' }}
              onClick={() => handleAddPresetChemical('rodents_rats')}
            >
              + Contrac Rodent Blox
            </button>
            <button
              className="btn btn-outline-emerald"
              style={{ padding: '0.5rem', fontSize: '0.75rem', justifyContent: 'center' }}
              onClick={() => handleAddPresetChemical('bedbugs')}
            >
              + Bedbug Residual Spray
            </button>
          </div>

          {/* Selected Chemicals List */}
          <div style={{ marginBottom: '1.25rem' }}>
            <strong style={{ fontSize: '0.8rem' }}>Chemicals Applied ({chemicals.length}):</strong>
            {chemicals.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Tap a preset above to record chemical dosage.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                {chemicals.map((chem) => (
                  <div
                    key={chem.id}
                    style={{
                      padding: '0.65rem 0.85rem',
                      backgroundColor: 'var(--bg-surface-alt)',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '0.825rem' }}>{chem.chemicalName}</strong>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Batch: <span style={{ fontFamily: 'monospace' }}>{chem.batchNumber}</span> • {chem.quantityUsed} {chem.unit} ({chem.dosageRate})
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveChemical(chem.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--ikpm-rose-500)', cursor: 'pointer' }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(1)}>
              <ArrowLeft size={15} />
              <span>Back</span>
            </button>
            <button
              className="btn btn-primary"
              disabled={chemicals.length === 0}
              onClick={() => setCurrentStep(3)}
            >
              <span>Next: Add Photos</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: ADD PHOTOS */}
      {currentStep === 3 && !isFinished && (
        <div className="card animate-fade-in" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Step 3: Treatment Photos</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Capture photographic evidence for the certified service report.
              </p>
            </div>
            <Camera size={18} color="var(--ikpm-emerald-600)" />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <JobPhotoCapture
              jobId={activeJob.id}
              photos={photos}
              onChange={handlePhotosChange}
              required={['before', 'after']}
              onNotify={(kind, title, message) => (kind === 'error' ? error(title, message) : kind === 'warning' ? warning(title, message) : success(title, message))}
            />
          </div>

          <ConfirmDialog
            isOpen={confirmSkipPhotos}
            onClose={() => setConfirmSkipPhotos(false)}
            onConfirm={() => setCurrentStep(4)}
            title="Continue without all photos?"
            message={`No ${missingPhotoSteps.join(' or ')} photo has been added. The service report is stronger with both. Continue anyway?`}
            confirmLabel="Continue anyway"
            isDestructive={false}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(2)}>
              <ArrowLeft size={15} />
              <span>Back</span>
            </button>
            <button className="btn btn-primary" onClick={handlePhotosNext}>
              <span>Next: Client Sign-off</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: CLIENT SIGNATURE */}
      {currentStep === 4 && !isFinished && (
        <div className="card animate-fade-in" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Step 4: Customer Acknowledgment</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Client physical or digital signature and star rating on site.
              </p>
            </div>
            <PenTool size={18} color="var(--ikpm-emerald-600)" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.78rem' }}>Client Representative Name <span className="required">*</span></label>
              <input
                type="text"
                required
                className="form-input"
                style={{ height: '34px', fontSize: '0.8rem' }}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontSize: '0.78rem' }}>Designation / Title</label>
              <input
                type="text"
                className="form-input"
                style={{ height: '34px', fontSize: '0.8rem' }}
                value={customerDesignation}
                onChange={(e) => setCustomerDesignation(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label className="form-label" style={{ fontSize: '0.78rem' }}>Customer Service Rating</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: star <= feedbackRating ? '#F59E0B' : '#CBD5E1',
                    fontSize: '1.5rem',
                  }}
                  onClick={() => setFeedbackRating(star as any)}
                >
                  ★
                </button>
              ))}
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#D97706', marginLeft: '0.5rem' }}>
                {feedbackRating} / 5 Stars
              </span>
            </div>
          </div>

          {/* Interactive Signature Canvas */}
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label className="form-label" style={{ fontSize: '0.78rem', margin: 0 }}>
                Sign on Screen (Touch or Stylus):
              </label>
              <button
                type="button"
                onClick={clearSignature}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer' }}
              >
                Clear Signature
              </button>
            </div>
            <div
              style={{
                border: '2px dashed var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: '#FAFAFA',
                touchAction: 'none',
              }}
            >
              <canvas
                ref={canvasRef}
                width={500}
                height={120}
                style={{ width: '100%', height: '120px', display: 'block', cursor: 'crosshair' }}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(3)}>
              <ArrowLeft size={15} />
              <span>Back</span>
            </button>
            <button className="btn btn-primary" onClick={handleFinishJob}>
              <CheckCircle2 size={16} />
              <span>Finish Visit & Generate Report</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: COMPLETED CONFIRMATION */}
      {(currentStep === 5 || isFinished) && (
        <div className="card animate-fade-in" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: 'var(--ikpm-emerald-100)',
              color: 'var(--ikpm-emerald-600)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
            }}
          >
            <CheckCircle2 size={32} />
          </div>

          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>
            Service Visit Completed & Certified
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            Job <strong>{activeJob.id}</strong> has been signed by <strong>{customerName || activeJob.customerName}</strong>.
            The official PDF report was automatically generated and saved into the client&apos;s folder.
          </p>

          <div
            style={{
              margin: '1.25rem 0',
              padding: '0.85rem',
              backgroundColor: 'var(--bg-surface-alt)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.8rem',
              display: 'flex',
              justifyContent: 'space-around',
            }}
          >
            <div>Chemicals: <strong>{chemicals.length} applied</strong></div>
            <div>Photos: <strong>{photos.length} captured</strong></div>
            <div>Rating: <strong>{feedbackRating} / 5 ⭐</strong></div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '0.7rem' }}
              onClick={() => pdfAction.run(activeJob.id, () => pdfGenerator.generateJobReportPDF(activeJob))}
              disabled={pdfAction.busy === activeJob.id}
            >
              <Download size={15} />
              <span>Download Signed Report PDF</span>
            </button>

            <button
              className="btn btn-secondary"
              style={{ width: '100%', justifyContent: 'center', padding: '0.7rem' }}
              onClick={() => {
                const text = encodeURIComponent(
                  `Assalam-o-Alaikum! Your pest control service report for Job ${activeJob.id} at ${activeJob.siteName} has been finalized by IKPM. Thank you for your feedback!`
                );
                window.open(`https://wa.me/?text=${text}`, '_blank');
              }}
            >
              <Share2 size={15} />
              <span>Share Summary via WhatsApp</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
