import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Shield,
  History,
  RefreshCw,
  CheckCircle2,
  HardDrive,
  Eye,
  Cloud,
  CloudUpload,
  AlertTriangle,
  UsersRound,
  Building2,
  FileText,
} from 'lucide-react';
import { CompanyProfileForm } from '../../features/settings/CompanyProfileForm';
import { TemplatesForm } from '../../features/settings/TemplatesForm';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatDateTime } from '../../lib/formatters';
import { useSync } from '../../contexts/SyncContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDataStore } from '../../hooks/useDataStore';

export const SettingsPage: React.FC = () => {
  useDataStore(); // re-render when Firestore data arrives
  const { isOnline, pendingCount, syncQueue, triggerSync } = useSync();
  const { isSuperAdmin, setSimulatedRole } = useAuth();
  const { success, error } = useNotification();
  const [searchParams, setSearchParams] = useSearchParams();

  type SettingsTab = 'company' | 'templates' | 'cloud' | 'roles' | 'audit' | 'sync';
  const [activeTab, setActiveTabState] = useState<SettingsTab>((searchParams.get('tab') as SettingsTab) || 'cloud');
  const setActiveTab = (t: SettingsTab) => {
    setActiveTabState(t);
    setSearchParams({ tab: t }, { replace: true });
  };
  const auditLogs = dataService.getAuditLogs();
  const cloud = dataService.getCloudState();
  const [includeSamples, setIncludeSamples] = useState(false);
  const [uploading, setUploading] = useState(false);
  const localGroups = dataService.getLocalOnlyRecords(includeSamples);
  const localTotal = localGroups.reduce((n, g) => n + g.count, 0);
  const teams = dataService.getTeams();
  const staff = dataService.getUsers().filter((u) => u.isActive);

  const uploadLocal = async () => {
    setUploading(true);
    try {
      const n = await dataService.uploadLocalRecords(includeSamples);
      success('Uploaded to Firestore', `${n} record(s) from this browser are now saved in the cloud.`);
    } catch (err) {
      const code = (err as { code?: string }).code;
      error('Upload failed', code === 'permission-denied'
        ? 'Firestore refused the upload. Deploy the security rules first (see the steps above), then try again.'
        : err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const rolesMatrix = [
    {
      role: 'super_admin',
      title: 'Super Admin',
      leads: 'Full access — all records',
      proposals: 'Full access',
      jobs: 'Full access — all teams',
      finance: 'Full access',
    },
    {
      role: 'admin',
      title: 'Admin',
      leads: 'Full edit — all leads & CRM',
      proposals: 'Create, edit & send proposals',
      jobs: 'Schedule, dispatch & manage all jobs',
      finance: 'View invoices only',
    },
    {
      role: 'sales',
      title: 'CRO',
      leads: 'All leads — new, follow-up, proposal',
      proposals: 'Create & send proposals',
      jobs: 'No access',
      finance: 'No access',
    },
    {
      role: 'operations',
      title: 'Operation Coordinator',
      leads: 'View meetings, assign team leaders',
      proposals: 'View accepted proposals',
      jobs: 'Create contracts, schedule & dispatch jobs',
      finance: 'No access',
    },
    {
      role: 'team_leader',
      title: 'Team Leader',
      leads: 'Submit meeting reports',
      proposals: 'View (read-only)',
      jobs: 'Execute jobs, submit field reports',
      finance: 'No access',
    },
    {
      role: 'technician',
      title: 'Technician (PCO)',
      leads: 'No access',
      proposals: 'No access',
      jobs: 'Own assigned jobs only',
      finance: 'No access',
    },
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
        <button className={`tab-btn ${activeTab === 'company' ? 'active' : ''}`} onClick={() => setActiveTab('company')}>
          <Building2 size={16} /> Company profile
        </button>
        <button className={`tab-btn ${activeTab === 'templates' ? 'active' : ''}`} onClick={() => setActiveTab('templates')}>
          <FileText size={16} /> Templates
        </button>
        <button className={`tab-btn ${activeTab === 'cloud' ? 'active' : ''}`} onClick={() => setActiveTab('cloud')}>
          <Cloud size={16} /> Cloud database
          {cloud.status === 'error' && <AlertTriangle size={14} color="var(--ikpm-rose-500)" />}
        </button>
        <button className={`tab-btn ${activeTab === 'roles' ? 'active' : ''}`} onClick={() => setActiveTab('roles')}>
          <Shield size={16} /> Preview as role
        </button>
        <button className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
          <History size={16} /> Audit trail <span className="tab-count">{auditLogs.length}</span>
        </button>
        <button className={`tab-btn ${activeTab === 'sync' ? 'active' : ''}`} onClick={() => setActiveTab('sync')}>
          <HardDrive size={16} /> Offline queue <span className="tab-count">{pendingCount}</span>
        </button>
      </div>

      {activeTab === 'company' && <CompanyProfileForm />}
      {activeTab === 'templates' && <TemplatesForm />}

      {/* Tab: Cloud database */}
      {activeTab === 'cloud' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              {cloud.status === 'error' ? <AlertTriangle size={22} color="var(--ikpm-rose-500)" /> : <Cloud size={22} color="var(--ikpm-emerald-600)" />}
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="card-title">
                  {cloud.status === 'error' ? 'Cloud Firestore is refusing access' : cloud.status === 'live' ? 'Connected to Cloud Firestore' : 'Connecting to Cloud Firestore…'}
                </div>
                <div className="cell-sub">
                  {cloud.status === 'error'
                    ? cloud.lastError?.message
                    : `Every change is saved to Firestore${cloud.pendingWrites ? `. ${cloud.pendingWrites} change(s) still saving` : '. Nothing pending'}. Offline edits sync automatically when you reconnect.`}
                </div>
              </div>
              <span className={`sync-pill ${cloud.status === 'error' ? 'error' : cloud.pendingWrites ? 'pending' : 'live'}`}>
                <span className="dot" /> {cloud.status === 'error' ? 'Blocked' : cloud.pendingWrites ? 'Saving' : 'Live'}
              </span>
            </div>
            {cloud.blocked.length > 0 && (
              <div className="error-hint" style={{ marginTop: '1rem' }}>
                <strong>Blocked collections:</strong> {cloud.blocked.join(', ')}
                <ol className="steps-list">
                  <li>In a terminal in the project folder run <code>npx firebase-tools login</code> (use the Google account that owns the Firebase project).</li>
                  <li>Run <code>npx firebase-tools deploy --only firestore</code>. This publishes <code>firestore.rules</code> and the indexes.</li>
                  <li>Reload the portal.</li>
                </ol>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
              <CloudUpload size={22} color="var(--ikpm-blue-600)" />
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="card-title">Data saved only in this browser</div>
                <div className="cell-sub">
                  Before the database was connected, records were kept in this browser only. Upload them once so the whole team can see them.
                </div>
              </div>
              {isSuperAdmin && (
                <button className="btn btn-primary" disabled={uploading || localTotal === 0} onClick={uploadLocal}>
                  <CloudUpload size={16} /> {uploading ? 'Uploading…' : `Upload ${localTotal} record(s)`}
                </button>
              )}
            </div>
            {localTotal === 0 ? (
              <div className="cell-sub" style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={15} color="var(--ikpm-emerald-600)" /> Nothing left to upload from this browser.
              </div>
            ) : (
              <>
                <div className="chip-row" style={{ marginTop: '0.85rem', marginBottom: '0.5rem' }}>
                  {localGroups.map((g) => (
                    <span key={g.collection} className="status-pill">{g.collection.replace(/_/g, ' ')} <strong>{g.count}</strong></span>
                  ))}
                </div>
                <label className="doc-check" style={{ display: 'inline-flex' }}>
                  <input type="checkbox" checked={includeSamples} onChange={(e) => setIncludeSamples(e.target.checked)} />
                  Also upload the built-in demo records
                </label>
                {!isSuperAdmin && <div className="form-hint">Only the super admin can upload these records.</div>}
              </>
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <UsersRound size={22} color="var(--ikpm-navy-700)" />
              <div style={{ flex: 1 }}>
                <div className="card-title">Organisation</div>
                <div className="cell-sub">{staff.length} active staff in {teams.length} team(s)</div>
              </div>
              {isSuperAdmin && <Link to="/admin/team" className="btn btn-secondary">Manage team & access</Link>}
            </div>
          </div>
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
        <div className="table-container is-scroll">
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
