import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Bell, LogOut, User, Eye, Building2, UserPlus, FileText, Truck, Shield } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { OfflineBadge } from '../common/OfflineBadge';
import { dataService } from '../../services/dataService';
import { normalizePakistaniPhone } from '../../lib/formatters';

export const Header: React.FC = () => {
  const { userProfile, effectiveRole, isSuperAdmin, logout, simulatedRole, setSimulatedRole } = useAuth();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Global search implementation across all entities
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setShowSearchResults(val.trim().length > 1);
  };

  const getFilteredResults = () => {
    if (!searchQuery.trim()) return { clients: [], companies: [], leads: [], jobs: [], invoices: [] };
    const q = searchQuery.toLowerCase().trim();
    const normalizedPhone = normalizePakistaniPhone(q);

    const clients = dataService.getClients().filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.cnic && c.cnic.includes(q)) ||
        (normalizedPhone && normalizePakistaniPhone(c.primaryPhone).includes(normalizedPhone))
    ).slice(0, 3);

    const companies = dataService.getCompanies().filter(
      (co) =>
        co.legalCompanyName.toLowerCase().includes(q) ||
        co.id.toLowerCase().includes(q) ||
        (co.ntn && co.ntn.includes(q)) ||
        (normalizedPhone && normalizePakistaniPhone(co.primaryContact.mobile).includes(normalizedPhone))
    ).slice(0, 3);

    const leads = dataService.getLeads().filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.contactName.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q) ||
        (normalizedPhone && normalizePakistaniPhone(l.phone).includes(normalizedPhone))
    ).slice(0, 3);

    const jobs = dataService.getJobs().filter(
      (j) => j.id.toLowerCase().includes(q) || j.customerName.toLowerCase().includes(q) || j.siteName.toLowerCase().includes(q)
    ).slice(0, 3);

    const invoices = dataService.getInvoices().filter(
      (i) => i.invoiceNumber.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)
    ).slice(0, 3);

    return { clients, companies, leads, jobs, invoices };
  };

  const results = getFilteredResults();
  const hasResults =
    results.clients.length > 0 ||
    results.companies.length > 0 ||
    results.leads.length > 0 ||
    results.jobs.length > 0 ||
    results.invoices.length > 0;

  return (
    <header className="top-header">
      {/* Global Search Bar */}
      <div className="header-search">
        <Search size={16} />
        <input
          type="text"
          placeholder="Search name, phone, NTN, CNIC, Job #..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => searchQuery.trim().length > 1 && setShowSearchResults(true)}
        />

        {/* Search Results Dropdown */}
        {showSearchResults && (
          <div
            className="animate-fade-in"
            style={{
              position: 'absolute',
              top: '48px',
              left: 0,
              right: 0,
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-xl)',
              maxHeight: '380px',
              overflowY: 'auto',
              zIndex: 100,
              padding: '0.75rem',
            }}
          >
            {!hasResults ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No records matched &quot;{searchQuery}&quot;
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {results.companies.map((co) => (
                  <div
                    key={co.id}
                    onClick={() => {
                      setShowSearchResults(false);
                      setSearchQuery('');
                      navigate(`/customers/company/${co.id}`);
                    }}
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.825rem',
                      backgroundColor: 'var(--bg-surface-alt)',
                    }}
                  >
                    <Building2 size={16} color="var(--ikpm-navy-700)" />
                    <div>
                      <strong>{co.legalCompanyName}</strong> ({co.id})
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Master Corporate • {co.city}</div>
                    </div>
                  </div>
                ))}

                {results.clients.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => {
                      setShowSearchResults(false);
                      setSearchQuery('');
                      navigate(`/customers/individual/${c.id}`);
                    }}
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.825rem',
                      backgroundColor: 'var(--bg-surface-alt)',
                    }}
                  >
                    <User size={16} color="var(--ikpm-emerald-600)" />
                    <div>
                      <strong>{c.fullName}</strong> ({c.id})
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Individual Client • {c.primaryPhone}</div>
                    </div>
                  </div>
                ))}

                {results.leads.map((l) => (
                  <div
                    key={l.id}
                    onClick={() => {
                      setShowSearchResults(false);
                      setSearchQuery('');
                      navigate(`/crm?lead=${l.id}`);
                    }}
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.825rem',
                      backgroundColor: 'var(--bg-surface-alt)',
                    }}
                  >
                    <FileText size={16} color="var(--ikpm-teal-500)" />
                    <div>
                      <strong>{l.title}</strong> ({l.id})
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Lead • Stage: {l.stage}</div>
                    </div>
                  </div>
                ))}

                {results.jobs.map((j) => (
                  <div
                    key={j.id}
                    onClick={() => {
                      setShowSearchResults(false);
                      setSearchQuery('');
                      navigate(`/operations/jobs?job=${j.id}`);
                    }}
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.825rem',
                      backgroundColor: 'var(--bg-surface-alt)',
                    }}
                  >
                    <Truck size={16} color="var(--ikpm-amber-500)" />
                    <div>
                      <strong>{j.id}</strong> — {j.customerName}
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Job • {j.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Header Actions */}
      <div className="header-actions">
        {/* Offline / Online Sync Badge */}
        <OfflineBadge />

        {/* Quick Create Dropdown Button */}
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-primary"
            style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem' }}
            onClick={() => setShowQuickCreate(!showQuickCreate)}
          >
            <Plus size={16} />
            <span>Create</span>
          </button>

          {showQuickCreate && (
            <div
              className="animate-fade-in"
              style={{
                position: 'absolute',
                top: '42px',
                right: 0,
                width: '210px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-xl)',
                zIndex: 100,
                padding: '0.45rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.2rem',
              }}
            >
              <button
                className="nav-item"
                style={{ color: 'var(--text-primary)', padding: '0.5rem 0.75rem' }}
                onClick={() => {
                  setShowQuickCreate(false);
                  navigate('/customers?action=new_individual');
                }}
              >
                <UserPlus size={15} color="var(--ikpm-emerald-600)" />
                <span>+ Individual Client</span>
              </button>

              <button
                className="nav-item"
                style={{ color: 'var(--text-primary)', padding: '0.5rem 0.75rem' }}
                onClick={() => {
                  setShowQuickCreate(false);
                  navigate('/customers?action=new_company');
                }}
              >
                <Building2 size={15} color="var(--ikpm-navy-700)" />
                <span>+ Company Master</span>
              </button>

              <button
                className="nav-item"
                style={{ color: 'var(--text-primary)', padding: '0.5rem 0.75rem' }}
                onClick={() => {
                  setShowQuickCreate(false);
                  navigate('/crm?action=new_lead');
                }}
              >
                <FileText size={15} color="var(--ikpm-teal-500)" />
                <span>+ New Lead Inquiry</span>
              </button>

              <button
                className="nav-item"
                style={{ color: 'var(--text-primary)', padding: '0.5rem 0.75rem' }}
                onClick={() => {
                  setShowQuickCreate(false);
                  navigate('/proposals?action=new_proposal');
                }}
              >
                <FileText size={15} color="var(--ikpm-amber-500)" />
                <span>+ Draft Proposal</span>
              </button>

              <button
                className="nav-item"
                style={{ color: 'var(--text-primary)', padding: '0.5rem 0.75rem' }}
                onClick={() => {
                  setShowQuickCreate(false);
                  navigate('/operations/jobs?action=new_job');
                }}
              >
                <Truck size={15} color="var(--ikpm-rose-500)" />
                <span>+ Schedule Job</span>
              </button>
            </div>
          )}
        </div>

        {/* Role Simulator Quick Trigger (For Super Admins) */}
        {isSuperAdmin && (
          <button
            title="RBAC Role Simulator (SRS RBAC-004)"
            onClick={() => {
              if (simulatedRole) {
                setSimulatedRole(null);
              } else {
                setSimulatedRole('technician'); // Start with PCO view simulation
              }
            }}
            style={{
              padding: '0.45rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: simulatedRole ? '#7C3AED' : 'var(--bg-surface-alt)',
              color: simulatedRole ? '#FFFFFF' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Eye size={17} />
          </button>
        )}

        {/* Notifications Bell */}
        <button
          style={{
            padding: '0.45rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface-alt)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <Bell size={17} />
          <span
            style={{
              position: 'absolute',
              top: '5px',
              right: '5px',
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: 'var(--ikpm-emerald-500)',
            }}
          />
        </button>

        {/* User Profile Avatar and Menu */}
        <div style={{ position: 'relative' }}>
          <div className="user-profile-badge" onClick={() => setShowUserMenu(!showUserMenu)}>
            <div className="user-avatar">
              {userProfile?.displayName?.slice(0, 2).toUpperCase() || 'IK'}
            </div>
            <div style={{ textAlign: 'left', display: 'none', lineHeight: 1.2 }}>
              <div style={{ fontSize: '0.825rem', fontWeight: 700 }}>{userProfile?.displayName || 'User'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{effectiveRole?.toUpperCase()}</div>
            </div>
          </div>

          {showUserMenu && (
            <div
              className="animate-fade-in"
              style={{
                position: 'absolute',
                top: '46px',
                right: 0,
                width: '240px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-xl)',
                zIndex: 100,
                padding: '0.75rem',
              }}
            >
              <div style={{ paddingBottom: '0.5rem', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{userProfile?.displayName}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{userProfile?.email}</div>
                <div style={{ marginTop: '0.35rem', display: 'flex', gap: '4px' }}>
                  <span className="badge-status badge-navy" style={{ fontSize: '0.68rem' }}>
                    <Shield size={10} style={{ marginRight: '2px' }} />
                    {effectiveRole?.toUpperCase()}
                  </span>
                </div>
              </div>

              <button
                className="nav-item"
                style={{ width: '100%', color: 'var(--ikpm-rose-500)', padding: '0.5rem' }}
                onClick={() => {
                  setShowUserMenu(false);
                  logout();
                }}
              >
                <LogOut size={16} />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
