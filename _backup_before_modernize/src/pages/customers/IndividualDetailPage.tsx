import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  User,
  MapPin,
  Phone,
  Mail,
  Plus,
  FileSpreadsheet,
  FileSignature,
  Truck,
  Receipt,
  FileText,
  FileCheck2,
  Paperclip,
  History,
  CreditCard,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatPKR, formatCNIC, formatDate, formatDateTime } from '../../lib/formatters';
import { useAuth } from '../../contexts/AuthContext';

export const IndividualDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();

  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'sites'
    | 'leads'
    | 'proposals'
    | 'contracts'
    | 'jobs'
    | 'invoices'
    | 'statements'
    | 'documents'
    | 'audit'
  >('overview');

  const client = dataService.getClientById(id || '');
  const sites = dataService.getSites(id);
  const leads = dataService.getLeads().filter((l) => l.existingCustomerId === id);
  const proposals = dataService.getProposals(id);
  const contracts = dataService.getContracts(id);
  const jobs = dataService.getJobs(id);
  const invoices = dataService.getInvoices(id);
  const auditLogs = dataService.getAuditLogs('client', id);

  if (!client) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <h2>Client Record Not Found</h2>
        <p style={{ color: 'var(--text-muted)' }}>No individual client with ID {id} was found.</p>
        <button className="btn btn-primary" onClick={() => navigate('/customers')}>
          Return to Customer Accounts
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <Breadcrumbs
        items={[
          { label: 'Customer Accounts', path: '/customers' },
          { label: `${client.fullName} (${client.id})` },
        ]}
      />

      {/* Individual Client Header */}
      <div
        className="card"
        style={{
          marginBottom: '1.5rem',
          padding: '1.75rem',
          borderLeft: '4px solid var(--ikpm-emerald-600)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span className="badge-status badge-navy" style={{ fontFamily: 'monospace' }}>
                {client.id}
              </span>
              <span className={`badge-status ${client.taxStatus === 'active_filer' ? 'badge-emerald' : 'badge-slate'}`}>
                {client.taxStatus.replace('_', ' ')}
              </span>
              <span className="badge-status badge-slate">Individual Client</span>
            </div>

            <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginTop: '0.35rem' }}>
              {client.fullName}
            </h1>

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.85rem', fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <MapPin size={14} color="var(--text-muted)" />
                <span>{client.residentialAddress}, {client.city}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Phone size={14} color="var(--text-muted)" />
                <span>{client.primaryPhone}</span>
              </div>
              {client.cnic && (
                <div>
                  <strong>CNIC:</strong> {formatCNIC(client.cnic)}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ padding: '0.75rem 1.25rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)', textAlign: 'right' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Outstanding Balance</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: client.balance > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                {formatPKR(client.balance)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 10 Individual Tabs */}
      <div className="tab-bar">
        <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          Overview & Identity
        </button>
        <button className={`tab-btn ${activeTab === 'sites' ? 'active' : ''}`} onClick={() => setActiveTab('sites')}>
          <MapPin size={14} /> Sites & Residences ({sites.length})
        </button>
        <button className={`tab-btn ${activeTab === 'leads' ? 'active' : ''}`} onClick={() => setActiveTab('leads')}>
          <FileText size={14} /> Inquiries & Inspections ({leads.length})
        </button>
        <button className={`tab-btn ${activeTab === 'proposals' ? 'active' : ''}`} onClick={() => setActiveTab('proposals')}>
          <FileSpreadsheet size={14} /> Proposals ({proposals.length})
        </button>
        <button className={`tab-btn ${activeTab === 'contracts' ? 'active' : ''}`} onClick={() => setActiveTab('contracts')}>
          <FileSignature size={14} /> Service Contracts ({contracts.length})
        </button>
        <button className={`tab-btn ${activeTab === 'jobs' ? 'active' : ''}`} onClick={() => setActiveTab('jobs')}>
          <Truck size={14} /> Field Jobs ({jobs.length})
        </button>
        {hasRole(['super_admin', 'management', 'finance']) && (
          <>
            <button className={`tab-btn ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>
              <Receipt size={14} /> Invoices & Receipts ({invoices.length})
            </button>
            <button className={`tab-btn ${activeTab === 'statements' ? 'active' : ''}`} onClick={() => setActiveTab('statements')}>
              <FileCheck2 size={14} /> Ledger & Statements
            </button>
          </>
        )}
        <button className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>
          <Paperclip size={14} /> Documents & ID
        </button>
        <button className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
          <History size={14} /> Audit Trail ({auditLogs.length})
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--ikpm-navy-900)' }}>
              Individual Profile Particulars
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Permanent Client ID:</span>
                <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{client.id}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>CNIC Identity:</span>
                <div style={{ fontWeight: 600 }}>{client.cnic ? formatCNIC(client.cnic) : 'Not Provided'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Primary Contact Phone:</span>
                <div style={{ fontWeight: 600 }}>{client.primaryPhone}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Secondary Landline:</span>
                <div style={{ fontWeight: 600 }}>{client.secondaryPhone || '—'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Email Address:</span>
                <div style={{ fontWeight: 600 }}>{client.email || '—'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>City / Region:</span>
                <div style={{ fontWeight: 600 }}>{client.city}, {client.province}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--ikpm-navy-900)' }}>
              Residential Treatment Location
            </h3>
            <div style={{ fontSize: '0.85rem' }}>
              <div><strong>Area / Sector:</strong> {client.area}</div>
              <div style={{ marginTop: '0.4rem' }}><strong>Full Address:</strong> {client.residentialAddress}</div>
              <div style={{ marginTop: '0.75rem', padding: '0.65rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)' }}>
                <strong>Account Relationship:</strong> Managed by IKPM Residential Services Division
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Jobs Tab */}
      {activeTab === 'jobs' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Scheduled Date & Slot</th>
                <th>Target Pests</th>
                <th>Lead PCO</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No service visits recorded for this client yet.
                  </td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={j.id}>
                    <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{j.id}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{formatDate(j.scheduledDate)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Slot: {j.timeSlot}</div>
                    </td>
                    <td>{j.targetPests.join(', ')}</td>
                    <td>{j.leadPcoName}</td>
                    <td><StatusBadge status={j.status} /></td>
                    <td>
                      <button
                        className="btn btn-outline-emerald"
                        style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                        onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
