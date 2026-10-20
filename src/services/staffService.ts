// Super-admin operations for staff logins and teams.
// Logins are created on a separate Firebase Auth instance so the admin stays signed in;
// the new person then receives a password-reset email to choose their own password.

import { createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile } from 'firebase/auth';
import { deleteDoc, deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, getProvisioningAuth } from '../lib/firebase';
import { DEFAULT_SCOPE } from '../lib/permissions';
import { dataService } from './dataService';
import type { DataScope, Team, UserProfile, UserRole } from '../types';

export interface NewStaffInput {
  displayName: string;
  email: string;
  businessEmail?: string;
  phone?: string;
  role: UserRole;
  dataScope?: DataScope;
  teamId?: string;
  designationTitle?: string;
}

const now = () => new Date().toISOString();

const randomPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
};

const teamName = (teamId?: string) => dataService.getTeams().find((t) => t.id === teamId)?.name;

const authMessage = (err: unknown) => {
  const code = (err as { code?: string }).code;
  if (code === 'auth/email-already-in-use') return 'This email already has a portal login. Edit the existing user instead.';
  if (code === 'auth/invalid-email') return 'That email address is not valid.';
  if (code === 'auth/operation-not-allowed') return 'Email/password sign-in is disabled in Firebase Console → Authentication → Sign-in method.';
  if (code === 'permission-denied') return 'Firestore refused the change. Only the super admin can manage staff, and the security rules must be deployed.';
  return err instanceof Error ? err.message : String(err);
};

function audit(action: 'create' | 'update' | 'delete', id: string, title: string, details: string) {
  const se = dataService.getSession();
  dataService.logAudit({ userId: se?.uid || '', userEmail: se?.email || '', action, entityType: 'user', entityId: id, entityTitle: title, details });
}

export const staffService = {
  /** Creates the login + profile and emails a "set your password" link. Returns a one-time temporary password. */
  async createStaff(input: NewStaffInput): Promise<{ uid: string; tempPassword: string; resetEmailSent: boolean }> {
    const email = input.email.trim().toLowerCase();
    const tempPassword = randomPassword();
    const provisioning = getProvisioningAuth();

    let uid: string;
    try {
      const cred = await createUserWithEmailAndPassword(provisioning, email, tempPassword);
      uid = cred.user.uid;
      await updateProfile(cred.user, { displayName: input.displayName }).catch(() => {});
    } catch (err) {
      throw new Error(authMessage(err));
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
      dataScope: input.dataScope || DEFAULT_SCOPE[input.role],
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
      throw new Error(`Login created but the profile could not be saved: ${authMessage(err)}`);
    }

    let resetEmailSent = true;
    try {
      await sendPasswordResetEmail(auth, email);
    } catch {
      resetEmailSent = false;
    }

    audit('create', uid, profile.displayName, `Added staff ${profile.displayName} <${email}> as ${profile.role}${profile.teamName ? ` in ${profile.teamName}` : ''}`);
    return { uid, tempPassword, resetEmailSent };
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
      throw new Error(authMessage(err));
    }
    const name = dataService.getUsers().find((u) => u.uid === uid)?.displayName || uid;
    audit('update', uid, name, `Updated staff ${name}: ${Object.keys(patch).join(', ')}`);
  },

  async sendPasswordReset(email: string) {
    await sendPasswordResetEmail(auth, email);
  },

  async saveTeam(team: Omit<Team, 'createdAt' | 'updatedAt'> & { createdAt?: string }) {
    const ts = now();
    const record: Team = { ...team, createdAt: team.createdAt || ts, updatedAt: ts };
    try {
      await setDoc(doc(db, 'teams', team.id), JSON.parse(JSON.stringify(record)), { merge: true });
    } catch (err) {
      throw new Error(authMessage(err));
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
      throw new Error(authMessage(err));
    }
    audit('delete', teamId, teamId, `Deleted team ${teamId} (${members.length} member(s) unassigned)`);
  },
};
