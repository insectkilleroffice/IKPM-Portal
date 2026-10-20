import React, { useState } from 'react';
import {
  Shield,
  History,
  RefreshCw,
  Building2,
  CheckCircle2,
  HardDrive,
  Eye,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatDateTime } from '../../lib/formatters';
import { useSync } from '../../contexts/SyncContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';

export const SettingsPage: React.FC = () => {
  const { isOnline, pendingCount, syncQueue, triggerSync } = useSync();
  const { isSuperAdmin, setSimulatedRole } = useAuth();
  const { success } = useNotification();

  const [activeTab, setActiveTab] = useState<'org' | 'roles' | 'audit' | 'sync'>('org');
  const auditLogs = dataService.getAuditLogs();

  const seedDepartments = [
    { name: 'Executive Management', head: 'Salman (CEO)', staffCount: 1 },
    { name: 'Sales & Customer Relationship', head: 'TBD', staffCount: 4 },
    { name: 'Operations & Dispatch', head: 'Muhammad Asif (Ops Mgr)', staffCount: 12 },
    { name: 'Accounts & Finance', head: 'Farooq (Accounts Head)', staffCount: 3 },
    { name: 'Quality Control & Audit', head: 'Internal Compliance Lead', staffCount: 2 },
  ];

  const rolesMatrix = [
    { role: 'super_admin', title: 'Super Admin (CEO / Owner)', leads: 'All', proposals: 'All + Full Approvals', jobs: 'All', finance: 'Full Access' },
    { role: 'management', title: 'Management (General Manager)', leads: 'All', proposals: 'All + Approvals', jobs: 'All', finance: 'View & Reports' },
    { role: 'sales', title: 'Sales (Manager / CRO)', leads: 'Team / Owned', proposals: 'Draft & Submit', jobs: 'View Linked', finance: 'No Access' },
    { role: 'operations', title: 'Operations (Dispatch / Coordinator)', leads: 'Conversion View', proposals: 'View Approved', jobs: 'Full Dispatch', finance: 'No Access' },
    { role: 'finance', title: 'Accounts & Finance Officer', leads: 'No Access', proposals: 'View Approved', jobs: 'View Completed', finance: 'Invoicing & WHT' },
    { role: 'technician', title: 'Pest Control Operator (PCO Field)', leads: 'No Access', proposals: 'No Access', jobs: 'Assigned Site Only', finance: 'No Access' },
    { role: 'auditor', title: 'Read-only Auditor', leads: 'Read-only', proposals: 'Read-only', jobs: 'Read-only', finance: 'Read-only' },
  ];

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'System Settings & Administration' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Portal Configuration & Governance</h1>
          <p className="page-subtitle">
            Organizational hierarchy, role permission matrices, audit logs, and PWA offline queue diagnostics.
          </p>
        </div>
      </div>

      {/* Settings Navigation Tabs */}
      <div className="tab-bar">
        <button className={`tab-btn ${activeTab === 'org' ? 'active' : ''}`} onClick={() => setActiveTab('org')}>
          <Building2 size={14} /> Organizational Structure
        </button>
        <button className={`tab-btn ${activeTab === 'roles' ? 'active' : ''}`} onClick={() => setActiveTab('roles')}>
          <Shield size={14} /> Roles & Authorization Matrix
        </button>
        <button className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
          <History size={14} /> System Audit Trail ({auditLogs.length})
        </button>
        <button className={`tab-btn ${activeTab === 'sync' ? 'active' : ''}`} onClick={() => setActiveTab('sync')}>
          <HardDrive size={14} /> Offline Sync Queue ({pendingCount})
        </button>
      </div>

      {/* Tab: Org Structure */}
      {activeTab === 'org' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
          {seedDepartments.map((dept) => (
            <div key={dept.name} className="card" style={{ borderTop: '3px solid var(--ikpm-navy-700)' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>{dept.name}</h3>
              <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Department Head: <strong>{dept.head}</strong>
              </div>
              <div style={{ marginTop: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="badge-status badge-navy">{dept.staffCount} Designated Staff</span>
                <span className="badge-status badge-emerald">Operational</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Roles Matrix */}
      {activeTab === 'roles' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Role Code & Title</th>
                <th>CRM & Leads</th>
                <th>Proposals & Pricing</th>
                <th>Field Operations</th>
                <th>Finance & WHT</th>
                {isSuperAdmin && <th>Simulate View</th>}
              </tr>
            </thead>
            <tbody>
              {rolesMatrix.map((rm) => (
                <tr key={rm.role}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{rm.title}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--ikpm-emerald-600)', fontFamily: 'monospace' }}>
                      {rm.role}
                    </div>
                  </td>
                  <td>{rm.leads}</td>
                  <td>{rm.proposals}</td>
                  <td>{rm.jobs}</td>
                  <td>{rm.finance}</td>
                  {isSuperAdmin && (
                    <td>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem' }}
                        onClick={() => {
                          setSimulatedRole(rm.role as any);
                          success('Simulator Activated', `Now viewing as ${rm.title}`);
                        }}
                      >
                        <Eye size={12} />
                        <span>Simulate</span>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Audit Logs */}
      {activeTab === 'audit' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Log Timestamp</th>
                <th>Action Type</th>
                <th>Entity Affected</th>
                <th>Operator</th>
                <th>Audit Trail Description</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatDateTime(log.timestamp)}</td>
                  <td><span className="badge-status badge-navy">{log.action.toUpperCase()}</span></td>
                  <td><strong>{log.entityType}</strong> ({log.entityId})</td>
                  <td>{log.userEmail}</td>
                  <td style={{ fontSize: '0.85rem' }}>{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Sync Queue */}
      {activeTab === 'sync' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)' }}>
                Offline Local Drafts & Sync Queue
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Items saved while technicians or sales reps are disconnected. Automatically synchronized when internet returns.
              </p>
            </div>

            <button className="btn btn-primary" onClick={triggerSync} disabled={!isOnline || pendingCount === 0}>
              <RefreshCw size={15} />
              <span>Force Sync Queue Now</span>
            </button>
          </div>

          {syncQueue.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <CheckCircle2 size={32} color="var(--ikpm-emerald-600)" style={{ margin: '0 auto 0.5rem auto' }} />
              All local records are synchronized with Cloud Firestore. Zero pending offline drafts.
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item ID</th>
                    <th>Target Collection</th>
                    <th>Action</th>
                    <th>Document ID</th>
                    <th>Queued At</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {syncQueue.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{item.id}</td>
                      <td><strong>{item.collectionName}</strong></td>
                      <td>{item.action.toUpperCase()}</td>
                      <td style={{ fontFamily: 'monospace' }}>{item.docId}</td>
                      <td style={{ fontSize: '0.8rem' }}>{formatDateTime(item.createdAt)}</td>
                      <td><StatusBadge status={item.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
