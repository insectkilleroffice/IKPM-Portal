// Staff logins, teams and roles: used on the Team & Access page by the super admin and by
// anyone whose role was given "Manage staff & teams" or "Customize roles".
// Logins are created on a separate Firebase Auth instance so the admin stays signed in.

import { createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile } from 'firebase/auth';
import { deleteDoc, deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, getProvisioningAuth } from '../lib/firebase';
import { defaultScopeFor, type RoleDefinition } from '../lib/permissions';
import { dataService } from './dataService';
import type { DataScope, Team, UserProfile, UserRole } from '../types';

export interface NewStaffInput {
  displayName: string;
  email: string;
  /** Chosen by the admin; the person can change it later with "Forgot password?". */
  password: string;
  businessEmail?: string;
  phone?: string;
  role: UserRole;
  dataScope?: DataScope;
  teamId?: string;
  designationTitle?: string;
  /** Also email the person a link to choose their own password. */
  sendResetEmail?: boolean;
}

export const MIN_PASSWORD_LENGTH = 8;

const now = () => new Date().toISOString();

const teamName = (teamId?: string) => dataService.getTeams().find((t) => t.id === teamId)?.name;

const friendly = (err: unknown) => {
  const code = (err as { code?: string }).code;
  if (code === 'auth/email-already-in-use') return 'This email already has a portal login. Edit the existing person instead.';
  if (code === 'auth/invalid-email') return 'That email address is not valid.';
  if (code === 'auth/weak-password') return `Password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters with letters and numbers.`;
  if (code === 'auth/operation-not-allowed') return 'Email/password sign-in is disabled in Firebase Console → Authentication → Sign-in method.';
  if (code === 'permission-denied') return 'Firestore refused the change. Your role may not allow it, or the security rules are not deployed.';
  return err instanceof Error ? err.message : String(err);
};

function audit(action: 'create' | 'update' | 'delete', id: string, title: string, details: string) {
  const se = dataService.getSession();
  dataService.logAudit({ userId: se?.uid || '', userEmail: se?.email || '', action, entityType: 'user', entityId: id, entityTitle: title, details });
}

export function passwordProblem(password: string, confirm?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain letters and numbers.';
  if (confirm !== undefined && password !== confirm) return 'Passwords do not match.';
  return null;
}

export const staffService = {
  /** Creates the login with the admin-chosen password and the staff profile. */
  async createStaff(input: NewStaffInput): Promise<{ uid: string; resetEmailSent: boolean }> {
    const email = input.email.trim().toLowerCase();
    const problem = passwordProblem(input.password);
    if (problem) throw new Error(problem);

    const provisioning = getProvisioningAuth();
    let uid: string;
    try {
      const cred = await createUserWithEmailAndPassword(provisioning, email, input.password);
      uid = cred.user.uid;
      await updateProfile(cred.user, { displayName: input.displayName }).catch(() => {});
    } catch (err) {
      throw new Error(friendly(err));
    } finally {
      await signOut(provisioning).catch(() => {});
    }

    const ts = now();
    const profile: UserProfile = {
      uid,
      email,
      businessEmail: (input.businessEmail || email).trim().toLowerCase(),
      displayName: input.displayName.trim(),
      phone: input.phone?.trim() || undefined,
      role: input.role,
      dataScope: input.dataScope || defaultScopeFor(input.role),
      teamId: input.teamId || undefined,
      teamName: teamName(input.teamId),
      designationTitle: input.designationTitle?.trim() || undefined,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    };

    try {
      await setDoc(doc(db, 'users', uid), JSON.parse(JSON.stringify(profile)));
    } catch (err) {
      throw new Error(`The login was created but the profile could not be saved: ${friendly(err)}`);
    }

    let resetEmailSent = false;
    if (input.sendResetEmail) {
      resetEmailSent = await sendPasswordResetEmail(auth, email).then(() => true, () => false);
    }

    audit('create', uid, profile.displayName, `Added staff ${profile.displayName} <${email}> as ${profile.role}${profile.teamName ? ` in ${profile.teamName}` : ''}`);
    return { uid, resetEmailSent };
  },

  async updateStaff(uid: string, patch: Partial<Pick<UserProfile,
    'displayName' | 'businessEmail' | 'phone' | 'role' | 'dataScope' | 'teamId' | 'designationTitle' | 'isActive'>>) {
    const data: Record<string, unknown> = { ...patch, updatedAt: now() };
    if ('teamId' in patch) {
      data.teamId = patch.teamId || deleteField();
      data.teamName = teamName(patch.teamId) || deleteField();
    }
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
    try {
      await updateDoc(doc(db, 'users', uid), data);
    } catch (err) {
      throw new Error(friendly(err));
    }
    const name = dataService.getUsers().find((u) => u.uid === uid)?.displayName || uid;
    audit('update', uid, name, `Updated staff ${name}: ${Object.keys(patch).join(', ')}`);
  },

  async sendPasswordReset(email: string) {
    await sendPasswordResetEmail(auth, email);
  },

  // ---------- Teams ----------
  async saveTeam(team: Omit<Team, 'createdAt' | 'updatedAt'> & { createdAt?: string }) {
    const ts = now();
    const record: Team = { ...team, createdAt: team.createdAt || ts, updatedAt: ts };
    try {
      await setDoc(doc(db, 'teams', team.id), JSON.parse(JSON.stringify(record)), { merge: true });
    } catch (err) {
      throw new Error(friendly(err));
    }
    // Keep the denormalised team name on members in sync
    await Promise.all(
      dataService.getUsers()
        .filter((u) => u.teamId === team.id && u.teamName !== team.name)
        .map((u) => updateDoc(doc(db, 'users', u.uid), { teamName: team.name }).catch(() => {}))
    );
    audit(team.createdAt ? 'update' : 'create', team.id, team.name, `${team.createdAt ? 'Updated' : 'Created'} team ${team.name}`);
  },

  async deleteTeam(teamId: string) {
    const members = dataService.getUsers().filter((u) => u.teamId === teamId);
    await Promise.all(members.map((u) => updateDoc(doc(db, 'users', u.uid), { teamId: deleteField(), teamName: deleteField() }).catch(() => {})));
    try {
      await deleteDoc(doc(db, 'teams', teamId));
    } catch (err) {
      throw new Error(friendly(err));
    }
    audit('delete', teamId, teamId, `Deleted team ${teamId} (${members.length} member(s) unassigned)`);
  },

  // ---------- Roles ----------
  async saveRole(role: RoleDefinition) {
    if (role.id === 'super_admin') throw new Error('The Super Admin role always has full access and cannot be changed.');
    const ts = now();
    const record: RoleDefinition = { ...role, createdAt: role.createdAt || ts, updatedAt: ts };
    try {
      await setDoc(doc(db, 'roles', role.id), JSON.parse(JSON.stringify(record)));
    } catch (err) {
      throw new Error(friendly(err));
    }
    audit(role.createdAt ? 'update' : 'create', role.id, role.name, `${role.createdAt ? 'Updated' : 'Created'} role ${role.name}`);
  },

  async deleteRole(role: RoleDefinition) {
    if (role.isSystem) throw new Error('Built-in roles can be edited but not deleted.');
    const holders = dataService.getUsers().filter((u) => u.role === role.id);
    if (holders.length) throw new Error(`${holders.length} person(s) still have this role. Give them another role first.`);
    try {
      await deleteDoc(doc(db, 'roles', role.id));
    } catch (err) {
      throw new Error(friendly(err));
    }
    audit('delete', role.id, role.name, `Deleted role ${role.name}`);
  },
};
