// Quality audits.
// Super admin: schedule an audit (chosen site or random pick), verify or return the entomologist's
// report, then save it to the client's folder and / or send it to the client; create a free
// corrective visit when the audit finds problems.
// Entomologist: sees only their own audits, fills in the report and submits it.

import React, { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Download, FolderUp, Plus, RotateCcw, Send, Shuffle, Trash2 } from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDataStore } from '../../hooks/useDataStore';
import { usePdfAction } from '../../hooks/usePdfAction';
import { baseRoleOf, canAccessModule } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import { dataService } from '../../services/dataService';
import { AUDIT_STATUS_LABELS, DEFAULT_AUDIT_CHECKS, type AuditReport, type QualityAudit } from '../../types/audits';
import type { Contract } from '../../types/operations';
import { channelBlocker, SEND_CHANNEL_LABELS, type InvoiceSendChannel } from '../../features/invoices/invoiceWorkflow';
import {
  auditCandidates, auditMessage, auditRecipient, createAuditFollowUp, entomologists, randomAuditPick, reportProblems,
  returnAudit, saveAuditToFolder, saveReport, scheduleAudit, sendAuditToClient, verifyAudit, type AuditActor,
} from '../../features/audits/audits';

const STATUS_BADGE: Record<QualityAudit['status'], string> = {
  scheduled: 'badge-blue', submitted: 'badge-amber', returned: 'badge-rose', verified: 'badge-teal', cancelled: 'badge-slate',
};

const useActor = (): AuditActor => {
  const { userProfile } = useAuth();
  return {
    uid: userProfile?.uid || '', email: userProfile?.email || 'admin',
    name: userProfile?.displayName || userProfile?.email || 'Staff', businessEmail: userProfile?.businessEmail || userProfile?.email || '',
  };
};

