import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  UserPlus,
  UsersRound,
  ShieldCheck,
  Search,
  Pencil,
  KeyRound,
  UserX,
  UserCheck,
  Plus,
  Trash2,
  Check,
  Minus,
  Copy,
  Mail,
} from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { staffService, type NewStaffInput } from '../../services/staffService';
import {
  DEFAULT_SCOPE,
  MODULE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  SCOPE_LABELS,
  type ModuleKey,
} from '../../lib/permissions';
import { formatDateTime } from '../../lib/formatters';
import type { DataScope, Team, UserProfile, UserRole } from '../../types';

const ROLES: UserRole[] = ['super_admin', 'management', 'sales', 'operations', 'finance', 'technician', 'auditor'];
const SCOPES: DataScope[] = ['own', 'team', 'company'];
const TEAM_COLORS = ['#0E8A5F', '#1A73E8', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#475569'];

const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: 'Dashboard',
  customers: 'Customer accounts',
  crm: 'Leads',
  proposals: 'Proposals',
  contracts: 'Contracts & AMCs',
  files: 'Client files',
  documents: 'Company documents',
  calendar: 'Dispatch calendar',
  jobs: 'Service jobs',
  pco: 'PCO field app',
  invoices: 'Invoices & receipts',
  tax: 'Tax rules',
  settings: 'Settings & audit',
  team: 'Team & access',
};

const initials = (name?: string) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

type Tab = 'people' | 'teams' | 'permissions';

interface PersonForm extends NewStaffInput {
  uid?: string;
  isActive?: boolean;
}

const blankPerson = (): PersonForm => ({
  displayName: '',
  email: '',
  businessEmail: '',
  phone: '',
  role: 'sales',
  dataScope: DEFAULT_SCOPE.sales,
  teamId: '',
  designationTitle: '',
});

