import React from 'react';
import { Eye, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { UserRole } from '../../types';

export const RoleSimulatorBanner: React.FC = () => {
  const { isSuperAdmin, simulatedRole, setSimulatedRole } = useAuth();

  if (!isSuperAdmin) return null;

  const roles: { role: UserRole; label: string }[] = [
    { role: 'management', label: 'Management (CEO/General)' },
    { role: 'sales', label: 'Sales (Manager / CRO)' },
    { role: 'operations', label: 'Operations (Dispatch / QC)' },
    { role: 'finance', label: 'Finance (Accounts / Tax)' },
    { role: 'technician', label: 'Technician / PCO (Mobile Field)' },
    { role: 'auditor', label: 'Read-only Auditor' },
  ];

  if (!simulatedRole) {
    return null;
  }

  return (
    <div
      style={{
        backgroundColor: '#7C3AED',
        color: '#FFFFFF',
        padding: '0.45rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.8rem',
        fontWeight: 600,
        zIndex: 50,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Eye size={15} />
        <span>
          <strong>Role Simulator Active (SRS RBAC-004):</strong> Viewing portal through permissions of{' '}
          <span style={{ textDecoration: 'underline' }}>{simulatedRole.toUpperCase()}</span>.
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <select
          value={simulatedRole}
          onChange={(e) => setSimulatedRole(e.target.value as UserRole)}
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 8px',
            fontSize: '0.75rem',
            outline: 'none',
          }}
        >
          {roles.map((r) => (
            <option key={r.role} value={r.role} style={{ color: '#000' }}>
              {r.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSimulatedRole(null)}
          style={{
            background: 'none',
            border: 'none',
            color: '#FFFFFF',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            fontSize: '0.75rem',
            fontWeight: 700,
          }}
        >
          <X size={14} /> Exit Simulation
        </button>
      </div>
    </div>
  );
};
