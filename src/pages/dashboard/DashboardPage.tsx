import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Users2,
  Building2,
  FileSignature,
  Truck,
  Receipt,
  FileSpreadsheet,
  AlertCircle,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { formatPKR, formatDate } from '../../lib/formatters';
import { StatusBadge } from '../../components/common/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { userProfile, effectiveRole, isSuperAdmin, setSimulatedRole } = useAuth();

  // Metrics queried from active database records
  const companies = dataService.getCompanies();
  const clients = dataService.getClients();
  const leads = dataService.getLeads();
  const proposals = dataService.getProposals();
  const contracts = dataService.getContracts();
  const jobs = dataService.getJobs();
  const invoices = dataService.getInvoices();
  const auditLogs = dataService.getAuditLogs().slice(0, 8);

  const totalActiveCustomers =
    companies.filter((c) => c.status === 'active').length +
    clients.filter((cl) => cl.status === 'active').length;

  const openLeadsCount = leads.filter((l) => !['won', 'lost'].includes(l.stage)).length;
  const activeContractsCount = contracts.filter((c) => c.status === 'active').length;
  const scheduledJobsCount = jobs.filter((j) => ['scheduled', 'in_progress'].includes(j.status)).length;

  const totalOutstandingBalance = invoices
    .filter((i) => i.status !== 'void_reversed')
    .reduce((acc, curr) => acc + (curr.balanceDue || 0), 0);

  const pendingApprovals = proposals.filter((p) => p.status === 'pending_approval');

  return (
    <div className="animate-fade-in">
      {/* Welcome Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.75rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', letterSpacing: '-0.02em' }}>
            Welcome, {userProfile?.displayName || 'User'}
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            IKPM Enterprise Operations Dashboard • Active Role: <strong>{effectiveRole?.toUpperCase()}</strong> • Scope: <strong>{userProfile?.dataScope?.toUpperCase() || 'COMPANY'}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={() => navigate('/pco-field')}>
            <Truck size={15} />
            <span>PCO Mobile View</span>
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/crm?action=new_lead')}>
            <span>+ Capture New Lead</span>
          </button>
        </div>
      </div>

      {/* Pending Approvals Notice (Approval Matrix AP-01/02) */}
      {pendingApprovals.length > 0 && ['super_admin', 'management', 'sales'].includes(effectiveRole || '') && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: 'var(--ikpm-amber-100)',
            border: '1px solid #FCD34D',
            borderRadius: 'var(--radius-lg)',
            marginBottom: '1.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertTriangle size={22} color="#92400E" />
            <div>
              <strong style={{ color: '#92400E' }}>
                {pendingApprovals.length} Proposal(s) Pending Critical Escalation Approval
              </strong>
              <div style={{ fontSize: '0.8rem', color: '#B45309' }}>
                Approval Matrix: Proposals exceeding discount or value thresholds require authorized sign-off.
              </div>
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ backgroundColor: '#92400E', padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}
            onClick={() => navigate('/proposals?filter=pending_approval')}
          >
            Review Approval Queue
          </button>
        </div>
      )}

      {/* Real KPI Metrics Cards */}
      <div className="kpi-grid">
        <div className="kpi-card" onClick={() => navigate('/customers')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Active Customer Accounts</div>
            <div className="kpi-value">{totalActiveCustomers}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              {companies.length} Corporate Masters • {clients.length} Individuals
            </div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: 'var(--ikpm-emerald-100)', color: 'var(--ikpm-emerald-600)' }}>
            <Building2 size={22} />
          </div>
        </div>

        <div className="kpi-card" onClick={() => navigate('/crm')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Open Sales Pipeline Leads</div>
            <div className="kpi-value">{openLeadsCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              Inquiries, Inspections & Drafts
            </div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#E0E7FF', color: 'var(--ikpm-navy-700)' }}>
            <Users2 size={22} />
          </div>
        </div>

        <div className="kpi-card" onClick={() => navigate('/contracts')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Active AMCs & Contracts</div>
            <div className="kpi-value">{activeContractsCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              Recurring preventive maintenance
            </div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
            <FileSignature size={22} />
          </div>
        </div>

        <div className="kpi-card" onClick={() => navigate('/operations/jobs')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Scheduled Service Visits</div>
            <div className="kpi-value">{scheduledJobsCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              Field jobs & PCO assignments
            </div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: 'var(--ikpm-emerald-100)', color: 'var(--ikpm-emerald-600)' }}>
            <Truck size={22} />
          </div>
        </div>

        {['super_admin', 'management', 'finance'].includes(effectiveRole || '') && (
          <div className="kpi-card" onClick={() => navigate('/finance/invoices')} style={{ cursor: 'pointer' }}>
            <div>
              <div className="kpi-title">Total Outstanding Receivables</div>
              <div className="kpi-value" style={{ color: totalOutstandingBalance > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                {formatPKR(totalOutstandingBalance)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Operational billing ledger
              </div>
            </div>
            <div className="kpi-icon" style={{ backgroundColor: '#FEE2E2', color: 'var(--ikpm-rose-500)' }}>
              <Receipt size={22} />
            </div>
          </div>
        )}
      </div>

      {/* Main Grid: Scheduled Jobs & Recent Leads */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* Next Scheduled Jobs */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>
              Upcoming Operations & Field Jobs
            </h3>
            <Link to="/operations/jobs" style={{ fontSize: '0.8rem', color: 'var(--ikpm-emerald-600)', fontWeight: 600 }}>
              View All Dispatch Jobs
            </Link>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {jobs.slice(0, 4).map((j) => (
              <div
                key={j.id}
                onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                style={{
                  padding: '0.85rem 1rem',
                  backgroundColor: 'var(--bg-surface-alt)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>{j.customerName}</span>
                    <span className="badge-status badge-slate" style={{ fontSize: '0.68rem' }}>{j.id}</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Site: {j.siteName} • Lead PCO: {j.leadPcoName}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{formatDate(j.scheduledDate)}</div>
                  <StatusBadge status={j.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Inquiries & Leads */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>
              Active Inquiries & Leads
            </h3>
            <Link to="/crm" style={{ fontSize: '0.8rem', color: 'var(--ikpm-emerald-600)', fontWeight: 600 }}>
              Pipeline Kanban
            </Link>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {leads.slice(0, 4).map((l) => (
              <div
                key={l.id}
                onClick={() => navigate(`/crm?lead=${l.id}`)}
                style={{
                  padding: '0.85rem 1rem',
                  backgroundColor: 'var(--bg-surface-alt)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{l.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {l.contactName} • {l.city}
                  </div>
                </div>
                <StatusBadge status={l.stage} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Audit Trail Snippet */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>
            System Audit Trail (Immutable Log)
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Security & Traceability</span>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Entity Type</th>
                <th>User</th>
                <th>Action Details</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                    System initialized. Audit records will appear upon business actions.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatDate(log.timestamp)}</td>
                    <td><span className="badge-status badge-navy">{log.action.toUpperCase()}</span></td>
                    <td style={{ fontWeight: 600 }}>{log.entityType}</td>
                    <td>{log.userEmail}</td>
                    <td style={{ fontSize: '0.825rem' }}>{log.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
