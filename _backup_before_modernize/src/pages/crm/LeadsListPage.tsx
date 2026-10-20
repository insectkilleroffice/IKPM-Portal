import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Users2,
  Plus,
  Search,
  Filter,
  CheckCircle,
  AlertTriangle,
  FileSpreadsheet,
  ArrowRight,
  Phone,
  MapPin,
  Calendar,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { formatPKR, formatDate, generatePermanentId } from '../../lib/formatters';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { Lead, LeadStage, LeadSource, PestType } from '../../types/crm';

const PIPELINE_STAGES: { stage: LeadStage; title: string }[] = [
  { stage: 'new', title: 'New Inquiries' },
  { stage: 'contacted', title: 'Contacted' },
  { stage: 'inspection_scheduled', title: 'Inspection Scheduled' },
  { stage: 'inspection_completed', title: 'Inspection Done' },
  { stage: 'qualified', title: 'Qualified Prospect' },
  { stage: 'proposal_drafted', title: 'Proposal Sent' },
  { stage: 'won', title: 'Won / Converted' },
  { stage: 'lost', title: 'Lost / Closed' },
];

export const LeadsListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { success, warning } = useNotification();
  const { userProfile } = useAuth();

  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewLeadModal, setShowNewLeadModal] = useState(searchParams.get('action') === 'new_lead');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // New Lead Form State
  const [newLead, setNewLead] = useState({
    title: '',
    source: 'whatsapp' as LeadSource,
    customerType: 'company' as const,
    contactName: '',
    phone: '',
    email: '',
    city: 'Karachi',
    area: '',
    propertyAddress: '',
    pestIssues: ['termites'] as PestType[],
    estimatedValue: 50000,
    notes: '',
  });

  const leads = dataService.getLeads();

  const filteredLeads = leads.filter((l) => {
    const q = searchQuery.toLowerCase();
    return (
      l.title.toLowerCase().includes(q) ||
      l.contactName.toLowerCase().includes(q) ||
      l.phone.includes(q) ||
      l.city.toLowerCase().includes(q) ||
      l.id.toLowerCase().includes(q)
    );
  });

  const handleCreateLead = (e: React.FormEvent) => {
    e.preventDefault();
    const dups = dataService.checkDuplicates(newLead.phone, newLead.email);
    if (dups.length > 0) {
      warning('Duplicate Warning Flagged', dups[0]);
    }

    const nextId = generatePermanentId('LD', leads.length + 1);
    const created: Lead = {
      id: nextId,
      title: newLead.title,
      source: newLead.source,
      stage: 'new',
      customerType: newLead.customerType,
      contactName: newLead.contactName,
      phone: newLead.phone,
      email: newLead.email,
      city: newLead.city,
      area: newLead.area,
      propertyAddress: newLead.propertyAddress,
      pestIssues: newLead.pestIssues,
      estimatedValue: newLead.estimatedValue,
      assignedToName: userProfile?.displayName || 'Salman (CEO)',
      notes: newLead.notes,
      duplicateWarning: dups.length > 0 ? dups.join(' | ') : undefined,
      createdAt: new Date().toISOString(),
      createdBy: userProfile?.displayName || 'Admin',
      updatedAt: new Date().toISOString(),
    };

    dataService.saveLead(created, userProfile?.email);
    success('Lead Inquiry Logged', `${created.title} (${created.id})`);
    setShowNewLeadModal(false);
  };

  const handleStageChange = (lead: Lead, newStage: LeadStage) => {
    const updated = { ...lead, stage: newStage };
    dataService.saveLead(updated, userProfile?.email);
    success('Pipeline Stage Updated', `${lead.title} is now ${newStage.replace('_', ' ')}`);
  };

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'CRM & Sales Pipeline' }]} />

      {/* Header */}
      <div className="page-header">
        <div className="page-title-wrap">
          <h1>CRM, Leads & Sales Pipeline</h1>
          <p className="page-subtitle">
            Capture inquiries from WhatsApp, Web, and Calls. Automatic duplicate detection and lead conversion.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div style={{ display: 'flex', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <button
              onClick={() => setViewMode('kanban')}
              style={{
                padding: '0.45rem 0.85rem',
                border: 'none',
                background: viewMode === 'kanban' ? 'var(--ikpm-emerald-600)' : 'none',
                color: viewMode === 'kanban' ? 'white' : 'var(--text-muted)',
                borderRadius: 'var(--radius-md) 0 0 var(--radius-md)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.8rem',
              }}
            >
              Kanban Board
            </button>
            <button
              onClick={() => setViewMode('table')}
              style={{
                padding: '0.45rem 0.85rem',
                border: 'none',
                background: viewMode === 'table' ? 'var(--ikpm-emerald-600)' : 'none',
                color: viewMode === 'table' ? 'white' : 'var(--text-muted)',
                borderRadius: '0 var(--radius-md) var(--radius-md) 0',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.8rem',
              }}
            >
              Table List
            </button>
          </div>

          <button className="btn btn-primary" onClick={() => setShowNewLeadModal(true)}>
            <Plus size={16} />
            <span>+ Capture New Lead</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ position: 'relative', width: '320px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search leads by title, contact, phone, city..."
            className="form-input"
            style={{ paddingLeft: '2.2rem', height: '36px', fontSize: '0.825rem' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Showing <strong>{filteredLeads.length}</strong> inquiries
        </div>
      </div>

      {/* Kanban Pipeline View */}
      {viewMode === 'kanban' ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
            overflowX: 'auto',
            alignItems: 'start',
          }}
        >
          {PIPELINE_STAGES.map(({ stage, title }) => {
            const stageLeads = filteredLeads.filter((l) => l.stage === stage);
            return (
              <div
                key={stage}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '1rem',
                  minHeight: '400px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>{title}</h4>
                  <span className="badge-status badge-slate" style={{ fontSize: '0.7rem' }}>
                    {stageLeads.length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      style={{
                        padding: '0.85rem',
                        backgroundColor: 'var(--bg-surface-alt)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                        borderLeft: lead.duplicateWarning ? '3px solid var(--ikpm-amber-500)' : '3px solid var(--ikpm-emerald-500)',
                        cursor: 'pointer',
                        transition: 'box-shadow 0.15s',
                      }}
                    >
                      {lead.duplicateWarning && (
                        <div
                          style={{
                            fontSize: '0.7rem',
                            color: '#92400E',
                            backgroundColor: 'var(--ikpm-amber-100)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <AlertTriangle size={11} />
                          <span>Possible Duplicate Customer</span>
                        </div>
                      )}

                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{lead.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {lead.contactName} • {lead.city}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.65rem' }}>
                        <span className="badge-status badge-navy" style={{ fontSize: '0.65rem' }}>
                          {lead.source}
                        </span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--ikpm-emerald-600)' }}>
                          {formatPKR(lead.estimatedValue)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lead ID & Title</th>
                <th>Source</th>
                <th>Contact Name & Phone</th>
                <th>City & Address</th>
                <th>Pest Issues</th>
                <th>Estimated Value</th>
                <th>Stage</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{l.title}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)', fontFamily: 'monospace' }}>
                      {l.id}
                    </div>
                  </td>
                  <td><span className="badge-status badge-navy">{l.source}</span></td>
                  <td>
                    <div>{l.contactName}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{l.phone}</div>
                  </td>
                  <td>
                    <div>{l.city}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{l.propertyAddress}</div>
                  </td>
                  <td>
                    {l.pestIssues.map((p) => (
                      <span key={p} className="badge-status badge-slate" style={{ fontSize: '0.65rem', marginRight: '2px' }}>
                        {p.replace('_', ' ')}
                      </span>
                    ))}
                  </td>
                  <td style={{ fontWeight: 700 }}>{formatPKR(l.estimatedValue)}</td>
                  <td><StatusBadge status={l.stage} /></td>
                  <td>
                    <button
                      className="btn btn-outline-emerald"
                      style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
                      onClick={() => setSelectedLead(l)}
                    >
                      View / Convert
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: New Lead Capture */}
      <Modal
        isOpen={showNewLeadModal}
        onClose={() => setShowNewLeadModal(false)}
        title="Capture New Lead Inquiry"
        subtitle="Records WhatsApp, Call, or Web inquiries with automated duplicate detection."
        maxWidth="640px"
      >
        <form onSubmit={handleCreateLead}>
          <div className="form-group">
            <label className="form-label">Inquiry Title / Description <span className="required">*</span></label>
            <input
              type="text"
              required
              className="form-input"
              placeholder="e.g. Termite Inspection for Warehouse Roof"
              value={newLead.title}
              onChange={(e) => setNewLead({ ...newLead, title: e.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Inquiry Source</label>
              <select
                className="form-select"
                value={newLead.source}
                onChange={(e) => setNewLead({ ...newLead, source: e.target.value as any })}
              >
                <option value="whatsapp">WhatsApp Business Platform</option>
                <option value="website_form">Website Inquiry Form</option>
                <option value="inbound_phone">Inbound Phone Call</option>
                <option value="referral">Client Referral</option>
                <option value="walk_in">Walk-in Customer</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Customer Profile Type</label>
              <select
                className="form-select"
                value={newLead.customerType}
                onChange={(e) => setNewLead({ ...newLead, customerType: e.target.value as any })}
              >
                <option value="company">Corporate / Commercial Company</option>
                <option value="individual">Individual Residential Client</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Contact Person Name <span className="required">*</span></label>
              <input
                type="text"
                required
                className="form-input"
                placeholder="e.g. Tariq Mehmood"
                value={newLead.contactName}
                onChange={(e) => setNewLead({ ...newLead, contactName: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Phone Number (Duplicate Check) <span className="required">*</span></label>
              <input
                type="text"
                required
                className="form-input"
                placeholder="03001234567"
                value={newLead.phone}
                onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">City</label>
              <select
                className="form-select"
                value={newLead.city}
                onChange={(e) => setNewLead({ ...newLead, city: e.target.value })}
              >
                <option value="Karachi">Karachi</option>
                <option value="Lahore">Lahore</option>
                <option value="Islamabad">Islamabad</option>
                <option value="Rawalpindi">Rawalpindi</option>
                <option value="Faisalabad">Faisalabad</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Estimated Deal Value (PKR)</label>
              <input
                type="number"
                className="form-input"
                value={newLead.estimatedValue}
                onChange={(e) => setNewLead({ ...newLead, estimatedValue: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Site / Property Address</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Plot 24, Industrial Area"
              value={newLead.propertyAddress}
              onChange={(e) => setNewLead({ ...newLead, propertyAddress: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowNewLeadModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Log Lead to Pipeline
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Lead Detail & Conversion Wizard */}
      {selectedLead && (
        <Modal
          isOpen={Boolean(selectedLead)}
          onClose={() => setSelectedLead(null)}
          title={`Lead: ${selectedLead.title}`}
          subtitle={`Lead ID: ${selectedLead.id} • Source: ${selectedLead.source}`}
          maxWidth="600px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Update Stage:</span>
                <select
                  className="form-select"
                  style={{ width: '170px', height: '32px', fontSize: '0.78rem' }}
                  value={selectedLead.stage}
                  onChange={(e) => {
                    handleStageChange(selectedLead, e.target.value as LeadStage);
                    setSelectedLead({ ...selectedLead, stage: e.target.value as LeadStage });
                  }}
                >
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s.stage} value={s.stage}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="btn btn-primary"
                onClick={() => {
                  setSelectedLead(null);
                  navigate(`/proposals?action=new_proposal&leadTitle=${encodeURIComponent(selectedLead.title)}`);
                }}
              >
                <span>Draft Proposal for Lead</span>
                <ArrowRight size={14} />
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
            {selectedLead.duplicateWarning && (
              <div
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'var(--ikpm-amber-100)',
                  border: '1px solid #FCD34D',
                  borderRadius: 'var(--radius-sm)',
                  color: '#92400E',
                }}
              >
                <strong>Duplicate Warning:</strong> {selectedLead.duplicateWarning}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Contact Person:</span>
                <div style={{ fontWeight: 700 }}>{selectedLead.contactName}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Phone Number:</span>
                <div style={{ fontWeight: 600 }}>{selectedLead.phone}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>City & Address:</span>
                <div>{selectedLead.propertyAddress || selectedLead.city}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Estimated Value:</span>
                <div style={{ fontWeight: 700, color: 'var(--ikpm-emerald-600)' }}>{formatPKR(selectedLead.estimatedValue)}</div>
              </div>
            </div>

            {selectedLead.notes && (
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)' }}>
                <strong>Inquiry Notes:</strong> {selectedLead.notes}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
