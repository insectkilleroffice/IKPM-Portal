import React, { useState } from 'react';
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
  ArrowRight,
  Phone,
  Send,
  ShieldCheck,
  Calendar,
  DollarSign,
  Briefcase,
  Layers,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { formatPKR, formatDate } from '../../lib/formatters';
import { StatusBadge } from '../../components/common/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { getLeadNextAction, getJobNextAction } from '../../lib/workflow';

type RoleQueueTab = 'sales' | 'operations' | 'finance' | 'team_leader';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { userProfile, effectiveRole, isSuperAdmin, setSimulatedRole } = useAuth();
  useDataStore();

  // Determine default queue tab based on active role
  const getDefaultTab = (): RoleQueueTab => {
    if (effectiveRole === 'finance') return 'finance';
    if (effectiveRole === 'sales') return 'sales';
    if (effectiveRole === 'team_leader') return 'team_leader';
    return 'operations';
  };

  const [activeQueueTab, setActiveQueueTab] = useState<RoleQueueTab>(getDefaultTab());

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

  // Dates for queue evaluation
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

  // 1. SALES QUEUE
  const salesLeadsToCall = leads.filter((l) => ['new', 'contacted'].includes(l.stage));
  const salesProposalsAwaitingReply = proposals.filter((p) => ['sent_to_client', 'negotiation'].includes(p.status));
  const salesProposalsNeedApproval = proposals.filter((p) => p.status === 'pending_approval');

  // 2. OPERATIONS QUEUE
  const opsJobsTodayAndTomorrow = jobs.filter((j) => [todayStr, tomorrowStr].includes(j.scheduledDate) || j.status === 'in_progress');
  const opsUnassignedJobs = jobs.filter((j) => !j.assignedTechnicianNames?.length || j.assignedTechnicianNames.includes('Unassigned'));
  const opsReportsWaitingVerification = jobs.filter((j) => j.status === 'completed' && !j.supervisorVerification?.isVerified);

  // 3. FINANCE QUEUE
  const financeVerifiedReportsNotYetInvoiced = jobs.filter((j) => {
    if (!j.supervisorVerification?.isVerified) return false;
    const inv = dataService.getInvoiceForJob(j.id);
    return !inv || inv.status === 'void_reversed';
  });
  const financeOverdueInvoices = invoices.filter((i) => {
    return new Date(i.dueDate) < new Date() && i.balanceDue > 0 && i.status !== 'void_reversed';
  });
  const financePendingWhtCertificates = invoices.filter((i) => {
    return i.balanceDue > 0 && (!i.customerWhtTotal || i.customerWhtTotal === 0);
  });

  // 4. TEAM LEADER QUEUE
  const uid = userProfile?.uid || '';
  // Meetings scheduled today or overdue (not yet reported)
  const tlMeetingsDue = leads.filter(
    (l) =>
      l.stage === 'meeting_scheduled' &&
      l.inspection?.scheduledDate &&
      l.inspection.scheduledDate <= todayStr &&
      (l.assignedTeamLeaderId === uid || l.inspection?.assignedTeamLeaderId === uid)
  );
  // Upcoming meetings assigned to this TL
  const tlUpcomingMeetings = leads.filter(
    (l) =>
      l.stage === 'meeting_scheduled' &&
      l.inspection?.scheduledDate &&
      l.inspection.scheduledDate > todayStr &&
      (l.assignedTeamLeaderId === uid || l.inspection?.assignedTeamLeaderId === uid)
  );
  // Site inspections where this TL or their team is assigned
  const tlSiteInspections = leads.filter(
    (l) =>
      l.siteInspection?.status === 'scheduled' &&
      (l.siteInspection.teamLeaderId === uid || l.siteInspection.assignedTechIds?.includes(uid))
  );
  // Meeting done, TL requested inspection, but none scheduled yet (awaiting admin assignment)
  const tlPendingInspectionAssignment = leads.filter(
    (l) =>
      l.stage === 'meeting_done' &&
      l.inspection?.meetingFollowUps?.some(f => f.type === 'inspection') &&
      !l.siteInspection &&
      (l.assignedTeamLeaderId === uid || l.inspection?.assignedTeamLeaderId === uid)
  );
  // Active contracts assigned to this TL
  const tlContracts = contracts.filter(
    (c) => c.status === 'active' && c.assignedTeamLeaderId === uid
  );
  // Upcoming & in-progress service jobs for this TL
  const tlServiceJobs = jobs.filter(
    (j) =>
      ['scheduled', 'in_progress'].includes(j.status) &&
      (j.assignedTeamLeaderId === uid ||
        j.leadPcoId === uid ||
        j.assignedTechnicianIds.includes(uid))
  );
  // This TL's team members (getStaff already filters isActive)
  const tlTeamMembers = dataService.getStaff().filter(
    (u) => userProfile?.teamId && u.teamId === userProfile.teamId && u.uid !== uid
  );

  return (
    <div className="animate-fade-in">
      {/* Welcome Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', letterSpacing: '-0.02em' }}>
            Welcome, {userProfile?.displayName || 'User'}
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Lead ─► Contact ─► Meeting (Team Leader) ─► Report ─► Proposal / Profile ─► Contract ─► Job ─► Invoice ─► Paid
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-primary" onClick={() => navigate('/crm?action=new_lead')}>
            <span>+ Capture New Lead</span>
          </button>
        </div>
      </div>

      {/* TODAY'S WORK QUEUE (Step 4 of Roadmap) */}
      <div
        className="card"
        style={{
          padding: '1.25rem',
          marginBottom: '1.75rem',
          borderLeft: '4px solid var(--ikpm-navy-700)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Briefcase size={20} color="var(--ikpm-navy-900)" />
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', margin: 0 }}>
              Today&apos;s Work Queue
            </h2>
            <span className="badge-status badge-navy" style={{ fontSize: '0.7rem' }}>
              Action Required
            </span>
          </div>

          {/* Role Queue Switcher */}
          <div style={{ display: 'flex', backgroundColor: 'var(--bg-surface-alt)', padding: '3px', borderRadius: 'var(--radius-md)', gap: '2px' }}>
            {[
              { id: 'operations', label: 'Operations Queue' },
              { id: 'sales', label: 'Sales Queue' },
              { id: 'finance', label: 'Finance Queue' },
              { id: 'team_leader', label: 'Team Leader Queue' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveQueueTab(t.id as RoleQueueTab)}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: activeQueueTab === t.id ? 700 : 500,
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: activeQueueTab === t.id ? 'var(--bg-surface)' : 'transparent',
                  color: activeQueueTab === t.id ? 'var(--ikpm-navy-900)' : 'var(--text-muted)',
                  boxShadow: activeQueueTab === t.id ? 'var(--shadow-sm)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 1. SALES QUEUE */}
        {activeQueueTab === 'sales' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            {/* Leads to Call */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                  Leads to Call ({salesLeadsToCall.length})
                </strong>
                <Link to="/crm" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>View CRM</Link>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {salesLeadsToCall.slice(0, 3).map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => navigate(`/crm?lead=${lead.id}`)}
                    style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)' }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{lead.title}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{lead.contactName} • {lead.phone}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                      <span className="badge-status badge-navy" style={{ fontSize: '0.62rem' }}>{lead.stage}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ikpm-emerald-600)' }}>{formatPKR(lead.estimatedValue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Proposals Awaiting Reply */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                  Proposals Awaiting Reply ({salesProposalsAwaitingReply.length})
                </strong>
                <Link to="/proposals" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>All Proposals</Link>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {salesProposalsAwaitingReply.slice(0, 3).map((prop) => (
                  <div
                    key={prop.id}
                    onClick={() => navigate(`/proposals`)}
                    style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)' }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{prop.customerName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Proposal {prop.id} • Sent: {formatDate(prop.sentDate || prop.createdAt)}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                      <span className="badge-status badge-slate" style={{ fontSize: '0.62rem' }}>{prop.status}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700 }}>{formatPKR(prop.totalAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Proposals Needing Approval */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: '#92400E' }}>
                  Proposals Needing Approval ({salesProposalsNeedApproval.length})
                </strong>
              </div>
              {salesProposalsNeedApproval.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  No pending discount escalations.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {salesProposalsNeedApproval.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => navigate(`/proposals?filter=pending_approval`)}
                      style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid #FCD34D' }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{p.customerName}</div>
                      <div style={{ fontSize: '0.72rem', color: '#B45309' }}>
                        Discount: {p.discountPercent}% • Value: {formatPKR(p.totalAmount)}
                      </div>
                      <button className="btn btn-primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', marginTop: '4px' }}>
                        Review AP-01 Approval
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. OPERATIONS QUEUE */}
        {activeQueueTab === 'operations' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            {/* Today's & Tomorrow's Jobs */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                  Today &amp; Tomorrow&apos;s Visits ({opsJobsTodayAndTomorrow.length})
                </strong>
                <Link to="/operations/jobs" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>Jobs List</Link>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {opsJobsTodayAndTomorrow.slice(0, 3).map((job) => (
                  <div
                    key={job.id}
                    onClick={() => navigate(`/operations/jobs?job=${job.id}`)}
                    style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.8rem' }}>{job.customerName}</strong>
                      <span className="badge-status badge-slate" style={{ fontSize: '0.62rem' }}>{job.timeSlot}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {job.siteName} • Tech: {job.leadPcoName}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Reports Waiting for Supervisor QC */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                  Reports Waiting for QC ({opsReportsWaitingVerification.length})
                </strong>
              </div>
              {opsReportsWaitingVerification.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  All completed reports have been verified.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {opsReportsWaitingVerification.map((j) => (
                    <div
                      key={j.id}
                      onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                      style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--ikpm-emerald-300)' }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{j.customerName} ({j.id})</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Client Signed • Tech: {j.leadPcoName}
                      </div>
                      <button className="btn btn-outline-emerald" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', marginTop: '4px' }}>
                        <ShieldCheck size={12} />
                        <span>Verify QC Report</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Unassigned Jobs */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: '#92400E' }}>
                  Unassigned Jobs ({opsUnassignedJobs.length})
                </strong>
              </div>
              {opsUnassignedJobs.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  All scheduled jobs have assigned technicians.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {opsUnassignedJobs.map((j) => (
                    <div
                      key={j.id}
                      onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                      style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid #FCD34D' }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{j.customerName}</div>
                      <div style={{ fontSize: '0.72rem', color: '#92400E' }}>Date: {formatDate(j.scheduledDate)}</div>
                      <button className="btn btn-primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', marginTop: '4px' }}>
                        Assign Technician
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. FINANCE QUEUE */}
        {activeQueueTab === 'finance' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            {/* Verified Reports Not Yet Invoiced */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                  Verified Reports to Invoice ({financeVerifiedReportsNotYetInvoiced.length})
                </strong>
              </div>
              {financeVerifiedReportsNotYetInvoiced.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  All verified reports have been invoiced.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {financeVerifiedReportsNotYetInvoiced.map((j) => (
                    <div
                      key={j.id}
                      onClick={() => navigate(`/finance/invoices?action=new_invoice&fromJob=${j.id}`)}
                      style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)' }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{j.customerName}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Job {j.id} • QC Verified by {j.supervisorVerification?.supervisorName}
                      </div>
                      <button className="btn btn-primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', marginTop: '4px' }}>
                        <Receipt size={12} />
                        <span>Create Invoice</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Overdue Invoices */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-rose-500)' }}>
                  Overdue Invoices ({financeOverdueInvoices.length})
                </strong>
                <Link to="/finance/invoices" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>Invoices</Link>
              </div>
              {financeOverdueInvoices.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  No overdue invoices.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {financeOverdueInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      onClick={() => navigate(`/finance/invoices`)}
                      style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--ikpm-rose-300)' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '0.8rem' }}>{inv.customerName}</strong>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--ikpm-rose-500)' }}>
                          {formatPKR(inv.balanceDue)}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Inv: {inv.invoiceNumber} • Due: {formatDate(inv.dueDate)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* WHT Certificates Pending */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                  Receivable Balances Pending ({financePendingWhtCertificates.length})
                </strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {financePendingWhtCertificates.slice(0, 3).map((inv) => (
                  <div
                    key={inv.id}
                    onClick={() => navigate(`/finance/invoices`)}
                    style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)' }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{inv.customerName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Outstanding: <strong>{formatPKR(inv.balanceDue)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 4. TEAM LEADER QUEUE */}
        {activeQueueTab === 'team_leader' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            {/* My Meetings — due today or overdue + upcoming */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                  My Meetings ({tlMeetingsDue.length + tlUpcomingMeetings.length})
                </strong>
                <Link to="/crm" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>Pipeline</Link>
              </div>
              {tlMeetingsDue.length === 0 && tlUpcomingMeetings.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No meetings assigned to you.</p>
              ) : (
                <>
                  {tlMeetingsDue.length > 0 && (
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#DC2626', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Due / Overdue
                    </div>
                  )}
                  {tlMeetingsDue.slice(0, 3).map((l) => (
                    <div key={l.id} onClick={() => navigate(`/crm?lead=${l.id}`)} style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid #FCA5A5', marginBottom: '0.4rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{l.title}</div>
                      <div style={{ fontSize: '0.72rem', color: '#DC2626' }}>{l.city} • {formatDate(l.inspection!.scheduledDate!)}</div>
                    </div>
                  ))}
                  {tlUpcomingMeetings.length > 0 && (
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginTop: '0.4rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Upcoming
                    </div>
                  )}
                  {tlUpcomingMeetings.slice(0, 3).map((l) => (
                    <div key={l.id} onClick={() => navigate(`/crm?lead=${l.id}`)} style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)', marginBottom: '0.4rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{l.title}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{l.city} • {formatDate(l.inspection!.scheduledDate!)}</div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Site Inspections — scheduled technical visits */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                  Site Inspections ({tlSiteInspections.length})
                </strong>
                <Link to="/crm" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>Pipeline</Link>
              </div>
              {tlSiteInspections.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No site inspections assigned to you.</p>
              ) : (
                tlSiteInspections.slice(0, 4).map((l) => (
                  <div key={l.id} onClick={() => navigate(`/crm?lead=${l.id}`)} style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--ikpm-emerald-300)', marginBottom: '0.4rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{l.title}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {l.siteInspection!.branchName || l.city} • {formatDate(l.siteInspection!.scheduledDate)}
                    </div>
                    {l.siteInspection!.assignedTechNames?.length ? (
                      <div style={{ fontSize: '0.7rem', color: 'var(--ikpm-emerald-700)', marginTop: '0.15rem' }}>
                        Techs: {l.siteInspection!.assignedTechNames.join(', ')}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {/* Awaiting Assignment — TL requested inspection but admin hasn't scheduled it yet */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: '#92400E' }}>
                  Awaiting Assignment ({tlPendingInspectionAssignment.length})
                </strong>
                <Link to="/crm" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>Pipeline</Link>
              </div>
              {tlPendingInspectionAssignment.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No pending inspection assignments.</p>
              ) : (
                tlPendingInspectionAssignment.slice(0, 4).map((l) => {
                  const inspFu = l.inspection!.meetingFollowUps!.find(f => f.type === 'inspection');
                  return (
                    <div key={l.id} onClick={() => navigate(`/crm?lead=${l.id}`)} style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid #FCD34D', marginBottom: '0.4rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{l.title}</div>
                      <div style={{ fontSize: '0.72rem', color: '#92400E' }}>
                        {inspFu?.branchName ? `Site: ${inspFu.branchName}` : 'Site TBD'}
                        {inspFu?.scheduledDate ? ` • ${formatDate(inspFu.scheduledDate)}` : ''}
                      </div>
                      {inspFu?.addressTbd && (
                        <div style={{ fontSize: '0.7rem', color: '#D97706', marginTop: '0.1rem' }}>⚠ Address not confirmed</div>
                      )}
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Waiting for CRO/admin to assign</div>
                    </div>
                  );
                })
              )}
            </div>

            {/* My Service Jobs — upcoming visits for contracts assigned to this TL */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                  My Service Jobs ({tlServiceJobs.length})
                </strong>
                <Link to="/operations/jobs" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>All Jobs</Link>
              </div>
              {tlServiceJobs.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No service jobs assigned to you.</p>
              ) : (
                tlServiceJobs.slice(0, 4).map((j) => (
                  <div key={j.id} onClick={() => navigate(`/operations/jobs?job=${j.id}`)} style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: `1px solid ${j.status === 'in_progress' ? 'var(--ikpm-emerald-300)' : 'var(--border-subtle)'}`, marginBottom: '0.4rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.8rem' }}>{j.customerName}</strong>
                      <span className={`badge-status ${j.status === 'in_progress' ? 'badge-emerald' : 'badge-navy'}`} style={{ fontSize: '0.62rem' }}>
                        {j.status === 'in_progress' ? 'In Progress' : 'Scheduled'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {j.siteName} • {formatDate(j.scheduledDate)} • {j.timeSlot}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                      Techs: {j.assignedTechnicianNames.join(', ') || '—'}
                    </div>
                  </div>
                ))
              )}
              {tlContracts.length > 0 && (
                <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    My Contracts ({tlContracts.length} active)
                  </div>
                  {tlContracts.slice(0, 3).map((c) => (
                    <div key={c.id} onClick={() => navigate(`/contracts`)} style={{ padding: '0.35rem 0.6rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)', marginBottom: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.78rem' }}>{c.customerName}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{c.contractType} • {c.totalJobsCompleted}/{c.totalJobsScheduled} visits done</div>
                      </div>
                      <span className="badge-status badge-emerald" style={{ fontSize: '0.6rem' }}>Active</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* My Team */}
            <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                  My Team ({tlTeamMembers.length})
                </strong>
              </div>
              {tlTeamMembers.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No team members assigned to your team yet.</p>
              ) : (
                tlTeamMembers.map((m) => (
                  <div key={m.uid} style={{ padding: '0.4rem 0.6rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'var(--ikpm-navy-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--ikpm-navy-700)', flexShrink: 0 }}>
                      {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.displayName || m.email}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{m.role?.replace(/_/g, ' ')}</div>
                    </div>
                  </div>
                ))
              )}
              {userProfile?.teamName && (
                <div style={{ marginTop: '0.4rem', fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Team: {userProfile.teamName}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

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
              Inquiries, Inspections &amp; Drafts
            </div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#E0E7FF', color: 'var(--ikpm-navy-700)' }}>
            <Users2 size={22} />
          </div>
        </div>

        <div className="kpi-card" onClick={() => navigate('/contracts')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Active AMCs &amp; Contracts</div>
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
              Field jobs &amp; PCO assignments
            </div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: 'var(--ikpm-emerald-100)', color: 'var(--ikpm-emerald-600)' }}>
            <Truck size={22} />
          </div>
        </div>
      </div>
    </div>
  );
};
