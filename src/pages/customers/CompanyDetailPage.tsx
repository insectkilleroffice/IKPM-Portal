import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Building2,
  GitFork,
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
  ChevronRight,
  AlertCircle,
  Filter,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { formatPKR, formatNTN, formatDate, formatDateTime, generatePermanentId } from '../../lib/formatters';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { EntityDocumentsPanel } from '../../features/documents/EntityDocumentsPanel';
import type { CompanyBranch, SiteAddress } from '../../types/customer';

export const CompanyDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success } = useNotification();
  const { userProfile, hasRole } = useAuth();
  useDataStore();

  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'branches'
    | 'documents'
    | 'sites'
    | 'leads'
    | 'proposals'
    | 'contracts'
    | 'jobs'
    | 'invoices'
    | 'statements'
    | 'audit'
  >('overview');

  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [showAddBranchModal, setShowAddBranchModal] = useState(false);
  const [showAddSiteModal, setShowAddSiteModal] = useState(false);

  // New Branch Form State
  const [newBranch, setNewBranch] = useState({
    branchName: '',
    branchCode: '',
    city: 'Karachi',
    area: '',
    province: 'Sindh' as const,
    physicalAddress: '',
    branchPhone: '',
    branchEmail: '',
    branchManagerName: '',
    branchManagerPhone: '',
    billingType: 'company_invoice' as const,
  });

  // New Site Form State
  const [newSite, setNewSite] = useState({
    siteName: '',
    branchId: '',
    propertyType: 'warehouse' as const,
    addressLine1: '',
    area: '',
    city: 'Karachi',
    province: 'Sindh' as const,
    contactPersonName: '',
    contactPersonPhone: '',
    areaSqFt: 5000,
  });

  const company = dataService.getCompanyById(id || '');
  const branches = dataService.getBranches(id);
  const sites = dataService.getSites(id);
  const leads = dataService.getLeads().filter((l) => l.existingCustomerId === id);
  const proposals = dataService.getProposals(id);
  const contracts = dataService.getContracts(id);
  const jobs = dataService.getJobs(id);
  const invoices = dataService.getInvoices(id);
  const auditLogs = dataService.getAuditLogs('company', id);

  // Branch-Filtered Subsets
  const filteredSites = useMemo(() => {
    if (branchFilter === 'all') return sites;
    return sites.filter((s) => s.branchId === branchFilter);
  }, [sites, branchFilter]);

  const filteredJobs = useMemo(() => {
    if (branchFilter === 'all') return jobs;
    return jobs.filter((j) => j.branchId === branchFilter);
  }, [jobs, branchFilter]);

  const filteredProposals = useMemo(() => {
    if (branchFilter === 'all') return proposals;
    return proposals.filter((p) => p.branchId === branchFilter);
  }, [proposals, branchFilter]);

  const filteredContracts = useMemo(() => {
    if (branchFilter === 'all') return contracts;
    return contracts.filter((c) => c.branchId === branchFilter);
  }, [contracts, branchFilter]);

  const filteredInvoices = useMemo(() => {
    if (branchFilter === 'all') return invoices;
    return invoices.filter((i) => i.branchId === branchFilter);
  }, [invoices, branchFilter]);

  if (!company) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <h2>Company Record Not Found</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0.5rem 0 1.5rem 0' }}>The company ID {id} does not exist.</p>
        <button className="btn btn-primary" onClick={() => navigate('/customers')}>
          Return to Customer Accounts
        </button>
      </div>
    );
  }

  const handleCreateBranch = (e: React.FormEvent) => {
    e.preventDefault();
    const branchId = generatePermanentId('BR', branches.length + 1);
    const created: CompanyBranch = {
      id: branchId,
      companyId: company.id,
      companyName: company.legalCompanyName,
      branchName: newBranch.branchName,
      branchCode: newBranch.branchCode || `BR-${branches.length + 1}`,
      city: newBranch.city,
      area: newBranch.area,
      province: newBranch.province,
      physicalAddress: newBranch.physicalAddress,
      branchPhone: newBranch.branchPhone,
      branchEmail: newBranch.branchEmail,
      branchManagerName: newBranch.branchManagerName,
      branchManagerPhone: newBranch.branchManagerPhone,
      billingType: newBranch.billingType,
      balance: 0,
      contacts: [],
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: userProfile?.displayName || 'Admin',
      updatedAt: new Date().toISOString(),
    };

    dataService.saveBranch(created, userProfile?.email);
    success('New Branch Linked to Company', `${created.branchName} (${created.id})`);
    setShowAddBranchModal(false);
  };

  const handleCreateSite = (e: React.FormEvent) => {
    e.preventDefault();
    const siteId = `SITE-${Date.now().toString().slice(-4)}`;
    const created: SiteAddress = {
      id: siteId,
      siteName: newSite.siteName,
      customerType: 'company',
      customerId: company.id,
      branchId: newSite.branchId || undefined,
      propertyType: newSite.propertyType,
      addressLine1: newSite.addressLine1,
      area: newSite.area,
      city: newSite.city,
      province: newSite.province,
      areaSqFt: newSite.areaSqFt,
      contactPersonName: newSite.contactPersonName,
      contactPersonPhone: newSite.contactPersonPhone,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    dataService.saveSite(created);
    success('New Site / Premises Added', `${created.siteName}`);
    setShowAddSiteModal(false);
  };

  return (
    <div className="animate-fade-in">
      {/* Navigation Breadcrumb */}
      <Breadcrumbs
        items={[
          { label: 'Customer Accounts', path: '/customers' },
          { label: `${company.legalCompanyName} (${company.id})` },
        ]}
      />

      {/* Profile Master Header */}
      <div
        className="card"
        style={{
          marginBottom: '1.5rem',
          padding: '1.75rem',
          background: 'linear-gradient(135deg, var(--bg-surface) 0%, rgba(10, 34, 64, 0.03) 100%)',
          borderLeft: '4px solid var(--ikpm-navy-700)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span className="badge-status badge-navy" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                {company.id}
              </span>
              <span className="badge-status badge-slate">{company.industrySegment.replace('_', ' ')}</span>
              <span className="badge-status badge-emerald">Master Company Profile</span>
            </div>

            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginTop: '0.35rem' }}>
              {company.legalCompanyName}
            </h1>
            {company.tradeName && (
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Trade / Brand: {company.tradeName}</div>
            )}

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.85rem', fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <MapPin size={14} color="var(--text-muted)" />
                <span>{company.headOfficeAddress}, {company.city}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Phone size={14} color="var(--text-muted)" />
                <span>{company.primaryContact.mobile} ({company.primaryContact.fullName})</span>
              </div>
              {company.ntn && (
                <div>
                  <strong>NTN:</strong> {formatNTN(company.ntn)}
                </div>
              )}
            </div>
          </div>

          {/* Quick Metrics */}
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ padding: '0.75rem 1.25rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', textAlign: 'right' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Branches</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--ikpm-navy-700)' }}>
                {branches.length}
              </div>
            </div>

            <div style={{ padding: '0.75rem 1.25rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', textAlign: 'right' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Consolidated Balance</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: company.totalBalance > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                {formatPKR(company.totalBalance)}
              </div>
            </div>
          </div>
        </div>

        {/* Branch Filter Selector */}
        {branches.length > 0 && (
          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Filter size={15} color="var(--text-muted)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Filter Tab Records by Branch:</span>
            <select
              className="form-select"
              style={{ width: '280px', height: '32px', fontSize: '0.8rem' }}
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
            >
              <option value="all">Company-Wide (All Branches Aggregated)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.branchName} ({b.id} • {b.city})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 10 Clearly Separated Tabs (Highest Priority Requirement) */}
      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview & Contact
        </button>

        <button
          className={`tab-btn ${activeTab === 'branches' ? 'active' : ''}`}
          onClick={() => setActiveTab('branches')}
        >
          <GitFork size={14} />
          Branch Hierarchy ({branches.length})
        </button>

        <button
          className={`tab-btn ${activeTab === 'sites' ? 'active' : ''}`}
          onClick={() => setActiveTab('sites')}
        >
          <MapPin size={14} />
          Sites & Premises ({filteredSites.length})
        </button>

        <button
          className={`tab-btn ${activeTab === 'leads' ? 'active' : ''}`}
          onClick={() => setActiveTab('leads')}
        >
          <FileText size={14} />
          Leads & Inspections ({leads.length})
        </button>

        <button
          className={`tab-btn ${activeTab === 'proposals' ? 'active' : ''}`}
          onClick={() => setActiveTab('proposals')}
        >
          <FileSpreadsheet size={14} />
          Proposals & Revisions ({filteredProposals.length})
        </button>

        <button
          className={`tab-btn ${activeTab === 'contracts' ? 'active' : ''}`}
          onClick={() => setActiveTab('contracts')}
        >
          <FileSignature size={14} />
          Contracts & Renewals ({filteredContracts.length})
        </button>

        <button
          className={`tab-btn ${activeTab === 'jobs' ? 'active' : ''}`}
          onClick={() => setActiveTab('jobs')}
        >
          <Truck size={14} />
          Service Jobs ({filteredJobs.length})
        </button>

        {hasRole(['super_admin', 'management', 'finance']) && (
          <>
            <button
              className={`tab-btn ${activeTab === 'invoices' ? 'active' : ''}`}
              onClick={() => setActiveTab('invoices')}
            >
              <Receipt size={14} />
              Invoices & Payments ({filteredInvoices.length})
            </button>

            <button
              className={`tab-btn ${activeTab === 'statements' ? 'active' : ''}`}
              onClick={() => setActiveTab('statements')}
            >
              <FileCheck2 size={14} />
              Ledger Statements & WHT
            </button>
          </>
        )}

        <button
          className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
          onClick={() => setActiveTab('documents')}
        >
          <Paperclip size={14} />
          Documents & MSDS
        </button>

        <button
          className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <History size={14} />
          Audit History ({auditLogs.length})
        </button>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--ikpm-navy-900)' }}>
              Head Office Corporate Details
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Permanent Company ID:</span>
                <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{company.id}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>National Tax Number (NTN):</span>
                <div style={{ fontWeight: 600 }}>{company.ntn ? formatNTN(company.ntn) : 'Unregistered'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Sales Tax Reg Number (STRN):</span>
                <div style={{ fontWeight: 600 }}>{company.strn || '—'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Invoicing Preference:</span>
                <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                  {company.billingPreference === 'centralized' ? 'Centralized (HQ Invoiced)' : 'Branch-Wise Billing'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Industry Category:</span>
                <div style={{ fontWeight: 600 }}>{company.industrySegment.replace('_', ' ')}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Account Manager:</span>
                <div style={{ fontWeight: 600 }}>{company.assignedAccountManagerName || 'Salman (CEO)'}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--ikpm-navy-900)' }}>
              Primary Corporate Contact
            </h3>
            <div style={{ fontSize: '0.85rem' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{company.primaryContact.fullName}</div>
              <div style={{ color: 'var(--ikpm-emerald-600)', fontWeight: 600, marginBottom: '0.75rem' }}>
                {company.primaryContact.designation || 'Head of Procurement / Facility'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', color: 'var(--text-secondary)' }}>
                <div><strong>Mobile:</strong> {company.primaryContact.mobile}</div>
                <div><strong>Office Phone:</strong> {company.primaryContact.phone}</div>
                {company.primaryContact.email && <div><strong>Email:</strong> {company.primaryContact.email}</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Dedicated Branch Hierarchy List (Critical Requirement) */}
      {activeTab === 'branches' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>
                Linked Branches of {company.legalCompanyName}
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Each branch has its own dedicated profile, jobs, proposals, and contracts without duplicating the master company profile.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => setShowAddBranchModal(true)}>
              <Plus size={15} />
              <span>Add New Branch</span>
            </button>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Branch ID & Name</th>
                  <th>Branch Code</th>
                  <th>City / Area</th>
                  <th>Physical Address</th>
                  <th>Branch Manager</th>
                  <th>Billing Mode</th>
                  <th>Branch Balance</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{b.branchName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)', fontFamily: 'monospace' }}>
                        {b.id}
                      </div>
                    </td>
                    <td>
                      <span className="badge-status badge-slate">{b.branchCode || '—'}</span>
                    </td>
                    <td>
                      <div>{b.city}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{b.area}</div>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '220px' }}>
                      {b.physicalAddress}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{b.branchManagerName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{b.branchManagerPhone}</div>
                    </td>
                    <td>
                      <span className={`badge-status ${b.billingType === 'branch_invoice' ? 'badge-amber' : 'badge-navy'}`}>
                        {b.billingType === 'branch_invoice' ? 'Direct Branch Invoice' : 'Master HQ Invoice'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{formatPKR(b.balance)}</td>
                    <td>
                      <button
                        className="btn btn-outline-emerald"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                        onClick={() => navigate(`/customers/branch/${b.id}`)}
                      >
                        <span>Open Branch Profile</span>
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Sites & Addresses */}
      {activeTab === 'sites' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>
                Premises & Treatment Sites
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Warehouses, manufacturing plants, kitchens, and retail floors covered by IKPM pest treatment.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => setShowAddSiteModal(true)}>
              <Plus size={15} />
              <span>Add Service Site</span>
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
            {filteredSites.map((s) => (
              <div key={s.id} className="card" style={{ borderTop: '3px solid var(--ikpm-emerald-500)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{s.siteName}</div>
                  <span className="badge-status badge-slate">{s.propertyType.replace('_', ' ')}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                  <MapPin size={13} style={{ display: 'inline', marginRight: '4px' }} />
                  {s.addressLine1}, {s.city}
                </div>
                {s.areaSqFt && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                    Coverage Area: <strong>{s.areaSqFt.toLocaleString()} sq ft</strong>
                  </div>
                )}
                {s.specialInstructions && (
                  <div style={{ marginTop: '0.75rem', padding: '0.5rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem' }}>
                    <strong>Treatment Note:</strong> {s.specialInstructions}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 5: Proposals & Revisions */}
      {activeTab === 'proposals' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Proposal ID & Revision</th>
                <th>Branch</th>
                <th>Template & Scope</th>
                <th>Prepared By</th>
                <th>Total Value</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredProposals.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{p.id}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)' }}>Revision: R{p.revisionNumber}</div>
                  </td>
                  <td>{p.branchName || 'Company-Wide HQ'}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.templateType.replace('_', ' ')}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.lineItems.length} Service Items</div>
                  </td>
                  <td>{p.preparedByName}</td>
                  <td style={{ fontWeight: 700 }}>{formatPKR(p.totalAmount)}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>
                    <button
                      className="btn btn-outline-emerald"
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                      onClick={() => navigate(`/proposals?id=${p.id}`)}
                    >
                      View Proposal
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 6: Contracts & AMCs */}
      {activeTab === 'contracts' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Contract ID</th>
                <th>Branch</th>
                <th>Type & Frequency</th>
                <th>Term Period</th>
                <th>Contract Value</th>
                <th>Jobs Completed</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredContracts.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{c.id}</td>
                  <td>{c.branchName || 'Company-Wide HQ'}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.contractType === 'amc_recurring' ? 'Annual AMC' : 'One-Time'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Frequency: {c.frequency}</div>
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>
                    {formatDate(c.startDate)} to {formatDate(c.endDate)}
                  </td>
                  <td style={{ fontWeight: 700 }}>{formatPKR(c.totalContractValue)}</td>
                  <td>
                    <span className="badge-status badge-navy">
                      {c.totalJobsCompleted} / {c.totalJobsScheduled} Jobs
                    </span>
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 7: Service Jobs */}
      {activeTab === 'jobs' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Scheduled Date & Slot</th>
                <th>Branch / Site</th>
                <th>Target Pests</th>
                <th>Lead PCO</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((j) => (
                <tr key={j.id}>
                  <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{j.id}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{formatDate(j.scheduledDate)}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Slot: {j.timeSlot}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{j.siteName}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{j.branchName || 'HQ'}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                      {j.targetPests.map((p) => (
                        <span key={p} className="badge-status badge-slate" style={{ fontSize: '0.68rem' }}>
                          {p.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{j.leadPcoName}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td>
                    <button
                      className="btn btn-outline-emerald"
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                      onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                    >
                      Report / Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 8: Invoices & Receivables */}
      {activeTab === 'invoices' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Branch</th>
                <th>Issue / Due Date</th>
                <th>Jurisdiction</th>
                <th>Gross Total</th>
                <th>Paid</th>
                <th>Balance Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{inv.invoiceNumber}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)' }}>{inv.id}</div>
                  </td>
                  <td>{inv.branchName || 'Company HQ'}</td>
                  <td style={{ fontSize: '0.8rem' }}>
                    <div>Issued: {formatDate(inv.issueDate)}</div>
                    <div style={{ color: 'var(--text-muted)' }}>Due: {formatDate(inv.dueDate)}</div>
                  </td>
                  <td><span className="badge-status badge-slate">{inv.jurisdiction.toUpperCase()}</span></td>
                  <td style={{ fontWeight: 700 }}>{formatPKR(inv.grossPayable)}</td>
                  <td style={{ color: 'var(--ikpm-emerald-600)' }}>{formatPKR(inv.amountPaid)}</td>
                  <td style={{ fontWeight: 700, color: inv.balanceDue > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                    {formatPKR(inv.balanceDue)}
                  </td>
                  <td><StatusBadge status={inv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 9: Documents (Cloudinary) + IKPM documents shared with the client */}
      {activeTab === 'documents' && (
        <EntityDocumentsPanel
          owner={{ kind: 'company', id: company.id }}
          title={company.legalCompanyName}
          recipient={{
            name: company.primaryContact.fullName,
            phone: company.primaryContact.mobile || company.primaryContact.phone,
            email: company.primaryContact.email,
          }}
        />
      )}

      {/* Tab 10: Audit History */}
      {activeTab === 'audit' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>User / Employee</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatDateTime(log.timestamp)}</td>
                  <td><span className="badge-status badge-navy">{log.action.toUpperCase()}</span></td>
                  <td style={{ fontWeight: 600 }}>{log.userEmail}</td>
                  <td style={{ fontSize: '0.85rem' }}>{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Add New Branch */}
      <Modal
        isOpen={showAddBranchModal}
        onClose={() => setShowAddBranchModal(false)}
        title={`Add Branch to ${company.legalCompanyName}`}
        subtitle="Create a child branch profile with localized site addresses and operational records."
        maxWidth="640px"
      >
        <form onSubmit={handleCreateBranch}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Branch Name <span className="required">*</span></label>
              <input
                type="text"
                required
                className="form-input"
                placeholder="e.g. Korangi Industrial Plant 2"
                value={newBranch.branchName}
                onChange={(e) => setNewBranch({ ...newBranch, branchName: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Branch Code</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. KHI-02"
                value={newBranch.branchCode}
                onChange={(e) => setNewBranch({ ...newBranch, branchCode: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">City <span className="required">*</span></label>
              <select
                className="form-select"
                value={newBranch.city}
                onChange={(e) => setNewBranch({ ...newBranch, city: e.target.value })}
              >
                <option value="Karachi">Karachi</option>
                <option value="Lahore">Lahore</option>
                <option value="Islamabad">Islamabad</option>
                <option value="Rawalpindi">Rawalpindi</option>
                <option value="Faisalabad">Faisalabad</option>
                <option value="Multan">Multan</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Area / Industrial Estate</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Korangi Sector 23"
                value={newBranch.area}
                onChange={(e) => setNewBranch({ ...newBranch, area: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Physical Address <span className="required">*</span></label>
            <input
              type="text"
              required
              className="form-input"
              placeholder="e.g. Plot 40-A, Main Industrial Highway"
              value={newBranch.physicalAddress}
              onChange={(e) => setNewBranch({ ...newBranch, physicalAddress: e.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Branch Manager Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Farhan Ali"
                value={newBranch.branchManagerName}
                onChange={(e) => setNewBranch({ ...newBranch, branchManagerName: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Branch Contact Phone</label>
              <input
                type="text"
                className="form-input"
                placeholder="03001234567"
                value={newBranch.branchManagerPhone}
                onChange={(e) => setNewBranch({ ...newBranch, branchManagerPhone: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Billing Invoicing Mode</label>
            <select
              className="form-select"
              value={newBranch.billingType}
              onChange={(e) => setNewBranch({ ...newBranch, billingType: e.target.value as any })}
            >
              <option value="company_invoice">Consolidated to Master Company (HQ Billing)</option>
              <option value="branch_invoice">Decentralized Direct Branch Invoicing</option>
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowAddBranchModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create Branch Profile
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Add Service Site */}
      <Modal
        isOpen={showAddSiteModal}
        onClose={() => setShowAddSiteModal(false)}
        title="Add Premises / Treatment Site"
        maxWidth="600px"
      >
        <form onSubmit={handleCreateSite}>
          <div className="form-group">
            <label className="form-label">Site Name <span className="required">*</span></label>
            <input
              type="text"
              required
              className="form-input"
              placeholder="e.g. Main Raw Spice Storage Warehouse"
              value={newSite.siteName}
              onChange={(e) => setNewSite({ ...newSite, siteName: e.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Link to Branch</label>
              <select
                className="form-select"
                value={newSite.branchId}
                onChange={(e) => setNewSite({ ...newSite, branchId: e.target.value })}
              >
                <option value="">Head Office / General Premises</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branchName} ({b.city})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Property Category</label>
              <select
                className="form-select"
                value={newSite.propertyType}
                onChange={(e) => setNewSite({ ...newSite, propertyType: e.target.value as any })}
              >
                <option value="warehouse">Warehouse / Storage</option>
                <option value="factory">Factory / Manufacturing Floor</option>
                <option value="restaurant_kitchen">Commercial Kitchen</option>
                <option value="commercial_office">Office Building</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Premises Address <span className="required">*</span></label>
            <input
              type="text"
              required
              className="form-input"
              value={newSite.addressLine1}
              onChange={(e) => setNewSite({ ...newSite, addressLine1: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowAddSiteModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Treatment Site
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
