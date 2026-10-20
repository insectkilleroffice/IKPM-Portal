import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { dataService } from '../services/dataService';
import { UserProfile, UserRole, SystemInitialization } from '../types';

/** Why a signed-in user can't use the portal yet. */
export type ProfileIssue =
  | 'no_profile' // Firebase login exists but the super admin hasn't added this person
  | 'inactive' // Account deactivated by the super admin
  | 'rules_blocked' // Firestore refused to read the profile (rules not deployed / DB locked)
  | null;

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  profileIssue: ProfileIssue;
  effectiveRole: UserRole | null;
  simulatedRole: UserRole | null;
  setSimulatedRole: (role: UserRole | null) => void;
  isLoading: boolean;
  isInitialized: boolean;
  login: (email: string, pass: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  setupFirstAdmin: (email: string, pass: string, displayName: string, setupKey: string) => Promise<void>;
  // Authorization check helpers
  hasRole: (roles: UserRole[]) => boolean;
  canViewFinancials: () => boolean;
  canApproveProposals: () => boolean;
  canManageOperations: () => boolean;
  isSuperAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SYSTEM_CONFIG_DOC = 'initialization';
const SETUP_KEYS = [(import.meta.env.VITE_SETUP_KEY as string | undefined) || 'IKPM-2026-PAKISTAN-SECURE', 'IKPM2026'];

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileIssue, setProfileIssue] = useState<ProfileIssue>(null);
  const [simulatedRole, setSimulatedRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isInitialized, setIsInitialized] = useState<boolean>(true);

  const checkSystemInitialization = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, 'system_config', SYSTEM_CONFIG_DOC));
      setIsInitialized(snap.exists() && Boolean((snap.data() as SystemInitialization).isInitialized));
    } catch (err) {
      // Readable by everyone once rules are deployed; if it fails the DB is still locked.
      console.warn('Could not read system initialization status:', err);
      setIsInitialized(true);
    }
  }, []);

  useEffect(() => {
    checkSystemInitialization();
  }, [checkSystemInitialization]);

  // Track the signed-in user, then live-subscribe to their profile so role / team / deactivation
  // changes made by the super admin apply immediately.
  useEffect(() => {
    let unsubProfile: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubProfile?.();
      unsubProfile = undefined;
      setCurrentUser(user);

      if (!user) {
        setUserProfile(null);
        setProfileIssue(null);
        setSimulatedRole(null);
        dataService.setSession(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      unsubProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (snap) => {
          if (!snap.exists()) {
            setUserProfile(null);
            setProfileIssue('no_profile');
            dataService.setSession(null);
          } else {
            const profile = { uid: user.uid, ...snap.data() } as UserProfile;
            if (!profile.isActive) {
              setUserProfile(null);
              setProfileIssue('inactive');
              dataService.setSession(null);
            } else {
              setUserProfile(profile);
              setProfileIssue(null);
              dataService.setSession({
                uid: user.uid,
                email: profile.email || user.email || '',
                name: profile.displayName || user.email || 'User',
                role: profile.role,
                dataScope: profile.dataScope || 'own',
                teamId: profile.teamId || undefined,
              });
            }
          }
          setIsLoading(false);
        },
        (err) => {
          console.error('Could not read user profile from Firestore:', err);
          setUserProfile(null);
          setProfileIssue('rules_blocked');
          dataService.setSession(null);
          setIsLoading(false);
        }
      );
    });

    return () => {
      unsubProfile?.();
      unsubAuth();
    };
  }, []);

  // Record last login once per session (allowed: it's not an access field)
  useEffect(() => {
    if (!userProfile?.uid) return;
    updateDoc(doc(db, 'users', userProfile.uid), { lastLoginAt: new Date().toISOString() }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.uid]);

  const login = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), pass);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const setupFirstAdmin = async (email: string, pass: string, displayName: string, setupKey: string) => {
    if (!SETUP_KEYS.includes(setupKey.trim())) {
      throw new Error('Invalid first-administrator initialization key.');
    }

    // Reuse the login if it was already created in Firebase Authentication
    let user: FirebaseUser;
    try {
      user = (await createUserWithEmailAndPassword(auth, email.trim(), pass)).user;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/email-already-in-use') throw err;
      user = (await signInWithEmailAndPassword(auth, email.trim(), pass)).user;
    }

    const ts = new Date().toISOString();
    const adminProfile: UserProfile = {
      uid: user.uid,
      email: user.email || email.trim(),
      businessEmail: user.email || email.trim(),
      displayName: displayName || 'Super Admin',
      role: 'super_admin',
      dataScope: 'company',
      departmentName: 'Executive Management',
      designationTitle: 'Chief Executive Officer / Owner',
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    };

    try {
      await setDoc(doc(db, 'users', user.uid), adminProfile);
      const config: SystemInitialization = {
        isInitialized: true,
        superAdminUid: user.uid,
        superAdminEmail: adminProfile.email,
        setupCompletedAt: ts,
        organizationName: 'Insect Killer Pest Management (IKPM)',
      };
      await setDoc(doc(db, 'system_config', SYSTEM_CONFIG_DOC), config);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'permission-denied') {
        throw new Error(
          'Firestore refused the write. Deploy the security rules first (npx firebase-tools deploy --only firestore), or the portal has already been initialized.'
        );
      }
      throw err;
    }
    setIsInitialized(true);
  };

  const logout = async () => {
    setSimulatedRole(null);
    dataService.setSession(null);
    await signOut(auth);
  };

  // Effective role considering the "View as Role" simulator for Admins
  const effectiveRole: UserRole | null =
    userProfile?.role === 'super_admin' && simulatedRole ? simulatedRole : userProfile?.role || null;

  const isSuperAdmin = userProfile?.role === 'super_admin';

  const hasRole = useCallback(
    (roles: UserRole[]) => {
      if (!effectiveRole) return false;
      if (userProfile?.role === 'super_admin' && !simulatedRole) return true;
      return roles.includes(effectiveRole);
    },
    [effectiveRole, userProfile, simulatedRole]
  );

  const canViewFinancials = useCallback(() => hasRole(['super_admin', 'management', 'finance']), [hasRole]);
  const canApproveProposals = useCallback(() => hasRole(['super_admin', 'management']), [hasRole]);
  const canManageOperations = useCallback(() => hasRole(['super_admin', 'management', 'operations']), [hasRole]);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        profileIssue,
        effectiveRole,
        simulatedRole,
        setSimulatedRole,
        isLoading,
        isInitialized,
        login,
        resetPassword,
        logout,
        setupFirstAdmin,
        hasRole,
        canViewFinancials,
        canApproveProposals,
        canManageOperations,
        isSuperAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
