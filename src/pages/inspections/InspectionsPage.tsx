import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Search, MapPin, Phone, MessageCircle, CalendarClock, Download } from 'lucide-react';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { usePdfAction } from '../../hooks/usePdfAction';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { EmptyState } from '../../components/common/EmptyState';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { SiteInspectionFindingsModal, PEST_OPTIONS } from '../../features/leads/LeadActionModals';
import { canAccessModule, canEditModule } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { primaryContact } from '../../lib/leadWorkflow';
import { toWhatsAppNumber } from '../../services/outreachService';
import type { Lead, SiteInspection } from '../../types/crm';

/** Builds a SiteInspection-shaped view from an inline meeting inspection so it renders in the same table. */
function inlineAsSiteInspection(l: Lead): SiteInspection | null {
  const i = l.inspection;
  if (!i || i.inspectionHandling !== 'done_inline') return null;
  return {
    id: i.id || `inline-${l.id}`,
    status: i.status === 'completed' ? 'completed' : 'scheduled',
    scheduledDate: i.scheduledDate || i.completedDate || '',
    completedDate: i.completedDate,
    branchId: i.branchId,
    branchName: i.branchName,
    branchAddress: undefined,
    assignedTechIds: i.inspectorId ? [i.inspectorId] : [],
    assignedTechNames: i.inspectorName ? [i.inspectorName] : [],
    teamLeaderId: i.assignedTeamLeaderId,
    teamLeaderName: i.assignedTeamLeaderName,
    requestedAt: i.scheduledDate || '',
    requestedBy: i.inspectorName || '',
    pestTypesFound: i.pestTypesFound,
    infestationSeverity: i.infestationSeverity,
    areaSqFt: i.areaSqFt,
    criticalFindings: i.criticalFindings,
    recommendedTreatment: i.recommendedTreatment,
    photoEvidenceUrls: i.photoEvidenceUrls,
    photos: i.photos,
    findings: i.findings,
    reportTitle: i.reportTitle,
    observedBy: i.observedBy || i.inspectorName,
    notes: i.teamLeaderNotes,
  };
}

type Tab = 'upcoming' | 'today' | 'completed';

const today = () => new Date().toISOString().slice(0, 10);