export const TeamAccessPage: React.FC = () => {
  const store = useDataStore();
  const { userProfile } = useAuth();
  const { success, error, info } = useNotification();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>((searchParams.get('tab') as Tab) || 'people');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(false);

  const [person, setPerson] = useState<PersonForm | null>(searchParams.get('action') === 'new_user' ? blankPerson() : null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; tempPassword: string; resetEmailSent: boolean } | null>(null);

  const [team, setTeam] = useState<(Partial<Team> & { memberIds: string[] }) | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);

  const users = store.getUsers();
  const teams = store.getTeams();

  const visibleUsers = useMemo(() => {
    const q = query.toLowerCase().trim();
    return users.filter((u) => {
      if (!showInactive && !u.isActive) return false;
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (teamFilter === 'none' && u.teamId) return false;
      if (teamFilter !== 'all' && teamFilter !== 'none' && u.teamId !== teamFilter) return false;
      if (!q) return true;
      return [u.displayName, u.email, u.businessEmail, u.designationTitle, u.teamName].some((v) => v?.toLowerCase().includes(q));
    });
  }, [users, query, roleFilter, teamFilter, showInactive]);

  const switchTab = (t: Tab) => {
    setTab(t);
    setSearchParams(t === 'people' ? {} : { tab: t }, { replace: true });
  };

  // ---------- People ----------
  const openNewPerson = () => setPerson(blankPerson());

  const openEditPerson = (u: UserProfile) =>
    setPerson({
      uid: u.uid,
      displayName: u.displayName,
      email: u.email,
      businessEmail: u.businessEmail || u.email,
      phone: u.phone || '',
      role: u.role,
      dataScope: u.dataScope,
      teamId: u.teamId || '',
      designationTitle: u.designationTitle || '',
      isActive: u.isActive,
    });

  const personProblems = (p: PersonForm): string[] => {
    const out: string[] = [];
    if (!p.displayName.trim()) out.push('Enter the person’s full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) out.push('Enter a valid login email.');
    if (p.businessEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.businessEmail.trim())) out.push('Business email is not valid.');
    if (!p.uid && users.some((u) => u.email.toLowerCase() === p.email.trim().toLowerCase())) out.push('Someone already uses this login email.');
    if (p.dataScope === 'team' && !p.teamId) out.push('“Own team’s records” needs a team. Pick one or change data access.');
    return out;
  };

  const savePerson = async () => {
    if (!person) return;
    const problems = personProblems(person);
    if (problems.length) return;
    setSaving(true);
    try {
      if (person.uid) {
        await staffService.updateStaff(person.uid, {
          displayName: person.displayName.trim(),
          businessEmail: (person.businessEmail || person.email).trim().toLowerCase(),
          phone: person.phone?.trim() || '',
          role: person.role,
          dataScope: person.dataScope,
          teamId: person.teamId || undefined,
          designationTitle: person.designationTitle?.trim() || '',
        });
        success('Saved', `${person.displayName}'s access was updated. It applies to them immediately.`);
      } else {
        const res = await staffService.createStaff({ ...person, teamId: person.teamId || undefined });
        setCreated({ name: person.displayName, email: person.email.trim().toLowerCase(), tempPassword: res.tempPassword, resetEmailSent: res.resetEmailSent });
      }
      setPerson(null);
      if (searchParams.get('action')) setSearchParams({}, { replace: true });
    } catch (err) {
      error('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: UserProfile) => {
    if (u.uid === userProfile?.uid) {
      error('Not allowed', 'You cannot deactivate your own account.');
      return;
    }
    try {
      await staffService.updateStaff(u.uid, { isActive: !u.isActive });
      success(u.isActive ? 'Access paused' : 'Access restored', `${u.displayName} ${u.isActive ? 'can no longer sign in to the portal' : 'can use the portal again'}.`);
    } catch (err) {
      error('Could not update', err instanceof Error ? err.message : String(err));
    }
  };

  const sendReset = async (u: UserProfile) => {
    try {
      await staffService.sendPasswordReset(u.email);
      info('Password email sent', `${u.displayName} will receive a link at ${u.email} to set a new password.`);
    } catch (err) {
      error('Could not send', err instanceof Error ? err.message : String(err));
    }
  };

  // ---------- Teams ----------
  const openNewTeam = () => setTeam({ name: '', department: '', description: '', color: TEAM_COLORS[teams.length % TEAM_COLORS.length], isActive: true, memberIds: [] });

  const openEditTeam = (t: Team) => setTeam({ ...t, memberIds: users.filter((u) => u.teamId === t.id).map((u) => u.uid) });

  const saveTeam = async () => {
    if (!team || !team.name?.trim()) return;
    setSaving(true);
    try {
      const id = team.id || `TEAM-${team.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 24)}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
      const lead = users.find((u) => u.uid === team.leadUid);
      await staffService.saveTeam({
        id,
        name: team.name.trim(),
        department: team.department?.trim() || undefined,
        description: team.description?.trim() || undefined,
        leadUid: lead?.uid,
        leadName: lead?.displayName,
        color: team.color,
        isActive: true,
        createdAt: team.createdAt,
      });
      // Membership: add newly ticked people, remove unticked ones
      const before = new Set(users.filter((u) => u.teamId === id).map((u) => u.uid));
      const after = new Set(team.memberIds);
      const changes = [
        ...[...after].filter((uid) => !before.has(uid)).map((uid) => staffService.updateStaff(uid, { teamId: id })),
        ...[...before].filter((uid) => !after.has(uid)).map((uid) => staffService.updateStaff(uid, { teamId: undefined })),
      ];
      await Promise.all(changes);
      success(team.id ? 'Team updated' : 'Team created', `${team.name} has ${after.size} member(s).`);
      setTeam(null);
    } catch (err) {
      error('Could not save team', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const problems = person ? personProblems(person) : [];
  const activeCount = users.filter((u) => u.isActive).length;

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Team & Access' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Team & Access</h1>
          <p className="page-subtitle">
            Add staff logins, group them into teams and choose what each role can see. Staff only see the modules and records their role and team allow.
          </p>
        </div>
        <div>
          {tab === 'teams' ? (
            <button className="btn btn-primary" onClick={openNewTeam}>
              <Plus size={16} /> New team
            </button>
          ) : (
            <button className="btn btn-primary" onClick={openNewPerson}>
              <UserPlus size={16} /> Add person
            </button>
          )}
        </div>
      </div>

      <div className="tab-bar" role="tablist">
        <button className={`tab-btn ${tab === 'people' ? 'active' : ''}`} onClick={() => switchTab('people')} role="tab">
          <UsersRound size={16} /> People <span className="tab-count">{activeCount}</span>
        </button>
        <button className={`tab-btn ${tab === 'teams' ? 'active' : ''}`} onClick={() => switchTab('teams')} role="tab">
          <UsersRound size={16} /> Teams <span className="tab-count">{teams.length}</span>
        </button>
        <button className={`tab-btn ${tab === 'permissions' ? 'active' : ''}`} onClick={() => switchTab('permissions')} role="tab">
          <ShieldCheck size={16} /> Role permissions
        </button>
      </div>

      {/* ---------------- People ---------------- */}
      {tab === 'people' && (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div className="drive-search" style={{ flex: '1 1 260px', maxWidth: 380 }}>
              <Search size={16} color="var(--text-muted)" />
              <input placeholder="Search name, email or team" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: 'auto', minHeight: 36, borderRadius: 8 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as UserRole | 'all')}>
              <option value="all">All roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <select className="form-select" style={{ width: 'auto', minHeight: 36, borderRadius: 8 }} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="all">All teams</option>
              <option value="none">No team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button type="button" className={`chip ${showInactive ? 'chip-on' : ''}`} onClick={() => setShowInactive((v) => !v)}>
              {showInactive ? <Check size={14} /> : null} Show paused accounts
            </button>
          </div>

          {visibleUsers.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={users.length <= 1 ? 'Add your first staff member' : 'Nobody matches these filters'}
              description="Each person gets their own login. Their role decides which modules they see, and their data access decides whose records they see."
              action={{ label: 'Add person', onClick: openNewPerson }}
            />
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Team</th>
                    <th>Data access</th>
                    <th>Sends client email as</th>
                    <th>Last sign-in</th>
                    <th style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((u) => (
                    <tr key={u.uid} style={u.isActive ? undefined : { opacity: 0.55 }}>
                      <td>
                        <div className="cell-main">
                          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: '0.75rem', background: teams.find((t) => t.id === u.teamId)?.color }}>
                            {initials(u.displayName)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div className="cell-title">
                              {u.displayName} {u.uid === userProfile?.uid && <span className="cell-sub">(you)</span>}
                            </div>
                            <div className="cell-sub">{u.email}{u.designationTitle ? ` · ${u.designationTitle}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className={`role-pill ${u.role}`}>{ROLE_LABELS[u.role]}</span></td>
                      <td>{u.teamName || <span className="cell-sub">No team</span>}</td>
                      <td className="cell-sub">{SCOPE_LABELS[u.dataScope] || u.dataScope}</td>
                      <td className="cell-sub">{u.businessEmail || u.email}</td>
                      <td className="cell-sub">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : (u.isActive ? 'Never' : 'Paused')}</td>
                      <td>
                        <div className="cell-actions">
                          <button className="icon-btn" title="Edit access" onClick={() => openEditPerson(u)}><Pencil size={16} /></button>
                          <button className="icon-btn" title="Email a password-reset link" onClick={() => sendReset(u)}><KeyRound size={16} /></button>
                          {u.uid !== userProfile?.uid && (
                            <button className={`icon-btn ${u.isActive ? 'danger' : ''}`} title={u.isActive ? 'Pause access' : 'Restore access'} onClick={() => toggleActive(u)}>
                              {u.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ---------------- Teams ---------------- */}
      {tab === 'teams' && (
        teams.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="No teams yet"
            description="Create teams such as “Karachi Sales” or “North Region Operations”. People with “own team’s records” access will share leads, customers and proposals within their team."
            action={{ label: 'New team', onClick: openNewTeam }}
          />
        ) : (
          <div className="team-grid">
            {teams.map((t) => {
              const members = users.filter((u) => u.teamId === t.id && u.isActive);
              return (
                <div key={t.id} className="team-card">
                  <div className="team-card-head">
                    <span className="team-swatch" style={{ background: t.color || '#475569' }}>{initials(t.name)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="cell-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                      <div className="cell-sub">{t.department || 'No department'} · {members.length} member{members.length === 1 ? '' : 's'}</div>
                    </div>
                    <button className="icon-btn" title="Edit team" onClick={() => openEditTeam(t)}><Pencil size={16} /></button>
                    <button className="icon-btn danger" title="Delete team" onClick={() => setTeamToDelete(t)}><Trash2 size={16} /></button>
                  </div>
                  {t.description && <div className="cell-sub">{t.description}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div className="avatar-stack">
                      {members.slice(0, 6).map((m) => (
                        <div key={m.uid} className="user-avatar" title={m.displayName} style={{ background: t.color }}>{initials(m.displayName)}</div>
                      ))}
                      {members.length > 6 && <div className="user-avatar" style={{ background: '#94A3B8' }}>+{members.length - 6}</div>}
                    </div>
                    {t.leadName && <span className="cell-sub">Lead: {t.leadName}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ---------------- Permissions ---------------- */}
      {tab === 'permissions' && (
        <>
          <div className="info-hint" style={{ marginBottom: '1rem' }}>
            The same matrix is enforced by the Firestore security rules on the server, so hidden modules can't be opened by typing a URL.
            <strong> Data access</strong> narrows it further: <em>Own records</em> shows only what the person created; <em>Own team’s records</em> adds their teammates’ records.
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Module</th>
                  {ROLES.map((r) => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABELS[r]}</th>)}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(MODULE_ROLES) as ModuleKey[]).map((m) => (
                  <tr key={m}>
                    <td className="cell-title">{MODULE_LABELS[m]}</td>
                    {ROLES.map((r) => (
                      <td key={r} style={{ textAlign: 'center' }}>
                        {MODULE_ROLES[m].includes(r)
                          ? <Check size={16} color="var(--ikpm-emerald-600)" />
                          : <Minus size={16} color="var(--border-strong)" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="team-grid" style={{ marginTop: '1rem' }}>
            {ROLES.map((r) => (
              <div key={r} className="team-card">
                <span className={`role-pill ${r}`} style={{ alignSelf: 'flex-start' }}>{ROLE_LABELS[r]}</span>
                <div className="cell-sub">{ROLE_DESCRIPTIONS[r]}</div>
                <div className="cell-sub">Default data access: <strong>{SCOPE_LABELS[DEFAULT_SCOPE[r]]}</strong></div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---------------- Person modal ---------------- */}
      <Modal
        isOpen={Boolean(person)}
        onClose={() => !saving && setPerson(null)}
        title={person?.uid ? `Edit ${person.displayName}` : 'Add a person'}
        subtitle={person?.uid ? 'Changes apply immediately, even if they are signed in.' : 'They get their own login and an email to set their password.'}
        maxWidth="680px"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPerson(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={savePerson} disabled={saving || problems.length > 0} title={problems.join('\n')}>
              {saving ? 'Saving…' : person?.uid ? 'Save changes' : 'Create login'}
            </button>
          </>
        }
      >
        {person && (
          <>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Full name <span className="required">*</span></label>
                <input className="form-input" value={person.displayName} onChange={(e) => setPerson({ ...person, displayName: e.target.value })} placeholder="e.g. Ayesha Khan" autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Designation</label>
                <input className="form-input" value={person.designationTitle} onChange={(e) => setPerson({ ...person, designationTitle: e.target.value })} placeholder="e.g. Sales Executive" />
              </div>
              <div className="form-group">
                <label className="form-label">Login email <span className="required">*</span></label>
                <input
                  className="form-input"
                  type="email"
                  value={person.email}
                  disabled={Boolean(person.uid)}
                  onChange={(e) => {
                    const email = e.target.value;
                    // Keep business email in step until it's edited separately
                    const sameAsLogin = !person.businessEmail || person.businessEmail === person.email;
                    setPerson({ ...person, email, businessEmail: sameAsLogin ? email : person.businessEmail });
                  }}
                  placeholder="ayesha@insectkiller.pk"
                />
                {person.uid && <div className="form-hint">Login emails can't be changed here.</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Business email (client emails are sent from this)</label>
                <input className="form-input" type="email" value={person.businessEmail} onChange={(e) => setPerson({ ...person, businessEmail: e.target.value })} placeholder="ayesha@insectkiller.pk" />
                <div className="form-hint">Proposals and documents are sent as this person, from this address.</div>
              </div>
              <div className="form-group">
                <label className="form-label">Mobile</label>
                <input className="form-input" value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} placeholder="03XX XXXXXXX" />
              </div>
              <div className="form-group">
                <label className="form-label">Team</label>
                <select className="form-select" value={person.teamId} onChange={(e) => setPerson({ ...person, teamId: e.target.value })}>
                  <option value="">No team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Role <span className="required">*</span></label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.5rem' }}>
                {ROLES.map((r) => (
                  <label
                    key={r}
                    className="doc-check"
                    style={{
                      alignItems: 'flex-start',
                      border: `1px solid ${person.role === r ? 'var(--ikpm-emerald-600)' : 'var(--border-subtle)'}`,
                      background: person.role === r ? 'var(--ikpm-emerald-50)' : undefined,
                      padding: '0.55rem 0.65rem',
                    }}
                  >
                    <input
                      type="radio"
                      name="role"
                      checked={person.role === r}
                      disabled={person.uid === userProfile?.uid && r !== 'super_admin'}
                      onChange={() => setPerson({ ...person, role: r, dataScope: person.uid ? person.dataScope : DEFAULT_SCOPE[r] })}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <span style={{ display: 'block', fontWeight: 600 }}>{ROLE_LABELS[r]}</span>
                      <span className="cell-sub">{ROLE_DESCRIPTIONS[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Data access</label>
              <div className="chip-row" style={{ marginBottom: 0 }}>
                {SCOPES.map((sc) => (
                  <button key={sc} type="button" className={`chip ${person.dataScope === sc ? 'chip-on' : ''}`} onClick={() => setPerson({ ...person, dataScope: sc })}>
                    {person.dataScope === sc && <Check size={14} />} {SCOPE_LABELS[sc]}
                  </button>
                ))}
              </div>
              {['super_admin', 'management', 'auditor'].includes(person.role) && (
                <div className="form-hint">{ROLE_LABELS[person.role]} always sees all company records.</div>
              )}
            </div>

            {problems.length > 0 && (person.displayName || person.email) && (
              <ul className="form-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
          </>
        )}
      </Modal>

      {/* ---------------- Created confirmation ---------------- */}
      <Modal
        isOpen={Boolean(created)}
        onClose={() => setCreated(null)}
        title="Login created"
        subtitle={created ? `${created.name} can now sign in to the portal.` : undefined}
        footer={<button className="btn btn-primary" onClick={() => setCreated(null)}>Done</button>}
      >
        {created && (
          <>
            {created.resetEmailSent ? (
              <div className="info-hint" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Mail size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>We emailed <strong>{created.email}</strong> a link to choose their own password. Ask them to check spam if it doesn't arrive.</span>
              </div>
            ) : (
              <div className="empty-hint">The password email could not be sent. Share the temporary password below instead.</div>
            )}
            <div className="form-group" style={{ marginTop: '1rem', marginBottom: 0 }}>
              <label className="form-label">Temporary password (shown once)</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input className="form-input font-mono" readOnly value={created.tempPassword} onFocus={(e) => e.target.select()} />
                <button
                  className="btn btn-secondary"
                  onClick={() => navigator.clipboard?.writeText(created.tempPassword).then(() => success('Copied', 'Temporary password copied.'))}
                >
                  <Copy size={15} /> Copy
                </button>
              </div>
              <div className="form-hint">They should change it after first sign-in using “Forgot password?” on the login page.</div>
            </div>
          </>
        )}
      </Modal>

      {/* ---------------- Team modal ---------------- */}
      <Modal
        isOpen={Boolean(team)}
        onClose={() => !saving && setTeam(null)}
        title={team?.id ? `Edit ${team.name}` : 'New team'}
        subtitle="Teammates with “own team’s records” access share leads, customers, proposals and jobs."
        maxWidth="640px"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setTeam(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={saveTeam} disabled={saving || !team?.name?.trim()}>
              {saving ? 'Saving…' : team?.id ? 'Save team' : 'Create team'}
            </button>
          </>
        }
      >
        {team && (
          <>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Team name <span className="required">*</span></label>
                <input className="form-input" value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} placeholder="e.g. Karachi Sales" autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Department</label>
                <input className="form-input" value={team.department || ''} onChange={(e) => setTeam({ ...team, department: e.target.value })} placeholder="e.g. Sales & CRM" />
              </div>
              <div className="form-group">
                <label className="form-label">Team lead</label>
                <select className="form-select" value={team.leadUid || ''} onChange={(e) => setTeam({ ...team, leadUid: e.target.value || undefined })}>
                  <option value="">No lead</option>
                  {users.filter((u) => u.isActive).map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Colour</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 38 }}>
                  {TEAM_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Colour ${c}`}
                      onClick={() => setTeam({ ...team, color: c })}
                      style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: team.color === c ? '3px solid var(--ikpm-navy-900)' : '3px solid transparent', cursor: 'pointer' }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="form-input" value={team.description || ''} onChange={(e) => setTeam({ ...team, description: e.target.value })} placeholder="What this team covers" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Members ({team.memberIds.length})</label>
              <div className="doc-check-list" style={{ maxHeight: 260 }}>
                {users.filter((u) => u.isActive).map((u) => {
                  const checked = team.memberIds.includes(u.uid);
                  const elsewhere = u.teamId && u.teamId !== team.id ? u.teamName : undefined;
                  return (
                    <label key={u.uid} className="doc-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setTeam({ ...team, memberIds: checked ? team.memberIds.filter((x) => x !== u.uid) : [...team.memberIds, u.uid] })}
                      />
                      <span style={{ flex: 1 }}>{u.displayName} <span className="cell-sub">· {u.email}</span></span>
                      <span className={`role-pill ${u.role}`}>{ROLE_LABELS[u.role]}</span>
                      {elsewhere && <span className="cell-sub" title="Ticking moves them to this team">in {elsewhere}</span>}
                    </label>
                  );
                })}
                {users.length === 0 && <div className="cell-sub" style={{ padding: '0.5rem' }}>Add people first, then put them in teams.</div>}
              </div>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(teamToDelete)}
        onClose={() => setTeamToDelete(null)}
        onConfirm={async () => {
          if (!teamToDelete) return;
          try {
            await staffService.deleteTeam(teamToDelete.id);
            success('Team deleted', `${teamToDelete.name} was removed. Its members now have no team.`);
          } catch (err) {
            error('Could not delete', err instanceof Error ? err.message : String(err));
          }
          setTeamToDelete(null);
        }}
        title="Delete team?"
        message={`${teamToDelete?.name} will be removed and its members will have no team. Their records are kept.`}
        confirmLabel="Delete team"
      />
    </div>
  );
};

export default TeamAccessPage;
