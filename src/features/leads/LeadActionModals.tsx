import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { CHANNELS, contactsOf, INSPECTION_PHOTO_TYPES, OUTCOMES } from '../../lib/leadWorkflow';
import { roleLabel } from '../../lib/permissions';
import type { ActivityChannel, ContactOutcome, InspectionAssessment, Lead, PestType } from '../../types/crm';
import type { SitePhoto } from '../../types/operations';
import { PhotoCapture } from '../field/PhotoCapture';

const today = () => new Date().toISOString().slice(0, 10);

const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Log a contact attempt
// ---------------------------------------------------------------------------
export const LogContactModal: React.FC<{ lead: Lead | null; onClose: () => void; onDone?: (lead: Lead) => void }> = ({ lead, onClose, onDone }) => {
  const store = useDataStore();
  const { userProfile } = useAuth();
  const { success, warning } = useNotification();
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
    const updated = store.logLeadContact(
      lead.id,
      { channel, outcome, note: note.trim() || undefined, contactId: contactId || undefined, nextFollowUp: needsFollowUp ? followUp : undefined, lostReason: closing ? lostReason.trim() || undefined : undefined },
      userProfile?.email
    );
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
  const { success, warning } = useNotification();
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
    const updated = store.scheduleLeadInspection(lead.id, { date, timeSlot, teamId: teamId || undefined, inspectorIds, instructions: instructions.trim() || undefined }, userProfile?.email);
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
  const [findings, setFindings] = useState('');
  const [treatment, setTreatment] = useState('');

  useEffect(() => {
    if (!lead) return;
    const i = lead.inspection;
    setPests(i?.pestTypesFound?.length ? i.pestTypesFound : lead.pestIssues || []);
    setSeverity(i?.infestationSeverity || 'moderate');
    setArea(i?.areaSqFt ? String(i.areaSqFt) : '');
    setFindings(i?.criticalFindings || '');
    setTreatment(i?.recommendedTreatment || '');
    setPhotos(i?.photos ?? []);
  }, [lead]);

  if (!lead) return null;
  const problems: string[] = [];
  if (!pests.length) problems.push('Select at least one pest found.');
  if (!findings.trim()) problems.push('Describe what was found.');

  const save = () => {
    if (problems.length) return;
    const updated = store.recordInspectionFindings(
      lead.id,
      { pestTypesFound: pests, infestationSeverity: severity, areaSqFt: Number(area) || 0, criticalFindings: findings.trim(), recommendedTreatment: treatment.trim(), photos },
      userProfile?.email
    );
    if (updated) {
      success('Findings saved', `${lead.title} is ready for a proposal.`);
      onDone?.(updated);
    }
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Inspection findings: ${lead.title}`}
      subtitle={lead.inspection?.scheduledDate ? `Visit on ${new Date(lead.inspection.scheduledDate).toLocaleDateString('en-GB')}${lead.inspection.inspectorName ? ` · ${lead.inspection.inspectorName}` : ''}` : 'Enter the findings manually'}
      maxWidth="700px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={problems.length > 0} title={problems.join('\n')}>Save findings</button>
        </>
      }
    >
      {lead.inspection?.instructions && <div className="info-hint" style={{ marginBottom: '1rem' }}><strong>Instructions:</strong> {lead.inspection.instructions}</div>}

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

      <div className="form-group">
        <label className="form-label">What was found <span className="required">*</span></label>
        <textarea className="form-textarea" rows={4} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="Activity seen, breeding points, entry points, hygiene issues, areas affected…" />
      </div>
      <div className="form-group">
        <label className="form-label">Recommended treatment</label>
        <textarea className="form-textarea" rows={3} value={treatment} onChange={(e) => setTreatment(e.target.value)} placeholder="e.g. Gel baiting monthly + rodent bait stations, termite drilling & injection" />
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Site photos</label>
        <PhotoCapture<SitePhoto>
          folder={`lead/${lead.id}/inspection`}
          idPrefix={lead.inspection?.id || lead.id}
          categories={INSPECTION_PHOTO_TYPES}
          photos={photos}
          onChange={setPhotos}
          required={['infestation']}
          onNotify={(kind, title, message) => (kind === 'error' ? error(title, message) : kind === 'warning' ? warning(title, message) : success(title, message))}
          emptyText="No photos yet. Photos appear in the inspection report sent with the proposal."
        />
      </div>
    </Modal>
  );
};