export const AuditsPage: React.FC = () => {
  useDataStore();
  const { effectiveRole, userProfile } = useAuth();
  const isSA = baseRoleOf(effectiveRole) === 'super_admin';
  // Open to the super admin (audits module) and to any staff member marked as an entomologist
  const allowed = isSA || canAccessModule(effectiveRole, 'audits') || Boolean(userProfile?.isEntomologist);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<{ contract?: Contract; random?: boolean } | null>(null);
  const audits = dataService.getAudits();
  const rows = audits.filter((a) => filter === 'all' || ['scheduled', 'submitted', 'returned'].includes(a.status) || (a.status === 'verified' && !a.savedAt && !a.sentAt));
  const due = isSA ? auditCandidates().slice(0, 8) : [];
  const open = openId ? dataService.getAuditById(openId) : undefined;

  if (!allowed) {
    return <div className="empty-hint" style={{ margin: '2rem' }}>Quality audits are for the super admin and staff marked as entomologists in Team &amp; Access.</div>;
  }

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Quality audits' }]} />
      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Quality audits</h1>
          <p className="page-subtitle">{isSA
            ? 'Entomologist audit visits: schedule (or pick at random), verify the report, then save or send it.'
            : 'Your audit visits. Fill in the report on site and submit it for verification.'}</p>
        </div>
        {isSA && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={() => setScheduling({ random: true })}><Shuffle size={15} /> Random audit</button>
            <button className="btn btn-primary" onClick={() => setScheduling({})}><Plus size={15} /> Schedule audit</button>
          </div>
        )}
      </div>

      {isSA && due.length > 0 && (
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div className="card-title" style={{ marginBottom: '0.5rem' }}>Due for an audit</div>
          {due.map((c) => (
            <div key={c.contract.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.84rem', marginBottom: '0.3rem' }}>
              <span><strong>{c.contract.customerName}</strong>{c.contract.branchName ? ` · ${c.contract.branchName}` : ''} · {c.contract.id}</span>
              <span className="cell-sub">{c.lastAuditDate ? `last audit ${formatDate(c.lastAuditDate)}` : 'never audited'}{c.openComplaints ? ` · ${c.openComplaints} open complaint(s)` : ''}</span>
              <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setScheduling({ contract: c.contract })}>Schedule</button>
            </div>
          ))}
        </div>
      )}

      <div className="chip-row" style={{ marginBottom: '0.75rem' }}>
        <button type="button" className={`chip ${filter === 'open' ? 'chip-on' : ''}`} onClick={() => setFilter('open')}>Open</button>
        <button type="button" className={`chip ${filter === 'all' ? 'chip-on' : ''}`} onClick={() => setFilter('all')}>All</button>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Audit</th><th>Client / site</th><th>Date</th><th>Entomologist</th><th>Score</th><th>Status</th><th /></tr></thead>
          <tbody>
            {!rows.length ? (
              <tr><td colSpan={7} className="cell-sub" style={{ textAlign: 'center', padding: '1.25rem' }}>No audits{filter === 'open' ? ' open' : ''}.</td></tr>
            ) : rows.map((a) => (
              <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(a.id)}>
                <td className="cell-title">{a.auditNumber}<div className="cell-sub">{[a.surprise && 'Surprise', a.random && 'Random'].filter(Boolean).join(' · ')}</div></td>
                <td>{a.customerName}<div className="cell-sub">{a.siteName}</div></td>
                <td>{formatDate(a.scheduledDate)}</td>
                <td>{a.entomologistName}</td>
                <td>{a.report?.score ? `${a.report.score} / 5` : '—'}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[a.status]}`}>{AUDIT_STATUS_LABELS[a.status]}</span>
                  {a.status === 'verified' && <div className="cell-sub">{a.sentAt ? 'Sent to client' : a.savedAt ? 'Saved to client folder' : ''}</div>}
                </td>
                <td><button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); setOpenId(a.id); }}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scheduling && <ScheduleAuditModal preset={scheduling} onClose={() => setScheduling(null)} onDone={(id) => { setScheduling(null); setOpenId(id); }} />}
      {open && <AuditModal audit={open} onClose={() => setOpenId(null)} />}
    </div>
  );
};

/** Schedule an audit: a chosen contract site, or a random pick among the sites most due. */
const ScheduleAuditModal: React.FC<{ preset: { contract?: Contract; random?: boolean }; onClose: () => void; onDone: (id: string) => void }> = ({ preset, onClose, onDone }) => {
  const actor = useActor();
  const { success, error, warning } = useNotification();
  const contracts = dataService.getContracts().filter((c) => c.status === 'active');
  const ents = entomologists();
  const [contractId, setContractId] = useState(() => preset.contract?.id || (preset.random ? randomAuditPick()?.contract.id : '') || '');
  const [random, setRandom] = useState(Boolean(preset.random && contractId));
  const [entUid, setEntUid] = useState(ents.length === 1 ? ents[0].uid : '');
  const [date, setDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [surprise, setSurprise] = useState(true);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const contract = contracts.find((c) => c.id === contractId);

  const reroll = () => {
    const pick = randomAuditPick();
    if (!pick) return warning('Nothing due', 'No active contract is due for an audit.');
    setContractId(pick.contract.id);
    setRandom(true);
  };

  const save = async () => {
    if (!contract) return error('Choose the site', 'Pick a contract or use Random pick.');
    setBusy(true);
    try {
      const a = await scheduleAudit({ contract, entomologistUid: entUid, scheduledDate: date, surprise, random, instructions }, actor);
      success('Audit scheduled', `${a.auditNumber} at ${a.siteName} on ${formatDate(a.scheduledDate)}${surprise ? ' (surprise: hidden from the field team)' : ''}.`);
      onDone(a.id);
    } catch (err) {
      error('Could not schedule', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Schedule quality audit" subtitle="The entomologist audits the site and the last service, then submits a report for your verification." maxWidth="560px"
      footer={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !contract || !entUid}>{busy ? 'Scheduling…' : 'Schedule audit'}</button></>}>
      <div className="form-group">
        <label className="form-label">Site (active contract) *</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <select className="form-select" value={contractId} onChange={(e) => { setContractId(e.target.value); setRandom(false); }}>
            <option value="">Choose…</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.customerName}{c.branchName ? ` · ${c.branchName}` : ''} ({c.id})</option>)}
          </select>
          <button type="button" className="btn btn-secondary" onClick={reroll} title="Pick at random among the sites most due for an audit"><Shuffle size={14} /> Random pick</button>
        </div>
        {random && contract && <div className="cell-sub" style={{ marginTop: 4 }}>Picked at random among the sites most due for an audit.</div>}
      </div>
      <div className="form-group">
        <label className="form-label">Entomologist *</label>
        <select className="form-select" value={entUid} onChange={(e) => setEntUid(e.target.value)}>
          <option value="">{ents.length ? 'Choose…' : 'Nobody is marked as an entomologist: tick "Entomologist" on a staff member in Team & Access'}</option>
          {ents.map((u) => <option key={u.uid} value={u.uid}>{u.displayName || u.email}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div className="form-group"><label className="form-label">Audit date *</label>
          <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <label className="doc-check" style={{ alignSelf: 'center' }}>
          <input type="checkbox" checked={surprise} onChange={(e) => setSurprise(e.target.checked)} />
          <span>Surprise audit<span className="cell-sub" style={{ display: 'block' }}>Hidden from the Supervisor and field team</span></span>
        </label>
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Instructions for the entomologist</label>
        <textarea className="form-textarea" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Check the kitchen bait stations after last month's complaint" /></div>
    </Modal>
  );
};

const blankReport = (a: QualityAudit): AuditReport => a.report ?? {
  visitedAt: a.scheduledDate,
  pestActivity: [],
  checks: DEFAULT_AUDIT_CHECKS.map((item) => ({ item })),
  findings: [],
  score: 0,
  summary: '',
  photos: [],
};

const AuditModal: React.FC<{ audit: QualityAudit; onClose: () => void }> = ({ audit: a, onClose }) => {
  const { userProfile, effectiveRole } = useAuth();
  const actor = useActor();
  const { success, error, warning } = useNotification();
  const pdf = usePdfAction();
  const isSA = baseRoleOf(effectiveRole) === 'super_admin';
  const isMine = a.entomologistUid === userProfile?.uid;
  const canFill = isMine && ['scheduled', 'returned'].includes(a.status);
  const [r, setR] = useState<AuditReport>(() => blankReport(a));
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'view' | 'return' | 'followup' | 'send'>('view');
  const [followDate, setFollowDate] = useState(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<AuditReport>) => setR((cur) => ({ ...cur, ...patch }));
  const problems = useMemo(() => reportProblems(r), [r]);

  const run = async (label: string, fn: () => Promise<void> | void) => {
    setBusy(true);
    try { await fn(); } catch (err) { error(label, err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const owner = a.branchId ? { kind: 'branch' as const, id: a.branchId } : { kind: a.customerType === 'company' ? 'company' as const : 'client' as const, id: a.customerId };
      const added: AuditReport['photos'] = [];
      for (const f of Array.from(files)) {
        const stored = await uploadFile(f, { scope: dataService.uploadScopeFor(owner, 'service_report'), subPath: `${a.id}/audit`, fileName: f.name });
        added.push({ url: stored.url, caption: f.name.replace(/\.[^.]+$/, '') });
      }
      setR((cur) => ({ ...cur, photos: [...cur.photos, ...added] }));
    } catch (err) {
      error('Photo upload failed', err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const ro = !canFill;
  return (
    <Modal isOpen onClose={() => !busy && onClose()} title={`Audit ${a.auditNumber} — ${a.siteName}`}
      subtitle={`${a.customerName} · ${formatDate(a.scheduledDate)} · ${a.entomologistName} · ${AUDIT_STATUS_LABELS[a.status]}${a.surprise ? ' · surprise' : ''}`}
      maxWidth="960px"
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', width: '100%', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
          {isSA && a.report && (
            <button className="btn btn-ghost" disabled={pdf.busy === a.id} onClick={() => pdf.run(a.id, () => pdfGenerator.generateAuditReportPDF(a))}><Download size={14} /> PDF</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {canFill && (
              <>
                <button className="btn btn-secondary" disabled={busy} onClick={() => run('Could not save', () => { saveReport(a, r, false, actor); success('Draft saved', a.auditNumber); })}>Save draft</button>
                <button className="btn btn-primary" disabled={busy || problems.length > 0} title={problems.join('\n')}
                  onClick={() => run('Could not submit', () => { saveReport(a, r, true, actor); success('Report submitted', 'The super admin will verify it.'); onClose(); })}>
                  <Send size={14} /> Submit report
                </button>
              </>
            )}
            {isSA && a.status === 'submitted' && (
              <>
                <button className="btn btn-danger" disabled={busy} onClick={() => { setMode('return'); setNote(''); }}><RotateCcw size={14} /> Return</button>
                <button className="btn btn-primary" style={{ backgroundColor: 'var(--ikpm-emerald-600)' }} disabled={busy}
                  onClick={() => run('Could not verify', async () => {
                    const v = await verifyAudit(a, note, actor);
                    if (v.savedAt) success('Report verified', 'Saved to the client\'s Service Reports folder. You can now send it to the client.');
                    else warning('Report verified', 'It could not be filed yet (file storage). Use "Save to client folder".');
                  })}>
                  <CheckCircle2 size={14} /> Verify
                </button>
              </>
            )}
            {isSA && a.status === 'verified' && (
              <>
                {!a.followUpJobId && <button className="btn btn-secondary" disabled={busy} onClick={() => setMode('followup')}>Free corrective visit</button>}
                <button className="btn btn-secondary" disabled={busy} onClick={() => run('Could not save', async () => { await saveAuditToFolder(a, actor); success('Saved', 'Filed in the client\'s Service Reports folder.'); })}>
                  <FolderUp size={14} /> {a.savedAt ? 'Saved ✓' : 'Save to client folder'}
                </button>
                <button className="btn btn-primary" disabled={busy} onClick={() => setMode('send')}><Send size={14} /> {a.sentAt ? 'Resend to client' : 'Send to client'}</button>
              </>
            )}
          </div>
        </div>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', fontSize: '0.85rem' }}>
        <div className="cell-sub">
          {a.siteAddress} {a.contractId ? `· contract ${a.contractId}` : ''} {a.lastJobDate ? `· last service ${formatDate(a.lastJobDate)}${a.lastTeamLeaderName ? ` by ${a.lastTeamLeaderName}` : ''}` : ''}
        </div>
        {a.instructions && <div className="info-hint"><strong>Instructions:</strong> {a.instructions}</div>}
        {a.status === 'returned' && a.returnNote && <div className="error-hint"><strong>Returned:</strong> {a.returnNote}</div>}
        {a.verifiedBy && <div className="cell-sub">Verified by {a.verifiedBy} on {formatDate(a.verifiedAt!)}{a.verifierNote ? ` · ${a.verifierNote}` : ''}{a.sentAt ? ` · sent to ${a.sentTo} on ${formatDate(a.sentAt)}` : ''}{a.followUpJobId ? ` · corrective visit ${a.followUpJobId}` : ''}</div>}

        {!a.report && !canFill ? (
          <div className="empty-hint">The entomologist has not filled in the report yet.</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Visit date</label>
                <input type="date" className="form-input" disabled={ro} value={r.visitedAt} onChange={(e) => set({ visitedAt: e.target.value })} /></div>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Score for the service team (1 poor – 5 excellent)</label>
                <select className="form-select" disabled={ro} value={r.score || ''} onChange={(e) => set({ score: Number(e.target.value) })}>
                  <option value="">Choose…</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select></div>
            </div>

            <div className="section-title">Pest activity found</div>
            {r.pestActivity.map((p, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 1.4fr 32px', gap: '0.4rem', marginBottom: '0.3rem' }}>
                <input className="form-input" disabled={ro} placeholder="Area (e.g. Kitchen)" value={p.area} onChange={(e) => set({ pestActivity: r.pestActivity.map((x, j) => (j === i ? { ...x, area: e.target.value } : x)) })} />
                <input className="form-input" disabled={ro} placeholder="Pest" value={p.pest} onChange={(e) => set({ pestActivity: r.pestActivity.map((x, j) => (j === i ? { ...x, pest: e.target.value } : x)) })} />
                <select className="form-select" disabled={ro} value={p.level} onChange={(e) => set({ pestActivity: r.pestActivity.map((x, j) => (j === i ? { ...x, level: e.target.value as typeof p.level } : x)) })}>
                  <option value="none">None</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option>
                </select>
                <input className="form-input" disabled={ro} placeholder="Notes" value={p.notes || ''} onChange={(e) => set({ pestActivity: r.pestActivity.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)) })} />
                {!ro && <button type="button" className="icon-btn" onClick={() => set({ pestActivity: r.pestActivity.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>}
              </div>
            ))}
            {!ro && <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => set({ pestActivity: [...r.pestActivity, { area: '', pest: '', level: 'low' }] })}><Plus size={13} /> Add area</button>}

            <div className="section-title">Service quality checks</div>
            {r.checks.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 150px 1fr', gap: '0.4rem', alignItems: 'center', marginBottom: '0.3rem' }}>
                <span>{c.item}</span>
                <select className="form-select" disabled={ro} value={c.ok === undefined ? '' : c.ok ? 'ok' : 'no'}
                  onChange={(e) => set({ checks: r.checks.map((x, j) => (j === i ? { ...x, ok: e.target.value === '' ? undefined : e.target.value === 'ok' } : x)) })}>
                  <option value="">—</option><option value="ok">OK</option><option value="no">Not OK</option>
                </select>
                <input className="form-input" disabled={ro} placeholder="Notes" value={c.notes || ''} onChange={(e) => set({ checks: r.checks.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)) })} />
              </div>
            ))}

            <div className="section-title">Findings & recommendations</div>
            {r.findings.map((f, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 1.4fr 32px', gap: '0.4rem', marginBottom: '0.3rem' }}>
                <input className="form-input" disabled={ro} placeholder="Observation" value={f.observation} onChange={(e) => set({ findings: r.findings.map((x, j) => (j === i ? { ...x, observation: e.target.value } : x)) })} />
                <select className="form-select" disabled={ro} value={f.risk} onChange={(e) => set({ findings: r.findings.map((x, j) => (j === i ? { ...x, risk: e.target.value as typeof f.risk } : x)) })}>
                  <option value="low">Low risk</option><option value="medium">Medium</option><option value="high">High</option>
                </select>
                <input className="form-input" disabled={ro} placeholder="Recommendation" value={f.recommendation} onChange={(e) => set({ findings: r.findings.map((x, j) => (j === i ? { ...x, recommendation: e.target.value } : x)) })} />
                {!ro && <button type="button" className="icon-btn" onClick={() => set({ findings: r.findings.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>}
              </div>
            ))}
            {!ro && <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => set({ findings: [...r.findings, { observation: '', risk: 'medium', recommendation: '' }] })}><Plus size={13} /> Add finding</button>}

            <div className="form-group"><label className="form-label">Summary</label>
              <textarea className="form-textarea" rows={3} disabled={ro} value={r.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="Overall condition of the site and of the service" /></div>

            <div className="section-title">Photos</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {r.photos.map((p, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.caption} style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6 }} /></a>
                  {!ro && <button type="button" className="icon-btn" style={{ position: 'absolute', top: 0, right: 0 }} onClick={() => set({ photos: r.photos.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>}
                </div>
              ))}
              {!ro && (integrations.cloudinary
                ? <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer' }}>{uploading ? 'Uploading…' : 'Add photos'}<input type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} /></label>
                : <span className="cell-sub">Photos need file storage (Cloudinary).</span>)}
            </div>
            {canFill && problems.length > 0 && <div className="cell-sub" style={{ color: '#B45309' }}>To submit: {problems.join(' ')}</div>}
          </>
        )}

        {isSA && a.status === 'submitted' && mode !== 'return' && (
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Verification note (optional, printed on the report)</label>
            <input className="form-input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        )}
        {mode === 'return' && (
          <div style={{ padding: '0.75rem', background: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
            <label className="form-label">What should the entomologist correct? *</label>
            <textarea className="form-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
              <button className="btn btn-sm btn-danger" disabled={!note.trim() || busy} onClick={() => run('Could not return', () => { returnAudit(a, note, actor); warning('Returned to the entomologist', note); setMode('view'); })}>Return report</button>
              <button className="btn btn-sm btn-secondary" onClick={() => setMode('view')}>Back</button>
            </div>
          </div>
        )}
        {mode === 'followup' && (
          <div style={{ padding: '0.75rem', background: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)', display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Corrective visit date (free of charge)</label>
              <input type="date" className="form-input" value={followDate} onChange={(e) => setFollowDate(e.target.value)} /></div>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run('Could not create the visit', async () => {
              const up = await createAuditFollowUp(a, followDate, actor);
              success('Free corrective visit created', `${up.followUpJobId}: assign a Supervisor on the Jobs page. It is never invoiced.`);
              setMode('view');
            })}>Create visit</button>
            <button className="btn btn-sm btn-secondary" onClick={() => setMode('view')}>Back</button>
          </div>
        )}
        {mode === 'send' && <AuditSend audit={a} actor={actor} onDone={() => setMode('view')} />}
      </div>
    </Modal>
  );
};

const CHANNELS: InvoiceSendChannel[] = ['email_auto', 'whatsapp', 'email_gmail', 'email_outlook'];

const AuditSend: React.FC<{ audit: QualityAudit; actor: AuditActor; onDone: () => void }> = ({ audit, actor, onDone }) => {
  const { success, error } = useNotification();
  const rec = auditRecipient(audit);
  const draft = auditMessage(audit, rec.name, actor);
  const [channel, setChannel] = useState<InvoiceSendChannel>(CHANNELS.find((c) => !channelBlocker(c)) ?? 'whatsapp');
  const [name, setName] = useState(rec.name);
  const [email, setEmail] = useState(rec.email || '');
  const [phone, setPhone] = useState(rec.phone || '');
  const [message, setMessage] = useState(draft.message);
  const [busy, setBusy] = useState(false);
  const isWA = channel === 'whatsapp';
  const send = async () => {
    const linkWindow = isWA ? window.open('', '_blank') : null;
    const emailWindow = channel === 'email_gmail' || channel === 'email_outlook' ? window.open('', '_blank') : null;
    setBusy(true);
    try {
      await sendAuditToClient(audit, actor, { channel, name, email, phone, subject: draft.subject, message, linkWindow, emailWindow });
      success(channel === 'email_auto' ? 'Report emailed' : 'Message ready', channel === 'email_auto' ? `Sent to ${email}.` : 'Press Send in the window that opened.');
      onDone();
    } catch (err) {
      linkWindow?.close(); emailWindow?.close();
      error('Could not send', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ padding: '0.75rem', background: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
      <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}><ClipboardCheck size={14} /> Send the report to the client</div>
      {CHANNELS.map((c) => {
        const why = channelBlocker(c);
        return (
          <label key={c} className="doc-check" style={{ opacity: why ? 0.55 : 1 }} title={why}>
            <input type="radio" checked={channel === c} disabled={Boolean(why)} onChange={() => setChannel(c)} />
            <span>{SEND_CHANNEL_LABELS[c].replace('invoice', 'report')}</span>
          </label>
        );
      })}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.4rem' }}>
        <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Client contact" />
        {isWA ? <input className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="WhatsApp number" />
          : <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />}
      </div>
      <textarea className="form-textarea" rows={5} style={{ marginTop: '0.4rem' }} value={message} onChange={(e) => setMessage(e.target.value)} />
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
        <button className="btn btn-sm btn-primary" disabled={busy || Boolean(channelBlocker(channel))} onClick={send}><Send size={13} /> {busy ? 'Sending…' : 'Send'}</button>
        <button className="btn btn-sm btn-secondary" onClick={onDone}>Back</button>
      </div>
    </div>
  );
};
