import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, ExternalLink, Calendar, User, Building2, Eye, Download, X } from 'lucide-react';
import { useDataStore } from '../../hooks/useDataStore';
import { formatDate } from '../../lib/formatters';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { EmptyState } from '../../components/common/EmptyState';
import { Modal } from '../../components/common/Modal';
import type { Challan } from '../../types/operations';

export const ChallansPage: React.FC = () => {
  const store = useDataStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [previewChallan, setPreviewChallan] = useState<Challan | null>(null);

  const challans = store.getChallans();
  const companies = store.getCompanies();

  const filtered = challans.filter((c) => {
    const key = (query || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchNumber = !key || c.challanKey.includes(key) || c.challanNumber.toLowerCase().includes(query.toLowerCase());
    const matchClient = clientFilter === 'all' || c.customerId === clientFilter;
    return matchNumber && matchClient;
  });

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Field operations', path: '/operations/jobs' }, { label: 'Challan Register' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Challan Register</h1>
          <p className="page-subtitle">
            Searchable register of delivery and service challans signed by clients. Uploaded by Operations/Admin during job completion or QC verification.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', flex: 1 }}>
          <div className="drive-search" style={{ minWidth: 280, maxWidth: 440 }}>
            <Search size={15} color="var(--text-muted)" />
            <input
              placeholder="Search challan # (e.g. 1042 or CH-1042)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <select
            className="form-select"
            style={{ width: 'auto', minHeight: 36 }}
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
          >
            <option value="all">All Clients</option>
            {companies.map((co) => (
              <option key={co.id} value={co.id}>{co.legalCompanyName}</option>
            ))}
          </select>
        </div>

        <span className="cell-sub">{filtered.length} challan(s) found</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No challans found"
          description={query ? 'No signed challan records match your search number or client filter.' : 'Signed service and delivery challans will appear here as jobs are completed and verified.'}
        />
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Challan #</th>
                <th>Client</th>
                <th>Linked Job</th>
                <th>Challan Date</th>
                <th>Uploaded By</th>
                <th style={{ textAlign: 'right' }}>Document</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--ikpm-navy-900)' }}>{c.challanNumber}</div>
                    <div className="cell-sub">{c.id}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
                      <Building2 size={14} color="var(--text-muted)" />
                      {c.customerName}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => navigate(`/operations/jobs?job=${c.jobId}`)}
                    >
                      {c.jobId} <ExternalLink size={12} />
                    </button>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Calendar size={13} color="var(--text-muted)" />
                      {formatDate(c.challanDate)}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }} className="cell-sub">
                      <User size={13} />
                      {c.uploadedByName}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {c.fileUrl ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}
                        onClick={() => setPreviewChallan(c)}
                      >
                        <Eye size={13} /> View Challan
                      </button>
                    ) : (
                      <span className="cell-sub">No file</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Challan Preview Modal */}
      {previewChallan && (
        <Modal
          isOpen={Boolean(previewChallan)}
          onClose={() => setPreviewChallan(null)}
          title={`Delivery Challan #${previewChallan.challanNumber}`}
          subtitle={`${previewChallan.customerName} · Linked to Job ${previewChallan.jobId} · Date: ${formatDate(previewChallan.challanDate)}`}
          maxWidth="700px"
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const job = previewChallan.jobId;
                  setPreviewChallan(null);
                  navigate(`/operations/jobs?job=${job}`);
                }}
              >
                Go to Service Job ({previewChallan.jobId})
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <a
                  href={previewChallan.fileUrl}
                  download={`Challan_${previewChallan.challanNumber}.png`}
                  className="btn btn-primary"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={14} /> Download File
                </a>
                <button type="button" className="btn btn-secondary" onClick={() => setPreviewChallan(null)}>
                  Close
                </button>
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', maxHeight: '70vh', overflowY: 'auto' }}>
            {previewChallan.fileUrl.startsWith('data:application/pdf') ? (
              <iframe src={previewChallan.fileUrl} title="Challan PDF" style={{ width: '100%', height: '500px', border: 'none' }} />
            ) : (
              <img
                src={previewChallan.fileUrl}
                alt={`Challan #${previewChallan.challanNumber}`}
                style={{ maxWidth: '100%', maxHeight: '550px', objectFit: 'contain', borderRadius: 4, border: '1px solid var(--border-subtle)' }}
              />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
