import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Search, MapPin, Phone, MessageCircle, CalendarClock, UserCog } from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { EmptyState } from '../../components/common/EmptyState';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { MeetingReportModal, ScheduleInspectionModal, ScheduleSiteInspectionModal } from '../../features/leads/LeadActionModals';
import { canAccessModule, canEditModule, baseRoleOf } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { primaryContact } from '../../lib/leadWorkflow';
import { toWhatsAppNumber } from '../../services/outreachService';
import type { Lead } from '../../types/crm';

type Tab = 'unassigned' | 'upcoming' | 'today' | 'done';

const today = () => new Date().toISOString().slice(0, 10);

const MEETING_TYPE_LABEL: Record<string, string> = {
  first_meeting: 'First meeting',
  negotiation: 'Negotiation',
  renewal: 'Renewal',
};

/** Client meeting visits scheduled from the Leads pipeline. Supervisors submit reports here. */
export const MeetingsPage: React.FC = () => {
  const store = useDataStore();
  const { userProfile, effectiveRole } = useAuth();
  const [tab, setTab] = useState<Tab>('upcoming');
  // Operations role has no CRO (crm) access but needs to see all meetings to assign supervisors.
  const [mine, setMine] = useState(!canAccessModule(effectiveRole, 'crm') && baseRoleOf(effectiveRole) !== 'operations');
  const [query, setQuery] = useState('');
  const [reportLead, setReportLead] = useState<Lead | null>(null);
  const [scheduleLead, setScheduleLead] = useState<Lead | null>(null);
  const [inspectLead, setInspectLead] = useState<Lead | null>(null);
  const canRecord = canEditModule(effectiveRole, 'pco') || canEditModule(effectiveRole, 'inspections');
  // Rescheduling and editing submitted reports is restricted to ops/admin/CRO.
  // Supervisors may only submit a new report; the operations coordinator handles the calendar.
  const canReschedule = canEditModule(effectiveRole, 'crm') || ['operations', 'admin', 'super_admin'].includes(baseRoleOf(effectiveRole) ?? '');
  // CRO can also assign a meeting / inspection — to himself or to any operations staff
  const canAssign = ['team_leader', 'operations', 'sales', 'super_admin', 'admin'].includes(baseRoleOf(effectiveRole) ?? '');
  const canOpenLeads = canAccessModule(effectiveRole, 'crm');
  // The meeting report is submitted by whoever attended (the assigned person or the extra staff);
  // admin / CEO may submit on anyone's behalf
  const isAttending = (i: NonNullable<Lead['inspection']>) =>
    !!userProfile?.uid && (i.assignedTeamLeaderId === userProfile.uid || (i.inspectorIds ?? []).includes(userProfile.uid));
  const isAdmin = ['admin', 'super_admin'].includes(baseRoleOf(effectiveRole) ?? '');

  const all = store.getLeads().filter((l) => l.inspection && l.inspection.status !== 'cancelled');
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const uid = userProfile?.uid || '';
    return all
      .filter((l) => !mine || l.inspection!.assignedTeamLeaderId === uid || (l.inspection!.inspectorIds ?? []).includes(uid))
      .filter((l) => !q || [l.title, l.city, l.area, l.inspection!.teamName, l.inspection!.assignedTeamLeaderName, l.inspection!.inspectorName].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [all, mine, query, userProfile?.uid]);

  const needsAssignment = (l: (typeof filtered)[0]) =>
    !l.inspection!.assignedTeamLeaderId || !l.inspection!.assignedTeamLeaderName;

  const hideCompleted = ['operations', 'team_leader'].includes(baseRoleOf(effectiveRole) ?? '');

  const byTab = {
    unassigned: filtered.filter((l) => l.inspection!.status === 'scheduled' && needsAssignment(l)),
    today: filtered.filter((l) => l.inspection!.status === 'scheduled' && l.inspection!.scheduledDate <= today()),
    upcoming: filtered.filter((l) => l.inspection!.status === 'scheduled'),
    done: hideCompleted ? [] : filtered.filter((l) => l.inspection!.status === 'completed'),
  };
  const rows = [...byTab[tab]].sort((a, b) =>
    tab === 'done'
      ? (b.inspection!.completedDate || '').localeCompare(a.inspection!.completedDate || '')
      : a.inspection!.scheduledDate.localeCompare(b.inspection!.scheduledDate)
  );
  const isUnassignedTab = tab === 'unassigned';

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Meetings' }]} />
      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Meetings</h1>
          <p className="page-subtitle">Client visit schedule. After each visit, submit the meeting report so sales can move the lead forward.</p>
        </div>
      </div>

      <div className="tab-bar" role="tablist">
        <button className={`tab-btn ${tab === 'unassigned' ? 'active' : ''}`} onClick={() => setTab('unassigned')} style={{ position: 'relative' }}>
          <UserCog size={16} /> Unassigned
          {byTab.unassigned.length > 0 && (
            <span className="tab-count" style={{ background: 'var(--ikpm-amber-500, #f59e0b)', color: '#fff' }}>{byTab.unassigned.length}</span>
          )}
          {byTab.unassigned.length === 0 && <span className="tab-count">{byTab.unassigned.length}</span>}
        </button>
        <button className={`tab-btn ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>
          <CalendarClock size={16} /> Today &amp; overdue <span className="tab-count">{byTab.today.length}</span>
        </button>
        <button className={`tab-btn ${tab === 'upcoming' ? 'active' : ''}`} onClick={() => setTab('upcoming')}>
          Scheduled <span className="tab-count">{byTab.upcoming.length}</span>
        </button>
        {!hideCompleted && (
          <button className={`tab-btn ${tab === 'done' ? 'active' : ''}`} onClick={() => setTab('done')}>
            <ClipboardCheck size={16} /> Done <span className="tab-count">{byTab.done.length}</span>
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div className="drive-search" style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <Search size={16} color="var(--text-muted)" />
          <input placeholder="Search company, city, team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {(canOpenLeads || canAccessModule(effectiveRole, 'pco')) && (
          <button type="button" className={`chip ${mine ? 'chip-on' : ''}`} onClick={() => setMine((v) => !v)}>Assigned to me</button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={tab === 'unassigned' ? UserCog : CalendarClock}
          title={tab === 'unassigned' ? 'No unassigned meetings' : tab === 'done' ? 'No completed meetings' : 'No meetings scheduled'}
          description={tab === 'unassigned' ? 'All scheduled meetings have a supervisor assigned.' : canOpenLeads ? 'Meetings are scheduled from the Leads pipeline.' : 'Meetings assigned to you will appear here.'}
        />
      ) : (
        <div className="table-container">
          <table className="data-table is-wide">
            <thead>
              <tr>
                <th>Date</th>
                <th>Company</th>
                <th>Contact</th>
                <th>Supervisor</th>
                <th>{tab === 'done' ? 'Meeting type' : 'Instructions'}</th>
                <th style={{ width: 180 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const i = l.inspection!;
                const p = primaryContact(l);
                const overdue = i.status === 'scheduled' && i.scheduledDate < today();
                return (
                  <tr key={l.id}>
                    <td>
                      <div className="cell-title">{formatDate(i.status === 'completed' ? i.completedDate : i.scheduledDate)}</div>
                      <div className="cell-sub" style={{ textTransform: 'capitalize' }}>
                        {overdue
                          ? <span className="badge-status badge-rose">Overdue</span>
                          : <>{i.scheduledTime && <strong style={{ color: 'var(--ikpm-emerald-700)' }}>{i.scheduledTime} · </strong>}{i.timeSlot || ''}</>
                        }
                      </div>
                    </td>
                    <td>
                      <div className="cell-title">{canOpenLeads ? <Link to={`/crm?lead=${l.id}`}>{l.title}</Link> : l.title}</div>
                      <div className="cell-sub"><MapPin size={12} style={{ verticalAlign: '-1px' }} /> {[l.propertyAddress, l.area, l.city].filter(Boolean).join(', ')}</div>
                    </td>
                    <td>
                      {p ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ minWidth: 0 }}>
                            <div>{p.name}</div>
                            <div className="cell-sub">{p.phone}</div>
                          </div>
                          <a className="icon-btn" href={`tel:${p.phone}`} title="Call"><Phone size={14} /></a>
                          <a className="icon-btn" href={`https://wa.me/${toWhatsAppNumber(p.phone)}`} target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={14} /></a>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="cell-sub">
                      {!needsAssignment(l) ? (
                        <>
                          {i.teamName && <div className="cell-title">{i.teamName}</div>}
                          {i.assignedTeamLeaderName || i.inspectorName}
                          {(() => {
                            const others = [...(i.inspectorNames ?? []).filter((n) => n !== i.assignedTeamLeaderName), ...(i.pcoEmployeeNames ?? []).map((n) => `${n} (PCO)`)];
                            return others.length ? <div style={{ fontSize: '0.72rem' }}>+ {others.join(', ')}</div> : null;
                          })()}
                        </>
                      ) : (
                        <span className="badge-status badge-amber" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Unassigned</span>
                      )}
                    </td>
                    <td className="cell-sub" style={{ maxWidth: 280 }}>
                      {i.status === 'completed'
                        ? <span style={{ textTransform: 'capitalize' }}>{MEETING_TYPE_LABEL[i.meetingType || 'first_meeting'] || i.meetingType}</span>
                        : i.instructions || '—'}
                    </td>
                    <td>
                      <div className="cell-actions" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
                        {canAssign && i.status === 'scheduled' && needsAssignment(l) && (
                          <button className="btn btn-sm btn-primary" onClick={() => setScheduleLead(l)}>
                            <UserCog size={14} /> Assign team
                          </button>
                        )}
                        {canReschedule && i.status === 'scheduled' && !needsAssignment(l) && (
                          <button className="btn btn-sm btn-secondary" onClick={() => setScheduleLead(l)}>
                            <CalendarClock size={14} /> Reschedule
                          </button>
                        )}
                        {canReschedule && i.status === 'completed' && (
                          <button className="btn btn-sm btn-secondary" onClick={() => setScheduleLead(l)}>
                            <CalendarClock size={14} /> Schedule another
                          </button>
                        )}
                        {canAssign && i.status === 'completed' &&
                          (i.meetingFollowUps?.some((f) => f.type === 'inspection') ||
                           i.inspectionHandling === 'tl_schedule' || i.inspectionHandling === 'separate_visit') &&
                          !l.siteInspection && (
                          <button className="btn btn-sm btn-primary" onClick={() => setInspectLead(l)}>
                            <ClipboardCheck size={14} /> Schedule inspection
                          </button>
                        )}
                        {canRecord && i.status === 'scheduled' && (isAttending(i) || isAdmin) && (
                          <button className="btn btn-sm btn-primary" onClick={() => setReportLead(l)}>
                            <ClipboardCheck size={14} /> Submit report
                          </button>
                        )}
                        {canReschedule && i.status === 'completed' && (
                          <button className="btn btn-sm btn-secondary" onClick={() => setReportLead(l)}>
                            <ClipboardCheck size={14} /> Edit report
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
      )}

      <MeetingReportModal lead={reportLead} onClose={() => setReportLead(null)} onDone={() => setReportLead(null)} />
      <ScheduleInspectionModal lead={scheduleLead} onClose={() => setScheduleLead(null)} onDone={() => setScheduleLead(null)} />
      <ScheduleSiteInspectionModal lead={inspectLead} onClose={() => setInspectLead(null)} onDone={() => setInspectLead(null)} />
    </div>
  );
};

export default MeetingsPage;
