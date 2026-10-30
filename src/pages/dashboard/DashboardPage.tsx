import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  FileSignature,
  Truck,
  ShieldCheck,
  MessageSquareWarning,
  Receipt,
  CalendarDays,
  Users2,
  FileSpreadsheet,
  Briefcase,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { isComplaintOverdue } from '../../types/complaints';
import { dataService } from '../../services/dataService';
import { formatPKR, formatDate } from '../../lib/formatters';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { baseRoleOf } from '../../lib/permissions';
import { ScheduleGeneratorModal } from '../../features/schedule/ScheduleGeneratorModal';
import type { Contract } from '../../types/operations';

// Each sub-dashboard must call useDataStore() so it re-renders when Firestore data arrives.

// ─── CRO Dashboard ────────────────────────────────────────────────────────────
function CRODashboard() {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  useDataStore();
  const leads = dataService.getLeads();
  const proposals = dataService.getProposals();
  const contracts = dataService.getContracts();

  const todayStr = new Date().toISOString().split('T')[0];
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const openLeads = leads.filter((l) => !['won', 'lost'].includes(l.stage));
  const leadsToCall = leads.filter((l) => ['new', 'contacted'].includes(l.stage));
  const proposalsAwaitingReply = proposals.filter((p) => ['sent_to_client', 'negotiation'].includes(p.status));
  const proposalsNeedApproval = proposals.filter((p) => p.status === 'pending_approval');
  const myMeetingsThisWeek = leads.filter(
    (l) =>
      l.stage === 'meeting_scheduled' &&
      l.inspection?.scheduledDate &&
      l.inspection.scheduledDate >= todayStr &&
      l.inspection.scheduledDate <= weekEnd
  );

  const thisMonthStart = new Date().toISOString().slice(0, 7);
  const contractsThisMonth = contracts.filter(
    (c) => c.createdAt?.startsWith(thisMonthStart)
  );

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', letterSpacing: '-0.02em' }}>
            Welcome, {userProfile?.displayName || 'CRO'}
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Lead ─► Meeting ─► Proposal ─► Sign Contract ─► Ops takes over
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/crm?action=new_lead')}>
          + Capture New Lead
        </button>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card" onClick={() => navigate('/crm')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Open Leads</div>
            <div className="kpi-value">{openLeads.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#E0E7FF', color: 'var(--ikpm-navy-700)' }}>
            <Users2 size={22} />
          </div>
        </div>
        <div className="kpi-card" onClick={() => navigate('/proposals')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Proposals Sent</div>
            <div className="kpi-value">{proposalsAwaitingReply.length}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>awaiting reply</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#FEF9C3', color: '#92400E' }}>
            <FileSpreadsheet size={22} />
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-title">Contracts Signed</div>
            <div className="kpi-value">{contractsThisMonth.length}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>this month</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#D1FAE5', color: 'var(--ikpm-emerald-600)' }}>
            <FileSignature size={22} />
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-title">Meetings This Week</div>
            <div className="kpi-value">{myMeetingsThisWeek.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#EDE9FE', color: '#7C3AED' }}>
            <CalendarDays size={22} />
          </div>
        </div>
      </div>

      {/* Work Queue */}
      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--ikpm-navy-700)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Briefcase size={20} color="var(--ikpm-navy-900)" />
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', margin: 0 }}>
            Today&apos;s Work Queue
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {/* Leads to Call */}
          <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                Leads to Call ({leadsToCall.length})
              </strong>
              <Link to="/crm" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>View All</Link>
            </div>
            {leadsToCall.length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No new leads to follow up.</p>
            ) : (
              leadsToCall.slice(0, 4).map((lead) => (
                <div key={lead.id} onClick={() => navigate(`/crm?lead=${lead.id}`)}
                  style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)', marginBottom: '0.35rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{lead.title}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{lead.contactName} · {lead.phone}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px' }}>
                    <span className="badge-status badge-navy" style={{ fontSize: '0.62rem' }}>{lead.stage}</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ikpm-emerald-600)' }}>{formatPKR(lead.estimatedValue)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Proposals Awaiting Reply */}
          <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <strong style={{ fontSize: '0.825rem', color: 'var(--ikpm-navy-900)' }}>
                Proposals Awaiting Reply ({proposalsAwaitingReply.length})
              </strong>
              <Link to="/proposals" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>All Proposals</Link>
            </div>
            {proposalsAwaitingReply.length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No proposals pending client reply.</p>
            ) : (
              proposalsAwaitingReply.slice(0, 4).map((p) => (
                <div key={p.id} onClick={() => navigate('/proposals')}
                  style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)', marginBottom: '0.35rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{p.customerName}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Sent: {formatDate(p.sentDate || p.createdAt)}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px' }}>
                    <span className="badge-status badge-slate" style={{ fontSize: '0.62rem' }}>{p.status}</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700 }}>{formatPKR(p.totalAmount)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Proposals Needing Approval */}
          <div style={{ padding: '0.85rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <strong style={{ fontSize: '0.825rem', color: '#92400E' }}>
                Discount Approvals Needed ({proposalsNeedApproval.length})
              </strong>
            </div>
            {proposalsNeedApproval.length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No pending approvals.</p>
            ) : (
              proposalsNeedApproval.map((p) => (
                <div key={p.id} onClick={() => navigate('/proposals?filter=pending_approval')}
                  style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid #FCD34D', marginBottom: '0.35rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{p.customerName}</div>
                  <div style={{ fontSize: '0.72rem', color: '#B45309' }}>
                    Discount: {p.discountPercent}% · {formatPKR(p.totalAmount)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Operations Manager Dashboard ─────────────────────────────────────────────
function OpsManagerDashboard() {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  useDataStore();
  const contracts = dataService.getContracts();
  const jobs = dataService.getJobs();
  const staff = dataService.getStaff();
  const leads = dataService.getLeads();
  const [scheduleModalContract, setScheduleModalContract] = useState<Contract | null>(null);
  const [assigningLeadId, setAssigningLeadId] = useState<string | null>(null);
  const [assignTlId, setAssignTlId] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const activeContracts = contracts.filter((c) => c.status === 'active');
  const unassignedJobs = jobs.filter(
    (j) => ['scheduled'].includes(j.status) && (!j.assignedTechnicianNames?.length || j.assignedTechnicianNames.includes('Unassigned'))
  );
  const jobsToday = jobs.filter((j) => j.scheduledDate === todayStr && ['scheduled', 'in_progress'].includes(j.status));
  const reportsAwaitingQC = jobs.filter((j) => j.status === 'completed' && !j.supervisorVerification?.isVerified);

  // Meetings scheduled by CRO that have no team leader assigned yet
  const meetingsNeedingTL = leads.filter(
    (l) => l.stage === 'meeting_scheduled' && !l.assignedTeamLeaderId
  );

  const teamLeaders = dataService.getStaff(['team_leader']);

  const handleAssignTL = (leadId: string) => {
    const tl = teamLeaders.find((t) => t.uid === assignTlId);
    if (!tl) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    dataService.saveLead(
      { ...lead, assignedTeamLeaderId: tl.uid, assignedTeamLeaderName: tl.displayName, updatedAt: new Date().toISOString() },
      userProfile?.email
    );
    setAssigningLeadId(null);
    setAssignTlId('');
  };

  // Contracts with no jobs generated yet — use totalJobsScheduled (set by createScheduledJobs)
  // as the primary signal, with a live job scan as a fallback.
  const contractsReadyToSchedule = activeContracts.filter(
    (c) => (c.totalJobsScheduled || 0) === 0 && !jobs.some((j) => j.contractId === c.id && j.status !== 'cancelled')
  );

  const technicians = staff.filter((s) => ['technician', 'team_leader'].includes(s.role || ''));

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', letterSpacing: '-0.02em' }}>
            Welcome, {userProfile?.displayName || 'Operations Manager'}
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Contract signed ─► Generate Jobs ─► Assign Team ─► Dispatch ─► QC Verify
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/operations/jobs?action=new_job')}>
          + Schedule Service Job
        </button>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card" style={{ cursor: 'default' }}>
          <div>
            <div className="kpi-title">Meetings to Assign</div>
            <div className="kpi-value" style={{ color: meetingsNeedingTL.length > 0 ? '#D97706' : undefined }}>{meetingsNeedingTL.length}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>no team leader yet</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
            <CalendarDays size={22} />
          </div>
        </div>
        <div className="kpi-card" style={{ cursor: 'default' }}>
          <div>
            <div className="kpi-title">Active Contracts</div>
            <div className="kpi-value">{activeContracts.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#D1FAE5', color: 'var(--ikpm-emerald-600)' }}>
            <FileSignature size={22} />
          </div>
        </div>
        <div className="kpi-card" onClick={() => navigate('/operations/jobs')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Jobs Needing Team</div>
            <div className="kpi-value" style={{ color: unassignedJobs.length > 0 ? '#D97706' : undefined }}>{unassignedJobs.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
            <Truck size={22} />
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-title">Reports Pending QC</div>
            <div className="kpi-value" style={{ color: reportsAwaitingQC.length > 0 ? '#DC2626' : undefined }}>{reportsAwaitingQC.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
            <ShieldCheck size={22} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>

        {/* Meetings from CRO — need a team leader assigned */}
        <div className="card" style={{ padding: '1rem', borderLeft: `4px solid ${meetingsNeedingTL.length > 0 ? '#F59E0B' : 'var(--border-subtle)'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CalendarDays size={18} color={meetingsNeedingTL.length > 0 ? '#D97706' : 'var(--text-muted)'} />
              <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>
                Meetings — Assign Team Leader ({meetingsNeedingTL.length})
              </strong>
            </div>
          </div>
          {meetingsNeedingTL.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>All scheduled meetings have a team leader assigned.</p>
          ) : (
            meetingsNeedingTL.slice(0, 5).map((lead) => (
              <div key={lead.id} style={{ padding: '0.6rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', border: '1px solid #FCD34D', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.82rem' }}>{lead.title}</strong>
                  <span style={{ fontSize: '0.68rem', color: '#92400E' }}>
                    {lead.inspection?.scheduledDate ? formatDate(lead.inspection.scheduledDate) : 'Date TBD'}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {lead.contactName} · {lead.city || '—'}
                </div>

                {assigningLeadId === lead.id ? (
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '6px', alignItems: 'center' }}>
                    <select
                      className="form-select"
                      style={{ flex: 1, height: '30px', fontSize: '0.75rem' }}
                      value={assignTlId}
                      onChange={(e) => setAssignTlId(e.target.value)}
                    >
                      <option value="">Select team leader…</option>
                      {teamLeaders.map((tl) => (
                        <option key={tl.uid} value={tl.uid}>{tl.displayName}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                      disabled={!assignTlId}
                      onClick={() => handleAssignTL(lead.id)}
                    >
                      Assign
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.72rem' }}
                      onClick={() => { setAssigningLeadId(null); setAssignTlId(''); }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.7rem', marginTop: '6px' }}
                    onClick={() => { setAssigningLeadId(lead.id); setAssignTlId(''); }}
                  >
                    Assign Team Leader
                  </button>
                )}
              </div>
            ))
          )}
          {meetingsNeedingTL.length > 5 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)', textAlign: 'center', marginTop: '0.25rem', cursor: 'pointer' }}
              onClick={() => navigate('/meetings')}>
              +{meetingsNeedingTL.length - 5} more — view all meetings
            </div>
          )}
        </div>

        {/* Contracts Ready to Schedule — signed by CRO, no jobs yet */}
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid var(--ikpm-emerald-500)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileSignature size={18} color="var(--ikpm-emerald-600)" />
              <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>
                New Contracts — Generate Jobs ({contractsReadyToSchedule.length})
              </strong>
            </div>
          </div>
          {contractsReadyToSchedule.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>All contracts have jobs scheduled.</p>
          ) : (
            contractsReadyToSchedule.slice(0, 5).map((c) => (
              <div key={c.id} onClick={() => navigate('/operations/jobs?action=new_job')}
                style={{ padding: '0.6rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--ikpm-emerald-300)', marginBottom: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.82rem' }}>{c.customerName}</strong>
                  <span className="badge-status badge-emerald" style={{ fontSize: '0.62rem' }}>Active</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {c.contractType} · {formatDate(c.startDate)} → {formatDate(c.endDate)}
                </div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ikpm-emerald-600)', marginTop: '2px' }}>
                  {formatPKR(c.totalContractValue)} · {c.frequency}
                </div>
                <button
                  className="btn btn-primary"
                  style={{ padding: '0.2rem 0.6rem', fontSize: '0.7rem', marginTop: '6px' }}
                  onClick={(e) => { e.stopPropagation(); setScheduleModalContract(c); }}
                >
                  Generate &amp; Assign Jobs
                </button>
              </div>
            ))
          )}
        </div>

        {/* Unassigned Jobs */}
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #F59E0B' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={18} color="#D97706" />
              <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>
                Jobs Without Team ({unassignedJobs.length})
              </strong>
            </div>
            <Link to="/operations/jobs" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>All Jobs</Link>
          </div>
          {unassignedJobs.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>All jobs have assigned technicians.</p>
          ) : (
            unassignedJobs.slice(0, 5).map((j) => (
              <div key={j.id} onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                style={{ padding: '0.6rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid #FCD34D', marginBottom: '0.4rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{j.customerName}</div>
                <div style={{ fontSize: '0.72rem', color: '#92400E' }}>Date: {formatDate(j.scheduledDate)}</div>
                <button className="btn btn-primary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.7rem', marginTop: '6px' }}>
                  Assign Team
                </button>
              </div>
            ))
          )}
        </div>

        {/* Today's & Tomorrow's Visits */}
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid var(--ikpm-navy-700)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CalendarDays size={18} color="var(--ikpm-navy-700)" />
              <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>
                Today &amp; Tomorrow ({jobs.filter((j) => [todayStr, tomorrowStr].includes(j.scheduledDate) && ['scheduled', 'in_progress'].includes(j.status)).length})
              </strong>
            </div>
            <Link to="/operations/calendar" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>Calendar</Link>
          </div>
          {jobs.filter((j) => [todayStr, tomorrowStr].includes(j.scheduledDate) && ['scheduled', 'in_progress'].includes(j.status)).length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No visits today or tomorrow.</p>
          ) : (
            jobs.filter((j) => [todayStr, tomorrowStr].includes(j.scheduledDate) && ['scheduled', 'in_progress'].includes(j.status)).slice(0, 5).map((j) => (
              <div key={j.id} onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)', marginBottom: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: '0.8rem' }}>{j.customerName}</strong>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{j.scheduledDate === todayStr ? 'Today' : 'Tomorrow'}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{j.siteName} · {j.timeSlot}</div>
              </div>
            ))
          )}
        </div>

        {/* Reports Awaiting QC */}
        {reportsAwaitingQC.length > 0 && (
          <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #DC2626' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <ShieldCheck size={18} color="#DC2626" />
              <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>
                Reports Awaiting QC Verification ({reportsAwaitingQC.length})
              </strong>
            </div>
            {reportsAwaitingQC.slice(0, 5).map((j) => (
              <div key={j.id} onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--ikpm-emerald-300)', marginBottom: '0.35rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{j.customerName}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Tech: {j.leadPcoName} · {formatDate(j.scheduledDate)}</div>
                <button className="btn btn-outline-emerald" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', marginTop: '5px' }}>
                  <ShieldCheck size={12} /> Verify QC
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Team Overview */}
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #7C3AED' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Truck size={18} color="#7C3AED" />
            <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>
              Field Staff ({technicians.length})
            </strong>
          </div>
          {technicians.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No field staff registered yet.</p>
          ) : (
            technicians.slice(0, 6).map((m) => (
              <div key={m.uid} style={{ padding: '0.35rem 0.6rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: 'var(--ikpm-navy-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--ikpm-navy-700)', flexShrink: 0 }}>
                  {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.78rem' }}>{m.displayName || m.email}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{m.role?.replace(/_/g, ' ')}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {scheduleModalContract && (
        <ScheduleGeneratorModal
          contract={scheduleModalContract}
          onClose={() => setScheduleModalContract(null)}
        />
      )}
    </div>
  );
}

// ─── Operation Person Dashboard ────────────────────────────────────────────────
function OperationPersonDashboard() {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  useDataStore();
  const jobs = dataService.getJobs();
  const leads = dataService.getLeads();

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const uid = userProfile?.uid || '';

  const myJobsToday = jobs.filter(
    (j) => j.scheduledDate === todayStr && ['scheduled', 'in_progress'].includes(j.status) &&
      (j.assignedTeamLeaderId === uid || j.leadPcoId === uid || j.assignedTechnicianIds?.includes(uid))
  );
  const myJobsTomorrow = jobs.filter(
    (j) => j.scheduledDate === tomorrowStr && ['scheduled', 'in_progress'].includes(j.status) &&
      (j.assignedTeamLeaderId === uid || j.leadPcoId === uid || j.assignedTechnicianIds?.includes(uid))
  );
  const myMeetingsDue = leads.filter(
    (l) =>
      l.stage === 'meeting_scheduled' &&
      l.inspection?.scheduledDate &&
      l.inspection.scheduledDate <= todayStr &&
      (l.assignedTeamLeaderId === uid || l.inspection?.assignedTeamLeaderId === uid)
  );
  const myUpcomingMeetings = leads.filter(
    (l) =>
      l.stage === 'meeting_scheduled' &&
      l.inspection?.scheduledDate &&
      l.inspection.scheduledDate > todayStr &&
      (l.assignedTeamLeaderId === uid || l.inspection?.assignedTeamLeaderId === uid)
  );

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', letterSpacing: '-0.02em' }}>
          Welcome, {userProfile?.displayName || 'Operations'}
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
          Your assigned visits and meetings for today
        </p>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card">
          <div>
            <div className="kpi-title">My Jobs Today</div>
            <div className="kpi-value" style={{ color: myJobsToday.length > 0 ? 'var(--ikpm-emerald-600)' : undefined }}>{myJobsToday.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#D1FAE5', color: 'var(--ikpm-emerald-600)' }}>
            <CheckCircle2 size={22} />
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-title">Jobs Tomorrow</div>
            <div className="kpi-value">{myJobsTomorrow.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#EDE9FE', color: '#7C3AED' }}>
            <Clock size={22} />
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-title">Meetings Due Today</div>
            <div className="kpi-value" style={{ color: myMeetingsDue.length > 0 ? '#D97706' : undefined }}>{myMeetingsDue.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
            <CalendarDays size={22} />
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-title">Upcoming Meetings</div>
            <div className="kpi-value">{myUpcomingMeetings.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#E0E7FF', color: 'var(--ikpm-navy-700)' }}>
            <CalendarDays size={22} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>

        {/* My Jobs Today */}
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid var(--ikpm-emerald-500)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Truck size={18} color="var(--ikpm-emerald-600)" />
              <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>My Jobs Today ({myJobsToday.length})</strong>
            </div>
            <Link to="/operations/jobs" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>All Jobs</Link>
          </div>
          {myJobsToday.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No jobs assigned to you today.</p>
          ) : (
            myJobsToday.map((j) => (
              <div key={j.id} onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                style={{ padding: '0.6rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: `1px solid ${j.status === 'in_progress' ? 'var(--ikpm-emerald-300)' : 'var(--border-subtle)'}`, marginBottom: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.82rem' }}>{j.customerName}</strong>
                  <span className={`badge-status ${j.status === 'in_progress' ? 'badge-emerald' : 'badge-navy'}`} style={{ fontSize: '0.62rem' }}>
                    {j.status === 'in_progress' ? 'In Progress' : 'Scheduled'}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {j.siteName} · {j.timeSlot}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Tomorrow's Jobs */}
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid var(--ikpm-navy-700)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={18} color="var(--ikpm-navy-700)" />
              <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>Tomorrow&apos;s Jobs ({myJobsTomorrow.length})</strong>
            </div>
          </div>
          {myJobsTomorrow.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No jobs assigned tomorrow.</p>
          ) : (
            myJobsTomorrow.map((j) => (
              <div key={j.id} onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                style={{ padding: '0.6rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)', marginBottom: '0.4rem' }}>
                <strong style={{ fontSize: '0.82rem' }}>{j.customerName}</strong>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {j.siteName} · {j.timeSlot}
                </div>
              </div>
            ))
          )}
        </div>

        {/* My Meetings */}
        <div className="card" style={{ padding: '1rem', borderLeft: `4px solid ${myMeetingsDue.length > 0 ? '#DC2626' : 'var(--border-subtle)'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CalendarDays size={18} color={myMeetingsDue.length > 0 ? '#DC2626' : 'var(--ikpm-navy-700)'} />
              <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>
                My Meetings ({myMeetingsDue.length + myUpcomingMeetings.length})
              </strong>
            </div>
            <Link to="/meetings" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>Meetings</Link>
          </div>
          {myMeetingsDue.length === 0 && myUpcomingMeetings.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No meetings assigned to you.</p>
          ) : (
            <>
              {myMeetingsDue.map((l) => (
                <div key={l.id} onClick={() => navigate(`/crm?lead=${l.id}`)}
                  style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid #FCA5A5', marginBottom: '0.35rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{l.title}</div>
                  <div style={{ fontSize: '0.72rem', color: '#DC2626' }}>{l.city} · {formatDate(l.inspection!.scheduledDate!)} (Due)</div>
                </div>
              ))}
              {myUpcomingMeetings.slice(0, 3).map((l) => (
                <div key={l.id} onClick={() => navigate(`/crm?lead=${l.id}`)}
                  style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)', marginBottom: '0.35rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{l.title}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{l.city} · {formatDate(l.inspection!.scheduledDate!)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Technician Dashboard ──────────────────────────────────────────────────────
function TechnicianDashboard() {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  useDataStore();
  const jobs = dataService.getJobs();
  const uid = userProfile?.uid || '';

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const myJobsToday = jobs.filter(
    (j) => j.scheduledDate === todayStr && ['scheduled', 'in_progress'].includes(j.status) &&
      (j.assignedTechnicianIds?.includes(uid) || j.leadPcoId === uid)
  );
  const myJobsTomorrow = jobs.filter(
    (j) => j.scheduledDate === tomorrowStr && ['scheduled', 'in_progress'].includes(j.status) &&
      (j.assignedTechnicianIds?.includes(uid) || j.leadPcoId === uid)
  );
  const recentlyCompleted = jobs.filter(
    (j) => j.status === 'completed' && (j.assignedTechnicianIds?.includes(uid) || j.leadPcoId === uid)
  ).slice(0, 5);

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', letterSpacing: '-0.02em' }}>
          Welcome, {userProfile?.displayName || 'Technician'}
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
          Your service visits for today
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>

        {/* Today's Jobs */}
        <div className="card" style={{ padding: '1.25rem', borderLeft: `4px solid ${myJobsToday.length > 0 ? 'var(--ikpm-emerald-500)' : 'var(--border-subtle)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Truck size={20} color="var(--ikpm-emerald-600)" />
            <strong style={{ fontSize: '1rem', color: 'var(--ikpm-navy-900)' }}>Today&apos;s Jobs ({myJobsToday.length})</strong>
          </div>
          {myJobsToday.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              No visits scheduled for today.
            </div>
          ) : (
            myJobsToday.map((j) => (
              <div key={j.id} onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: `1px solid ${j.status === 'in_progress' ? 'var(--ikpm-emerald-300)' : 'var(--border-subtle)'}`, marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.9rem' }}>{j.customerName}</strong>
                  <span className={`badge-status ${j.status === 'in_progress' ? 'badge-emerald' : 'badge-navy'}`}>
                    {j.status === 'in_progress' ? 'In Progress' : 'Scheduled'}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {j.siteName}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Time: {j.timeSlot}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Tomorrow's Jobs */}
        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--ikpm-navy-700)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Clock size={20} color="var(--ikpm-navy-700)" />
            <strong style={{ fontSize: '1rem', color: 'var(--ikpm-navy-900)' }}>Tomorrow&apos;s Jobs ({myJobsTomorrow.length})</strong>
          </div>
          {myJobsTomorrow.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              No visits scheduled for tomorrow.
            </div>
          ) : (
            myJobsTomorrow.map((j) => (
              <div key={j.id} onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: '1px solid var(--border-subtle)', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.9rem' }}>{j.customerName}</strong>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>{j.siteName}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>Time: {j.timeSlot}</div>
              </div>
            ))
          )}
        </div>

        {/* Recently Completed */}
        {recentlyCompleted.length > 0 && (
          <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #10B981' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <CheckCircle2 size={20} color="#10B981" />
              <strong style={{ fontSize: '1rem', color: 'var(--ikpm-navy-900)' }}>Recently Completed</strong>
            </div>
            {recentlyCompleted.map((j) => (
              <div key={j.id} style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', border: '1px solid #D1FAE5', marginBottom: '0.35rem' }}>
                <strong style={{ fontSize: '0.82rem' }}>{j.customerName}</strong>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{j.siteName} · {formatDate(j.scheduledDate)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Super Admin / Admin Dashboard ────────────────────────────────────────────
function AdminDashboard() {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  useDataStore();

  const leads = dataService.getLeads();
  const proposals = dataService.getProposals();
  const contracts = dataService.getContracts();
  const jobs = dataService.getJobs();
  const invoices = dataService.getInvoices();
  const complaints = dataService.getComplaints();

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const openLeads = leads.filter((l) => !['won', 'lost'].includes(l.stage));
  const activeContracts = contracts.filter((c) => c.status === 'active');
  const jobsToday = jobs.filter((j) => [todayStr, tomorrowStr].includes(j.scheduledDate) && ['scheduled', 'in_progress'].includes(j.status));
  const reportsQC = jobs.filter((j) => j.status === 'completed' && !j.supervisorVerification?.isVerified);
  const unassignedJobs = jobs.filter((j) => ['scheduled'].includes(j.status) && (!j.assignedTechnicianNames?.length || j.assignedTechnicianNames.includes('Unassigned')));
  const overdueInvoices = invoices.filter((i) => new Date(i.dueDate) < new Date() && i.balanceDue > 0 && i.status !== 'void_reversed');
  const openComplaints = complaints.filter((c) => c.status !== 'closed');
  const overdueComplaints = complaints.filter(isComplaintOverdue);

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', letterSpacing: '-0.02em' }}>
          Welcome, {userProfile?.displayName || 'Admin'}
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
          Lead ─► Proposal ─► Contract ─► Job ─► Invoice ─► Paid
        </p>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card" onClick={() => navigate('/crm')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Open Pipeline Leads</div>
            <div className="kpi-value">{openLeads.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#E0E7FF', color: 'var(--ikpm-navy-700)' }}>
            <Users2 size={22} />
          </div>
        </div>
        <div className="kpi-card" onClick={() => navigate('/contracts')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Active Contracts</div>
            <div className="kpi-value">{activeContracts.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#D1FAE5', color: 'var(--ikpm-emerald-600)' }}>
            <FileSignature size={22} />
          </div>
        </div>
        <div className="kpi-card" onClick={() => navigate('/operations/jobs')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Jobs Today / Tomorrow</div>
            <div className="kpi-value">{jobsToday.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#EDE9FE', color: '#7C3AED' }}>
            <Truck size={22} />
          </div>
        </div>
        <div className="kpi-card" onClick={() => navigate('/finance/invoices')} style={{ cursor: 'pointer' }}>
          <div>
            <div className="kpi-title">Overdue Invoices</div>
            <div className="kpi-value" style={{ color: overdueInvoices.length > 0 ? '#DC2626' : undefined }}>{overdueInvoices.length}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
            <Receipt size={22} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>

        {/* Open Leads */}
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>Open Leads ({openLeads.length})</strong>
            <Link to="/crm" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>CRM</Link>
          </div>
          {openLeads.slice(0, 4).map((l) => (
            <div key={l.id} onClick={() => navigate(`/crm?lead=${l.id}`)}
              style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border-subtle)', marginBottom: '0.35rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{l.title}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{l.contactName} · {l.stage.replace(/_/g, ' ')}</div>
            </div>
          ))}
        </div>

        {/* Unassigned Jobs */}
        {unassignedJobs.length > 0 && (
          <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #F59E0B' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>
                <AlertTriangle size={16} style={{ display: 'inline', marginRight: '4px', color: '#D97706' }} />
                Unassigned Jobs ({unassignedJobs.length})
              </strong>
              <Link to="/operations/jobs" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>All Jobs</Link>
            </div>
            {unassignedJobs.slice(0, 4).map((j) => (
              <div key={j.id} onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid #FCD34D', marginBottom: '0.35rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{j.customerName}</div>
                <div style={{ fontSize: '0.72rem', color: '#92400E' }}>Date: {formatDate(j.scheduledDate)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Reports Pending QC */}
        {reportsQC.length > 0 && (
          <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #DC2626' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>Reports Pending QC ({reportsQC.length})</strong>
              <Link to="/operations/jobs" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>Jobs</Link>
            </div>
            {reportsQC.slice(0, 4).map((j) => (
              <div key={j.id} onClick={() => navigate(`/operations/jobs?job=${j.id}`)}
                style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--ikpm-emerald-300)', marginBottom: '0.35rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{j.customerName}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Tech: {j.leadPcoName}</div>
              </div>
            ))}
          </div>
        )}

        {/* Open Complaints */}
        {openComplaints.length > 0 && (
          <div className="card" style={{ padding: '1rem', borderLeft: `4px solid ${overdueComplaints.length > 0 ? '#DC2626' : 'var(--ikpm-amber-500)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <MessageSquareWarning size={18} color={overdueComplaints.length > 0 ? '#DC2626' : '#D97706'} />
                <strong style={{ fontSize: '0.9rem', color: 'var(--ikpm-navy-900)' }}>
                  Open Complaints ({openComplaints.length})
                </strong>
                {overdueComplaints.length > 0 && <span className="badge-status badge-rose">{overdueComplaints.length} overdue</span>}
              </div>
              <Link to="/complaints" style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)' }}>View All</Link>
            </div>
            {openComplaints.slice(0, 4).map((c) => (
              <div key={c.id} onClick={() => navigate('/complaints')}
                style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: `1px solid ${isComplaintOverdue(c) ? '#FCA5A5' : 'var(--border-subtle)'}`, marginBottom: '0.35rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{c.customerName}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.category} · {c.status.replace(/_/g, ' ')}</div>
                {isComplaintOverdue(c) && <div style={{ fontSize: '0.68rem', color: '#DC2626' }}>Overdue</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Export ───────────────────────────────────────────────────────────────
export const DashboardPage: React.FC = () => {
  const { effectiveRole } = useAuth();
  const base = baseRoleOf(effectiveRole);

  // CRO / Sales: lead pipeline & proposal management
  if (base === 'sales') return <CRODashboard />;
  // Operations Coordinator: schedules jobs, dispatches, assigns teams
  if (base === 'operations') return <OpsManagerDashboard />;
  // Team Leader (PCO field lead): sees own assigned visits & meetings
  if (base === 'team_leader') return <OperationPersonDashboard />;
  // Technician: sees only their own jobs
  if (base === 'technician') return <TechnicianDashboard />;
  // Super Admin / Admin / Management: full overview
  return <AdminDashboard />;
};
