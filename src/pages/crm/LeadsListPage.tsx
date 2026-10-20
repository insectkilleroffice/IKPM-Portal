import React, { useState } from 'react';
import { useDataStore } from '../../hooks/useDataStore';
import { SendDocumentsModal } from '../../features/outreach/SendDocumentsModal';
import { OutreachHistory } from '../../features/outreach/OutreachHistory';
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
  Send,
  Building2,
  UserPlus,
  ClipboardCheck,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { formatPKR, formatDate, generatePermanentId } from '../../lib/formatters';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import type { Lead, LeadStage, LeadSource, PestType, InspectionAssessment } from '../../types/crm';
import type { IndividualClient, CompanyMaster, SiteAddress } from '../../types/customer';
import { getLeadNextAction } from '../../lib/workflow';

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
  useDataStore();
  const [sendLead, setSendLead] = useState<Lead | null>(null);

  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewLeadModal, setShowNewLeadModal] = useState(searchParams.get('action') === 'new_lead');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // Convert Won Lead to Client Modal State
  const [showConvertModal, setShowConvertModal] = useState<Lead | null>(null);
  const [convertType, setConvertType] = useState<'individual' | 'company'>('company');
  const [convertForm, setConvertForm] = useState({
    name: '',
    phone: '',
    email: '',
    cnicOrNtn: '',
    city: 'Karachi',
    area: '',
    address: '',
    province: 'Sindh' as 'Sindh' | 'Punjab' | 'Islamabad_ICT' | 'KPK' | 'Balochistan',
  });

  // Schedule / Complete Inspection Modal State
  const [showInspectionModal, setShowInspectionModal] = useState<Lead | null>(null);
  const [inspectionForm, setInspectionForm] = useState({
    scheduledDate: new Date().toISOString().split('T')[0],
    inspectorName: 'Kamran Abbasi (Inspector)',
    infestationSeverity: 'moderate' as 'low' | 'moderate' | 'high' | 'severe',
    pestTypesFound: ['termites'] as PestType[],
    areaSqFt: 2500,
    criticalFindings: 'Perimeter pest harbor observed along floor skirting.',
    recommendedTreatment: 'Drill & sub-slab pressure chemical barrier injection.',
  });

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

  const handleExecuteLeadAction = (lead: Lead) => {
    const nextAct = getLeadNextAction(lead);
    if (nextAct.actionType === 'create_client') {
      const isCo = lead.customerType === 'company';
      setConvertType(isCo ? 'company' : 'individual');
      const prov =
        lead.city.toLowerCase().includes('lahore') || lead.city.toLowerCase().includes('faisalabad')
          ? 'Punjab'
          : lead.city.toLowerCase().includes('islamabad') || lead.city.toLowerCase().includes('rawalpindi')
          ? 'Islamabad_ICT'
          : 'Sindh';
      setConvertForm({
        name: isCo ? lead.title : lead.contactName,
        phone: lead.phone,
        email: lead.email || '',
        cnicOrNtn: '',
        city: lead.city || 'Karachi',
        area: lead.area || '',
        address: lead.propertyAddress || '',
        province: prov,
      });
      setShowConvertModal(lead);
    } else if (nextAct.actionType === 'create_proposal') {
      const params = new URLSearchParams({
        action: 'new_proposal',
        fromLead: lead.id,
        customerName: lead.contactName || lead.title,
        customerType: lead.customerType || 'company',
        city: lead.city,
        address: lead.propertyAddress || lead.city,
        pests: lead.pestIssues.join(','),
        val: String(lead.estimatedValue || 50000),
      });
      if (lead.existingCustomerId) {
        params.set('customerId', lead.existingCustomerId);
      }
      navigate(`/proposals?${params.toString()}`);
    } else if (nextAct.actionType === 'schedule_inspection' || nextAct.actionType === 'complete_inspection') {
      setInspectionForm({
        scheduledDate: lead.inspection?.scheduledDate || new Date().toISOString().split('T')[0],
        inspectorName: lead.inspection?.inspectorName || 'Kamran Abbasi (Inspector)',
        infestationSeverity: lead.inspection?.infestationSeverity || 'moderate',
        pestTypesFound: lead.pestIssues.length > 0 ? lead.pestIssues : ['termites'],
        areaSqFt: lead.inspection?.areaSqFt || 2500,
        criticalFindings: lead.inspection?.criticalFindings || 'Active infestation evidence identified at site perimeter.',
        recommendedTreatment: lead.inspection?.recommendedTreatment || 'Targeted IPM chemical barrier application.',
      });
      setShowInspectionModal(lead);
    } else if (nextAct.actionType === 'send_documents') {
      setSendLead(lead);
    }
  };

  const handleSaveInspection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showInspectionModal) return;

    const insp: InspectionAssessment = {
      id: `INSP-${Date.now().toString().slice(-4)}`,
      leadId: showInspectionModal.id,
      scheduledDate: inspectionForm.scheduledDate,
      completedDate: new Date().toISOString().split('T')[0],
      inspectorId: 'tech_01',
      inspectorName: inspectionForm.inspectorName,
      pestTypesFound: inspectionForm.pestTypesFound,
      infestationSeverity: inspectionForm.infestationSeverity,
      areaSqFt: Number(inspectionForm.areaSqFt),
      criticalFindings: inspectionForm.criticalFindings,
      recommendedTreatment: inspectionForm.recommendedTreatment,
      photoEvidenceUrls: [],
      status: 'completed',
    };

    const updatedLead: Lead = {
      ...showInspectionModal,
      stage: 'inspection_completed',
      inspection: insp,
      pestIssues: inspectionForm.pestTypesFound,
    };

    dataService.saveLead(updatedLead, userProfile?.email);
    success('Inspection Completed & Logged', `Findings carried over. Ready to draft proposal.`);
    setShowInspectionModal(null);
    if (selectedLead?.id === updatedLead.id) {
      setSelectedLead(updatedLead);
    }
  };

  const handleConvertLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showConvertModal) return;

    const dups = dataService.checkDuplicates(convertForm.phone, convertForm.email, convertForm.cnicOrNtn);
    if (dups.length > 0) {
      warning('Duplicate Matches Detected', dups[0]);
    }

    if (convertType === 'individual') {
      const clientId = generatePermanentId('CL', dataService.getClients().length + 1);
      const client: IndividualClient = {
        id: clientId,
        type: 'individual',
        fullName: convertForm.name || showConvertModal.contactName,
        cnic: convertForm.cnicOrNtn || undefined,
        primaryPhone: convertForm.phone || showConvertModal.phone,
        email: convertForm.email || showConvertModal.email,
        residentialAddress: convertForm.address || showConvertModal.propertyAddress,
        city: convertForm.city,
        area: convertForm.area,
        province: convertForm.province,
        taxStatus: 'non_filer',
        status: 'active',
        balance: 0,
        createdAt: new Date().toISOString(),
        createdBy: userProfile?.displayName || 'Admin',
        updatedAt: new Date().toISOString(),
      };

      dataService.saveClient(client, userProfile?.email);

      const site: SiteAddress = {
        id: `SITE-${Date.now().toString().slice(-4)}`,
        siteName: `${client.fullName} Residence`,
        customerType: 'individual',
        customerId: client.id,
        propertyType: 'residential_house',
        addressLine1: client.residentialAddress,
        area: client.area,
        city: client.city,
        province: client.province,
        contactPersonName: client.fullName,
        contactPersonPhone: client.primaryPhone,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      dataService.saveSite(site);

      const updatedLead: Lead = {
        ...showConvertModal,
        stage: 'won',
        customerType: 'individual',
        existingCustomerId: client.id,
      };
      dataService.saveLead(updatedLead, userProfile?.email);
      success('Client Account Created (Won)', `${client.fullName} (${client.id})`);
      setShowConvertModal(null);
      navigate(`/customers/individual/${client.id}`);
    } else {
      const companyId = generatePermanentId('CO', dataService.getCompanies().length + 1);
      const company: CompanyMaster = {
        id: companyId,
        type: 'company',
        legalCompanyName: convertForm.name || showConvertModal.title,
        ntn: convertForm.cnicOrNtn || undefined,
        headOfficeAddress: convertForm.address || showConvertModal.propertyAddress,
        city: convertForm.city,
        province: convertForm.province,
        primaryContact: {
          id: `cont_${Date.now()}`,
          fullName: showConvertModal.contactName,
          phone: showConvertModal.phone,
          mobile: showConvertModal.phone,
          email: showConvertModal.email,
          isPrimary: true,
        },
        additionalContacts: [],
        industrySegment: 'corporate_office',
        billingPreference: 'centralized',
        taxStatus: 'active_filer',
        totalBranchesCount: 1,
        totalActiveContracts: 0,
        totalBalance: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
        createdBy: userProfile?.displayName || 'Admin',
        updatedAt: new Date().toISOString(),
      };

      dataService.saveCompany(company, userProfile?.email);

      const site: SiteAddress = {
        id: `SITE-${Date.now().toString().slice(-4)}`,
        siteName: `${company.legalCompanyName} Main Premises`,
        customerType: 'company',
        customerId: company.id,
        propertyType: 'commercial_office',
        addressLine1: company.headOfficeAddress,
        area: convertForm.area || showConvertModal.area,
        city: company.city,
        province: company.province,
        contactPersonName: company.primaryContact.fullName,
        contactPersonPhone: company.primaryContact.mobile,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      dataService.saveSite(site);

      const updatedLead: Lead = {
        ...showConvertModal,
        stage: 'won',
        customerType: 'company',
        existingCustomerId: company.id,
      };
      dataService.saveLead(updatedLead, userProfile?.email);
      success('Company Account Created (Won)', `${company.legalCompanyName} (${company.id})`);
      setShowConvertModal(null);
      navigate(`/customers/company/${company.id}`);
    }
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

                      {/* Next Action Single-Click Handoff */}
                      <div
                        style={{
                          marginTop: '0.65rem',
                          paddingTop: '0.5rem',
                          borderTop: '1px dashed var(--border-subtle)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Next Action:</span>
                        <button
                          className={`btn ${
                            getLeadNextAction(lead).actionType === 'create_client' ? 'btn-primary' : 'btn-outline-emerald'
                          }`}
                          style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem', fontWeight: 700 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExecuteLeadAction(lead);
                          }}
                        >
                          <span>{getLeadNextAction(lead).label}</span>
                          <ArrowRight size={11} />
                        </button>
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
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                        onClick={() => handleExecuteLeadAction(l)}
                      >
                        <span>{getLeadNextAction(l).label}</span>
                        <ArrowRight size={11} />
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                        onClick={() => setSelectedLead(l)}
                      >
                        Details
                      </button>
                    </div>
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

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-secondary" onClick={() => setSendLead(selectedLead)} title="Send authority letters, NTN/SRB, profile… via WhatsApp / Email">
                  <Send size={14} />
                  <span>Send Docs</span>
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    handleExecuteLeadAction(selectedLead);
                    setSelectedLead(null);
                  }}
                >
                  <span>{getLeadNextAction(selectedLead).label}</span>
                  <ArrowRight size={14} />
                </button>
              </div>
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

            {selectedLead.inspection && (
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--ikpm-emerald-50)', border: '1px solid var(--ikpm-emerald-200)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ color: 'var(--ikpm-emerald-800)' }}>Inspection Findings Recorded:</strong>
                  <span className="badge-status badge-emerald">Severity: {selectedLead.inspection.infestationSeverity.toUpperCase()}</span>
                </div>
                <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>
                  Area: <strong>{selectedLead.inspection.areaSqFt} sq ft</strong> • Inspector: {selectedLead.inspection.inspectorName}
                </div>
                <div style={{ fontSize: '0.78rem', marginTop: '2px', color: 'var(--text-secondary)' }}>
                  {selectedLead.inspection.criticalFindings}
                </div>
              </div>
            )}

            {selectedLead.notes && (
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)' }}>
                <strong>Inquiry Notes:</strong> {selectedLead.notes}
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem' }}>
              <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Documents shared</strong>
              <OutreachHistory related={{ kind: 'lead', id: selectedLead.id }} emptyText="No company documents sent to this lead yet." />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Convert Won Lead to Client / Company Account (Duplicate Check Step 1) */}
      {showConvertModal && (
        <Modal
          isOpen={Boolean(showConvertModal)}
          onClose={() => setShowConvertModal(null)}
          title="Convert Won Lead to Customer Account"
          subtitle={`Lead ID: ${showConvertModal.id} • Real-time Duplicate Verification on Phone, NTN, & CNIC`}
          maxWidth="640px"
        >
          <form onSubmit={handleConvertLead}>
            {/* Live Duplicate Warning */}
            {(() => {
              const liveDups = dataService.checkDuplicates(convertForm.phone, convertForm.email, convertForm.cnicOrNtn);
              return liveDups.length > 0 ? (
                <div
                  style={{
                    padding: '0.75rem',
                    backgroundColor: 'var(--ikpm-amber-100)',
                    border: '1px solid #FCD34D',
                    borderRadius: 'var(--radius-md)',
                    color: '#92400E',
                    marginBottom: '1rem',
                    fontSize: '0.825rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                    <AlertTriangle size={15} />
                    <span>Duplicate Check Alert:</span>
                  </div>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {liveDups.map((dup, i) => (
                      <li key={i}>{dup}</li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Account Structure Type <span className="required">*</span></label>
                <select
                  className="form-select"
                  value={convertType}
                  onChange={(e) => setConvertType(e.target.value as any)}
                >
                  <option value="company">Corporate Company Master</option>
                  <option value="individual">Individual Client</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  {convertType === 'company' ? 'Legal Company Name' : 'Client Full Name'} <span className="required">*</span>
                </label>
                <input
                  type="text"
                  required
                  className="form-input"
                  value={convertForm.name}
                  onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Primary Phone (Duplicate Checked) <span className="required">*</span></label>
                <input
                  type="text"
                  required
                  className="form-input"
                  value={convertForm.phone}
                  onChange={(e) => setConvertForm({ ...convertForm, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  className="form-input"
                  value={convertForm.email}
                  onChange={(e) => setConvertForm({ ...convertForm, email: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">
                  {convertType === 'company' ? 'Federal NTN (1234567-8)' : 'National CNIC (42101-xxxxxxx-x)'}
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={convertType === 'company' ? '0812345-7' : '42101-1234567-1'}
                  value={convertForm.cnicOrNtn}
                  onChange={(e) => setConvertForm({ ...convertForm, cnicOrNtn: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Province (Provincial Tax Jurisdiction)</label>
                <select
                  className="form-select"
                  value={convertForm.province}
                  onChange={(e) => setConvertForm({ ...convertForm, province: e.target.value as any })}
                >
                  <option value="Sindh">Sindh (SRB 13%)</option>
                  <option value="Punjab">Punjab (PRA 16%)</option>
                  <option value="Islamabad_ICT">Islamabad ICT (16%)</option>
                  <option value="KPK">KPK (KPRA 15%)</option>
                  <option value="Balochistan">Balochistan (BRA 15%)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">City</label>
                <input
                  type="text"
                  className="form-input"
                  value={convertForm.city}
                  onChange={(e) => setConvertForm({ ...convertForm, city: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Premises / Head Office Address</label>
                <input
                  type="text"
                  className="form-input"
                  value={convertForm.address}
                  onChange={(e) => setConvertForm({ ...convertForm, address: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowConvertModal(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {convertType === 'company' ? <Building2 size={15} /> : <UserPlus size={15} />}
                <span>Create Customer Account (Mark Won)</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Inspection Assessment (Step 1 Inspection Done -> Proposal) */}
      {showInspectionModal && (
        <Modal
          isOpen={Boolean(showInspectionModal)}
          onClose={() => setShowInspectionModal(null)}
          title={`Inspection Assessment: ${showInspectionModal.title}`}
          subtitle={`Lead ID: ${showInspectionModal.id} • Carry over findings directly to Proposal`}
          maxWidth="640px"
        >
          <form onSubmit={handleSaveInspection}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Inspection Date <span className="required">*</span></label>
                <input
                  type="date"
                  required
                  className="form-input"
                  value={inspectionForm.scheduledDate}
                  onChange={(e) => setInspectionForm({ ...inspectionForm, scheduledDate: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Inspector Name</label>
                <select
                  className="form-select"
                  value={inspectionForm.inspectorName}
                  onChange={(e) => setInspectionForm({ ...inspectionForm, inspectorName: e.target.value })}
                >
                  <option value="Kamran Abbasi (Inspector)">Kamran Abbasi (Inspector)</option>
                  <option value="Muhammad Asif (QC Supervisor)">Muhammad Asif (QC Supervisor)</option>
                  <option value="Irfan Jameel (Technician)">Irfan Jameel (Technician)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Infestation Severity</label>
                <select
                  className="form-select"
                  value={inspectionForm.infestationSeverity}
                  onChange={(e) => setInspectionForm({ ...inspectionForm, infestationSeverity: e.target.value as any })}
                >
                  <option value="low">Low (Early Stage / Preventive)</option>
                  <option value="moderate">Moderate (Visible Trails / Harbor)</option>
                  <option value="high">High (Extensive Structural Activity)</option>
                  <option value="severe">Severe (Critical Threat / Contamination)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Covered Area (Sq Ft) <span className="required">*</span></label>
                <input
                  type="number"
                  required
                  className="form-input"
                  value={inspectionForm.areaSqFt}
                  onChange={(e) => setInspectionForm({ ...inspectionForm, areaSqFt: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Critical Findings & Pest Activity</label>
              <textarea
                className="form-input"
                rows={2}
                value={inspectionForm.criticalFindings}
                onChange={(e) => setInspectionForm({ ...inspectionForm, criticalFindings: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Recommended Treatment / Scope</label>
              <textarea
                className="form-input"
                rows={2}
                value={inspectionForm.recommendedTreatment}
                onChange={(e) => setInspectionForm({ ...inspectionForm, recommendedTreatment: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowInspectionModal(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                <ClipboardCheck size={15} />
                <span>Save Inspection & Ready for Proposal</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {sendLead && (
        <SendDocumentsModal
          isOpen={Boolean(sendLead)}
          onClose={() => setSendLead(null)}
          recipient={{ name: sendLead.contactName, phone: sendLead.phone, email: sendLead.email }}
          related={{ kind: 'lead', id: sendLead.id, title: sendLead.title }}
          onSent={(results) => {
            // Automation: a brand-new lead that just received our documents has been contacted
            if (results.some((r) => r.ok) && sendLead.stage === 'new') {
              handleStageChange(sendLead, 'contacted');
              if (selectedLead?.id === sendLead.id) setSelectedLead({ ...sendLead, stage: 'contacted' });
            }
          }}
        />
      )}
    </div>
  );
};
