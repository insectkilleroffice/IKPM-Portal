import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { blankLeadBranch, CHANNELS, contactsOf, INSPECTION_PHOTO_TYPES, OUTCOMES, STUCK_AT_REASONS } from '../../lib/leadWorkflow';
import { roleLabel } from '../../lib/permissions';
import type { ActivityChannel, ContactOutcome, InspectionAssessment, Lead, LeadBranch, PestType, RiskFinding, StuckAtReason } from '../../types/crm';
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
  const [stuckAt, setStuckAt] = useState<string>('');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState(addDays(2));
  const [lostReason, setLostReason] = useState('');

  useEffect(() => {
    if (!lead) return;
    setChannel('call');
    setOutcome('no_response');
    setContactId(contactsOf(lead).find((c) => c.isPrimary)?.id || contactsOf(lead)[0]?.id || '');
    setStuckAt(lead.stuckAt || '');
    setNote('');
    setFollowUp(addDays(2));
    setLostReason('');
  }, [lead]);

  if (!lead) return null;
  const contacts = contactsOf(lead);
  const closing = outcome === 'not_interested' || outcome === 'wrong_contact';
  const needsFollowUp = outcome === 'callback' || outcome === 'no_response' || outcome === 'interested';

  const save = () => {
    let updated: Lead | undefined;
    try {
      updated = store.logLeadContact(
        lead.id,
        { channel, outcome, note: note.trim() || undefined, contactId: contactId || undefined, nextFollowUp: needsFollowUp ? followUp : undefined, lostReason: closing ? lostReason.trim() || undefined : undefined },
        userProfile?.email
      );
      if (stuckAt !== (lead.stuckAt || '')) {
        updated = store.setLeadStuckAt(lead.id, (stuckAt as StuckAtReason) || undefined, userProfile?.email) ?? updated;
      }
    } catch (err) {
      return error('Could not log contact', err instanceof Error ? err.message : String(err));
    }
    if (!updated) return;
    if (outcome === 'engaged') success('Engaged', `${lead.title} is engaged. Next: schedule the meeting / inspection.`);
    else if (outcome === 'interested') success('Interested', `${lead.title} is interested. Follow-up scheduled.`);
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
            {outcome === 'engaged'
              ? 'Save & mark engaged'
              : outcome === 'interested'
                ? 'Save & mark interested'
                : closing
                  ? 'Save & move to Lost'
                  : 'Save'}
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

      <div className="form-group">
        <label className="form-label">Stuck at status</label>
        <select className="form-select" value={stuckAt} onChange={(e) => setStuckAt(e.target.value)}>
          <option value="">Not stuck / in motion</option>
          {STUCK_AT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
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
// Schedule meeting / inspection & assign team leader
// ---------------------------------------------------------------------------
export const ScheduleInspectionModal: React.FC<{ lead: Lead | null; onClose: () => void; onDone?: (lead: Lead) => void }> = ({ lead, onClose, onDone }) => {
  const store = useDataStore();
  const { userProfile } = useAuth();
  const { success, warning, error } = useNotification();
  const [date, setDate] = useState(addDays(1));
  const [timeSlot, setTimeSlot] = useState<'morning' | 'afternoon' | 'evening'>('morning');
  const [teamId, setTeamId] = useState('');
  const [teamLeaderId, setTeamLeaderId] = useState('');
  const [addressChoice, setAddressChoice] = useState<string>('headquarter');
  const [customAddress, setCustomAddress] = useState('');
  const [instructions, setInstructions] = useState('');

  const teams = store.getTeams();
  const staff = store.getStaff().filter((u) => u.role !== 'auditor');

  useEffect(() => {
    if (!lead) return;
    const i = lead.inspection;
    setDate(i?.scheduledDate || addDays(1));
    setTimeSlot(i?.timeSlot || 'morning');
    const initialTeamId = i?.teamId || teams[0]?.id || '';
    setTeamId(initialTeamId);
    const initialTeam = teams.find((t) => t.id === initialTeamId);
    setTeamLeaderId(i?.assignedTeamLeaderId || initialTeam?.leaderId || initialTeam?.leadUid || staff.find((u) => u.teamId === initialTeamId)?.uid || '');
    setInstructions(i?.instructions || '');
    setAddressChoice(i?.meetingAddress ? 'custom' : 'headquarter');
    setCustomAddress(i?.meetingAddress || '');
  }, [lead]);

  if (!lead) return null;

  const teamMembers = staff.filter((u) => u.teamId === teamId);
  const eligibleLeaders = teamMembers.length > 0 ? teamMembers : staff;

  const pickTeam = (id: string) => {
    setTeamId(id);
    const t = teams.find((x) => x.id === id);
    const candidate = t?.leaderId || t?.leadUid || staff.find((u) => u.teamId === id)?.uid || '';
    if (candidate) setTeamLeaderId(candidate);
  };

  const headOfficeAddress = lead.headquarterAddress || lead.propertyAddress || [lead.area, lead.city].filter(Boolean).join(', ') || 'Head office';

  const selectedMeetingAddress =
    addressChoice === 'headquarter'
      ? headOfficeAddress
      : addressChoice === 'custom'
        ? customAddress.trim()
        : lead.branches?.find((b) => b.id === addressChoice)?.address || addressChoice;

  const save = () => {
    if (!teamLeaderId) {
      warning('Assign a team leader', 'Select a team leader who will own the visit and follow-up.');
      return;
    }
    let updated: Lead | undefined;
    try {
      updated = store.scheduleLeadInspection(
        lead.id,
        {
          date,
          timeSlot,
          teamId: teamId || undefined,
          teamLeaderId,
          inspectorIds: [teamLeaderId],
          instructions: instructions.trim() || undefined,
          meetingAddress: selectedMeetingAddress || undefined,
        },
        userProfile?.email
      );
    } catch (err) {
      return error('Could not schedule meeting / inspection', err instanceof Error ? err.message : String(err));
    }
    if (updated) {
      success('Meeting / inspection scheduled', `${new Date(date).toLocaleDateString('en-GB')} (${timeSlot}). Assigned to team leader.`);
      onDone?.(updated);
    }
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${lead.inspection?.status === 'scheduled' ? 'Reschedule' : 'Schedule'} meeting / inspection: ${lead.title}`}
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

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Team</label>
          <select className="form-select" value={teamId} onChange={(e) => pickTeam(e.target.value)}>
            <option value="">No team specified</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Team leader (responsible staff)</label>
          <select className="form-select" value={teamLeaderId} onChange={(e) => setTeamLeaderId(e.target.value)}>
            <option value="">Select team leader…</option>
            {eligibleLeaders.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.displayName} ({roleLabel(u.role)})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Meeting location / address</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <label className="doc-check">
            <input type="radio" name="meetingAddressChoice" checked={addressChoice === 'headquarter'} onChange={() => setAddressChoice('headquarter')} />
            <span><strong>Head office:</strong> {headOfficeAddress}</span>
          </label>
          {(lead.branches ?? []).map((b) => (
            <label key={b.id} className="doc-check">
              <input type="radio" name="meetingAddressChoice" checked={addressChoice === b.id} onChange={() => setAddressChoice(b.id)} />
              <span><strong>Branch ({b.name}):</strong> {b.address || b.city}</span>
            </label>
          ))}
          <label className="doc-check">
            <input type="radio" name="meetingAddressChoice" checked={addressChoice === 'custom'} onChange={() => setAddressChoice('custom')} />
            <span><strong>Other / Custom address</strong></span>
          </label>
        </div>
        {addressChoice === 'custom' && (
          <input className="form-input" style={{ marginTop: '0.4rem' }} value={customAddress} onChange={(e) => setCustomAddress(e.target.value)} placeholder="Enter full address for the visit…" />
        )}
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Instructions for the team</label>
        <textarea className="form-textarea" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Who to meet on site, gate pass, specific areas to inspect…" />
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Record inspection findings (team leader or office)
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
  const [teamLeaderNotes, setTeamLeaderNotes] = useState('');
  const [branches, setBranches] = useState<LeadBranch[]>([]);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!lead) return;
    const i = lead.inspection;
    const site = i?.siteName || [lead.area, lead.city].filter(Boolean).join(', ');
    setPests(i?.pestTypesFound?.length ? i.pestTypesFound : lead.pestIssues || []);
    setSeverity(i?.infestationSeverity || 'moderate');
    setArea(i?.areaSqFt ? String(i.areaSqFt) : '');
    setSummary(i?.findings?.length ? '' : i?.criticalFindings || '');
    setTreatment(i?.recommendedTreatment || '');
    setPhotos(i?.photos ?? []);
    setRows(i?.findings?.length ? i.findings : [newFinding()]);
    setReportTitle(i?.reportTitle || `Risk Assessment Report - ${lead.companyName || lead.title}${lead.area ? ` ${lead.area}` : ''}`);
    setSiteName(site);
    setObservedBy(i?.observedBy || '');
    setTeamLeaderNotes(i?.teamLeaderNotes || '');
    setBranches(lead.branches ?? []);
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

  const addBranch = () => {
    setBranches((prev) => [...prev, blankLeadBranch()]);
  };

  const updateBranch = (index: number, patch: Partial<LeadBranch>) => {
    setBranches((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const removeBranch = (index: number) => {
    setBranches((prev) => prev.filter((_, i) => i !== index));
  };

  const save = () => {
    if (problems.length) return;
    const findings = rows.filter(findingFilled).map((r) => ({ ...r, observation: r.observation.trim(), risk: r.risk.trim(), recommendation: r.recommendation.trim(), location: r.location?.trim() || undefined }));
    let updated: Lead | undefined;
    try {
      const validBranches = branches.filter((b) => b.name.trim() || b.address.trim());
      updated = store.recordInspectionFindings(
        lead.id,
        {
          pestTypesFound: pests,
          infestationSeverity: severity,
          areaSqFt: Number(area) || 0,
          criticalFindings: [summary.trim(), findingsSummary(findings)].filter(Boolean).join('\n'),
          recommendedTreatment: treatment.trim() || recommendedTreatmentOf({ findings }),
          photos,
          findings,
          reportTitle: reportTitle.trim() || undefined,
          siteName: siteName.trim() || undefined,
          observedBy: observedBy.trim() || undefined,
          teamLeaderNotes: teamLeaderNotes.trim() || undefined,
        },
        userProfile?.email,
        validBranches.length ? validBranches : undefined
      );
    } catch (err) {
      return error('Could not save findings', err instanceof Error ? err.message : String(err));
    }
    if (updated) {
      success('Findings saved', `${lead.title} is ready for a proposal. Risk assessment filed.`);
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
      title={`Meeting / inspection findings: ${lead.title}`}
      subtitle={lead.inspection?.scheduledDate ? `Visit on ${new Date(lead.inspection.scheduledDate).toLocaleDateString('en-GB')}${lead.inspection.assignedTeamLeaderName ? ` · Leader: ${lead.inspection.assignedTeamLeaderName}` : ''}` : 'Enter findings'}
      maxWidth="920px"
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
          <input className="form-input" value={observedBy} onChange={(e) => setObservedBy(e.target.value)} placeholder="Client representative" />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Team leader notes / technician follow-up</label>
        <textarea
          className="form-textarea"
          rows={2}
          value={teamLeaderNotes}
          onChange={(e) => setTeamLeaderNotes(e.target.value)}
          placeholder="Notes on technician discussions, access details, client verbal agreements, follow-up points…"
        />
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

      {/* Branches / sites found on visit */}
      <div style={{ marginTop: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <div>
            <div className="section-title" style={{ margin: 0 }}>Additional branches / sites identified</div>
            <div className="cell-sub">Discovered during client meeting; will be saved to the lead and converted to branches on won</div>
          </div>
          <button type="button" className="btn btn-sm btn-secondary" onClick={addBranch}>
            <Plus size={14} /> Add site
          </button>
        </div>
        {branches.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {branches.map((b, idx) => (
              <div key={b.id || idx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1fr 1fr auto', gap: '0.4rem', alignItems: 'center' }}>
                <input className="form-input" placeholder="Branch name" value={b.name} onChange={(e) => updateBranch(idx, { name: e.target.value })} />
                <input className="form-input" placeholder="Address" value={b.address} onChange={(e) => updateBranch(idx, { address: e.target.value })} />
                <input className="form-input" placeholder="City" value={b.city || ''} onChange={(e) => updateBranch(idx, { city: e.target.value })} />
                <input className="form-input" placeholder="Contact phone" value={b.contactPhone || ''} onChange={(e) => updateBranch(idx, { contactPhone: e.target.value })} />
                <button type="button" className="icon-btn" onClick={() => removeBranch(idx)} title="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

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
