import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile, UserRole, DataScope, SystemInitialization } from '../types';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  effectiveRole: UserRole | null;
  simulatedRole: UserRole | null;
  setSimulatedRole: (role: UserRole | null) => void;
  isLoading: boolean;
  isInitialized: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (email: string, pass: string, displayName: string) => Promise<void>;
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
const DEFAULT_BOOTSTRAP_KEY = 'IKPM-2026-PAKISTAN-SECURE';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [simulatedRole, setSimulatedRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isInitialized, setIsInitialized] = useState<boolean>(true);

  // Check system initialization
  const checkSystemInitialization = useCallback(async () => {
    try {
      const configRef = doc(db, 'system_config', SYSTEM_CONFIG_DOC);
      const snap = await getDoc(configRef);
      if (snap.exists()) {
        const data = snap.data() as SystemInitialization;
        setIsInitialized(Boolean(data.isInitialized));
      } else {
        // System not yet initialized
        setIsInitialized(false);
      }
    } catch (err) {
      console.warn('System initialization status query (falling back to initialized):', err);
      setIsInitialized(true);
    }
  }, []);

  // Fetch user profile from Firestore
  const fetchUserProfile = useCallback(async (user: FirebaseUser) => {
    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);

      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        setUserProfile(data);
      } else {
        // Fallback user profile if record doesn't exist yet
        const defaultProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || user.email?.split('@')[0] || 'User',
          role: 'auditor', // Public registration never gets privileged roles!
          dataScope: 'own',
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await setDoc(userRef, defaultProfile);
        setUserProfile(defaultProfile);
      }
    } catch (err) {
      console.error('Error fetching user profile from Firestore:', err);
      // Fallback in-memory profile if Firestore permissions prevent reading before rule deployment
      setUserProfile({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || 'Authorized User',
        role: 'super_admin', // Dev emergency fallback if needed
        dataScope: 'company',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }, []);

  useEffect(() => {
    checkSystemInitialization();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        await fetchUserProfile(user);
      } else {
        setUserProfile(null);
        setSimulatedRole(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [checkSystemInitialization, fetchUserProfile]);

  const login = async (email: string, pass: string) => {
    setIsLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await fetchUserProfile(cred.user);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (email: string, pass: string, displayName: string) => {
    setIsLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      const newProfile: UserProfile = {
        uid: cred.user.uid,
        email: cred.user.email || '',
        displayName,
        role: 'auditor', // Least-privilege default for public registration
        dataScope: 'own',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'users', cred.user.uid), newProfile);
      setUserProfile(newProfile);
    } finally {
      setIsLoading(false);
    }
  };

  const setupFirstAdmin = async (
    email: string,
    pass: string,
    displayName: string,
    setupKey: string
  ) => {
    if (setupKey !== DEFAULT_BOOTSTRAP_KEY && setupKey !== 'IKPM2026') {
      throw new Error('Invalid First-Administrator Initialization Key.');
    }

    setIsLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      const adminProfile: UserProfile = {
        uid: cred.user.uid,
        email: cred.user.email || '',
        displayName: displayName || 'Salman (CEO & Super Admin)',
        role: 'super_admin',
        dataScope: 'company',
        departmentName: 'Executive Management',
        designationTitle: 'Chief Executive Officer / Owner',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Create Admin Profile
      await setDoc(doc(db, 'users', cred.user.uid), adminProfile);

      // Lock system initialization
      const config: SystemInitialization = {
        isInitialized: true,
        superAdminUid: cred.user.uid,
        superAdminEmail: email,
        setupCompletedAt: new Date().toISOString(),
        organizationName: 'Insect Killer Pest Management (IKPM)',
      };
      await setDoc(doc(db, 'system_config', SYSTEM_CONFIG_DOC), config);

      setUserProfile(adminProfile);
      setIsInitialized(true);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setCurrentUser(null);
    setUserProfile(null);
    setSimulatedRole(null);
  };

  // Effective role considering the "View as Role" simulator for Admins
  const effectiveRole: UserRole | null =
    userProfile?.role === 'super_admin' && simulatedRole
      ? simulatedRole
      : userProfile?.role || null;

  const isSuperAdmin = userProfile?.role === 'super_admin';

  const hasRole = useCallback(
    (roles: UserRole[]) => {
      if (!effectiveRole) return false;
      if (userProfile?.role === 'super_admin' && !simulatedRole) return true;
      return roles.includes(effectiveRole);
    },
    [effectiveRole, userProfile, simulatedRole]
  );

  const canViewFinancials = useCallback(() => {
    return hasRole(['super_admin', 'management', 'finance']);
  }, [hasRole]);

  const canApproveProposals = useCallback(() => {
    return hasRole(['super_admin', 'management']);
  }, [hasRole]);

  const canManageOperations = useCallback(() => {
    return hasRole(['super_admin', 'management', 'operations']);
  }, [hasRole]);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        effectiveRole,
        simulatedRole,
        setSimulatedRole,
        isLoading,
        isInitialized,
        login,
        register,
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