/** Separate technical pest site inspections scheduled from the Leads pipeline. */
export const InspectionsPage: React.FC = () => {
  const { userProfile, effectiveRole } = useAuth();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [mine, setMine] = useState(!canAccessModule(effectiveRole, 'crm'));
  const [query, setQuery] = useState('');
  const [findingsLead, setFindingsLead] = useState<Lead | null>(null);
  const pdfAction = usePdfAction();
  const canRecord = canEditModule(effectiveRole, 'inspections') || canEditModule(effectiveRole, 'pco');
  const canOpenLeads = canAccessModule(effectiveRole, 'crm');
  const store = useDataStore();

  const getInspView = (l: Lead): SiteInspection | null =>
    l.siteInspection && l.siteInspection.status !== 'cancelled'
      ? l.siteInspection
      : inlineAsSiteInspection(l);

  const all = store.getLeads().filter((l) => getInspView(l) !== null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const uid = userProfile?.uid || '';
    return all.filter((l) => {
      const si = getInspView(l)!;
      if (mine && !(si.assignedTechIds ?? []).includes(uid) && si.teamLeaderId !== uid) return false;
      if (q && ![l.title, l.city, l.area, si.branchName, si.teamLeaderName, si.assignedTechNames?.join(' ')].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, mine, query, userProfile?.uid]);

  const byTab = {
    today: filtered.filter((l) => { const si = getInspView(l)!; return si.status === 'scheduled' && si.scheduledDate <= today(); }),
    upcoming: filtered.filter((l) => getInspView(l)!.status === 'scheduled'),
    completed: filtered.filter((l) => getInspView(l)!.status === 'completed'),
  };
  const rows = [...byTab[tab]].sort((a, b) => {
    const sa = getInspView(a)!, sb = getInspView(b)!;
    return tab === 'completed'
      ? (sb.completedDate || '').localeCompare(sa.completedDate || '')
      : sa.scheduledDate.localeCompare(sb.scheduledDate);
  });

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Site inspections' }]} />
      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Site inspections</h1>
          <p className="page-subtitle">Technical pest inspections scheduled from the Leads pipeline. Record findings so sales can prepare the proposal.</p>
        </div>
      </div>

      <div className="tab-bar" role="tablist">
        <button className={`tab-btn ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>
          <CalendarClock size={16} /> Today & overdue <span className="tab-count">{byTab.today.length}</span>
        </button>
        <button className={`tab-btn ${tab === 'upcoming' ? 'active' : ''}`} onClick={() => setTab('upcoming')}>
          Scheduled <span className="tab-count">{byTab.upcoming.length}</span>
        </button>
        <button className={`tab-btn ${tab === 'completed' ? 'active' : ''}`} onClick={() => setTab('completed')}>
          <ClipboardCheck size={16} /> Completed <span className="tab-count">{byTab.completed.length}</span>
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div className="drive-search" style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <Search size={16} color="var(--text-muted)" />
          <input placeholder="Search company, city, branch…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {canOpenLeads && (
          <button type="button" className={`chip ${mine ? 'chip-on' : ''}`} onClick={() => setMine((v) => !v)}>Assigned to me</button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={tab === 'completed' ? 'No completed inspections' : 'No site inspections scheduled'}
          description={canOpenLeads ? 'Schedule site inspections from the Leads pipeline after the client meeting.' : 'Site inspections assigned to you will appear here.'}
        />
      ) : (
        <div className="table-container">
          <table className="data-table is-wide">
            <thead>
              <tr>
                <th>Date</th>
                <th>Company / site</th>
                <th>Contact</th>
                <th>Team</th>
                <th>{tab === 'completed' ? 'Findings' : 'Notes'}</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const si = getInspView(l)!;
                const isInline = !l.siteInspection || l.siteInspection.status === 'cancelled';
                const p = primaryContact(l);
                const overdue = si.status === 'scheduled' && si.scheduledDate < today();
                return (
                  <tr key={l.id}>
                    <td>
                      <div className="cell-title">{formatDate(si.status === 'completed' ? si.completedDate : si.scheduledDate)}</div>
                      <div className="cell-sub">
                        {overdue ? <span className="badge-status badge-rose">Overdue</span> : null}
                        {isInline && <span className="badge-status badge-blue" style={{ marginLeft: overdue ? 4 : 0 }}>Done during meeting</span>}
                      </div>
                    </td>
                    <td>
                      <div className="cell-title">{canOpenLeads ? <Link to={`/crm?lead=${l.id}`}>{l.title}</Link> : l.title}</div>
                      {si.branchName
                        ? <div className="cell-sub"><MapPin size={12} style={{ verticalAlign: '-1px' }} /> {si.branchName}{si.branchAddress ? ` · ${si.branchAddress}` : ''}</div>
                        : <div className="cell-sub"><MapPin size={12} style={{ verticalAlign: '-1px' }} /> {[l.propertyAddress, l.area, l.city].filter(Boolean).join(', ')}</div>}
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
                      {si.teamLeaderName && <div className="cell-title">{si.teamLeaderName}</div>}
                      {si.assignedTechNames?.join(', ') || '—'}
                    </td>
                    <td className="cell-sub" style={{ maxWidth: 320 }}>
                      {si.status === 'completed'
                        ? <>{si.infestationSeverity} · {(si.pestTypesFound ?? []).map((x) => PEST_OPTIONS.find((o) => o.value === x)?.label || x).join(', ')}</>
                        : si.notes || '—'}
                    </td>
                    <td>
                      <div className="cell-actions">
                        {si.status === 'completed' && (
                          <button className="icon-btn" title="Download inspection report PDF" onClick={() => pdfAction.run(l.id, () => pdfGenerator.generateInspectionReportPDF(l))} disabled={pdfAction.busy === l.id}>
                            <Download size={15} />
                          </button>
                        )}
                        {canRecord && !isInline && (
                          <button className={`btn btn-sm ${si.status === 'completed' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setFindingsLead(l)}>
                            <ClipboardCheck size={14} /> {si.status === 'completed' ? 'Edit findings' : 'Record findings'}
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

      <SiteInspectionFindingsModal lead={findingsLead} onClose={() => setFindingsLead(null)} onDone={() => setFindingsLead(null)} />
    </div>
  );
};

export default InspectionsPage;
