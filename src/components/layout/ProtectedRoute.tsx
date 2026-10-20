import React from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ShieldOff, UserX, DatabaseZap, Lock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { UserRole } from '../../types';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { canAccessModule, homePathFor, roleLabel, type ModuleKey } from '../../lib/permissions';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  /** Module from src/lib/permissions.ts; the route is hidden from roles that can't use it. */
  module?: ModuleKey | ModuleKey[];
}

const BlockedScreen: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => {
  const { logout, currentUser } = useAuth();
  return (
    <div className="center-screen">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <img src="/ik_logo.svg" alt="IKPM" className="auth-logo" />
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>{icon}</div>
        <h1 className="auth-title">{title}</h1>
        <div style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Signed in as {currentUser?.email}</span>
          <button className="btn btn-secondary" onClick={() => logout()}>Sign out</button>
        </div>
      </div>
    </div>
  );
};

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles, module }) => {
  const { currentUser, isLoading, effectiveRole, hasRole, profileIssue, isInitialized } = useAuth();
  const location = useLocation();
  useDataStore(); // re-check once role definitions arrive

  if (isLoading) {
    return <LoadingSpinner fullPage message="Signing you in…" />;
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (profileIssue === 'rules_blocked') {
    return (
      <BlockedScreen icon={<DatabaseZap size={40} color="var(--ikpm-rose-500)" />} title="The database is locked">
        <p>
          You signed in, but Cloud Firestore refused to read your staff profile. This happens when the portal's security
          rules have not been deployed yet, so Firestore is still in its default locked mode. That is also why saved data
          never reached Firestore.
        </p>
        <ol className="steps-list">
          <li>Open a terminal in the project folder.</li>
          <li>Run <code>npx firebase-tools login</code> and sign in with the Google account that owns the Firebase project.</li>
          <li>Run <code>npx firebase-tools deploy --only firestore</code>.</li>
          <li>Reload this page.</li>
        </ol>
      </BlockedScreen>
    );
  }

  if (profileIssue === 'no_profile') {
    return (
      <BlockedScreen icon={<UserX size={40} color="var(--ikpm-amber-500)" />} title="Your account hasn't been set up">
        {!isInitialized ? (
          <p>
            The portal has no administrator yet. If you are the owner, finish the{' '}
            <Link to="/setup-first-admin">first-admin setup</Link> with this same email and password to become super admin.
          </p>
        ) : (
          <p>
            You can sign in, but the super admin hasn't added you to a team yet. Ask them to add your email under{' '}
            <strong>Team & Access</strong>. Your access will appear here automatically.
          </p>
        )}
      </BlockedScreen>
    );
  }

  if (profileIssue === 'inactive') {
    return (
      <BlockedScreen icon={<ShieldOff size={40} color="var(--ikpm-rose-500)" />} title="Your access is paused">
        <p>Your portal account has been deactivated by the super admin. Contact them to restore access.</p>
      </BlockedScreen>
    );
  }

  const modules = module ? (Array.isArray(module) ? module : [module]) : [];
  const moduleDenied = modules.length > 0 && !hasRole([]) && !modules.some((m) => canAccessModule(effectiveRole, m));
  const roleDenied = allowedRoles && allowedRoles.length > 0 && !hasRole(allowedRoles);

  if (moduleDenied || roleDenied) {
    // Send people to their own home page rather than showing a dead end on the root route
    if (location.pathname === '/' && effectiveRole && homePathFor(effectiveRole) !== '/') {
      return <Navigate to={homePathFor(effectiveRole)} replace />;
    }
    return (
      <div style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>
        <Lock size={36} color="var(--text-muted)" style={{ marginBottom: '0.75rem' }} />
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.35rem' }}>You don't have access to this page</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto 1.5rem' }}>
          Your role ({effectiveRole ? roleLabel(effectiveRole) : 'unknown'}) can't open this module. Ask the super admin if you need it.
        </p>
        <Link to={homePathFor(effectiveRole)} className="btn btn-secondary">
          Go to my home page
        </Link>
      </div>
    );
  }

  return <>{children}</>;
};
