import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Search, MapPin, Phone, MessageCircle, CalendarClock } from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { EmptyState } from '../../components/common/EmptyState';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { MeetingReportModal, ScheduleInspectionModal, ScheduleSiteInspectionModal } from '../../features/leads/LeadActionModals';
import { canAccessModule, canEditModule } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { primaryContact } from '../../lib/leadWorkflow';
import { toWhatsAppNumber } from '../../services/outreachService';
import type { Lead } from '../../types/crm';

type Tab = 'upcoming' | 'today' | 'done';

const today = () => new Date().toISOString().slice(0, 10);

const MEETING_TYPE_LABEL: Record<string, string> = {
  first_meeting: 'First meeting',
  negotiation: 'Negotiation',
  renewal: 'Renewal',
};

/** Client meeting visits scheduled from the Leads pipeline. Team Leaders submit reports here. */
export const MeetingsPage: React.FC = () => {
  const store = useDataStore();
  const { userProfile, effectiveRole } = useAuth();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [mine, setMine] = useState(!canAccessModule(effectiveRole, 'crm'));
  const [query, setQuery] = useState('');
  const [reportLead, setReportLead] = useState<Lead | null>(null);
  const [scheduleLead, setScheduleLead] = useState<Lead | null>(null);
  const [inspectLead, setInspectLead] = useState<Lead | null>(null);
  const canRecord = canEditModule(effectiveRole, 'pco') || canEditModule(effectiveRole, 'inspections');
  const canOpenLeads = canAccessModule(effectiveRole, 'crm');

  const all = store.getLeads().filter((l) => l.inspection && l.inspection.status !== 'cancelled');
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const uid = userProfile?.uid || '';
    return all
      .filter((l) => !mine || l.inspection!.assignedTeamLeaderId === uid || (l.inspection!.inspectorIds ?? []).includes(uid))
      .filter((l) => !q || [l.title, l.city, l.area, l.inspection!.teamName, l.inspection!.assignedTeamLeaderName, l.inspection!.inspectorName].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [all, mine, query, userProfile?.uid]);

  const byTab = {
    today: filtered.filter((l) => l.inspection!.status === 'scheduled' && l.inspection!.scheduledDate <= today()),
    upcoming: filtered.filter((l) => l.inspection!.status === 'scheduled'),
    done: filtered.filter((l) => l.inspection!.status === 'completed'),
  };
  const rows = [...byTab[tab]].sort((a, b) =>
    tab === 'done'
      ? (b.inspection!.completedDate || '').localeCompare(a.inspection!.completedDate || '')
      : a.inspection!.scheduledDate.localeCompare(b.inspection!.scheduledDate)
  );

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
        <button className={`tab-btn ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>
          <CalendarClock size={16} /> Today & overdue <span className="tab-count">{byTab.today.length}</span>
        </button>
        <button className={`tab-btn ${tab === 'upcoming' ? 'active' : ''}`} onClick={() => setTab('upcoming')}>
          Scheduled <span className="tab-count">{byTab.upcoming.length}</span>
        </button>
        <button className={`tab-btn ${tab === 'done' ? 'active' : ''}`} onClick={() => setTab('done')}>
          <ClipboardCheck size={16} /> Done <span className="tab-count">{byTab.done.length}</span>
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div className="drive-search" style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <Search size={16} color="var(--text-muted)" />
          <input placeholder="Search company, city, team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {canOpenLeads && (
          <button type="button" className={`chip ${mine ? 'chip-on' : ''}`} onClick={() => setMine((v) => !v)}>Assigned to me</button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={tab === 'done' ? 'No completed meetings' : 'No meetings scheduled'}
          description={canOpenLeads ? 'Meetings are scheduled from the Leads pipeline.' : 'Meetings assigned to you will appear here.'}
        />
      ) : (
        <div className="table-container">
          <table className="data-table is-wide">
            <thead>
              <tr>
                <th>Date</th>
                <th>Company</th>
                <th>Contact</th>
                <th>Team leader</th>
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
                      {i.teamName && <div className="cell-title">{i.teamName}</div>}
                      {i.assignedTeamLeaderName || i.inspectorName || '—'}
                    </td>
                    <td className="cell-sub" style={{ maxWidth: 280 }}>
                      {i.status === 'completed'
                        ? <span style={{ textTransform: 'capitalize' }}>{MEETING_TYPE_LABEL[i.meetingType || 'first_meeting'] || i.meetingType}</span>
                        : i.instructions || '—'}
                    </td>
                    <td>
                      <div className="cell-actions" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
                        {canRecord && i.status === 'scheduled' && (
                          <button className="btn btn-sm btn-secondary" onClick={() => setScheduleLead(l)}>
                            <CalendarClock size={14} /> Reschedule
                          </button>
                        )}
                        {canRecord && i.status === 'completed' && (
                          <button className="btn btn-sm btn-secondary" onClick={() => setScheduleLead(l)}>
                            <CalendarClock size={14} /> Schedule another
                          </button>
                        )}
                        {canRecord && i.status === 'completed' &&
                          i.meetingFollowUps?.some((f) => f.type === 'inspection') &&
                          !l.siteInspection && (
                          <button className="btn btn-sm btn-primary" onClick={() => setInspectLead(l)}>
                            <ClipboardCheck size={14} /> Schedule inspection
                          </button>
                        )}
                        {canRecord && (
                          <button className={`btn btn-sm ${i.status === 'completed' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setReportLead(l)}>
                            <ClipboardCheck size={14} /> {i.status === 'completed' ? 'Edit report' : 'Submit report'}
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
