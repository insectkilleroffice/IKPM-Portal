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
  Eye,
  EyeOff,
  Lock,
  Copy,
} from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { staffService, passwordProblem, MIN_PASSWORD_LENGTH, type NewStaffInput } from '../../services/staffService';
import {
  canEditModule,
  defaultScopeFor,
  getRoleDefinitions,
  MODULES,
  roleColor,
  roleDescription,
  roleLabel,
  SCOPE_LABELS,
  SYSTEM_ROLE_IDS,
  type AccessLevel,
  type ModuleKey,
  type RoleDefinition,
  type SystemRole,
} from '../../lib/permissions';
import { formatDateTime } from '../../lib/formatters';
import type { DataScope, Team, UserProfile } from '../../types';

const SCOPES: DataScope[] = ['own', 'team', 'company'];
const COLORS = ['#0E8A5F', '#1A73E8', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#9A3412', '#475569'];
const LEVELS: { value: AccessLevel; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'view', label: 'View' },
  { value: 'edit', label: 'Edit' },
];

const initials = (name?: string) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const RolePill: React.FC<{ role: string }> = ({ role }) => (
  <span className="role-pill" style={{ background: `${roleColor(role)}1F`, color: roleColor(role) }}>{roleLabel(role)}</span>
);

type Tab = 'people' | 'teams' | 'roles';

interface PersonForm extends Omit<NewStaffInput, 'password'> {
  uid?: string;
  password: string;
  confirmPassword: string;
}

const blankPerson = (): PersonForm => ({
  displayName: '',
  email: '',
  password: '',
  confirmPassword: '',
  businessEmail: '',
  phone: '',
  role: 'sales',
  dataScope: defaultScopeFor('sales'),
  teamId: '',
  designationTitle: '',
  sendResetEmail: false,
});

