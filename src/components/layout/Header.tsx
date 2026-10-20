import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LogOut,
  User,
  Eye,
  EyeOff,
  Building2,
  FileText,
  Truck,
  Receipt,
  Menu,
  Mail,
  UsersRound,
  Cloud,
  CloudOff,
  RefreshCw,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSync } from '../../contexts/SyncContext';
import { useDataStore } from '../../hooks/useDataStore';
import { normalizePakistaniPhone } from '../../lib/formatters';
import { canAccessModule, ROLE_LABELS, type ModuleKey } from '../../lib/permissions';

interface SearchHit {
  key: string;
  icon: LucideIcon;
  color: string;
  title: string;
  sub: string;
  to: string;
}

const initials = (name?: string) =>
  (name || 'IK')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export const Header: React.FC<{ onMenu: () => void }> = ({ onMenu }) => {
  const { userProfile, effectiveRole, isSuperAdmin, logout, simulatedRole, setSimulatedRole } = useAuth();
  const { isOnline } = useSync();
  const store = useDataStore();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSearchResults(false);
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const can = (m: ModuleKey) => canAccessModule(effectiveRole, m);

  // Global search, limited to the modules this role can open
  const hits: SearchHit[] = (() => {
    const q = searchQuery.toLowerCase().trim();
    if (q.length < 2) return [];
    const phone = normalizePakistaniPhone(q);
    const phoneHit = (p?: string) => Boolean(phone && p && normalizePakistaniPhone(p).includes(phone));
    const out: SearchHit[] = [];

    if (can('customers')) {
      store.getCompanies()
        .filter((co) => co.legalCompanyName.toLowerCase().includes(q) || co.id.toLowerCase().includes(q) || co.ntn?.includes(q) || phoneHit(co.primaryContact?.mobile))
        .slice(0, 4)
        .forEach((co) => out.push({ key: co.id, icon: Building2, color: 'var(--ikpm-navy-700)', title: co.legalCompanyName, sub: `Company · ${co.city}`, to: `/customers/company/${co.id}` }));
      store.getClients()
        .filter((c) => c.fullName.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.cnic?.includes(q) || phoneHit(c.primaryPhone))
        .slice(0, 4)
        .forEach((c) => out.push({ key: c.id, icon: User, color: 'var(--ikpm-emerald-600)', title: c.fullName, sub: `Individual client · ${c.primaryPhone}`, to: `/customers/individual/${c.id}` }));
    }
    if (can('crm')) {
      store.getLeads()
        .filter((l) => l.title.toLowerCase().includes(q) || l.contactName.toLowerCase().includes(q) || l.id.toLowerCase().includes(q) || phoneHit(l.phone))
        .slice(0, 4)
        .forEach((l) => out.push({ key: l.id, icon: FileText, color: 'var(--ikpm-teal-500)', title: l.title, sub: `Lead · ${l.stage.replace(/_/g, ' ')}`, to: `/crm?lead=${l.id}` }));
    }
    if (can('jobs') || can('pco')) {
      store.getJobs()
        .filter((j) => j.id.toLowerCase().includes(q) || j.customerName.toLowerCase().includes(q) || j.siteName.toLowerCase().includes(q))
        .slice(0, 4)
        .forEach((j) => out.push({ key: j.id, icon: Truck, color: 'var(--ikpm-amber-500)', title: `${j.id} · ${j.customerName}`, sub: `Service job · ${j.status.replace(/_/g, ' ')}`, to: can('jobs') ? `/operations/jobs?job=${j.id}` : '/pco-field' }));
    }
    if (can('invoices')) {
      store.getInvoices()
        .filter((i) => i.invoiceNumber.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
        .slice(0, 4)
        .forEach((i) => out.push({ key: i.id, icon: Receipt, color: 'var(--ikpm-navy-700)', title: `${i.invoiceNumber} · ${i.customerName}`, sub: `Invoice · ${i.balanceDue > 0 ? `PKR ${i.balanceDue.toLocaleString()} due` : 'Settled'}`, to: '/finance/invoices' }));
    }
    return out;
  })();

  const cloud = store.getCloudState();
  const sync = !isOnline
    ? { cls: 'pending', icon: CloudOff, label: 'Offline · changes saved on device', title: 'You are offline. Changes are stored on this device and sync automatically.' }
    : cloud.status === 'error'
      ? { cls: 'error', icon: AlertTriangle, label: 'Cloud sync blocked', title: cloud.lastError?.message || 'Firestore refused access' }
      : cloud.pendingWrites > 0
        ? { cls: 'pending', icon: RefreshCw, label: `Saving ${cloud.pendingWrites}…`, title: 'Writing changes to Cloud Firestore' }
        : cloud.status === 'connecting'
          ? { cls: '', icon: RefreshCw, label: 'Connecting…', title: 'Loading your data from Cloud Firestore' }
          : { cls: 'live', icon: Cloud, label: 'Saved to cloud', title: 'All changes are saved in Cloud Firestore' };

  const go = (to: string) => {
    setShowSearchResults(false);
    setSearchQuery('');
    navigate(to);
  };

  return (
    <header className="top-header">
      <div className="header-left">
        <button type="button" className="header-icon-btn header-menu-btn" onClick={onMenu} aria-label="Open menu">
          <Menu size={20} />
        </button>

        <div className="header-search" ref={searchRef}>
          <Search size={18} />
          <input
            type="search"
            placeholder="Search customers, leads, jobs, invoices…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSearchResults(e.target.value.trim().length > 1);
            }}
            onFocus={() => searchQuery.trim().length > 1 && setShowSearchResults(true)}
            onKeyDown={(e) => e.key === 'Enter' && hits[0] && go(hits[0].to)}
          />

          {showSearchResults && (
            <div className="dropdown-panel animate-fade-in" style={{ left: 0, right: 0, maxHeight: 420, overflowY: 'auto' }}>
              {hits.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  No records match “{searchQuery}”
                </div>
              ) : (
                hits.map((h) => (
                  <button key={`${h.to}-${h.key}`} type="button" className="dropdown-item" onClick={() => go(h.to)}>
                    <h.icon size={18} color={h.color} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</span>
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{h.sub}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="header-actions">
        <span
          className={`sync-pill ${sync.cls}`}
          title={sync.title}
          onClick={() => cloud.status === 'error' && can('settings') && navigate('/settings?tab=cloud')}
        >
          <sync.icon size={14} className={sync.icon === RefreshCw ? 'animate-spin' : undefined} />
          <span className="sync-label">{sync.label}</span>
        </span>

        {isSuperAdmin && (
          <button
            type="button"
            className="header-icon-btn"
            title={simulatedRole ? `Viewing as ${ROLE_LABELS[simulatedRole]}. Click to exit` : 'Preview the portal as another role'}
            onClick={() => (simulatedRole ? setSimulatedRole(null) : navigate('/settings?tab=roles'))}
            style={simulatedRole ? { background: '#F3E8FF', color: '#6B21A8' } : undefined}
          >
            {simulatedRole ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        )}

        <div style={{ position: 'relative' }} ref={menuRef}>
          <div className="user-profile-badge" onClick={() => setShowUserMenu((v) => !v)} role="button" aria-expanded={showUserMenu}>
            <div className="header-user-text" style={{ textAlign: 'right', lineHeight: 1.2 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{userProfile?.displayName || 'User'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {effectiveRole ? ROLE_LABELS[effectiveRole] : ''}
                {userProfile?.teamName ? ` · ${userProfile.teamName}` : ''}
              </div>
            </div>
            <div className="user-avatar">{initials(userProfile?.displayName)}</div>
          </div>

          {showUserMenu && (
            <div className="dropdown-panel animate-fade-in" style={{ width: 280 }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.6rem 0.6rem 0.75rem' }}>
                <div className="user-avatar" style={{ width: 42, height: 42 }}>{initials(userProfile?.displayName)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{userProfile?.displayName}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userProfile?.email}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {userProfile?.role && <span className={`role-pill ${userProfile.role}`}>{ROLE_LABELS[userProfile.role]}</span>}
                    {userProfile?.teamName && <span className="role-pill">{userProfile.teamName}</span>}
                  </div>
                </div>
              </div>
              <div className="dropdown-item" style={{ cursor: 'default', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <Mail size={15} />
                <span>Client emails sent from <strong>{userProfile?.businessEmail || userProfile?.email}</strong></span>
              </div>
              {isSuperAdmin && (
                <button type="button" className="dropdown-item" onClick={() => { setShowUserMenu(false); navigate('/admin/team'); }}>
                  <UsersRound size={15} /> Team & access
                </button>
              )}
              <div className="dropdown-divider" />
              <button
                type="button"
                className="dropdown-item danger"
                onClick={() => {
                  setShowUserMenu(false);
                  logout();
                }}
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
