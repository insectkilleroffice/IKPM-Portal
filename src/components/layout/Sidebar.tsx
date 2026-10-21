import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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
  Smartphone,
  FolderLock,
  FolderOpen,
  UsersRound,
  Plus,
  UserPlus,
  ClipboardCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { canAccessModule, roleLabel, type ModuleKey } from '../../lib/permissions';

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  module: ModuleKey;
  end?: boolean;
  badge?: string;
}

const SECTIONS: { title?: string; items: NavEntry[] }[] = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, module: 'dashboard', end: true },
      { to: '/pco-field', label: 'My Field Jobs', icon: Smartphone, module: 'pco', badge: 'PCO' },
    ],
  },
  {
    title: 'Sales & customers',
    items: [
      { to: '/customers', label: 'Customer Accounts', icon: Building2, module: 'customers' },
      { to: '/crm', label: 'Leads Pipeline', icon: Users2, module: 'crm' },
      { to: '/inspections', label: 'Site Inspections', icon: ClipboardCheck, module: 'inspections' },
      { to: '/proposals', label: 'Proposals', icon: FileSpreadsheet, module: 'proposals' },
      { to: '/contracts', label: 'Contracts & AMCs', icon: FileSignature, module: 'contracts' },
    ],
  },
  {
    title: 'Files',
    items: [
      { to: '/files', label: 'Client Files', icon: FolderOpen, module: 'files' },
      { to: '/documents', label: 'Company Documents', icon: FolderLock, module: 'documents' },
    ],
  },
  {
    title: 'Field operations',
    items: [
      { to: '/operations/calendar', label: 'Dispatch Calendar', icon: CalendarDays, module: 'calendar' },
      { to: '/operations/jobs', label: 'Service Jobs', icon: Truck, module: 'jobs' },
    ],
  },
  {
    title: 'Accounts',
    items: [
      { to: '/finance/invoices', label: 'Invoices & Receipts', icon: Receipt, module: 'invoices' },
      { to: '/finance/tax-rules', label: 'Tax Rules & WHT', icon: FileCheck2, module: 'tax' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/admin/team', label: 'Team & Access', icon: UsersRound, module: 'team' },
      { to: '/settings', label: 'Settings & Audit', icon: Settings, module: 'settings' },
    ],
  },
];

const QUICK_CREATE: { label: string; to: string; module: ModuleKey; icon: LucideIcon }[] = [
  { label: 'New lead', to: '/crm?action=new_lead', module: 'crm', icon: Users2 },
  { label: 'New company account', to: '/customers?action=new_company', module: 'customers', icon: Building2 },
  { label: 'New individual client', to: '/customers?action=new_individual', module: 'customers', icon: UsersRound },
  { label: 'New proposal', to: '/proposals?action=new_proposal', module: 'proposals', icon: FileSpreadsheet },
  { label: 'Upload client file', to: '/files', module: 'files', icon: FolderOpen },
  { label: 'Schedule service job', to: '/operations/jobs?action=new_job', module: 'jobs', icon: Truck },
  { label: 'Add staff member', to: '/admin/team?action=new_user', module: 'team', icon: UserPlus },
];

interface SidebarProps {
  mobileOpen: boolean;
  onNavigate: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onNavigate }) => {
  const { effectiveRole } = useAuth();
  useDataStore(); // role definitions load from Firestore
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);
  const newRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNew) return;
    const close = (e: MouseEvent) => {
      if (newRef.current && !newRef.current.contains(e.target as Node)) setShowNew(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showNew]);

  const can = (m: ModuleKey) =>
    canAccessModule(effectiveRole, m) || (m === 'team' && canAccessModule(effectiveRole, 'roles'));
  const quick = QUICK_CREATE.filter((q) => can(q.module));

  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Main navigation">
      <div className="sidebar-header">
        <NavLink to="/" className="brand-logo-wrap" onClick={onNavigate}>
          <img src="/ik_logo.svg" alt="Insect Killer Pest Management" />
        </NavLink>
      </div>

      {quick.length > 0 && (
        <div ref={newRef} style={{ position: 'relative' }}>
          <button type="button" className="sidebar-new-btn" onClick={() => setShowNew((v) => !v)} aria-expanded={showNew}>
            <Plus size={22} strokeWidth={2.2} color="var(--ikpm-emerald-600)" />
            <span>New</span>
          </button>
          {showNew && (
            <div className="dropdown-panel animate-fade-in" style={{ left: '1rem', right: 'auto', top: '58px' }}>
              {quick.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    setShowNew(false);
                    onNavigate();
                    navigate(q.to);
                  }}
                >
                  <q.icon size={16} color="var(--text-secondary)" />
                  {q.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <nav className="sidebar-nav">
        {SECTIONS.map((section, i) => {
          const items = section.items.filter((it) => can(it.module));
          if (items.length === 0) return null;
          return (
            <React.Fragment key={section.title ?? i}>
              {section.title && <div className="nav-section-title">{section.title}</div>}
              {items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  onClick={onNavigate}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <it.icon size={18} />
                  <span>{it.label}</span>
                  {it.badge && <span className="badge">{it.badge}</span>}
                </NavLink>
              ))}
            </React.Fragment>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <span>Signed in as {effectiveRole ? roleLabel(effectiveRole) : '—'}</span>
        <span>IKPM Portal · v1.1</span>
      </div>
    </aside>
  );
};
