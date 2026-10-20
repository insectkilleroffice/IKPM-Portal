import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { UserRole } from '../../types';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { currentUser, isLoading, effectiveRole, hasRole } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingSpinner fullPage message="Authenticating IKPM Session..." />;
  }

  if (!currentUser) {
    // Redirect to login preserving destination
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role authorization
  if (allowedRoles && allowedRoles.length > 0) {
    if (!hasRole(allowedRoles)) {
      return (
        <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.4rem', color: 'var(--ikpm-rose-500)', marginBottom: '0.5rem' }}>
            Access Restricted (Least Privilege Enforcement)
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto 1.5rem auto' }}>
            Your active role (<strong>{effectiveRole?.toUpperCase()}</strong>) does not have sufficient permission
            to view this administrative module.
          </p>
          <a href="/" className="btn btn-secondary">
            Return to Dashboard
          </a>
        </div>
      );
    }
  }

  return <>{children}</>;
};
