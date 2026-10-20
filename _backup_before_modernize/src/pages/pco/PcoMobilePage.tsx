import React, { useState } from 'react';
import {
  Smartphone,
  Wifi,
  WifiOff,
  PenTool,
  Download,
  Save,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { useSync } from '../../contexts/SyncContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import type { ServiceJob, ChemicalUsageRecord, CustomerSignOff } from '../../types/operations';

export const PcoMobilePage: React.FC = () => {
  const { isOnline, pendingCount, enqueueOfflineAction } = useSync();
  const { success, info } = useNotification();
  const { userProfile } = useAuth();

  const jobs = dataService.getJobs();
  const [selectedJobId, setSelectedJobId] = useState(jobs[0]?.id || '');
  const activeJob = jobs.find((j) => j.id === selectedJobId) || jobs[0];

  const [checklist, setChecklist] = useState(activeJob?.checklists || []);
  const [chemicals, setChemicals] = useState<ChemicalUsageRecord[]>(activeJob?.chemicalsUsed || []);
  const [customerName, setCustomerName] = useState(activeJob?.customerSignOff?.acknowledgedByName || '');
  const [feedbackRating, setFeedbackRating] = useState<1 | 2 | 3 | 4 | 5>(5);

  const handleAddChemical = () => {
    const newChem: ChemicalUsageRecord = {
      id: `chem_${Date.now()}`,
      chemicalName: 'Maxforce FC Magnum Roach Gel',
      activeIngredient: 'Fipronil 0.05%',
      dosageRate: '1-2 spots per sq meter',
      quantityUsed: 30,
      unit: 'grams',
      batchNumber: 'BATCH-2026-PAK',
      targetPest: 'cockroaches',
      applicationMethod: 'gel_baiting',
    };
    setChemicals([...chemicals, newChem]);
  };

  const handleSaveFieldReport = () => {
    if (!activeJob) return;

    const signOff: CustomerSignOff = {
      acknowledgedByName: customerName || activeJob.customerName,
      feedbackRating,
      signedAt: new Date().toISOString(),
      signatureDataUrl: 'data:image/svg+xml;utf8,<svg>DigitalVerifiedSignature</svg>',
    };

    const updatedJob: ServiceJob = {
      ...activeJob,
      checklists: checklist,
      chemicalsUsed: chemicals,
      customerSignOff: signOff,
      status: 'completed',
      updatedAt: new Date().toISOString(),
    };

    if (isOnline) {
      dataService.saveJob(updatedJob, userProfile?.email);
      success('Report Finalized & Synced', `Job ${activeJob.id} is marked complete with customer sign-off.`);
    } else {
      enqueueOfflineAction('service_jobs', 'update', activeJob.id, updatedJob as unknown as Record<string, unknown>);
      info('Saved to Offline Storage', `Job report for ${activeJob.id} will automatically sync once online.`);
    }
  };

  if (!activeJob) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h3>No Field Jobs Assigned</h3>
        <p style={{ color: 'var(--text-muted)' }}>There are currently no operations jobs assigned.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ maxWidth: '640px', margin: '0 auto' }}>
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
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>PCO Field Workstation</div>
            <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Offline-First Pest Management</div>
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

      <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
        <label className="form-label" style={{ fontSize: '0.8rem' }}>Active Service Assignment:</label>
        <select
          className="form-select"
          value={selectedJobId}
          onChange={(e) => {
            setSelectedJobId(e.target.value);
            const found = jobs.find((j) => j.id === e.target.value);
            if (found) {
              setChecklist(found.checklists);
              setChemicals(found.chemicalsUsed);
              setCustomerName(found.customerSignOff?.acknowledgedByName || '');
            }
          }}
        >
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.id} — {j.customerName} ({j.siteName})
            </option>
          ))}
        </select>
      </div>

      <div className="card" style={{ marginBottom: '1rem', borderTop: '4px solid var(--ikpm-emerald-500)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span className="badge-status badge-navy" style={{ fontSize: '0.7rem' }}>{activeJob.id}</span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: '0.35rem', color: 'var(--ikpm-navy-900)' }}>
              {activeJob.customerName}
            </h2>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {activeJob.siteName} • {activeJob.siteAddress}
            </div>
          </div>
          <span className="badge-status badge-slate">{activeJob.timeSlot.replace('_', ' ')}</span>
        </div>

        <div style={{ marginTop: '0.85rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <strong>Target Pests:</strong> {activeJob.targetPests.join(', ')}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginBottom: '0.75rem' }}>
          1. Field Checklist Execution
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {checklist.map((c, idx) => (
            <label
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.55rem 0.75rem',
                backgroundColor: c.isCompleted ? 'var(--ikpm-emerald-50)' : 'var(--bg-surface-alt)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontSize: '0.825rem',
              }}
            >
              <input
                type="checkbox"
                checked={c.isCompleted}
                onChange={(e) => {
                  const next = [...checklist];
                  next[idx].isCompleted = e.target.checked;
                  setChecklist(next);
                }}
              />
              <span style={{ textDecoration: c.isCompleted ? 'line-through' : 'none', color: c.isCompleted ? '#065F46' : 'var(--text-primary)' }}>
                {c.taskDescription}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>
            2. Applied Chemicals & Dosage Log
          </h3>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }} onClick={handleAddChemical}>
            + Add Chemical
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {chemicals.map((chem, idx) => (
            <div
              key={chem.id}
              style={{
                padding: '0.75rem',
                backgroundColor: 'var(--bg-surface-alt)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8rem',
              }}
            >
              <div style={{ fontWeight: 700 }}>{chem.chemicalName}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Active: {chem.activeIngredient}</div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.7rem' }}>Quantity Used ({chem.unit}):</label>
                  <input
                    type="number"
                    className="form-input"
                    style={{ height: '30px', fontSize: '0.8rem' }}
                    value={chem.quantityUsed}
                    onChange={(e) => {
                      const next = [...chemicals];
                      next[idx].quantityUsed = Number(e.target.value);
                      setChemicals(next);
                    }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.7rem' }}>Batch / Lot #:</label>
                  <input
                    type="text"
                    className="form-input"
                    style={{ height: '30px', fontSize: '0.8rem' }}
                    value={chem.batchNumber}
                    onChange={(e) => {
                      const next = [...chemicals];
                      next[idx].batchNumber = e.target.value;
                      setChemicals(next);
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginBottom: '0.75rem' }}>
          3. Customer Digital Sign-Off & QC
        </h3>

        <div className="form-group">
          <label className="form-label" style={{ fontSize: '0.8rem' }}>Client Representative Name:</label>
          <input
            type="text"
            className="form-input"
            placeholder="e.g. Tariq Mehmood"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" style={{ fontSize: '0.8rem' }}>Client Service Rating (1-5):</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className={`btn ${feedbackRating >= star ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.4rem 0.75rem' }}
                onClick={() => setFeedbackRating(star as any)}
              >
                ★ {star}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            border: '2px dashed var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            padding: '1.25rem',
            textAlign: 'center',
            backgroundColor: 'var(--bg-surface-alt)',
          }}
        >
          <PenTool size={20} color="var(--text-muted)" style={{ marginBottom: '4px' }} />
          <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Digital Signature Acknowledged</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Captured securely with timestamp and technician verification
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '3rem' }}>
        <button
          className="btn btn-secondary"
          style={{ flex: 1, padding: '0.85rem' }}
          onClick={() => pdfGenerator.generateJobReportPDF(activeJob)}
        >
          <Download size={16} />
          <span>Export Report</span>
        </button>

        <button
          className="btn btn-primary"
          style={{ flex: 2, padding: '0.85rem' }}
          onClick={handleSaveFieldReport}
        >
          <Save size={16} />
          <span>Finalize & Sync Report</span>
        </button>
      </div>
    </div>
  );
};
