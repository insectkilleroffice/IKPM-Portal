import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Building2,
  GitFork,
  MapPin,
  Phone,
  Mail,
  Truck,
  FileSpreadsheet,
  FileSignature,
  Receipt,
  FileText,
  Paperclip,
  History,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatPKR, formatDate } from '../../lib/formatters';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { EntityDocumentsPanel } from '../../features/documents/EntityDocumentsPanel';

export const BranchDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  useDataStore();

  const [activeTab, setActiveTab] = useState<'overview' | 'sites' | 'jobs' | 'proposals' | 'contracts' | 'invoices' | 'documents'>('overview');

  const branch = dataService.getBranchById(id || '');
  const company = branch ? dataService.getCompanyById(branch.companyId) : undefined;
  const sites = dataService.getSites(undefined, id);
  const jobs = dataService.getJobs(undefined, id);
  const proposals = dataService.getProposals(undefined, id);
  const contracts = dataService.getContracts(undefined, id);
  const invoices = dataService.getInvoices(undefined, id);

  if (!branch || !company) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <h2>Branch Profile Not Found</h2>
        <p style={{ color: 'var(--text-muted)' }}>The requested branch record could not be located.</p>
        <button className="btn btn-primary" onClick={() => navigate('/customers')}>
          Return to Customer Accounts
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Hierarchy Breadcrumb linking back to Master Company */}
      <Breadcrumbs
        items={[
          { label: 'Customer Accounts', path: '/customers' },
          { label: company.legalCompanyName, path: `/customers/company/${company.id}` },
          { label: `Branch: ${branch.branchName} (${branch.id})` },
        ]}
      />

      {/* Branch Header */}
      <div
        className="card"
        style={{
          marginBottom: '1.5rem',
          padding: '1.75rem',
          borderLeft: '4px solid var(--ikpm-emerald-500)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span className="badge-status badge-navy" style={{ fontFamily: 'monospace' }}>
                {branch.id}
              </span>
              <span className="badge-status badge-slate">Code: {branch.branchCode || '—'}</span>
              <span className="badge-status badge-emerald">Branch of {company.legalCompanyName}</span>
            </div>

            <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginTop: '0.35rem' }}>
              {branch.branchName}
            </h1>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Parent Company:{' '}
              <Link to={`/customers/company/${company.id}`} style={{ color: 'var(--ikpm-navy-700)', fontWeight: 600 }}>
                {company.legalCompanyName} ({company.id})
              </Link>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.85rem', fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <MapPin size={14} color="var(--text-muted)" />
                <span>{branch.physicalAddress}, {branch.city}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Phone size={14} color="var(--text-muted)" />
                <span>{branch.branchPhone} (Mgr: {branch.branchManagerName})</span>
              </div>
              <div>
                <strong>Billing Structure:</strong>{' '}
                <span className={`badge-status ${branch.billingType === 'branch_invoice' ? 'badge-amber' : 'badge-navy'}`}>
                  {branch.billingType === 'branch_invoice' ? 'Direct Branch Invoice' : 'Consolidated HQ Billing'}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ padding: '0.75rem 1.25rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)', textAlign: 'right' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Branch Balance</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: branch.balance > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                {formatPKR(branch.balance)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Branch Tabs */}
      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Branch Overview
        </button>
        <button
          className={`tab-btn ${activeTab === 'sites' ? 'active' : ''}`}
          onClick={() => setActiveTab('sites')}
        >
          <MapPin size={14} />
          Branch Premises ({sites.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'jobs' ? 'active' : ''}`}
          onClick={() => setActiveTab('jobs')}
        >
          <Truck size={14} />
          Service Jobs ({jobs.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'proposals' ? 'active' : ''}`}
          onClick={() => setActiveTab('proposals')}
        >
          <FileSpreadsheet size={14} />
          Proposals ({proposals.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'contracts' ? 'active' : ''}`}
          onClick={() => setActiveTab('contracts')}
        >
          <FileSignature size={14} />
          Contracts ({contracts.length})
        </button>
        {hasRole(['super_admin', 'management', 'finance']) && (
          <button
            className={`tab-btn ${activeTab === 'invoices' ? 'active' : ''}`}
            onClick={() => setActiveTab('invoices')}
          >
            <Receipt size={14} />
            Invoices & Billing ({invoices.length})
          </button>
        )}
        <button
          className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
          onClick={() => setActiveTab('documents')}
        >
          <Paperclip size={14} />
          Documents
        </button>
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--ikpm-navy-900)' }}>
              Branch Operational Information
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Branch ID:</span>
                <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{branch.id}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Internal Branch Code:</span>
                <div style={{ fontWeight: 600 }}>{branch.branchCode || '—'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>City & Territory:</span>
                <div style={{ fontWeight: 600 }}>{branch.city}, {branch.province}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Local Tax Status:</span>
                <div style={{ fontWeight: 600 }}>{branch.localNtn ? `NTN: ${branch.localNtn}` : 'Inherits Company NTN'}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--ikpm-navy-900)' }}>
              Branch Management & Contact
            </h3>
            <div style={{ fontSize: '0.85rem' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{branch.branchManagerName}</div>
              <div style={{ color: 'var(--ikpm-emerald-600)', fontWeight: 600, marginBottom: '0.75rem' }}>
                Branch Operations Manager
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', color: 'var(--text-secondary)' }}>
                <div><strong>Mobile Phone:</strong> {branch.branchManagerPhone}</div>
                <div><strong>Direct Office Line:</strong> {branch.branchPhone}</div>
                {branch.branchEmail && <div><strong>Branch Email:</strong> {branch.branchEmail}</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Jobs */}
      {activeTab === 'jobs' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Scheduled Date & Slot</th>
                <th>Site Premises</th>
                <th>Target Pests</th>
                <th>Lead PCO</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No service jobs scheduled specifically for this branch yet.
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
                    <td>{j.siteName}</td>
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

      {/* Tab: Sites */}
      {activeTab === 'sites' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem' }}>
          {sites.map((s) => (
            <div key={s.id} className="card">
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{s.siteName}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                <MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} />
                {s.addressLine1}, {s.city}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                Contact: {s.contactPersonName} ({s.contactPersonPhone})
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'documents' && (
        <EntityDocumentsPanel
          owner={{ kind: 'branch', id: branch.id }}
          title={`${branch.companyName} — ${branch.branchName}`}
          recipient={{ name: branch.branchManagerName, phone: branch.branchManagerPhone || branch.branchPhone, email: branch.branchEmail }}
        />
      )}
    </div>
  );
};
