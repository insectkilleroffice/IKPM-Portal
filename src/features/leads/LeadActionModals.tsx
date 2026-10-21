import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { CHANNELS, contactsOf, INSPECTION_PHOTO_TYPES, OUTCOMES } from '../../lib/leadWorkflow';
import { roleLabel } from '../../lib/permissions';
import type { ActivityChannel, ContactOutcome, InspectionAssessment, Lead, PestType, RiskFinding } from '../../types/crm';
import type { SitePhoto } from '../../types/operations';
import { PhotoCapture } from '../field/PhotoCapture';
import { SinglePhotoField } from '../field/SinglePhotoField';
import { FINDING_SUGGESTIONS, findingFilled, findingsSummary, newFinding, recommendedTreatmentOf } from '../../lib/riskAssessment';
import { fileInspectionReport } from './inspectionFiles';

const today = () => new Date().toISOString().slice(0, 10);

const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Log a contact attempt
// ---------------------------------------------------------------------------
export const LogContactModal: React.FC<{ lead: Lead | null; onClose: () => void; onDone?: (lead: Lead) => void }> = ({ lead, onClose, onDone }) => {
  const store = useDataStore();
  const { userProfile } = useAuth();
  const { success, warning, error } = useNotification();
  const [channel, setChannel] = useState<ActivityChannel>('call');
  const [outcome, setOutcome] = useState<ContactOutcome>('no_response');
  const [contactId, setContactId] = useState('');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState(addDays(2));
  const [lostReason, setLostReason] = useState('');

  useEffect(() => {
    if (!lead) return;
    setChannel('call');
    setOutcome('no_response');
    setContactId(contactsOf(lead).find((c) => c.isPrimary)?.id || contactsOf(lead)[0]?.id || '');
    setNote('');
    setFollowUp(addDays(2));
    setLostReason('');
  }, [lead]);

  if (!lead) return null;
  const contacts = contactsOf(lead);
  const closing = outcome === 'not_interested' || outcome === 'wrong_contact';
  const needsFollowUp = outcome === 'callback' || outcome === 'no_response';

  const save = () => {
    let updated: Lead | undefined;
    try {
      updated = store.logLeadContact(
        lead.id,
        { channel, outcome, note: note.trim() || undefined, contactId: contactId || undefined, nextFollowUp: needsFollowUp ? followUp : undefined, lostReason: closing ? lostReason.trim() || undefined : undefined },
        userProfile?.email
      );
    } catch (err) {
      return error('Could not log contact', err instanceof Error ? err.message : String(err));
    }
    if (!updated) return;
    if (outcome === 'engaged') success('Engaged', `${lead.title} is interested. Next: schedule the inspection.`);
    else if (closing) warning('Moved to Lost', `${lead.title} was marked as ${outcome === 'not_interested' ? 'not interested' : 'unreachable'}.`);
    else success('Contact logged', needsFollowUp ? `Follow up on ${new Date(followUp).toLocaleDateString('en-GB')}.` : lead.title);
    onDone?.(updated);
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Log contact: ${lead.title}`}
      subtitle="Record what happened. The lead moves to the right list automatically."
      maxWidth="620px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className={`btn ${closing ? 'btn-danger' : 'btn-primary'}`} onClick={save}>
            {outcome === 'engaged' ? 'Save & mark engaged' : closing ? 'Save & move to Lost' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">How</label>
          <select className="form-select" value={channel} onChange={(e) => setChannel(e.target.value as ActivityChannel)}>
            {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Who</label>
          <select className="form-select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.designation ? ` (${c.designation})` : ''} · {c.phone}</option>)}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Outcome</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.5rem' }}>
          {OUTCOMES.map((o) => (
            <label key={o.value} className="doc-check" style={{ border: `1px solid ${outcome === o.value ? 'var(--ikpm-emerald-600)' : 'var(--border-subtle)'}`, background: outcome === o.value ? 'var(--ikpm-emerald-50)' : undefined }}>
              <input type="radio" name="outcome" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
              <span className={`badge-status badge-${o.tone}`}>{o.label}</span>
            </label>
          ))}
        </div>
      </div>

      {needsFollowUp && (
        <div className="form-group">
          <label className="form-label">Next follow-up</label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="date" className="form-input" style={{ width: 180 }} value={followUp} min={today()} onChange={(e) => setFollowUp(e.target.value)} />
            {[1, 2, 7].map((d) => (
              <button key={d} type="button" className={`chip ${followUp === addDays(d) ? 'chip-on' : ''}`} onClick={() => setFollowUp(addDays(d))}>
                {d === 1 ? 'Tomorrow' : d === 7 ? 'Next week' : `In ${d} days`}
              </button>
            ))}
          </div>
        </div>
      )}

      {closing && (
        <div className="form-group">
          <label className="form-label">Reason</label>
          <input className="form-input" value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="e.g. Already has a contractor, budget, number not in use" />
        </div>
      )}

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Notes</label>
        <textarea className="form-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did they say? Pests, site size, decision maker, timing…" />
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Schedule inspection & assign team
// ---------------------------------------------------------------------------
export const ScheduleInspectionModal: React.FC<{ lead: Lead | null; onClose: () => void; onDone?: (lead: Lead) => void }> = ({ lead, onClose, onDone }) => {
  const store = useDataStore();
  const { userProfile } = useAuth();
  const { success, warning, error } = useNotification();
  const [date, setDate] = useState(addDays(1));
  const [timeSlot, setTimeSlot] = useState<'morning' | 'afternoon' | 'evening'>('morning');
  const [teamId, setTeamId] = useState('');
  const [inspectorIds, setInspectorIds] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    if (!lead) return;
    const i = lead.inspection;
    setDate(i?.scheduledDate || addDays(1));
    setTimeSlot(i?.timeSlot || 'morning');
    setTeamId(i?.teamId || '');
    setInspectorIds(i?.inspectorIds || []);
    setInstructions(i?.instructions || '');
  }, [lead]);

  if (!lead) return null;
  const teams = store.getTeams();
  // Anyone active who can be sent to a site: field, operations and sales staff
  const staff = store.getStaff().filter((u) => u.role !== 'auditor');
  const teamMembers = staff.filter((u) => u.teamId === teamId);
  const others = staff.filter((u) => u.teamId !== teamId);

  const pickTeam = (id: string) => {
    setTeamId(id);
    // Pre-select the whole team; people can untick
    if (id) setInspectorIds(staff.filter((u) => u.teamId === id).map((u) => u.uid));
  };
  const toggle = (uid: string) => setInspectorIds((ids) => (ids.includes(uid) ? ids.filter((x) => x !== uid) : [...ids, uid]));

  const save = () => {
    if (!inspectorIds.length && !teamId) {
      warning('Assign someone', 'Choose a team or at least one inspector.');
      return;
    }
    let updated: Lead | undefined;
    try {
      updated = store.scheduleLeadInspection(lead.id, { date, timeSlot, teamId: teamId || undefined, inspectorIds, instructions: instructions.trim() || undefined }, userProfile?.email);
    } catch (err) {
      return error('Could not schedule inspection', err instanceof Error ? err.message : String(err));
    }
    if (updated) {
      success('Inspection scheduled', `${new Date(date).toLocaleDateString('en-GB')} (${timeSlot}). It now appears in Site Inspections for the assigned people.`);
      onDone?.(updated);
    }
    onClose();
  };

  const PersonRow = ({ uid }: { uid: string }) => {
    const u = staff.find((s) => s.uid === uid)!;
    return (
      <label className="doc-check">
        <input type="checkbox" checked={inspectorIds.includes(uid)} onChange={() => toggle(uid)} />
        <span style={{ flex: 1 }}>{u.displayName}{u.designationTitle ? <span className="cell-sub"> · {u.designationTitle}</span> : null}</span>
        <span className="role-pill">{roleLabel(u.role)}</span>
      </label>
    );
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${lead.inspection?.status === 'scheduled' ? 'Reschedule' : 'Schedule'} inspection: ${lead.title}`}
      subtitle={`${lead.propertyAddress || lead.area || ''}${lead.city ? `, ${lead.city}` : ''}`}
      maxWidth="680px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Schedule & assign</button>
        </>
      }
    >
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Date</label>
          <input type="date" className="form-input" value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Time</label>
          <div className="chip-row" style={{ marginBottom: 0 }}>
            {(['morning', 'afternoon', 'evening'] as const).map((t) => (
              <button key={t} type="button" className={`chip ${timeSlot === t ? 'chip-on' : ''}`} onClick={() => setTimeSlot(t)}>
                {timeSlot === t && <Check size={14} />} {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Team</label>
        <select className="form-select" value={teamId} onChange={(e) => pickTeam(e.target.value)}>
          <option value="">No team (pick people below)</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {teams.length === 0 && <div className="form-hint">No teams yet. Create them under Team & Access.</div>}
      </div>

      <div className="form-group">
        <label className="form-label">Inspectors ({inspectorIds.length})</label>
        <div className="doc-check-list" style={{ maxHeight: 220 }}>
          {teamMembers.length > 0 && <div className="doc-group-label">Team members</div>}
          {teamMembers.map((u) => <PersonRow key={u.uid} uid={u.uid} />)}
          {others.length > 0 && <div className="doc-group-label">{teamMembers.length ? 'Other staff' : 'Staff'}</div>}
          {others.map((u) => <PersonRow key={u.uid} uid={u.uid} />)}
          {staff.length === 0 && <div className="cell-sub" style={{ padding: '0.5rem' }}>No staff yet. Add people under Team & Access.</div>}
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Instructions for the inspector</label>
        <textarea className="form-textarea" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Who to meet on site, areas to check, gate pass, etc." />
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Record inspection findings (inspector or office, manually)
// ---------------------------------------------------------------------------
export const PEST_OPTIONS: { value: PestType; label: string }[] = [
  { value: 'cockroaches', label: 'Cockroaches' },
  { value: 'rodents_rats', label: 'Rodents / rats' },
  { value: 'termites', label: 'Termites' },
  { value: 'bedbugs', label: 'Bed bugs' },
  { value: 'mosquitoes_flies', label: 'Mosquitoes / flies' },
  { value: 'ants', label: 'Ants' },
  { value: 'stored_grain_pests', label: 'Stored grain pests' },
  { value: 'snake_reptile', label: 'Snakes / reptiles' },
  { value: 'general_fumigation', label: 'General fumigation' },
  { value: 'other', label: 'Other' },
];

export const InspectionFindingsModal: React.FC<{ lead: Lead | null; onClose: () => void; onDone?: (lead: Lead) => void }> = ({ lead, onClose, onDone }) => {
  const store = useDataStore();
  const { userProfile } = useAuth();
  const { success, warning, error } = useNotification();
  const [pests, setPests] = useState<PestType[]>([]);
  const [photos, setPhotos] = useState<SitePhoto[]>([]);
  const [severity, setSeverity] = useState<InspectionAssessment['infestationSeverity']>('moderate');
  const [area, setArea] = useState('');
  const [summary, setSummary] = useState('');
  const [treatment, setTreatment] = useState('');
  const [rows, setRows] = useState<RiskFinding[]>([]);
  const [reportTitle, setReportTitle] = useState('');
  const [siteName, setSiteName] = useState('');
  const [observedBy, setObservedBy] = useState('');
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!lead) return;
    const i = lead.inspection;
    const site = i?.siteName || [lead.area, lead.city].filter(Boolean).join(', ');
    setPests(i?.pestTypesFound?.length ? i.pestTypesFound : lead.pestIssues || []);
    setSeverity(i?.infestationSeverity || 'moderate');
    setArea(i?.areaSqFt ? String(i.areaSqFt) : '');
    // Older inspections only have the free-text summary; it stays visible and editable
    setSummary(i?.findings?.length ? '' : i?.criticalFindings || '');
    setTreatment(i?.recommendedTreatment || '');
    setPhotos(i?.photos ?? []);
    setRows(i?.findings?.length ? i.findings : [newFinding()]);
    setReportTitle(i?.reportTitle || `Risk Assessment Report - ${lead.companyName || lead.title}${lead.area ? ` ${lead.area}` : ''}`);
    setSiteName(site);
    setObservedBy(i?.observedBy || '');
    setShowMore(Boolean(i?.photos?.length || (!i?.findings?.length && i?.criticalFindings)));
  }, [lead]);

  if (!lead) return null;
  const filled = rows.filter(findingFilled);
  const problems: string[] = [];
  if (!pests.length) problems.push('Select at least one pest found.');
  if (!filled.length && !summary.trim()) problems.push('Add at least one finding (observation and recommendation).');
  if (rows.some((r) => findingFilled(r) && (!r.observation.trim() || !r.recommendation.trim()))) problems.push('Each finding needs an observation and a recommendation.');

  const scope = { ownerScope: 'client' as const, clientId: lead.existingCustomerId || lead.id, category: 'risk_assessment' as const };
  const offlineCount = rows.filter((r) => r.photo?.imageUrl.startsWith('data:')).length + photos.filter((p) => p.imageUrl.startsWith('data:')).length;
  const setRow = (id: string, patch: Partial<RiskFinding>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const notify = (kind: 'success' | 'warning' | 'error', title: string, message: string) => (kind === 'error' ? error(title, message) : kind === 'warning' ? warning(title, message) : success(title, message));

  const save = () => {
    if (problems.length) return;
    const findings = rows.filter(findingFilled).map((r) => ({ ...r, observation: r.observation.trim(), risk: r.risk.trim(), recommendation: r.recommendation.trim(), location: r.location?.trim() || undefined }));
    let updated: Lead | undefined;
    try {
      updated = store.recordInspectionFindings(
        lead.id,
        {
          pestTypesFound: pests,
          infestationSeverity: severity,
          areaSqFt: Number(area) || 0,
          // Kept for older screens and reports that read the summary text
          criticalFindings: [summary.trim(), findingsSummary(findings)].filter(Boolean).join('\n'),
          recommendedTreatment: treatment.trim() || recommendedTreatmentOf({ findings }),
          photos,
          findings,
          reportTitle: reportTitle.trim() || undefined,
          siteName: siteName.trim() || undefined,
          observedBy: observedBy.trim() || undefined,
        },
        userProfile?.email
      );
    } catch (err) {
      return error('Could not save findings', err instanceof Error ? err.message : String(err));
    }
    if (updated) {
      success('Findings saved', `${lead.title} is ready for a proposal. The risk assessment report is being filed.`);
      onDone?.(updated);
      fileInspectionReport(updated, { email: userProfile?.email, displayName: userProfile?.displayName })
        .then((doc) => !doc && warning('Report not filed', 'File storage is not configured or you are offline. Download the report from the lead instead.'))
        .catch((err) => warning('Report not filed', err instanceof Error ? err.message : String(err)));
    }
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Risk assessment: ${lead.title}`}
      subtitle={lead.inspection?.scheduledDate ? `Visit on ${new Date(lead.inspection.scheduledDate).toLocaleDateString('en-GB')}${lead.inspection.inspectorName ? ` · ${lead.inspection.inspectorName}` : ''}` : 'Enter the findings manually'}
      maxWidth="900px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={problems.length > 0} title={problems.join('\n')}>Save findings</button>
        </>
      }
    >
      {lead.inspection?.instructions && <div className="info-hint" style={{ marginBottom: '1rem' }}><strong>Instructions:</strong> {lead.inspection.instructions}</div>}

      <div className="form-grid-3">
        <div className="form-group" style={{ gridColumn: 'span 2' }}>
          <label className="form-label">Report title</label>
          <input className="form-input" value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Branch / site</label>
          <input className="form-input" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="e.g. Johar" />
        </div>
        <div className="form-group">
          <label className="form-label">Prepared by</label>
          <input className="form-input" value={userProfile?.displayName || ''} disabled />
        </div>
        <div className="form-group">
          <label className="form-label">Observed by</label>
          <input className="form-input" value={observedBy} onChange={(e) => setObservedBy(e.target.value)} placeholder="Inspector / client representative" />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Pests found <span className="required">*</span></label>
        <div className="chip-row" style={{ marginBottom: 0 }}>
          {PEST_OPTIONS.map((p) => {
            const on = pests.includes(p.value);
            return (
              <button key={p.value} type="button" className={`chip ${on ? 'chip-on' : ''}`} onClick={() => setPests(on ? pests.filter((x) => x !== p.value) : [...pests, p.value])}>
                {on && <Check size={14} />} {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Infestation level</label>
          <select className="form-select" value={severity} onChange={(e) => setSeverity(e.target.value as InspectionAssessment['infestationSeverity'])}>
            <option value="low">Low</option>
            <option value="moderate">Moderate</option>
            <option value="high">High</option>
            <option value="severe">Severe</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Covered area (sq ft)</label>
          <input className="form-input" inputMode="numeric" value={area} onChange={(e) => setArea(e.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 4500" />
        </div>
      </div>

      <div className="section-title">Findings</div>
      <div className="finding-list">
        {rows.map((r, i) => (
          <div key={r.id} className="finding-row">
            <div className="finding-photo">
              <SinglePhotoField
                photo={r.photo}
                onChange={(photo) => setRow(r.id, { photo })}
                scope={scope}
                subPath={`${lead.id}/risk-assessment`}
                fileNamePrefix={`${lead.id}_finding_${i + 1}`}
                caption={r.location || `Finding ${i + 1}`}
                offlineCount={offlineCount}
                onNotify={notify}
              />
            </div>
            <div className="finding-fields">
              <div className="finding-head">
                <strong>{i + 1}.</strong>
                <input className="form-input" value={r.location ?? ''} onChange={(e) => setRow(r.id, { location: e.target.value })} placeholder="Location (e.g. Kitchen back door)" aria-label="Location" />
                <button type="button" className="icon-btn" onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((x) => x.id !== r.id) : [newFinding()]))} aria-label="Remove finding"><Trash2 size={15} /></button>
              </div>
              <div className="chip-row" style={{ margin: '0.35rem 0' }}>
                {FINDING_SUGGESTIONS.map((sug) => (
                  <button key={sug.label} type="button" className="chip chip-sm" onClick={() => setRow(r.id, { observation: sug.observation, risk: sug.risk, recommendation: sug.recommendation })}>
                    {sug.label}
                  </button>
                ))}
              </div>
              <textarea className="form-textarea" rows={2} value={r.observation} onChange={(e) => setRow(r.id, { observation: e.target.value })} placeholder="Observation" aria-label="Observation" />
              <textarea className="form-textarea" rows={2} value={r.risk} onChange={(e) => setRow(r.id, { risk: e.target.value })} placeholder="Risk" aria-label="Risk" />
              <textarea className="form-textarea" rows={2} value={r.recommendation} onChange={(e) => setRow(r.id, { recommendation: e.target.value })} placeholder="Recommendation" aria-label="Recommendation" />
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setRows((prev) => [...prev, newFinding()])}>
        <Plus size={14} /> Add finding
      </button>

      <div className="form-group" style={{ marginTop: '1rem' }}>
        <label className="form-label">Recommended treatment (for the proposal)</label>
        <textarea className="form-textarea" rows={2} value={treatment} onChange={(e) => setTreatment(e.target.value)} placeholder="Leave empty to use the findings' recommendations" />
      </div>

      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowMore((v) => !v)}>
        {showMore ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Summary notes and general site photos
      </button>
      {showMore && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="form-group">
            <label className="form-label">Summary notes</label>
            <textarea className="form-textarea" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Anything not covered by the findings above" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">General site photos</label>
            <PhotoCapture<SitePhoto>
              scope={{ ...scope, category: 'inspection_report' }}
              subPath={`${lead.id}/inspection`}
              idPrefix={lead.inspection?.id || lead.id}
              categories={INSPECTION_PHOTO_TYPES}
              photos={photos}
              onChange={setPhotos}
              onNotify={notify}
              emptyText="Optional. Finding photos are taken in each row above."
            />
          </div>
        </div>
      )}

      {problems.length > 0 && <ul className="form-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </Modal>
  );
};
