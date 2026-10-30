import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Building2, Users2, Truck, Receipt, ClipboardList,
  FileSpreadsheet, MessageSquareWarning, UserCog, ExternalLink,
  Filter, FolderOpen,
} from 'lucide-react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { EmptyState } from '../../components/common/EmptyState';
import { useDataStore } from '../../hooks/useDataStore';
import { useAuth } from '../../contexts/AuthContext';
import { searchAll, type SearchCategory, type SearchResultItem } from '../../lib/search';
import type { SystemRole } from '../../lib/permissions';

const CATEGORY_ICONS: Record<SearchCategory, React.ElementType> = {
  customers: Building2,
  leads: Users2,
  jobs: Truck,
  invoices: Receipt,
  challans: ClipboardList,
  proposals: FileSpreadsheet,
  contracts: FileSpreadsheet,
  complaints: MessageSquareWarning,
  employees: UserCog,
  documents: FolderOpen,
};

const CATEGORY_LABELS: Record<SearchCategory, string> = {
  customers: 'Client Accounts',
  leads: 'Leads (CRM)',
  jobs: 'Service Jobs',
  invoices: 'Invoices',
  challans: 'Challans',
  proposals: 'Proposals',
  contracts: 'Contracts',
  complaints: 'Complaints',
  employees: 'Employees',
  documents: 'Documents',
};

export const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [activeCategory, setActiveCategory] = useState<SearchCategory | 'all'>('all');

  const store = useDataStore();
  const { effectiveRole } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const q = searchParams.get('q');
    if (q !== null && q !== query) {
      setQuery(q);
    }
  }, [searchParams]);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (val.trim()) {
      setSearchParams({ q: val }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  const allHits = query.trim().length >= 2 ? searchAll(query, (effectiveRole as SystemRole) || undefined, store, { limitPerCategory: 50 }) : [];
  const filteredHits = activeCategory === 'all' ? allHits : allHits.filter((h) => h.category === activeCategory);

  // Group counts
  const categoryCounts = allHits.reduce((acc, h) => {
    acc[h.category] = (acc[h.category] || 0) + 1;
    return acc;
  }, {} as Partial<Record<SearchCategory, number>>);

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'System', path: '/' }, { label: 'Global Search' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Global Search</h1>
          <p className="page-subtitle">
            Universal portal search across clients, leads, service jobs, invoices, signed challans, proposals, and staff.
          </p>
        </div>
      </div>

      {/* Main search bar */}
      <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
        <div className="drive-search" style={{ minWidth: '100%', marginBottom: '0.85rem' }}>
          <Search size={18} color="var(--text-muted)" />
          <input
            type="search"
            autoFocus
            placeholder="Type client name, invoice #, challan #, phone, job ID, proposal ID…"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            style={{ fontSize: '1rem' }}
          />
        </div>

        {/* Category Filter Chips */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`chip ${activeCategory === 'all' ? 'chip-active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            All Results ({allHits.length})
          </button>
          {(Object.keys(CATEGORY_LABELS) as SearchCategory[]).map((cat) => {
            const count = categoryCounts[cat] || 0;
            if (count === 0 && activeCategory !== cat) return null;
            return (
              <button
                key={cat}
                type="button"
                className={`chip ${activeCategory === cat ? 'chip-active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {CATEGORY_LABELS[cat]} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {query.trim().length < 2 ? (
        <EmptyState
          icon={Search}
          title="Start searching"
          description="Type at least 2 characters to search across all records you have permission to access."
        />
      ) : filteredHits.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No records found"
          description={`No results matching "${query}" in ${activeCategory === 'all' ? 'any category' : CATEGORY_LABELS[activeCategory]}. Try checking for spelling or searching by ID.`}
        />
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '140px' }}>Category</th>
                <th>Title / Reference</th>
                <th>Details</th>
                <th style={{ textAlign: 'right' }}>Open</th>
              </tr>
            </thead>
            <tbody>
              {filteredHits.map((hit) => {
                const Icon = CATEGORY_ICONS[hit.category] || Search;
                return (
                  <tr key={`${hit.category}-${hit.key}`}>
                    <td>
                      <span className="badge badge-slate" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Icon size={12} />
                        {CATEGORY_LABELS[hit.category]}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--ikpm-navy-900)' }}>{hit.title}</div>
                      <div className="cell-sub" style={{ fontFamily: 'monospace' }}>{hit.key}</div>
                    </td>
                    <td>
                      <div className="cell-sub">{hit.subtitle}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => navigate(hit.to)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                      >
                        Open <ExternalLink size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
