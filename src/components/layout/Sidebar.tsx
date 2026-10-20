import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users2,
  Building2,
  CalendarDays,
  FileSpreadsheet,
  FileSignature,
  Truck,
  Receipt,
  FileCheck2,
  Settings,
  ShieldAlert,
  Smartphone,
  FolderLock,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export const Sidebar: React.FC = () => {
  const { effectiveRole, hasRole } = useAuth();

  const isTechOnly = effectiveRole === 'technician';

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="sidebar-header">
        <NavLink to="/" className="brand-logo-wrap">
          <div className="brand-icon-badge">
            <ShieldAlert size={22} />
          </div>
          <div>
            <div className="brand-title">IKPM PORTAL</div>
            <div className="brand-subtitle">Pest Management</div>
          </div>
        </NavLink>
      </div>

      {/* Navigation Links in SRS Specified Order */}
      <nav className="sidebar-nav">
        {/* Core Workspace */}
        <div className="nav-section-title">Core Operations</div>

        {!isTechOnly && (
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <LayoutDashboard size={18} />
            <span>Dashboard</span>
          </NavLink>
        )}

        {/* PCO Mobile View for Field Technicians */}
        <NavLink
          to="/pco-field"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Smartphone size={18} />
          <span>PCO Mobile View</span>
          <span className="badge">Field</span>
        </NavLink>

        {/* CRM & Customer Profiles (Highest Priority) */}
        {!isTechOnly && (
          <>
            <div className="nav-section-title">Customer & Pipeline</div>

            <NavLink
              to="/customers"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Building2 size={18} />
              <span>Customer Accounts</span>
            </NavLink>

            <NavLink
              to="/crm"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Users2 size={18} />
              <span>CRM & Leads</span>
            </NavLink>

            <NavLink
              to="/proposals"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <FileSpreadsheet size={18} />
              <span>Proposals & Revisions</span>
            </NavLink>

            <NavLink
              to="/contracts"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <FileSignature size={18} />
              <span>Contracts & AMCs</span>
            </NavLink>

            <NavLink
              to="/documents"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <FolderLock size={18} />
              <span>Document Library</span>
            </NavLink>

            {/* Operations */}
            <div className="nav-section-title">Field & Dispatch</div>

            <NavLink
              to="/operations/calendar"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <CalendarDays size={18} />
              <span>Dispatch Calendar</span>
            </NavLink>

            <NavLink
              to="/operations/jobs"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Truck size={18} />
              <span>Service Jobs</span>
            </NavLink>

            {/* Finance & Accounts */}
            {hasRole(['super_admin', 'management', 'finance']) && (
              <>
                <div className="nav-section-title">Accounts & Tax</div>

                <NavLink
                  to="/finance/invoices"
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <Receipt size={18} />
                  <span>Invoices & Receivables</span>
                </NavLink>

                <NavLink
                  to="/finance/tax-rules"
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <FileCheck2 size={18} />
                  <span>Tax Rules & WHT</span>
                </NavLink>
              </>
            )}

            {/* System Settings & Org Structure */}
            <div className="nav-section-title">Administration</div>

            <NavLink
              to="/settings"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Settings size={18} />
              <span>Settings & Audit</span>
            </NavLink>
          </>
        )}
      </nav>

      {/* Footer Info */}
      <div style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)', fontSize: '0.72rem', color: '#64748B' }}>
        <div>IKPM Pakistan • v1.0 Production</div>
        <div style={{ color: 'var(--ikpm-emerald-400)', marginTop: '2px' }}>PWA Offline-Ready</div>
      </div>
    </aside>
  );
};