export const TeamAccessPage: React.FC = () => {
  const store = useDataStore();
  const { userProfile, isSuperAdmin } = useAuth();
  const { success, error, info } = useNotification();
  const [searchParams, setSearchParams] = useSearchParams();

  const myRole = userProfile?.role;
  const canManageStaff = canEditModule(myRole, 'team');
  const canManageRoles = canEditModule(myRole, 'roles');

  const initialTab = (searchParams.get('tab') as Tab) || (canManageStaff ? 'people' : 'roles');
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(false);

  const [person, setPerson] = useState<PersonForm | null>(canManageStaff && searchParams.get('action') === 'new_user' ? blankPerson() : null);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const [team, setTeam] = useState<(Partial<Team> & { memberIds: string[] }) | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);

  const [roleDraft, setRoleDraft] = useState<RoleDefinition | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<RoleDefinition | null>(null);

  const users = store.getUsers();
  const teams = store.getTeams();
  store.getRoles(); // keep role list reactive
  const roles = getRoleDefinitions();
  // Only the super admin can hand out the Super Admin role
  const assignableRoles = roles.filter((r) => isSuperAdmin || (r.id !== 'super_admin' && !r.isHidden));

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

  /** Staff managers can't edit the super admin or themselves; only the super admin can. */
  const canEditPerson = (u: UserProfile) =>
    isSuperAdmin || (canManageStaff && u.uid !== userProfile?.uid && u.role !== 'super_admin');

  // ---------- People ----------
  const openNewPerson = () => {
    setShowPassword(false);
    setPerson(blankPerson());
  };

  const openEditPerson = (u: UserProfile) =>
    setPerson({
      uid: u.uid,
      displayName: u.displayName,
      email: u.email,
      password: '',
      confirmPassword: '',
      businessEmail: u.businessEmail || u.email,
      phone: u.phone || '',
      role: u.role,
      dataScope: u.dataScope,
      teamId: u.teamId || '',
      designationTitle: u.designationTitle || '',
    });

  const personProblems = (p: PersonForm): string[] => {
    const out: string[] = [];
    if (!p.displayName.trim()) out.push('Enter the person’s full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) out.push('Enter a valid login email.');
    if (p.businessEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.businessEmail.trim())) out.push('Business email is not valid.');
    if (!p.uid && users.some((u) => u.email.toLowerCase() === p.email.trim().toLowerCase())) out.push('Someone already uses this login email.');
    if (!p.uid) {
      const pw = passwordProblem(p.password, p.confirmPassword);
      if (pw) out.push(pw);
    }
    if (p.dataScope === 'team' && !p.teamId) out.push('“Own team’s records” needs a team. Pick one or change data access.');
    return out;
  };

  const savePerson = async () => {
    if (!person || personProblems(person).length) return;
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
        success(
          'Login created',
          `${person.displayName} can now sign in with ${person.email.trim().toLowerCase()} and the password you set.${res.resetEmailSent ? ' A link to change it was also emailed.' : ''}`
        );
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
  const openNewTeam = () => setTeam({ name: '', department: '', description: '', color: COLORS[teams.length % COLORS.length], isActive: true, memberIds: [] });
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
        leaderId: lead?.uid,
        leaderName: lead?.displayName,
        color: team.color,
        isActive: true,
        createdAt: team.createdAt,
      });
      const before = new Set(users.filter((u) => u.teamId === id).map((u) => u.uid));
      const after = new Set(team.memberIds);
      await Promise.all([
        ...[...after].filter((uid) => !before.has(uid)).map((uid) => staffService.updateStaff(uid, { teamId: id })),
        ...[...before].filter((uid) => !after.has(uid)).map((uid) => staffService.updateStaff(uid, { teamId: undefined })),
      ]);
      success(team.id ? 'Team updated' : 'Team created', `${team.name} has ${after.size} member(s).`);
      setTeam(null);
    } catch (err) {
      error('Could not save team', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // ---------- Roles ----------
  const openNewRole = (template: SystemRole = 'sales') => {
    const base = roles.find((r) => r.id === template)!;
    setRoleDraft({
      id: '',
      name: '',
      description: '',
      color: COLORS[(roles.length + 1) % COLORS.length],
      basedOn: template,
      modules: { ...base.modules },
      defaultScope: base.defaultScope,
    });
  };

  const saveRole = async () => {
    if (!roleDraft || !roleDraft.name.trim()) return;
    setSaving(true);
    try {
      const id = roleDraft.id || `role_${roleDraft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)}_${Date.now().toString(36).slice(-4)}`;
      await staffService.saveRole({ ...roleDraft, id, name: roleDraft.name.trim() });
      success(roleDraft.id ? 'Role updated' : 'Role created', `${roleDraft.name} permissions apply to everyone with this role straight away.`);
      setRoleDraft(null);
    } catch (err) {
      error('Could not save role', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const problems = person ? personProblems(person) : [];
  const activeCount = users.filter((u) => u.isActive).length;
  const headerAction =
    tab === 'teams' ? (canManageStaff && <button className="btn btn-primary" onClick={openNewTeam}><Plus size={16} /> New team</button>)
      : tab === 'roles' ? (canManageRoles && <button className="btn btn-primary" onClick={() => openNewRole()}><Plus size={16} /> New role</button>)
        : (canManageStaff && <button className="btn btn-primary" onClick={openNewPerson}><UserPlus size={16} /> Add person</button>);

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Team & Access' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Team & Access</h1>
          <p className="page-subtitle">
            Add staff and set their passwords, group them into teams, and decide exactly what each role can see and change. The database enforces the same permissions.
          </p>
        </div>
        <div>{headerAction}</div>
      </div>

      <div className="tab-bar" role="tablist">
        {canManageStaff && (
          <>
            <button className={`tab-btn ${tab === 'people' ? 'active' : ''}`} onClick={() => switchTab('people')} role="tab">
              <UsersRound size={16} /> People <span className="tab-count">{activeCount}</span>
            </button>
            <button className={`tab-btn ${tab === 'teams' ? 'active' : ''}`} onClick={() => switchTab('teams')} role="tab">
              <UsersRound size={16} /> Teams <span className="tab-count">{teams.length}</span>
            </button>
          </>
        )}
        <button className={`tab-btn ${tab === 'roles' ? 'active' : ''}`} onClick={() => switchTab('roles')} role="tab">
          <ShieldCheck size={16} /> Roles & permissions <span className="tab-count">{roles.length}</span>
        </button>
      </div>

      {/* ---------------- People ---------------- */}
      {tab === 'people' && canManageStaff && (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div className="drive-search" style={{ flex: '1 1 260px', maxWidth: 380 }}>
              <Search size={16} color="var(--text-muted)" />
              <input placeholder="Search name, email or team" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: 'auto', minHeight: 36 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">All roles</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select className="form-select" style={{ width: 'auto', minHeight: 36 }} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="all">All teams</option>
              <option value="none">No team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button type="button" className={`chip ${showInactive ? 'chip-on' : ''}`} onClick={() => setShowInactive((v) => !v)}>
              {showInactive && <Check size={14} />} Show paused accounts
            </button>
          </div>

          {visibleUsers.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={users.length <= 1 ? 'Add your first staff member' : 'Nobody matches these filters'}
              description="Each person gets their own login with a password you set. Their role decides which modules they see; their data access decides whose records they see."
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
                          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: '0.75rem', background: teams.find((t) => t.id === u.teamId)?.color || roleColor(u.role) }}>
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
                      <td><RolePill role={u.role} /></td>
                      <td>{u.teamName || <span className="cell-sub">No team</span>}</td>
                      <td className="cell-sub">{u.role === 'super_admin' ? 'Entire company' : SCOPE_LABELS[u.dataScope] || u.dataScope}</td>
                      <td className="cell-sub">{u.businessEmail || u.email}</td>
                      <td className="cell-sub">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : u.isActive ? 'Never' : 'Paused'}</td>
                      <td>
                        <div className="cell-actions">
                          {canEditPerson(u) ? (
                            <>
                              <button className="icon-btn" title="Edit access" onClick={() => openEditPerson(u)}><Pencil size={16} /></button>
                              <button className="icon-btn" title="Email a password-reset link" onClick={() => sendReset(u)}><KeyRound size={16} /></button>
                              {u.uid !== userProfile?.uid && (
                                <button className={`icon-btn ${u.isActive ? 'danger' : ''}`} title={u.isActive ? 'Pause access' : 'Restore access'} onClick={() => toggleActive(u)}>
                                  {u.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="cell-sub" title="Only the super admin can change this account"><Lock size={14} /></span>
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
      {tab === 'teams' && canManageStaff && (
        teams.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="No teams yet"
            description="Create teams such as “Karachi Sales” or “North Region Operations”. People with “own team’s records” access share leads, customers, proposals and jobs within their team."
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

      {/* ---------------- Roles & permissions ---------------- */}
      {tab === 'roles' && (
        <>
          <div className="info-hint" style={{ marginBottom: '1rem' }}>
            <strong>View</strong> lets people open a module; <strong>Edit</strong> also lets them create and change records.
            To let someone else add staff or build teams, give their role <strong>Manage staff & teams: Edit</strong>. To let them change these permissions, give <strong>Customize roles: Edit</strong>.
            Only the super admin can create another super admin.
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>People</th>
                  <th>Modules</th>
                  <th>Default data access</th>
                  <th style={{ width: 100 }} />
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => {
                  const holders = users.filter((u) => u.role === r.id && u.isActive).length;
                  const editMods = MODULES.filter((m) => r.modules[m.key] === 'edit').length;
                  const viewMods = MODULES.filter((m) => r.modules[m.key] === 'view').length;
                  const locked = r.id === 'super_admin';
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="cell-main">
                          <span className="team-swatch" style={{ background: r.color || '#475569', width: 32, height: 32, fontSize: '0.75rem' }}>{initials(r.name)}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="cell-title">
                              {r.name} {r.isSystem ? <span className="badge-status badge-slate" style={{ marginLeft: 4 }}>Built-in</span> : <span className="badge-status badge-blue" style={{ marginLeft: 4 }}>Custom</span>}
                            </div>
                            <div className="cell-sub">{r.description || roleDescription(r.id)}</div>
                          </div>
                        </div>
                      </td>
                      <td>{holders}</td>
                      <td className="cell-sub">{locked ? 'Everything' : `${editMods} edit · ${viewMods} view`}</td>
                      <td className="cell-sub">{SCOPE_LABELS[r.defaultScope]}</td>
                      <td>
                        <div className="cell-actions">
                          {locked ? (
                            <span className="cell-sub" title="Super Admin always has full access"><Lock size={14} /></span>
                          ) : (
                            <>
                              <button className="icon-btn" title={canManageRoles ? 'Edit permissions' : 'View permissions'} onClick={() => setRoleDraft({ ...r, modules: { ...r.modules } })}>
                                {canManageRoles ? <Pencil size={16} /> : <Eye size={16} />}
                              </button>
                              {canManageRoles && (
                                <button className="icon-btn" title="Duplicate as a new role" onClick={() => setRoleDraft({ ...r, id: '', name: `${r.name} (copy)`, isSystem: false, createdAt: undefined, modules: { ...r.modules } })}>
                                  <Copy size={16} />
                                </button>
                              )}
                              {canManageRoles && !r.isSystem && (
                                <button className="icon-btn danger" title="Delete role" onClick={() => setRoleToDelete(r)}><Trash2 size={16} /></button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------------- Person modal ---------------- */}
      <Modal
        isOpen={Boolean(person)}
        onClose={() => !saving && setPerson(null)}
        title={person?.uid ? `Edit ${person.displayName}` : 'Add a person'}
        subtitle={person?.uid ? 'Changes apply immediately, even if they are signed in.' : 'Set their login email and password. Share it with them, and they can change it later.'}
        maxWidth="720px"
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
                  autoComplete="off"
                  value={person.email}
                  disabled={Boolean(person.uid)}
                  onChange={(e) => {
                    const email = e.target.value;
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
              </div>

              {!person.uid && (
                <>
                  <div className="form-group">
                    <label className="form-label">Password <span className="required">*</span></label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-input"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={person.password}
                        onChange={(e) => setPerson({ ...person, password: e.target.value })}
                        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                        style={{ paddingRight: 40 }}
                      />
                      <button type="button" className="icon-btn" onClick={() => setShowPassword((v) => !v)} title={showPassword ? 'Hide' : 'Show'} style={{ position: 'absolute', right: 3, top: 3 }}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Confirm password <span className="required">*</span></label>
                    <input
                      className="form-input"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={person.confirmPassword}
                      onChange={(e) => setPerson({ ...person, confirmPassword: e.target.value })}
                    />
                  </div>
                </>
              )}

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

            {person.uid && (
              <div className="info-hint" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                <span>Passwords can't be read or changed by admins for security. Send a reset link and they choose a new one.</span>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => sendReset(users.find((u) => u.uid === person.uid)!)}>
                  <KeyRound size={14} /> Send reset link
                </button>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Role <span className="required">*</span></label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem' }}>
                {assignableRoles.map((r) => (
                  <label
                    key={r.id}
                    className="doc-check"
                    style={{
                      alignItems: 'flex-start',
                      border: `1px solid ${person.role === r.id ? 'var(--ikpm-emerald-600)' : 'var(--border-subtle)'}`,
                      background: person.role === r.id ? 'var(--ikpm-emerald-50)' : undefined,
                      padding: '0.55rem 0.65rem',
                    }}
                  >
                    <input
                      type="radio"
                      name="role"
                      checked={person.role === r.id}
                      disabled={person.uid === userProfile?.uid}
                      onChange={() => setPerson({ ...person, role: r.id, dataScope: person.uid ? person.dataScope : r.defaultScope })}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <span style={{ display: 'block', fontWeight: 600 }}>{r.name}</span>
                      <span className="cell-sub">{r.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Data access</label>
              {person.role === 'super_admin' ? (
                <div className="form-hint">Super Admin always sees all company records.</div>
              ) : (
                <div className="chip-row" style={{ marginBottom: 0 }}>
                  {SCOPES.map((sc) => (
                    <button key={sc} type="button" className={`chip ${person.dataScope === sc ? 'chip-on' : ''}`} onClick={() => setPerson({ ...person, dataScope: sc })}>
                      {person.dataScope === sc && <Check size={14} />} {SCOPE_LABELS[sc]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!person.uid && (
              <label className="doc-check" style={{ marginTop: '0.75rem', display: 'inline-flex' }}>
                <input type="checkbox" checked={Boolean(person.sendResetEmail)} onChange={(e) => setPerson({ ...person, sendResetEmail: e.target.checked })} />
                Also email them a link to change this password
              </label>
            )}

            {problems.length > 0 && (person.displayName || person.email || person.password) && (
              <ul className="form-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
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
                <ColorPicker value={team.color} onChange={(c) => setTeam({ ...team, color: c })} />
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
                  const editable = canEditPerson(u) || isSuperAdmin;
                  return (
                    <label key={u.uid} className={`doc-check ${editable ? '' : 'is-disabled'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!editable}
                        onChange={() => setTeam({ ...team, memberIds: checked ? team.memberIds.filter((x) => x !== u.uid) : [...team.memberIds, u.uid] })}
                      />
                      <span style={{ flex: 1 }}>{u.displayName} <span className="cell-sub">· {u.email}</span></span>
                      <RolePill role={u.role} />
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

      {/* ---------------- Role editor ---------------- */}
      <Modal
        isOpen={Boolean(roleDraft)}
        onClose={() => !saving && setRoleDraft(null)}
        title={roleDraft?.createdAt || roleDraft?.isSystem ? `${canManageRoles ? 'Edit' : 'View'} role: ${roleDraft?.name}` : 'New role'}
        subtitle="Choose what people with this role can open and change."
        maxWidth="760px"
        footer={
          canManageRoles ? (
            <>
              <button className="btn btn-secondary" onClick={() => setRoleDraft(null)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRole} disabled={saving || !roleDraft?.name.trim()}>
                {saving ? 'Saving…' : 'Save role'}
              </button>
            </>
          ) : (
            <button className="btn btn-secondary" onClick={() => setRoleDraft(null)}>Close</button>
          )
        }
      >
        {roleDraft && (
          <fieldset disabled={!canManageRoles} style={{ border: 'none' }}>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Role name <span className="required">*</span></label>
                <input className="form-input" value={roleDraft.name} onChange={(e) => setRoleDraft({ ...roleDraft, name: e.target.value })} placeholder="e.g. Branch Supervisor" autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Behaves like</label>
                <select
                  className="form-select"
                  value={roleDraft.basedOn}
                  disabled={roleDraft.isSystem}
                  onChange={(e) => {
                    const base = roles.find((r) => r.id === e.target.value);
                    setRoleDraft({ ...roleDraft, basedOn: e.target.value as SystemRole, ...(roleDraft.createdAt ? {} : { modules: { ...base?.modules }, defaultScope: base?.defaultScope || 'own' }) });
                  }}
                >
                  {SYSTEM_ROLE_IDS.filter((id) => id !== 'super_admin').map((id) => <option key={id} value={id}>{roleLabel(id)}</option>)}
                </select>
                <div className="form-hint">Used for built-in workflow rules (e.g. who can approve discounts).</div>
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input className="form-input" value={roleDraft.description || ''} onChange={(e) => setRoleDraft({ ...roleDraft, description: e.target.value })} placeholder="What this role is for" />
              </div>
              <div className="form-group">
                <label className="form-label">Colour</label>
                <ColorPicker value={roleDraft.color} onChange={(c) => setRoleDraft({ ...roleDraft, color: c })} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Default data access for new people</label>
              <div className="chip-row" style={{ marginBottom: 0 }}>
                {SCOPES.map((sc) => (
                  <button key={sc} type="button" className={`chip ${roleDraft.defaultScope === sc ? 'chip-on' : ''}`} onClick={() => setRoleDraft({ ...roleDraft, defaultScope: sc })}>
                    {roleDraft.defaultScope === sc && <Check size={14} />} {SCOPE_LABELS[sc]}
                  </button>
                ))}
              </div>
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Module</th>
                    <th style={{ width: 230 }}>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m, i) => {
                    const level = roleDraft.modules[m.key] ?? 'none';
                    const newGroup = i === 0 || MODULES[i - 1].group !== m.group;
                    return (
                      <React.Fragment key={m.key}>
                        {newGroup && (
                          <tr>
                            <td colSpan={2} style={{ background: 'var(--bg-surface-alt)', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.45rem 1rem' }}>
                              {m.group}
                            </td>
                          </tr>
                        )}
                        <tr>
                          <td>
                            <div className="cell-title">{m.label}</div>
                            {m.hint && <div className="cell-sub">{m.hint}</div>}
                          </td>
                          <td>
                            <div className="view-toggle" style={{ borderRadius: 8 }}>
                              {LEVELS.map((l) => (
                                <button
                                  key={l.value}
                                  type="button"
                                  className={level === l.value ? 'active' : ''}
                                  style={{ width: 72, fontSize: '0.78rem', fontWeight: 600 }}
                                  onClick={() => setRoleDraft({ ...roleDraft, modules: { ...roleDraft.modules, [m.key]: l.value } as Partial<Record<ModuleKey, AccessLevel>> })}
                                >
                                  {l.label}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(roleDraft.modules.roles === 'edit') && (
              <div className="empty-hint" style={{ marginTop: '0.75rem' }}>
                People with this role will be able to change every role's permissions, including their own. Only give this to people you trust like a super admin.
              </div>
            )}
          </fieldset>
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

      <ConfirmDialog
        isOpen={Boolean(roleToDelete)}
        onClose={() => setRoleToDelete(null)}
        onConfirm={async () => {
          if (!roleToDelete) return;
          try {
            await staffService.deleteRole(roleToDelete);
            success('Role deleted', `${roleToDelete.name} was removed.`);
          } catch (err) {
            error('Could not delete', err instanceof Error ? err.message : String(err));
          }
          setRoleToDelete(null);
        }}
        title="Delete role?"
        message={`${roleToDelete?.name} will be removed. Nobody may still have this role.`}
        confirmLabel="Delete role"
      />
    </div>
  );
};

const ColorPicker: React.FC<{ value?: string; onChange: (c: string) => void }> = ({ value, onChange }) => (
  <div style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 38, flexWrap: 'wrap' }}>
    {COLORS.map((c) => (
      <button
        key={c}
        type="button"
        aria-label={`Colour ${c}`}
        onClick={() => onChange(c)}
        style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: value === c ? '3px solid var(--ikpm-navy-900)' : '3px solid transparent', cursor: 'pointer' }}
      />
    ))}
  </div>
);

export default TeamAccessPage;
