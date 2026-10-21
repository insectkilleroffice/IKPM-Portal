import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Search, MapPin, Phone, MessageCircle, CalendarClock, Download } from 'lucide-react';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { usePdfAction } from '../../hooks/usePdfAction';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { EmptyState } from '../../components/common/EmptyState';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { InspectionFindingsModal, PEST_OPTIONS } from '../../features/leads/LeadActionModals';
import { canAccessModule, canEditModule } from '../../lib/permissions';
import { formatDate } from '../../lib/formatters';
import { primaryContact } from '../../lib/leadWorkflow';
import { toWhatsAppNumber } from '../../services/outreachService';
import type { Lead } from '../../types/crm';

type Tab = 'upcoming' | 'today' | 'completed';

const today = () => new Date().toISOString().slice(0, 10);

/** Site inspections assigned from the Leads pipeline. Inspectors only see the visits assigned to them. */
export const InspectionsPage: React.FC = () => {
  const store = useDataStore();
  const { userProfile, effectiveRole } = useAuth();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [mine, setMine] = useState(!canAccessModule(effectiveRole, 'crm'));
  const [query, setQuery] = useState('');
  const [findingsLead, setFindingsLead] = useState<Lead | null>(null);
  const pdfAction = usePdfAction();
  const canRecord = canEditModule(effectiveRole, 'inspections') || canEditModule(effectiveRole, 'crm');
  const canOpenLeads = canAccessModule(effectiveRole, 'crm');

  const all = store.getLeads().filter((l) => l.inspection && l.inspection.status !== 'cancelled');
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return all
      .filter((l) => !mine || (l.inspection?.inspectorIds ?? l.inspectorIds ?? []).includes(userProfile?.uid || ''))
      .filter((l) => !q || [l.title, l.city, l.area, l.inspection?.teamName, l.inspection?.inspectorName].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [all, mine, query, userProfile?.uid]);

  const byTab = {
    today: filtered.filter((l) => l.inspection!.status === 'scheduled' && l.inspection!.scheduledDate <= today()),
    upcoming: filtered.filter((l) => l.inspection!.status === 'scheduled'),
    completed: filtered.filter((l) => l.inspection!.status === 'completed'),
  };
  const rows = [...byTab[tab]].sort((a, b) =>
    tab === 'completed'
      ? (b.inspection!.completedDate || '').localeCompare(a.inspection!.completedDate || '')
      : a.inspection!.scheduledDate.localeCompare(b.inspection!.scheduledDate)
  );

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Site inspections' }]} />
      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Site inspections</h1>
          <p className="page-subtitle">Visits scheduled from the Leads pipeline. After the visit, record the findings here so sales can prepare the proposal.</p>
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
          <input placeholder="Search company, city, team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {canOpenLeads && (
          <button type="button" className={`chip ${mine ? 'chip-on' : ''}`} onClick={() => setMine((v) => !v)}>Assigned to me</button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={tab === 'completed' ? 'No completed inspections' : 'No inspections scheduled'}
          description={canOpenLeads ? 'Schedule inspections for engaged leads from the Leads pipeline.' : 'Inspections assigned to you will appear here.'}
        />
      ) : (
        <div className="table-container">
          <table className="data-table is-wide">
            <thead>
              <tr>
                <th>Date</th>
                <th>Site</th>
                <th>Contact on site</th>
                <th>Team / inspectors</th>
                <th>{tab === 'completed' ? 'Findings' : 'Instructions'}</th>
                <th style={{ width: 170 }} />
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
                        {overdue ? <span className="badge-status badge-rose">Overdue</span> : i.timeSlot || ''}
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
                      {i.inspectorNames?.join(', ') || i.inspectorName}
                    </td>
                    <td className="cell-sub" style={{ maxWidth: 320 }}>
                      {i.status === 'completed'
                        ? <>{i.infestationSeverity} · {i.pestTypesFound.map((x) => PEST_OPTIONS.find((o) => o.value === x)?.label || x).join(', ')}</>
                        : i.instructions || '—'}
                    </td>
                    <td>
                      <div className="cell-actions">
                        {i.status === 'completed' && (
                          <button className="icon-btn" title="Download inspection report PDF" onClick={() => pdfAction.run(l.id, () => pdfGenerator.generateInspectionReportPDF(l))} disabled={pdfAction.busy === l.id}>
                            <Download size={15} />
                          </button>
                        )}
                        {canRecord && (
                          <button className={`btn btn-sm ${i.status === 'completed' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setFindingsLead(l)}>
                            <ClipboardCheck size={14} /> {i.status === 'completed' ? 'Edit findings' : 'Record findings'}
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

      <InspectionFindingsModal lead={findingsLead} onClose={() => setFindingsLead(null)} />
    </div>
  );
};

export default InspectionsPage;
