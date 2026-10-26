import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { blankLeadBranch, CHANNELS, contactsOf, INSPECTION_PHOTO_TYPES, OUTCOMES, stageOf, STUCK_AT_REASONS, syncLeadFields } from '../../lib/leadWorkflow';
import { roleLabel } from '../../lib/permissions';
import { dataService } from '../../services/dataService';
import type { ActivityChannel, ContactOutcome, InspectionAssessment, Lead, LeadBranch, LeadContact, MeetingFollowUp, MeetingFollowUpType, PestType, RiskFinding, StuckAtReason } from '../../types/crm';
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
const blankContact = (primary: boolean): LeadContact => ({
  id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
  name: '', phone: '', isPrimary: primary,
});

const DESIGNATIONS = ['Owner / CEO', 'General Manager', 'Operations Manager', 'Admin Manager', 'Facility Manager', 'Procurement / Purchase', 'CMO / Marketing', 'HR Manager', 'Accounts', 'Site Supervisor'];

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
  const [followUpTime, setFollowUpTime] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const [editContacts, setEditContacts] = useState<LeadContact[]>([]);
  const [editBranches, setEditBranches] = useState<LeadBranch[]>([]);

  useEffect(() => {
    if (!lead) return;
    setChannel('call');
    setOutcome('no_response');
    setContactId(contactsOf(lead).find((c) => c.isPrimary)?.id || contactsOf(lead)[0]?.id || '');
    setStuckAt(lead.stuckAt || '');
    setNote('');
    setFollowUp(addDays(2));
    setLostReason('');
    setShowExtra(false);
    setEditContacts(contactsOf(lead).map((c) => ({ ...c })));
    setEditBranches((lead.branches ?? []).map((b) => ({ ...b })));
  }, [lead]);

  if (!lead) return null;
  const contacts = contactsOf(lead);
  const isCompany = lead.customerType === 'company';
  const closing = outcome === 'not_interested' || outcome === 'wrong_contact';
  const needsFollowUp = outcome === 'callback' || outcome === 'no_response' || outcome === 'interested';

  const setContact = (id: string, patch: Partial<LeadContact>) =>
    setEditContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const makePrimary = (id: string) =>
    setEditContacts((prev) => prev.map((c) => ({ ...c, isPrimary: c.id === id })));
  const removeContact = (id: string) =>
    setEditContacts((prev) => {
      const rest = prev.filter((c) => c.id !== id);
      if (rest.length && !rest.some((c) => c.isPrimary)) rest[0] = { ...rest[0], isPrimary: true };
      return rest;
    });
  const setBranch = (id: string, patch: Partial<LeadBranch>) =>
    setEditBranches((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const removeBranch = (id: string) =>
    setEditBranches((prev) => prev.filter((b) => b.id !== id));

  const save = () => {
    let updated: Lead | undefined;
    try {
      // Patch contacts/branches first if the extra panel was opened
      if (showExtra) {
        const validContacts = editContacts.filter((c) => c.name.trim() || c.phone.trim());
        const validBranches = editBranches.filter((b) => b.name.trim() || b.address.trim());
        const patched = syncLeadFields({ ...lead, contacts: validContacts.length ? validContacts : lead.contacts, branches: validBranches.length ? validBranches : undefined } as Lead);
        dataService.saveLead(patched, userProfile?.email);
      }
      updated = store.logLeadContact(
        lead.id,
        { channel, outcome, note: note.trim() || undefined, contactId: contactId || undefined, nextFollowUp: needsFollowUp ? (followUpTime ? `${followUp}T${followUpTime}` : followUp) : undefined, lostReason: closing ? lostReason.trim() || undefined : undefined },
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
        <select className="form-select" value={outcome} onChange={(e) => setOutcome(e.target.value as ContactOutcome)}>
          {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
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
            <input type="date" className="form-input" style={{ width: 160 }} value={followUp} min={today()} onChange={(e) => setFollowUp(e.target.value)} />
            <input type="time" className="form-input" style={{ width: 120 }} value={followUpTime} onChange={(e) => setFollowUpTime(e.target.value)} placeholder="Time (optional)" />
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

      {/* Collapsible: update contacts and add branches */}
      <div style={{ marginTop: '0.75rem', border: '1px solid var(--border-subtle)', borderRadius: '0.4rem', overflow: 'hidden' }}>
        <button
          type="button"
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.75rem', background: 'var(--surface-card)', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}
          onClick={() => setShowExtra((v) => !v)}
        >
          {showExtra ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          Update contacts / add branches
          <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {editContacts.length} contact{editContacts.length !== 1 ? 's' : ''}{editBranches.length ? `, ${editBranches.length} branch${editBranches.length !== 1 ? 'es' : ''}` : ''}
          </span>
        </button>

        {showExtra && (
          <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {/* Contacts */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Contacts</span>
              <button type="button" className="btn btn-xs btn-ghost" onClick={() => setEditContacts((p) => [...p, blankContact(false)])}>
                <Plus size={12} /> Add contact
              </button>
            </div>
            {editContacts.map((c, i) => (
              <div key={c.id} className="contact-card" style={{ borderColor: c.isPrimary ? 'var(--ikpm-emerald-500)' : undefined, marginBottom: 0 }}>
                <div className="contact-card-head">
                  <button type="button" className={`chip ${c.isPrimary ? 'chip-on' : ''}`} style={{ fontSize: '0.75rem' }} onClick={() => makePrimary(c.id)}>
                    ★ {c.isPrimary ? 'Primary' : `Contact ${i + 1}`}
                  </button>
                  {editContacts.length > 1 && (
                    <button type="button" className="icon-btn danger" onClick={() => removeContact(c.id)} title="Remove"><Trash2 size={14} /></button>
                  )}
                </div>
                <div className="form-grid-2" style={{ gap: '0.5rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.78rem' }}>Name</label>
                    <input className="form-input" value={c.name} onChange={(e) => setContact(c.id, { name: e.target.value })} placeholder="Full name" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.78rem' }}>Designation</label>
                    <input className="form-input" list="lc-designations" value={c.designation || ''} onChange={(e) => setContact(c.id, { designation: e.target.value })} placeholder="e.g. Operations Manager" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.78rem' }}>Phone</label>
                    <input className="form-input" value={c.phone} onChange={(e) => setContact(c.id, { phone: e.target.value })} placeholder="03XX XXXXXXX" inputMode="tel" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.78rem' }}>Email</label>
                    <input className="form-input" type="email" value={c.email || ''} onChange={(e) => setContact(c.id, { email: e.target.value })} placeholder="name@company.com" />
                  </div>
                </div>
              </div>
            ))}
            <datalist id="lc-designations">{DESIGNATIONS.map((d) => <option key={d} value={d} />)}</datalist>

            {/* Branches — company leads only */}
            {isCompany && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0.35rem 0 0.2rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Branches / sites</span>
                  <button type="button" className="btn btn-xs btn-ghost" onClick={() => setEditBranches((p) => [...p, blankLeadBranch()])}>
                    <Plus size={12} /> Add branch
                  </button>
                </div>
                {editBranches.length === 0 && (
                  <div className="form-hint">No branches yet — add any site that may need service.</div>
                )}
                {editBranches.map((br, i) => (
                  <div key={br.id} className="contact-card" style={{ marginBottom: 0 }}>
                    <div className="contact-card-head">
                      <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>Branch {i + 1}</span>
                      <button type="button" className="icon-btn danger" onClick={() => removeBranch(br.id)} title="Remove"><Trash2 size={14} /></button>
                    </div>
                    <div className="form-grid-2" style={{ gap: '0.5rem' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Branch name</label>
                        <input className="form-input" value={br.name} onChange={(e) => setBranch(br.id, { name: e.target.value })} placeholder="e.g. Johar Town" />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>City</label>
                        <input className="form-input" value={br.city || ''} onChange={(e) => setBranch(br.id, { city: e.target.value })} />
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Address</label>
                        <input className="form-input" value={br.address} onChange={(e) => setBranch(br.id, { address: e.target.value })} placeholder="Full branch address" />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Contact person</label>
                        <input className="form-input" value={br.contactName || ''} onChange={(e) => setBranch(br.id, { contactName: e.target.value })} placeholder="Branch manager" />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Contact phone</label>
                        <input className="form-input" value={br.contactPhone || ''} onChange={(e) => setBranch(br.id, { contactPhone: e.target.value })} placeholder="03XX XXXXXXX" inputMode="tel" />
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
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
  const [scheduledTime, setScheduledTime] = useState('');
  const [timeSlot, setTimeSlot] = useState<'morning' | 'afternoon' | 'evening'>('morning');
  const [teamId, setTeamId] = useState('');
  const [teamLeaderId, setTeamLeaderId] = useState('');
  const [addressChoice, setAddressChoice] = useState<string>('headquarter');
  const [customAddress, setCustomAddress] = useState('');
  const [instructions, setInstructions] = useState('');
  const [meetingType, setMeetingType] = useState<'first_meeting' | 'negotiation' | 'renewal'>('first_meeting');

  const teams = store.getTeams();
  const staff = store.getStaff().filter((u) => !['auditor', 'technician'].includes(u.role));

  useEffect(() => {
    if (!lead) return;
    const i = lead.inspection;
    setDate(i?.scheduledDate || addDays(1));
    setScheduledTime(i?.scheduledTime || '');
    setTimeSlot(i?.timeSlot || 'morning');
    const initialTeamId = i?.teamId || teams[0]?.id || '';
    setTeamId(initialTeamId);
    const initialTeam = teams.find((t) => t.id === initialTeamId);
    setTeamLeaderId(i?.assignedTeamLeaderId || initialTeam?.leaderId || initialTeam?.leadUid || staff.find((u) => u.teamId === initialTeamId)?.uid || '');
    setInstructions(i?.instructions || '');
    setAddressChoice(i?.meetingAddress ? 'custom' : 'headquarter');
    setCustomAddress(i?.meetingAddress || '');
    // Default meeting type from existing inspection, or infer from stage
    const st = stageOf(lead);
    setMeetingType(i?.meetingType || (st === 'negotiation' ? 'negotiation' : 'first_meeting'));
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
          scheduledTime: scheduledTime || undefined,
          timeSlot,
          teamId: teamId || undefined,
          teamLeaderId,
          inspectorIds: [teamLeaderId],
          instructions: instructions.trim() || undefined,
          meetingAddress: selectedMeetingAddress || undefined,
          meetingType,
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
      <div className="form-group">
        <label className="form-label">Meeting type</label>
        <div className="chip-row" style={{ marginBottom: 0 }}>
          {([
            { value: 'first_meeting', label: 'First meeting' },
            { value: 'negotiation', label: 'Negotiation' },
            { value: 'renewal', label: 'Renewal' },
          ] as const).map((opt) => (
            <button key={opt.value} type="button" className={`chip ${meetingType === opt.value ? 'chip-on' : ''}`} onClick={() => setMeetingType(opt.value)}>
              {meetingType === opt.value && <Check size={14} />} {opt.label}
            </button>
          ))}
        </div>
        {meetingType === 'negotiation' && <div className="cell-sub" style={{ marginTop: '0.3rem' }}>Shorter report form — outcome, new terms, follow-up date. No inspection question.</div>}
        {meetingType === 'renewal' && <div className="cell-sub" style={{ marginTop: '0.3rem' }}>Renewal discussion — no inspection required. Report covers renewal terms and next steps.</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label className="form-label">Date</label>
          <input type="date" className="form-input" value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Start time</label>
          <input type="time" className="form-input" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
          <div className="form-hint">Optional exact time</div>
        </div>
        <div className="form-group">
          <label className="form-label">Shift</label>
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
          <label className="form-label">Team Leader (responsible — submits the report)</label>
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
// Meeting report (TL submits after the client meeting)
// ---------------------------------------------------------------------------
export const MeetingReportModal: React.FC<{ lead: Lead | null; onClose: () => void; onDone?: (lead: Lead) => void }> = ({ lead, onClose, onDone }) => {
  const store = useDataStore();
  const { userProfile } = useAuth();
  const { success, error } = useNotification();
  const [reportTitle, setReportTitle] = useState('');
  const [siteName, setSiteName] = useState('');
  const [observedBy, setObservedBy] = useState('');
  const [teamLeaderNotes, setTeamLeaderNotes] = useState('');
  const [followUps, setFollowUps] = useState<MeetingFollowUp[]>([]);
  const [tlStatus, setTlStatus] = useState<'send_proposal' | 'waiting' | ''>('');
  const [meetingReportNote, setMeetingReportNote] = useState('');
  const [branches, setBranches] = useState<LeadBranch[]>([]);
  // Inspection handling (first_meeting only)
  const [inspectionHandling, setInspectionHandling] = useState<'done_inline' | 'tl_schedule' | 'separate_visit' | ''>('');
  // Schedule-later fields
  const [schedulingNote, setSchedulingNote] = useState('');
  const [preferredInspectionDate, setPreferredInspectionDate] = useState('');
  const [scheduleAssigneeId, setScheduleAssigneeId] = useState('');
  // Inline inspection fields (when inspectionHandling === 'done_inline')
  const [inlinePestTypes, setInlinePestTypes] = useState<import('../../types/crm').PestType[]>([]);
  const [inlineSeverity, setInlineSeverity] = useState<'low' | 'moderate' | 'high' | 'severe'>('moderate');
  const [inlineAreaSqFt, setInlineAreaSqFt] = useState('');
  const [inlineCriticalFindings, setInlineCriticalFindings] = useState('');
  const [inlineRecommendedTreatment, setInlineRecommendedTreatment] = useState('');
  const [inlinePhotos, setInlinePhotos] = useState<SitePhoto[]>([]);
  // Negotiation/renewal meeting fields
  const [negoTermsNote, setNegoTermsNote] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  const detectedMeetingType = lead?.inspection?.meetingType || 'first_meeting';
  const isNegoRenewal = detectedMeetingType === 'negotiation' || detectedMeetingType === 'renewal';

  useEffect(() => {
    if (!lead) return;
    const i = lead.inspection;
    setReportTitle(i?.reportTitle || `Meeting Report - ${lead.companyName || lead.title}`);
    setSiteName(i?.siteName || [lead.area, lead.city].filter(Boolean).join(', '));
    setObservedBy(i?.observedBy || '');
    setTeamLeaderNotes(i?.teamLeaderNotes || '');
    setTlStatus(i?.tlStatus || '');
    setMeetingReportNote(i?.meetingReportNote || '');
    setNegoTermsNote(i?.negotiationTermsNote || '');
    setFollowUpDate(lead.nextFollowUp || '');
    setInspectionHandling(i?.inspectionHandling || '');
    setSchedulingNote(i?.schedulingNote || '');
    setPreferredInspectionDate(i?.preferredInspectionDate || '');
    setScheduleAssigneeId(i?.assignedTeamLeaderId || '');
    setInlinePhotos(i?.photos ?? []);
    if (i?.pestTypesFound?.length) { setInlinePestTypes(i.pestTypesFound); setInlineSeverity(i.infestationSeverity || 'moderate'); setInlineAreaSqFt(String(i.areaSqFt || '')); setInlineCriticalFindings(i.criticalFindings || ''); setInlineRecommendedTreatment(i.recommendedTreatment || ''); }
    if (i?.meetingFollowUps?.length) {
      setFollowUps(i.meetingFollowUps);
    } else if (i?.clientRequest) {
      const legacyTypes: MeetingFollowUpType[] =
        i.clientRequest === 'both' ? ['company_profile', 'proposal'] :
        i.clientRequest === 'more_info' ? ['other_documents'] :
        [i.clientRequest as MeetingFollowUpType];
      setFollowUps(legacyTypes.map((type, idx) => ({ id: `fu_${idx}`, type })));
    } else {
      setFollowUps([]);
    }
    setBranches(lead.branches ?? []);
  }, [lead]);

  if (!lead) return null;

  const toggleFollowUp = (type: MeetingFollowUpType, checked: boolean) => {
    setFollowUps((prev) =>
      checked
        ? [...prev.filter((f) => f.type !== type), { id: `fu_${Date.now()}`, type }]
        : prev.filter((f) => f.type !== type)
    );
  };
  const updateFollowUp = (type: MeetingFollowUpType, patch: Partial<MeetingFollowUp>) => {
    setFollowUps((prev) => prev.map((f) => (f.type === type ? { ...f, ...patch } : f)));
  };
  const toggleDone = (type: MeetingFollowUpType) => {
    setFollowUps((prev) =>
      prev.map((f) => (f.type === type ? { ...f, doneAt: f.doneAt ? undefined : new Date().toISOString() } : f))
    );
  };

  const save = () => {
    const hasProfile = followUps.some((f) => f.type === 'company_profile');
    const hasProposal = followUps.some((f) => f.type === 'proposal');
    const notInterested = followUps.some((f) => f.type === 'not_interested');
    const contractReady = followUps.some((f) => f.type === 'contract_ready');
    const derivedClientRequest: import('../../types/crm').InspectionAssessment['clientRequest'] | undefined =
      notInterested ? 'not_interested' :
      contractReady ? 'contract_ready' :
      (hasProfile && hasProposal) ? 'both' :
      hasProposal ? 'proposal' :
      hasProfile ? 'company_profile' :
      followUps.length ? 'more_info' : undefined;
    const validBranches = branches.filter((b) => b.name.trim() || b.address.trim());
    let updated: Lead | undefined;
    try {
      updated = dataService.recordMeetingReport(
        lead.id,
        {
          meetingType: detectedMeetingType,
          reportTitle: reportTitle.trim() || undefined,
          siteName: siteName.trim() || undefined,
          observedBy: observedBy.trim() || undefined,
          teamLeaderNotes: teamLeaderNotes.trim() || undefined,
          clientRequest: isNegoRenewal ? undefined : derivedClientRequest,
          meetingFollowUps: isNegoRenewal ? undefined : (followUps.length ? followUps : undefined),
          meetingReportNote: meetingReportNote.trim() || undefined,
          tlStatus: isNegoRenewal ? undefined : (tlStatus || undefined),
          inspectionHandling: (!isNegoRenewal && inspectionHandling) ? inspectionHandling : undefined,
          schedulingNote: (!isNegoRenewal && inspectionHandling && inspectionHandling !== 'done_inline') ? (schedulingNote.trim() || undefined) : undefined,
          preferredInspectionDate: (!isNegoRenewal && inspectionHandling && inspectionHandling !== 'done_inline') ? (preferredInspectionDate || undefined) : undefined,
          assignedTeamLeaderId: (!isNegoRenewal && inspectionHandling && inspectionHandling !== 'done_inline' && scheduleAssigneeId) ? scheduleAssigneeId : undefined,
          assignedTeamLeaderName: (!isNegoRenewal && inspectionHandling && inspectionHandling !== 'done_inline' && scheduleAssigneeId)
            ? (store.getStaff().find((u) => u.uid === scheduleAssigneeId)?.displayName)
            : undefined,
          negotiationTermsNote: isNegoRenewal ? (negoTermsNote.trim() || undefined) : undefined,
          // Inline inspection fields (first_meeting only, when done_inline)
          ...((!isNegoRenewal && inspectionHandling === 'done_inline') ? {
            pestTypesFound: inlinePestTypes,
            infestationSeverity: inlineSeverity,
            areaSqFt: Number(inlineAreaSqFt) || 0,
            criticalFindings: inlineCriticalFindings.trim(),
            recommendedTreatment: inlineRecommendedTreatment.trim(),
            photos: inlinePhotos,
            photoEvidenceUrls: inlinePhotos.map((p) => p.imageUrl),
          } : {}),
        },
        userProfile?.email,
        validBranches.length ? validBranches : undefined
      );
    } catch (err) {
      return error('Could not save report', err instanceof Error ? err.message : String(err));
    }
    if (updated) {
      if (isNegoRenewal) {
        success(`${detectedMeetingType === 'renewal' ? 'Renewal' : 'Negotiation'} meeting report saved`, negoTermsNote ? `Terms discussed: ${negoTermsNote.slice(0, 60)}` : `${lead.title} meeting report recorded.`);
      } else {
        const fuNames = followUps.filter((f) => f.type !== 'not_interested').map((f) =>
          ({ company_profile: 'Company profile', proposal: 'Proposal', inspection: 'Site inspection', other_documents: 'Documents', contract_ready: 'Ready to sign', not_interested: 'Not interested' }[f.type])
        ).filter(Boolean).join(', ');
        success('Meeting report saved', fuNames ? `Client asked for: ${fuNames}.` : `${lead.title} meeting report recorded.`);
      }
      onDone?.(updated);
    }
    onClose();
  };

  const addBranch = () => setBranches((prev) => [...prev, blankLeadBranch()]);
  const updateBranch = (idx: number, patch: Partial<LeadBranch>) => setBranches((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  const removeBranch = (idx: number) => setBranches((prev) => prev.filter((_, i) => i !== idx));

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${detectedMeetingType === 'negotiation' ? 'Negotiation meeting' : detectedMeetingType === 'renewal' ? 'Renewal meeting' : 'First meeting'} report: ${lead.title}`}
      subtitle={lead.inspection?.scheduledDate ? (() => {
        const i = lead.inspection!;
        return `Visit on ${new Date(i.scheduledDate).toLocaleDateString('en-GB')}${i.assignedTeamLeaderName ? ` · Leader: ${i.assignedTeamLeaderName}` : ''}`;
      })() : 'Record what was discussed and what the client asked for'}
      maxWidth="760px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save meeting report</button>
        </>
      }
    >
      {lead.inspection?.instructions && <div className="info-hint" style={{ marginBottom: '1rem' }}><strong>Instructions:</strong> {lead.inspection.instructions}</div>}

      {/* Common header fields */}
      <div className="form-grid-2">
        <div className="form-group" style={{ gridColumn: 'span 2' }}>
          <label className="form-label">Report title</label>
          <input className="form-input" value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Branch / site visited</label>
          <input className="form-input" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="e.g. Johar branch" />
        </div>
        <div className="form-group">
          <label className="form-label">Observed by (client representative)</label>
          <input className="form-input" value={observedBy} onChange={(e) => setObservedBy(e.target.value)} placeholder="Client rep who attended" />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Notes</label>
        <textarea className="form-textarea" rows={2} value={teamLeaderNotes} onChange={(e) => setTeamLeaderNotes(e.target.value)} placeholder="Internal notes, client verbal agreements, access details…" />
      </div>

      {/* ---- Negotiation / Renewal short form ---- */}
      {isNegoRenewal && (
        <div className="form-group" style={{ background: 'var(--ikpm-emerald-50)', border: '1px solid var(--ikpm-emerald-200)', borderRadius: '0.5rem', padding: '0.85rem 1rem' }}>
          <label className="form-label" style={{ color: 'var(--ikpm-emerald-800)', fontWeight: 700, marginBottom: '0.5rem', display: 'block' }}>
            {detectedMeetingType === 'renewal' ? 'Renewal discussion' : 'Negotiation outcome'}
          </label>
          <div className="form-group">
            <label className="form-label">Outcome / discussion summary</label>
            <textarea className="form-textarea" rows={3} value={meetingReportNote} onChange={(e) => setMeetingReportNote(e.target.value)} placeholder="What was discussed, client's position, any agreement reached…" />
          </div>
          <div className="form-group">
            <label className="form-label">New price / terms discussed</label>
            <textarea className="form-textarea" rows={2} value={negoTermsNote} onChange={(e) => setNegoTermsNote(e.target.value)} placeholder="Revised rate, new scope, payment terms, client's counter-offer…" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Follow-up date</label>
            <input type="date" className="form-input" style={{ maxWidth: '200px' }} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
          </div>
        </div>
      )}

      {/* ---- First meeting full form ---- */}
      {!isNegoRenewal && (
        <>
          {/* How will the inspection be handled? */}
          <div className="form-group" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '0.5rem', padding: '0.85rem 1rem' }}>
            <label className="form-label" style={{ color: '#1E40AF', fontWeight: 700, marginBottom: '0.5rem', display: 'block' }}>
              Inspection <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {([
                { value: 'done_inline', label: 'Done during this meeting', hint: 'Inspection was completed on site — fill in pest findings below' },
                { value: 'tl_schedule', label: 'Schedule later — CRO will assign to operations', hint: 'Add notes below so the CRO knows what to arrange' },
              ] as const).map((opt) => {
                const isActive = inspectionHandling === opt.value
                  || (opt.value === 'tl_schedule' && inspectionHandling === 'separate_visit');
                return (
                  <label key={opt.value} className="doc-check" style={{ border: `1px solid ${isActive ? '#3B82F6' : 'var(--border-subtle)'}`, borderRadius: '0.4rem', padding: '0.4rem 0.65rem', background: isActive ? '#DBEAFE' : 'var(--surface-card)', cursor: 'pointer' }}>
                    <input type="radio" name="inspHandling" checked={isActive} onChange={() => setInspectionHandling(opt.value)} />
                    <span style={{ fontWeight: isActive ? 600 : undefined }}>
                      {opt.label} <span className="cell-sub" style={{ display: 'block', marginTop: '0.1rem' }}>{opt.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            {/* Inline inspection fields */}
            {inspectionHandling === 'done_inline' && (
              <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #BFDBFE' }}>
                <div className="form-label" style={{ color: '#1E40AF', fontWeight: 700, marginBottom: '0.5rem' }}>Inspection findings</div>
                <div className="form-group">
                  <label className="form-label">Pest types found</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {(['termites','cockroaches','bedbugs','rodents_rats','mosquitoes_flies','ants','stored_grain_pests','general_fumigation','snake_reptile','other'] as import('../../types/crm').PestType[]).map((p) => {
                      const on = inlinePestTypes.includes(p);
                      return <button key={p} type="button" className={`chip chip-sm ${on ? 'chip-on' : ''}`} onClick={() => setInlinePestTypes((prev) => on ? prev.filter((x) => x !== p) : [...prev, p])}>{on && <Check size={12} />} {p.replace(/_/g,' ')}</button>;
                    })}
                  </div>
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Severity</label>
                    <div className="chip-row">
                      {(['low','moderate','high','severe'] as const).map((s) => <button key={s} type="button" className={`chip ${inlineSeverity === s ? 'chip-on' : ''}`} onClick={() => setInlineSeverity(s)}>{s}</button>)}
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Area (sq ft)</label>
                    <input type="number" className="form-input" value={inlineAreaSqFt} onChange={(e) => setInlineAreaSqFt(e.target.value)} placeholder="e.g. 2500" min="0" />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Critical findings</label>
                  <textarea className="form-textarea" rows={2} value={inlineCriticalFindings} onChange={(e) => setInlineCriticalFindings(e.target.value)} placeholder="Main pest issues found…" />
                </div>
                <div className="form-group">
                  <label className="form-label">Recommended treatment</label>
                  <textarea className="form-textarea" rows={2} value={inlineRecommendedTreatment} onChange={(e) => setInlineRecommendedTreatment(e.target.value)} placeholder="What treatment / service is recommended…" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Site photos <span className="cell-sub" style={{ fontWeight: 400 }}>— attach photo evidence (optional)</span></label>
                  <PhotoCapture<SitePhoto>
                    scope={{ ownerScope: 'client', clientId: lead.existingCustomerId || lead.id, category: 'risk_assessment' }}
                    subPath={`${lead.id}/meeting-inspection`}
                    idPrefix={`${lead.id}_mi`}
                    categories={INSPECTION_PHOTO_TYPES}
                    photos={inlinePhotos}
                    onChange={setInlinePhotos}
                    onNotify={(kind, title, msg) => kind === 'error' ? error(title, msg) : success(title, msg)}
                    emptyText="Take a photo or pick from gallery — pests, affected areas, evidence."
                  />
                </div>
              </div>
            )}

            {/* Schedule-later: date, assign to Ops, CRO notes */}
            {(inspectionHandling === 'tl_schedule' || inspectionHandling === 'separate_visit') && (
              <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #BFDBFE', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                <div className="form-grid-2">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ color: '#1D4ED8', fontWeight: 600 }}>Preferred date <span style={{ fontWeight: 400 }}>(optional)</span></label>
                    <input type="date" className="form-input" value={preferredInspectionDate} min={today()} onChange={(e) => setPreferredInspectionDate(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ color: '#1D4ED8', fontWeight: 600 }}>Assign to <span style={{ fontWeight: 400 }}>Operations / Team Leader</span></label>
                    <select className="form-select" value={scheduleAssigneeId} onChange={(e) => setScheduleAssigneeId(e.target.value)}>
                      <option value="">Unassigned — TL will pick up</option>
                      {store.getStaff().filter((u) => ['team_leader', 'operations', 'admin', 'management'].includes(u.role)).map((u) => (
                        <option key={u.uid} value={u.uid}>{u.displayName} ({roleLabel(u.role)})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="form-label" style={{ color: '#1D4ED8', fontWeight: 600, marginBottom: '0.2rem', display: 'block' }}>CRO notes for the inspection team</label>
                  <textarea className="form-textarea" rows={3} value={schedulingNote} onChange={(e) => setSchedulingNote(e.target.value)} placeholder="What did the client say? Special requirements, restricted areas, preferred timing, who to contact on site, areas to focus on…" />
                </div>
              </div>
            )}
          </div>

          {/* Meeting outcome checklist */}
          <div className="form-group" style={{ background: 'var(--ikpm-emerald-50)', border: '1px solid var(--ikpm-emerald-200)', borderRadius: '0.5rem', padding: '0.85rem 1rem' }}>
            <label className="form-label" style={{ color: 'var(--ikpm-emerald-800)', fontWeight: 700, marginBottom: '0.5rem', display: 'block' }}>
              What did the client ask for? <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--ikpm-emerald-700)' }}>tick all that apply · mark done when delivered</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
              {([
                { type: 'company_profile' as MeetingFollowUpType, label: 'Company Profile', hint: 'Send IKPM company profile / brochure' },
                { type: 'proposal' as MeetingFollowUpType, label: 'Proposal / Quote', hint: 'Prepare a service proposal with pricing' },
                { type: 'other_documents' as MeetingFollowUpType, label: 'Other documents', hint: 'Specify what documents the client needs' },
                { type: 'contract_ready' as MeetingFollowUpType, label: 'Ready to sign', hint: 'Client is ready to proceed to a contract' },
                { type: 'not_interested' as MeetingFollowUpType, label: 'Not interested', hint: 'Client declined' },
              ]).map((opt) => {
                const fu = followUps.find((f) => f.type === opt.type);
                const checked = Boolean(fu);
                const isNegative = opt.type === 'not_interested';
                const borderC = checked ? (isNegative ? 'var(--color-error, #DC2626)' : 'var(--ikpm-emerald-400)') : 'var(--border-subtle)';
                const bgC = checked ? (isNegative ? '#FEF2F2' : 'var(--ikpm-emerald-100)') : 'var(--surface-card)';
                return (
                  <div key={opt.type} style={{ border: `1px solid ${borderC}`, borderRadius: '0.4rem', background: bgC }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.65rem' }}>
                      <input type="checkbox" checked={checked} onChange={(e) => toggleFollowUp(opt.type, e.target.checked)} style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: checked ? 600 : undefined }} title={opt.hint}>{opt.label}</span>
                      {opt.type === 'other_documents' && checked && (
                        <input type="text" className="form-input" style={{ flex: 2, minWidth: 0, padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} value={fu?.note || ''} onChange={(e) => updateFollowUp('other_documents', { note: e.target.value })} placeholder="What documents?" />
                      )}
                      {checked && !isNegative && (
                        <button type="button" className={`btn btn-xs ${fu?.doneAt ? 'btn-primary' : 'btn-ghost'}`} style={{ flexShrink: 0, padding: '0.2rem 0.6rem', fontSize: '0.75rem' }} onClick={() => toggleDone(opt.type)} title={fu?.doneAt ? `Done on ${new Date(fu.doneAt).toLocaleDateString('en-GB')}` : 'Mark as done when delivered'}>
                          {fu?.doneAt ? '✓ Done' : 'Mark done'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <textarea className="form-textarea" rows={2} value={meetingReportNote} onChange={(e) => setMeetingReportNote(e.target.value)} placeholder="Meeting outcome note — anything else discussed, follow-up points…" />
            {/* TL decision gate */}
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--ikpm-emerald-200)' }}>
              <label className="form-label" style={{ color: 'var(--ikpm-emerald-800)', fontWeight: 700, marginBottom: '0.4rem', display: 'block' }}>
                Team Leader decision <span style={{ fontWeight: 400, fontSize: '0.8rem' }}>— required before a proposal can be created</span>
              </label>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {([
                  { value: 'send_proposal', label: '✓ Ready — send proposal', activeColor: 'var(--ikpm-emerald-600)', activeText: '#fff', activeBg: 'var(--ikpm-emerald-600)' },
                  { value: 'waiting', label: '⏳ Hold — need inspection / more steps', activeColor: '#D97706', activeText: '#92400E', activeBg: '#FFFBEB' },
                ] as const).map((opt) => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', padding: '0.4rem 0.75rem', borderRadius: '0.4rem', fontSize: '0.875rem', fontWeight: 600, border: `1px solid ${tlStatus === opt.value ? opt.activeColor : 'var(--border-subtle)'}`, background: tlStatus === opt.value ? opt.activeBg : 'var(--surface-card)', color: tlStatus === opt.value ? opt.activeText : 'var(--text-primary)' }}>
                    <input type="radio" name="tlStatusMR" style={{ display: 'none' }} checked={tlStatus === opt.value} onChange={() => setTlStatus(opt.value)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Branches / sites */}
          <div className="form-group" style={{ marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label className="form-label" style={{ margin: 0 }}>Branches / sites</label>
              <button type="button" className="btn btn-xs btn-ghost" onClick={addBranch}><Plus size={13} /> Add branch</button>
            </div>
            {branches.length === 0 ? (
              <div className="cell-sub">No branches recorded — add one if you discovered a new site.</div>
            ) : branches.map((b, idx) => (
              <div key={b.id} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="form-input" placeholder="Branch name" value={b.name} onChange={(e) => updateBranch(idx, { name: e.target.value })} style={{ flex: '1 1 150px' }} />
                <input className="form-input" placeholder="Address" value={b.address} onChange={(e) => updateBranch(idx, { address: e.target.value })} style={{ flex: '2 1 200px' }} />
                <input className="form-input" placeholder="City" value={b.city || ''} onChange={(e) => updateBranch(idx, { city: e.target.value })} style={{ flex: '1 1 100px' }} />
                <button type="button" className="icon-btn" onClick={() => removeBranch(idx)} title="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Schedule a separate site inspection (after the client meeting)
// ---------------------------------------------------------------------------
export const ScheduleSiteInspectionModal: React.FC<{ lead: Lead | null; onClose: () => void; onDone?: (lead: Lead) => void }> = ({ lead, onClose, onDone }) => {
  const store = useDataStore();
  const { userProfile } = useAuth();
  const { success, warning, error } = useNotification();
  const [date, setDate] = useState(addDays(1));
  const [branchChoice, setBranchChoice] = useState<string>('headquarter');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchAddress, setNewBranchAddress] = useState('');
  const [newBranchCity, setNewBranchCity] = useState('');
  const [techIds, setTechIds] = useState<string[]>([]);
  const [teamLeaderId, setTeamLeaderId] = useState('');
  const [notes, setNotes] = useState('');

  const staff = store.getStaff().filter((u) => ['team_leader', 'operations', 'sales'].includes(u.role));

  useEffect(() => {
    if (!lead) return;
    const si = lead.siteInspection;
    // Pre-populate from TL's meeting report inspection request if no siteInspection yet
    const fu = lead.inspection?.meetingFollowUps?.find((f) => f.type === 'inspection');
    setDate(si?.scheduledDate || fu?.scheduledDate || addDays(1));
    if (si?.branchId) {
      setBranchChoice(si.branchId);
      setNewBranchName(''); setNewBranchAddress(''); setNewBranchCity('');
    } else if (si?.branchName) {
      setBranchChoice('new'); setNewBranchName(si.branchName); setNewBranchAddress(si.branchAddress || ''); setNewBranchCity('');
    } else if (fu?.branchId) {
      setBranchChoice(fu.branchId);
      setNewBranchName(''); setNewBranchAddress(''); setNewBranchCity('');
    } else if (fu?.branchName) {
      setBranchChoice('new'); setNewBranchName(fu.branchName); setNewBranchAddress(fu.branchAddress || ''); setNewBranchCity('');
    } else {
      setBranchChoice('headquarter');
      setNewBranchName(''); setNewBranchAddress(''); setNewBranchCity('');
    }
    setTechIds(si?.assignedTechIds ?? []);
    setTeamLeaderId(si?.teamLeaderId || lead.assignedTeamLeaderId || '');
    setNotes(si?.notes || '');
  }, [lead]);

  if (!lead) return null;

  const toggleTech = (uid: string) => setTechIds((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);

  const branches = lead.branches ?? [];
  const headOffice = lead.headquarterAddress || lead.propertyAddress || [lead.area, lead.city].filter(Boolean).join(', ');

  const resolvedBranch = (): { id?: string; name: string; address: string } => {
    if (branchChoice === 'headquarter') return { name: lead.companyName || lead.title, address: headOffice };
    if (branchChoice === 'new') return { name: newBranchName.trim(), address: [newBranchAddress.trim(), newBranchCity.trim()].filter(Boolean).join(', ') };
    const b = branches.find((x) => x.id === branchChoice);
    return b ? { id: b.id, name: b.name, address: b.address || b.city || '' } : { name: '', address: '' };
  };

  const save = () => {
    if (!date) return warning('Date required', 'Select a date for the inspection.');
    const b = resolvedBranch();
    if (!b.name) return warning('Location required', 'Enter a branch name or select an existing site.');
    const chosenTechs = staff.filter((u) => techIds.includes(u.uid));
    const tl = staff.find((u) => u.uid === teamLeaderId);
    let updated: Lead | undefined;
    try {
      updated = dataService.scheduleSiteInspection(
        lead.id,
        {
          scheduledDate: date,
          branchId: b.id,
          branchName: b.name,
          branchAddress: b.address,
          assignedTechIds: chosenTechs.map((u) => u.uid),
          assignedTechNames: chosenTechs.map((u) => u.displayName),
          teamLeaderId: tl?.uid,
          teamLeaderName: tl?.displayName,
          notes: notes.trim() || undefined,
        },
        userProfile?.email
      );
    } catch (err) {
      return error('Could not schedule inspection', err instanceof Error ? err.message : String(err));
    }
    if (updated) {
      success('Site inspection scheduled', `${new Date(date).toLocaleDateString('en-GB')} at ${b.name}${chosenTechs.length ? ` · Tech: ${chosenTechs.map((u) => u.displayName).join(', ')}` : ''}`);
      onDone?.(updated);
    }
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Schedule site inspection: ${lead.title}`}
      subtitle="Book a separate technical pest inspection visit"
      maxWidth="680px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Schedule inspection</button>
        </>
      }
    >
      {(() => {
        const fu = lead.inspection?.meetingFollowUps?.find((f) => f.type === 'inspection');
        return fu?.addressTbd ? (
          <div className="info-hint" style={{ marginBottom: '1rem', background: '#FFFBEB', borderColor: '#FDE68A', color: '#92400E' }}>
            ⚠ Team Leader indicated the address hasn't been confirmed with the client yet. Please verify before scheduling.
          </div>
        ) : null;
      })()}
      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">Inspection date <span className="required">*</span></label>
          <input type="date" className="form-input" value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Site / branch to inspect <span className="required">*</span></label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <label className="doc-check">
            <input type="radio" name="sibranchChoice" checked={branchChoice === 'headquarter'} onChange={() => setBranchChoice('headquarter')} />
            <span><strong>Head office / main site:</strong> {headOffice || 'Main address'}</span>
          </label>
          {branches.map((b) => (
            <label key={b.id} className="doc-check">
              <input type="radio" name="sibranchChoice" checked={branchChoice === b.id} onChange={() => setBranchChoice(b.id)} />
              <span><strong>{b.name}</strong>{b.city ? ` · ${b.city}` : ''}{b.address ? ` · ${b.address}` : ''}</span>
            </label>
          ))}
          <label className="doc-check">
            <input type="radio" name="sibranchChoice" checked={branchChoice === 'new'} onChange={() => setBranchChoice('new')} />
            <span><strong>Add new branch / site</strong> (not listed above)</span>
          </label>
        </div>
        {branchChoice === 'new' && (
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <input className="form-input" placeholder="Branch name *" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} style={{ flex: '1 1 180px' }} />
            <input className="form-input" placeholder="Address" value={newBranchAddress} onChange={(e) => setNewBranchAddress(e.target.value)} style={{ flex: '2 1 200px' }} />
            <input className="form-input" placeholder="City" value={newBranchCity} onChange={(e) => setNewBranchCity(e.target.value)} style={{ flex: '1 1 120px' }} />
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Supervisor / Team Leader</label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="form-input"
            value={teamLeaderId}
            onChange={(e) => setTeamLeaderId(e.target.value)}
            style={{ flex: 1, minWidth: '180px' }}
          >
            <option value="">— None / TBD —</option>
            {staff.map((u) => (
              <option key={u.uid} value={u.uid}>{u.displayName} ({u.role?.replace(/_/g, ' ')})</option>
            ))}
          </select>
          {userProfile && staff.some((u) => u.uid === userProfile.uid) && teamLeaderId !== userProfile.uid && (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setTeamLeaderId(userProfile.uid)}
            >
              Assign myself
            </button>
          )}
          {teamLeaderId === userProfile?.uid && (
            <span style={{ fontSize: '0.78rem', color: 'var(--ikpm-emerald-700)', fontWeight: 600 }}>✓ Assigned to you</span>
          )}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Assign technician(s) going for the visit</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
          {staff.map((u) => {
            const on = techIds.includes(u.uid);
            return (
              <button key={u.uid} type="button" className={`chip ${on ? 'chip-on' : ''}`} onClick={() => toggleTech(u.uid)}>
                {on && <Check size={14} />} {u.displayName}
              </button>
            );
          })}
        </div>
        {staff.length === 0 && <div className="cell-sub">No staff found. Add staff users to assign technicians.</div>}
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Instructions / notes</label>
        <textarea className="form-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Access instructions, specific areas to check, gate pass details…" />
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Record site inspection findings (pest findings for separate inspection visit)
// ---------------------------------------------------------------------------
export const SiteInspectionFindingsModal: React.FC<{ lead: Lead | null; onClose: () => void; onDone?: (lead: Lead) => void }> = ({ lead, onClose, onDone }) => {
  const { userProfile } = useAuth();
  const { success, error } = useNotification();
  const [pests, setPests] = useState<PestType[]>([]);
  const [severity, setSeverity] = useState<import('../../types/crm').InspectionAssessment['infestationSeverity']>('moderate');
  const [area, setArea] = useState('');
  const [summary, setSummary] = useState('');
  const [treatment, setTreatment] = useState('');
  const [rows, setRows] = useState<RiskFinding[]>([]);
  const [photos, setPhotos] = useState<import('../../types/operations').SitePhoto[]>([]);
  const [reportTitle, setReportTitle] = useState('');
  const [observedBy, setObservedBy] = useState('');
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!lead) return;
    const si = lead.siteInspection;
    setPests(si?.pestTypesFound ?? lead.pestIssues ?? []);
    setSeverity(si?.infestationSeverity || 'moderate');
    setArea(si?.areaSqFt ? String(si.areaSqFt) : '');
    setSummary(si?.criticalFindings || '');
    setTreatment(si?.recommendedTreatment || '');
    setPhotos(si?.photos ?? []);
    setRows(si?.findings?.length ? si.findings : [newFinding()]);
    setReportTitle(si?.reportTitle || `Site Inspection Report - ${lead.companyName || lead.title}${si?.branchName ? ` (${si.branchName})` : ''}`);
    setObservedBy(si?.observedBy || '');
  }, [lead]);

  if (!lead) return null;

  const si = lead.siteInspection;
  const filled = rows.filter(findingFilled);
  const problems: string[] = [];
  if (!pests.length) problems.push('Select at least one pest found.');
  if (!filled.length && !summary.trim()) problems.push('Add at least one finding (observation and recommendation).');

  const scope = { ownerScope: 'client' as const, clientId: lead.existingCustomerId || lead.id, category: 'risk_assessment' as const };
  const setRow = (id: string, patch: Partial<RiskFinding>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const notify = (kind: 'success' | 'warning' | 'error', title: string, message: string) => (kind === 'error' ? error(title, message) : kind === 'warning' ? console.warn(title, message) : success(title, message));

  const save = () => {
    if (problems.length) return;
    const findings = rows.filter(findingFilled).map((r) => ({ ...r, observation: r.observation.trim(), risk: r.risk.trim(), recommendation: r.recommendation.trim(), location: r.location?.trim() || undefined }));
    let updated: Lead | undefined;
    try {
      updated = dataService.recordSiteInspectionFindings(
        lead.id,
        {
          pestTypesFound: pests,
          infestationSeverity: severity,
          areaSqFt: Number(area) || 0,
          criticalFindings: [summary.trim(), findingsSummary(findings)].filter(Boolean).join('\n') || '',
          recommendedTreatment: treatment.trim() || recommendedTreatmentOf({ findings }),
          photos,
          findings,
          reportTitle: reportTitle.trim() || undefined,
          observedBy: observedBy.trim() || undefined,
        },
        userProfile?.email
      );
    } catch (err) {
      return error('Could not save', err instanceof Error ? err.message : String(err));
    }
    if (updated) {
      success('Inspection findings saved', `${pests.length} pest type(s), ${findings.length} finding(s).`);
      onDone?.(updated);
    }
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Site inspection findings: ${lead.title}`}
      subtitle={si ? `${si.branchName || 'Main site'} · ${new Date(si.scheduledDate).toLocaleDateString('en-GB')}${si.assignedTechNames?.length ? ` · Tech: ${si.assignedTechNames.join(', ')}` : ''}` : 'Enter pest inspection findings'}
      maxWidth="920px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={problems.length > 0} title={problems.join('\n')}>Save inspection report</button>
        </>
      }
    >
      <div className="form-grid-2">
        <div className="form-group" style={{ gridColumn: 'span 2' }}>
          <label className="form-label">Report title</label>
          <input className="form-input" value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Observed by (client rep)</label>
          <input className="form-input" value={observedBy} onChange={(e) => setObservedBy(e.target.value)} placeholder="Client representative present" />
        </div>
        <div className="form-group">
          <label className="form-label">Prepared by</label>
          <input className="form-input" value={userProfile?.displayName || ''} disabled />
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
          <select className="form-select" value={severity} onChange={(e) => setSeverity(e.target.value as import('../../types/crm').InspectionAssessment['infestationSeverity'])}>
            <option value="low">Low</option>
            <option value="moderate">Moderate</option>
            <option value="high">High</option>
            <option value="severe">Severe</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Area (sq ft)</label>
          <input type="number" className="form-input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. 5000" />
        </div>
      </div>

      {/* Risk findings rows */}
      <div className="form-group">
        <label className="form-label">Risk findings</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {rows.map((r, idx) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr 1fr 88px auto', gap: '0.4rem', alignItems: 'start', padding: '0.5rem', border: '1px solid var(--border-subtle)', borderRadius: '0.4rem', background: 'var(--surface-card)' }}>
              <span className="cell-sub" style={{ paddingTop: '0.5rem' }}>{idx + 1}</span>
              <div>
                <div className="cell-sub" style={{ marginBottom: '0.2rem' }}>Location</div>
                <input className="form-input" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }} value={r.location || ''} onChange={(e) => setRow(r.id, { location: e.target.value })} placeholder="Where?" />
              </div>
              <div>
                <div className="cell-sub" style={{ marginBottom: '0.2rem' }}>Observation <span className="required">*</span></div>
                <textarea className="form-textarea" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem', minHeight: '2.5rem' }} rows={2} value={r.observation} onChange={(e) => setRow(r.id, { observation: e.target.value })} placeholder="What was seen" />
              </div>
              <div>
                <div className="cell-sub" style={{ marginBottom: '0.2rem' }}>Risk</div>
                <textarea className="form-textarea" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem', minHeight: '2.5rem' }} rows={2} value={r.risk} onChange={(e) => setRow(r.id, { risk: e.target.value })} placeholder="Risk to client" />
              </div>
              <div>
                <div className="cell-sub" style={{ marginBottom: '0.2rem' }}>Recommendation <span className="required">*</span></div>
                <textarea className="form-textarea" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem', minHeight: '2.5rem' }} rows={2} value={r.recommendation} onChange={(e) => setRow(r.id, { recommendation: e.target.value })} placeholder="Action to take" />
              </div>
              <div>
                <div className="cell-sub" style={{ marginBottom: '0.2rem' }}>Photo</div>
                <SinglePhotoField
                  scope={{ ...scope, category: 'risk_assessment' as const }}
                  subPath={`${lead.id}/site-inspection`}
                  photo={r.photo}
                  onChange={(p) => setRow(r.id, { photo: p ?? undefined })}
                  fileNamePrefix={`risk_${r.id}`}
                  caption="Risk assessment photo"
                  offlineCount={rows.filter((x) => x.photo?.imageUrl?.startsWith('data:')).length}
                  onNotify={notify}
                />
              </div>
              {rows.length > 1 && <button type="button" className="icon-btn" style={{ marginTop: '1.5rem' }} onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))} title="Remove"><Trash2 size={14} /></button>}
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '0.4rem' }} onClick={() => setRows((prev) => [...prev, newFinding()])}>
          <Plus size={14} /> Add finding
        </button>
      </div>

      <div className="form-group">
        <label className="form-label">Recommended treatment (for the proposal)</label>
        <textarea className="form-textarea" rows={2} value={treatment} onChange={(e) => setTreatment(e.target.value)} placeholder="Leave empty to use the findings' recommendations" />
      </div>

      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowMore((v) => !v)}>
        {showMore ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Summary notes and site photos
      </button>
      {showMore && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="form-group">
            <label className="form-label">Summary notes</label>
            <textarea className="form-textarea" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Additional context not covered by findings above" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">General site photos</label>
            <PhotoCapture<import('../../types/operations').SitePhoto>
              scope={{ ...scope, category: 'inspection_report' as const }}
              subPath={`${lead.id}/site-inspection`}
              idPrefix={`${lead.id}_si`}
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
  const [didInspection, setDidInspection] = useState(false);
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
  const [followUps, setFollowUps] = useState<MeetingFollowUp[]>([]);
  const [tlStatus, setTlStatus] = useState<'send_proposal' | 'waiting' | ''>('');
  const [meetingReportNote, setMeetingReportNote] = useState('');
  const [branches, setBranches] = useState<LeadBranch[]>([]);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!lead) return;
    const i = lead.inspection;
    const site = i?.siteName || [lead.area, lead.city].filter(Boolean).join(', ');
    const hasInspectionData = Boolean(i?.pestTypesFound?.length || i?.findings?.length || i?.criticalFindings);
    setDidInspection(hasInspectionData);
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
    // Populate followUps from saved data, or migrate legacy single clientRequest value
    if (i?.meetingFollowUps?.length) {
      setFollowUps(i.meetingFollowUps);
    } else if (i?.clientRequest) {
      const legacyTypes: MeetingFollowUpType[] =
        i.clientRequest === 'both' ? ['company_profile', 'proposal'] :
        i.clientRequest === 'more_info' ? ['other_documents'] :
        [i.clientRequest as MeetingFollowUpType];
      setFollowUps(legacyTypes.map((type, idx) => ({ id: `fu_${idx}`, type })));
    } else {
      setFollowUps([]);
    }
    setMeetingReportNote(i?.meetingReportNote || '');
    setTlStatus(i?.tlStatus || '');
    setBranches(lead.branches ?? []);
    setShowMore(Boolean(i?.photos?.length || (!i?.findings?.length && i?.criticalFindings)));
  }, [lead]);

  if (!lead) return null;
  const filled = rows.filter(findingFilled);
  const problems: string[] = [];
  if (didInspection) {
    if (!pests.length) problems.push('Select at least one pest found.');
    if (!filled.length && !summary.trim()) problems.push('Add at least one finding (observation and recommendation).');
    if (rows.some((r) => findingFilled(r) && (!r.observation.trim() || !r.recommendation.trim()))) problems.push('Each finding needs an observation and a recommendation.');
  }

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

  const toggleFollowUp = (type: MeetingFollowUpType, checked: boolean) => {
    setFollowUps((prev) =>
      checked
        ? [...prev.filter((f) => f.type !== type), { id: `fu_${Date.now()}`, type }]
        : prev.filter((f) => f.type !== type)
    );
  };
  const updateFollowUp = (type: MeetingFollowUpType, patch: Partial<MeetingFollowUp>) => {
    setFollowUps((prev) => prev.map((f) => (f.type === type ? { ...f, ...patch } : f)));
  };
  const toggleDone = (type: MeetingFollowUpType) => {
    setFollowUps((prev) =>
      prev.map((f) => (f.type === type ? { ...f, doneAt: f.doneAt ? undefined : new Date().toISOString() } : f))
    );
  };

  const save = () => {
    if (problems.length) return;
    const findings = didInspection ? rows.filter(findingFilled).map((r) => ({ ...r, observation: r.observation.trim(), risk: r.risk.trim(), recommendation: r.recommendation.trim(), location: r.location?.trim() || undefined })) : [];

    // Derive legacy clientRequest from checklist for backward compat
    const hasProfile = followUps.some((f) => f.type === 'company_profile');
    const hasProposal = followUps.some((f) => f.type === 'proposal');
    const notInterested = followUps.some((f) => f.type === 'not_interested');
    const contractReady = followUps.some((f) => f.type === 'contract_ready');
    const derivedClientRequest: InspectionAssessment['clientRequest'] | undefined =
      notInterested ? 'not_interested' :
      contractReady ? 'contract_ready' :
      (hasProfile && hasProposal) ? 'both' :
      hasProposal ? 'proposal' :
      hasProfile ? 'company_profile' :
      followUps.length ? 'more_info' : undefined;

    let updated: Lead | undefined;
    try {
      const validBranches = branches.filter((b) => b.name.trim() || b.address.trim());
      updated = store.recordInspectionFindings(
        lead.id,
        {
          pestTypesFound: didInspection ? pests : [],
          infestationSeverity: didInspection ? severity : 'moderate',
          areaSqFt: didInspection ? (Number(area) || 0) : 0,
          criticalFindings: didInspection ? [summary.trim(), findingsSummary(findings)].filter(Boolean).join('\n') : '',
          recommendedTreatment: didInspection ? (treatment.trim() || recommendedTreatmentOf({ findings })) : '',
          photos: didInspection ? photos : [],
          findings: didInspection ? findings : [],
          reportTitle: reportTitle.trim() || undefined,
          siteName: siteName.trim() || undefined,
          observedBy: observedBy.trim() || undefined,
          teamLeaderNotes: teamLeaderNotes.trim() || undefined,
          clientRequest: derivedClientRequest,
          meetingFollowUps: followUps.length ? followUps : undefined,
          meetingReportNote: meetingReportNote.trim() || undefined,
          tlStatus: tlStatus || undefined,
        },
        userProfile?.email,
        validBranches.length ? validBranches : undefined
      );
    } catch (err) {
      return error('Could not save findings', err instanceof Error ? err.message : String(err));
    }
    if (updated) {
      const fuNames = followUps.filter((f) => f.type !== 'not_interested').map((f) => ({ company_profile: 'Company profile', proposal: 'Proposal', inspection: 'Inspection', other_documents: 'Documents', contract_ready: 'Ready to sign', not_interested: 'Not interested' }[f.type])).filter(Boolean).join(', ');
      success('Meeting report saved', fuNames ? `Client asked for: ${fuNames}.` : `${lead.title} findings recorded.`);
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
      subtitle={lead.inspection?.scheduledDate ? (() => {
        const i = lead.inspection!;
        const conductors = (i.inspectorNames ?? []).filter((n) => n !== i.assignedTeamLeaderName);
        return `Visit on ${new Date(i.scheduledDate).toLocaleDateString('en-GB')}${i.assignedTeamLeaderName ? ` · Leader: ${i.assignedTeamLeaderName}` : ''}${conductors.length ? ` · Conducted by: ${conductors.join(', ')}` : ''}`;
      })() : 'Enter findings'}
      maxWidth="920px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={problems.length > 0} title={problems.join('\n')}>Save findings</button>
        </>
      }
    >
      {lead.inspection?.instructions && <div className="info-hint" style={{ marginBottom: '1rem' }}><strong>Instructions:</strong> {lead.inspection.instructions}</div>}

      {/* Inspection toggle */}
      <label className="doc-check" style={{ marginBottom: '1rem', border: `1px solid ${didInspection ? 'var(--ikpm-emerald-600)' : 'var(--border-subtle)'}`, background: didInspection ? 'var(--ikpm-emerald-50)' : undefined }}>
        <input type="checkbox" checked={didInspection} onChange={(e) => setDidInspection(e.target.checked)} />
        <span><strong>Inspection was also conducted</strong> — pest findings, risk assessment, photos</span>
      </label>

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

      {/* Meeting outcome checklist — tick everything the client asked for, mark done when delivered */}
      <div className="form-group" style={{ background: 'var(--ikpm-emerald-50)', border: '1px solid var(--ikpm-emerald-200)', borderRadius: '0.5rem', padding: '0.85rem 1rem' }}>
        <label className="form-label" style={{ color: 'var(--ikpm-emerald-800)', fontWeight: 700, marginBottom: '0.5rem', display: 'block' }}>
          What did the client ask for? <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--ikpm-emerald-700)' }}>tick all that apply · mark done when delivered</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
          {([
            { type: 'company_profile' as MeetingFollowUpType, label: 'Company Profile', hint: 'Send IKPM company profile / brochure' },
            { type: 'proposal' as MeetingFollowUpType, label: 'Proposal / Quote', hint: 'Prepare a service proposal with pricing' },
            { type: 'inspection' as MeetingFollowUpType, label: 'Site Inspection (separate visit)', hint: 'Dedicated inspection visit — record the date below' },
            { type: 'other_documents' as MeetingFollowUpType, label: 'Other documents', hint: 'Specify what documents the client needs' },
            { type: 'contract_ready' as MeetingFollowUpType, label: 'Ready to sign', hint: 'Client is ready to proceed to a contract' },
            { type: 'not_interested' as MeetingFollowUpType, label: 'Not interested', hint: 'Client declined' },
          ]).map((opt) => {
            const fu = followUps.find((f) => f.type === opt.type);
            const checked = Boolean(fu);
            const isNegative = opt.type === 'not_interested';
            return (
              <div
                key={opt.type}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.65rem',
                  border: `1px solid ${checked ? (isNegative ? 'var(--color-error, #DC2626)' : 'var(--ikpm-emerald-400)') : 'var(--border-subtle)'}`,
                  borderRadius: '0.4rem',
                  background: checked ? (isNegative ? '#FEF2F2' : 'var(--ikpm-emerald-100)') : 'var(--surface-card)',
                }}
              >
                <input type="checkbox" checked={checked} onChange={(e) => toggleFollowUp(opt.type, e.target.checked)} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: checked ? 600 : undefined }} title={opt.hint}>{opt.label}</span>
                {opt.type === 'inspection' && checked && (
                  <input
                    type="date"
                    className="form-input"
                    style={{ width: '155px', padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                    value={fu?.scheduledDate || ''}
                    onChange={(e) => updateFollowUp('inspection', { scheduledDate: e.target.value })}
                    placeholder="Inspection date"
                  />
                )}
                {opt.type === 'other_documents' && checked && (
                  <input
                    type="text"
                    className="form-input"
                    style={{ flex: 2, minWidth: 0, padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                    value={fu?.note || ''}
                    onChange={(e) => updateFollowUp('other_documents', { note: e.target.value })}
                    placeholder="What documents?"
                  />
                )}
                {checked && !isNegative && (
                  <button
                    type="button"
                    className={`btn btn-xs ${fu?.doneAt ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flexShrink: 0, padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                    onClick={() => toggleDone(opt.type)}
                    title={fu?.doneAt ? `Done on ${new Date(fu.doneAt).toLocaleDateString('en-GB')}` : 'Mark as done when delivered'}
                  >
                    {fu?.doneAt ? '✓ Done' : 'Mark done'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <textarea
          className="form-textarea"
          rows={2}
          value={meetingReportNote}
          onChange={(e) => setMeetingReportNote(e.target.value)}
          placeholder="Meeting outcome note — anything else discussed, verbal agreements, follow-up points…"
        />
        {/* TL decision gate — controls when proposal button unlocks */}
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--ikpm-emerald-200)' }}>
          <label className="form-label" style={{ color: 'var(--ikpm-emerald-800)', fontWeight: 700, marginBottom: '0.4rem', display: 'block' }}>
            Team Leader decision <span style={{ fontWeight: 400, fontSize: '0.8rem' }}>— required before a proposal can be created</span>
          </label>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer',
              padding: '0.4rem 0.75rem', borderRadius: '0.4rem', fontSize: '0.875rem', fontWeight: 600,
              border: `1px solid ${tlStatus === 'send_proposal' ? 'var(--ikpm-emerald-600)' : 'var(--border-subtle)'}`,
              background: tlStatus === 'send_proposal' ? 'var(--ikpm-emerald-600)' : 'var(--surface-card)',
              color: tlStatus === 'send_proposal' ? '#fff' : 'var(--text-primary)',
            }}>
              <input type="radio" name="tlStatus" style={{ display: 'none' }} checked={tlStatus === 'send_proposal'} onChange={() => setTlStatus('send_proposal')} />
              ✓ Ready — send proposal
            </label>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer',
              padding: '0.4rem 0.75rem', borderRadius: '0.4rem', fontSize: '0.875rem', fontWeight: 600,
              border: `1px solid ${tlStatus === 'waiting' ? '#D97706' : 'var(--border-subtle)'}`,
              background: tlStatus === 'waiting' ? '#FFFBEB' : 'var(--surface-card)',
              color: tlStatus === 'waiting' ? '#92400E' : 'var(--text-primary)',
            }}>
              <input type="radio" name="tlStatus" style={{ display: 'none' }} checked={tlStatus === 'waiting'} onChange={() => setTlStatus('waiting')} />
              ⏳ Hold — need inspection / more steps
            </label>
          </div>
        </div>
      </div>

      {didInspection && <>
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
      </>}

      {problems.length > 0 && <ul className="form-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </Modal>
  );
};
