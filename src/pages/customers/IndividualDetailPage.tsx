import React, { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  MapPin,
  Phone,
  FileSpreadsheet,
  FileSignature,
  Truck,
  Receipt,
  FileText,
  FileCheck2,
  Paperclip,
  History,
  CreditCard,
  ClipboardList,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatPKR, formatCNIC, formatDate, formatDateTime } from '../../lib/formatters';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { EntityDocumentsPanel } from '../../features/documents/EntityDocumentsPanel';
import { OnboardingPackPanel } from '../../features/onboarding/OnboardingPackPanel';
import { packStatus, PACK_STATUS_LABEL } from '../../lib/onboarding';
import { EmptyState } from '../../components/common/EmptyState';

export const IndividualDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  useDataStore();
  const [searchParams] = useSearchParams();

  type ClientTab =
    | 'overview'
    | 'onboarding'
    | 'sites'
    | 'leads'
    | 'proposals'
    | 'contracts'
    | 'jobs'
    | 'invoices'
    | 'statements'
    | 'documents'
    | 'audit';
  const [activeTab, setActiveTab] = useState<ClientTab>((searchParams.get('tab') as ClientTab) || 'overview');

  const client = dataService.getClientById(id || '');
  const onboardingPack = client ? dataService.getOnboardingPack(client.id) : undefined;
  const sites = dataService.getSites(id);
  const leads = dataService.getLeads().filter((l) => l.existingCustomerId === id);
  const proposals = dataService.getProposals(id);
  const contracts = dataService.getContracts(id);
  const jobs = dataService.getJobs(id);
  const invoices = dataService.getInvoices(id);
  const auditLogs = dataService.getAuditLogs('client', id);
  const payments = dataService.getPayments(id);

  // Chronological ledger: invoices debit the account, non-reversed receipts credit it.
  const ledgerEntries = [
    ...invoices.map((inv) => ({
      id: `L-${inv.id}`,
      date: inv.issueDate,
      type: 'Invoice',
      reference: inv.invoiceNumber,
      description: `Service invoice (${inv.jurisdiction.toUpperCase()})`,
      debit: inv.grossPayable,
      credit: 0,
    })),
    ...payments
      .filter((p) => !p.isReversed)
      .map((p) => ({
        id: `L-${p.id}`,
        date: p.paymentDate,
        type: 'Receipt',
        reference: p.receiptNumber,
        description: `Payment against ${p.invoiceNumber} (${p.paymentMode.replace('_', ' ')})`,
        debit: 0,
        credit: p.totalCreditApplied,
      })),
  ]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .reduce<Array<{ id: string; date: string; type: string; reference: string; description: string; debit: number; credit: number; runningBalance: number }>>(
      (rows, e) => {
        const prev = rows.length ? rows[rows.length - 1].runningBalance : 0;
        rows.push({ ...e, runningBalance: prev + e.debit - e.credit });
        return rows;
      },
      []
    );
  const totalDebits = ledgerEntries.reduce((s, e) => s + e.debit, 0);
  const totalCredits = ledgerEntries.reduce((s, e) => s + e.credit, 0);

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

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/operations/jobs?action=new_job&customerId=${client.id}&customerType=individual`)}
              title="Schedule new pest control service with this client pre-selected"
            >
              <Truck size={15} />
              <span>+ New Service</span>
            </button>
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
        {hasRole(['super_admin', 'team_leader', 'finance']) && (
          <>
            <button className={`tab-btn ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>
              <Receipt size={14} /> Invoices & Receipts ({invoices.length})
            </button>
            <button className={`tab-btn ${activeTab === 'statements' ? 'active' : ''}`} onClick={() => setActiveTab('statements')}>
              <FileCheck2 size={14} /> Ledger & Statements
            </button>
          </>
        )}
        <button className={`tab-btn ${activeTab === 'onboarding' ? 'active' : ''}`} onClick={() => setActiveTab('onboarding')}>
          <ClipboardList size={14} /> Onboarding{onboardingPack ? ` (${PACK_STATUS_LABEL[packStatus(onboardingPack)]})` : ''}
        </button>
        <button className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>
          <Paperclip size={14} /> Files
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

      {/* Sites Tab */}
      {activeTab === 'sites' &&
        (sites.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No Service Sites"
            description="No residences or treatment sites are registered for this client yet."
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
            {sites.map((s) => (
              <div key={s.id} className="card" style={{ borderTop: '3px solid var(--ikpm-emerald-500)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{s.siteName}</div>
                  <span className={`badge-status ${s.isActive ? 'badge-emerald' : 'badge-slate'}`}>
                    {s.propertyType.replace('_', ' ')}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                  <MapPin size={13} style={{ display: 'inline', marginRight: '4px' }} />
                  {s.addressLine1}, {s.area}, {s.city}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  <Phone size={13} style={{ display: 'inline', marginRight: '4px' }} />
                  {s.contactPersonName} · {s.contactPersonPhone}
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
        ))}

      {/* Leads Tab */}
      {activeTab === 'leads' &&
        (leads.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No Inquiries"
            description="No leads or inspection requests are linked to this client yet."
          />
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lead ID</th>
                  <th>Inquiry</th>
                  <th>Pest Issues</th>
                  <th>Inspection</th>
                  <th>Est. Value</th>
                  <th>Stage</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{l.id}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{l.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {l.source.replace(/_/g, ' ')} · {formatDate(l.createdAt)}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                        {l.pestIssues.map((p) => (
                          <span key={p} className="badge-status badge-slate" style={{ fontSize: '0.68rem' }}>
                            {p.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {l.inspection ? (
                        <>
                          <div>{formatDate(l.inspection.completedDate || l.inspection.scheduledDate)}</div>
                          <div style={{ color: 'var(--text-muted)' }}>{l.inspection.inspectorName}</div>
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 700 }}>{l.estimatedValue != null ? formatPKR(l.estimatedValue) : '—'}</td>
                    <td><StatusBadge status={l.stage} /></td>
                    <td>
                      <button
                        className="btn btn-outline-emerald"
                        style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                        onClick={() => navigate(`/crm?lead=${l.id}`)}
                      >
                        Open Lead
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {/* Proposals Tab */}
      {activeTab === 'proposals' &&
        (proposals.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="No Proposals"
            description="No quotations or proposals have been prepared for this client yet."
          />
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Proposal ID & Revision</th>
                  <th>Template & Scope</th>
                  <th>Prepared By</th>
                  <th>Total Value</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{p.id}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)' }}>Revision: R{p.revisionNumber}</div>
                    </td>
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
        ))}

      {/* Contracts Tab */}
      {activeTab === 'contracts' &&
        (contracts.length === 0 ? (
          <EmptyState
            icon={FileSignature}
            title="No Service Contracts"
            description="This client has no one-time or AMC service contracts on record."
          />
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Contract ID</th>
                  <th>Type & Frequency</th>
                  <th>Term Period</th>
                  <th>Contract Value</th>
                  <th>Jobs Completed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{c.id}</td>
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
        ))}

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

      {/* Invoices Tab (finance roles only) */}
      {activeTab === 'invoices' && hasRole(['super_admin', 'team_leader', 'finance']) &&
        (invoices.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No Invoices"
            description="No invoices have been raised against this client yet."
          />
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Issue / Due Date</th>
                  <th>Jurisdiction</th>
                  <th>Gross Total</th>
                  <th>Paid</th>
                  <th>Balance Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{inv.invoiceNumber}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)' }}>{inv.id}</div>
                    </td>
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
        ))}

      {/* Statements Tab (finance roles only) */}
      {activeTab === 'statements' && hasRole(['super_admin', 'team_leader', 'finance']) &&
        (ledgerEntries.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No Ledger Activity"
            description="Invoices and payment receipts for this client will appear here as a running statement."
          />
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
              <div className="card">
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Invoiced</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{formatPKR(totalDebits)}</div>
              </div>
              <div className="card">
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Received</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--ikpm-emerald-600)' }}>{formatPKR(totalCredits)}</div>
              </div>
              <div className="card">
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Closing Balance</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: totalDebits - totalCredits > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                  {formatPKR(totalDebits - totalCredits)}
                </div>
              </div>
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Description</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th>Running Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerEntries.map((e) => (
                    <tr key={e.id}>
                      <td style={{ fontSize: '0.8rem' }}>{formatDate(e.date)}</td>
                      <td>
                        <span className={`badge-status ${e.type === 'Invoice' ? 'badge-navy' : 'badge-emerald'}`}>{e.type}</span>
                      </td>
                      <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{e.reference}</td>
                      <td style={{ fontSize: '0.85rem' }}>{e.description}</td>
                      <td>{e.debit ? formatPKR(e.debit) : '—'}</td>
                      <td style={{ color: 'var(--ikpm-emerald-600)' }}>{e.credit ? formatPKR(e.credit) : '—'}</td>
                      <td style={{ fontWeight: 700, color: e.runningBalance > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                        {formatPKR(e.runningBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {/* Audit Tab */}
      {activeTab === 'audit' &&
        (auditLogs.length === 0 ? (
          <EmptyState
            icon={History}
            title="No Audit History"
            description="No changes have been logged against this client record yet."
          />
        ) : (
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
        ))}

      {activeTab === 'onboarding' && (
        <OnboardingPackPanel
          clientId={client.id}
          clientType="individual"
          clientName={client.fullName}
          city={client.city}
          address={client.residentialAddress}
          recipient={{ name: client.fullName, phone: client.primaryPhone, email: client.email }}
        />
      )}

      {activeTab === 'documents' && (
        <EntityDocumentsPanel
          owner={{ kind: 'client', id: client.id }}
          title={client.fullName}
          recipient={{ name: client.fullName, phone: client.primaryPhone, email: client.email }}
        />
      )}
    </div>
  );
};
