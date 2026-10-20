import React from 'react';
import { Eye, Download, Trash2, FileText, Image as ImageIcon, HardDrive } from 'lucide-react';
import { downloadUrl, formatBytes } from '../../lib/cloudinary';
import { formatDate } from '../../lib/formatters';
import type { PortalDocument } from '../../types/document';
import { categoryLabel, expiryState } from './documentUtils';

interface Props {
  documents: PortalDocument[];
  onRemove?: (doc: PortalDocument) => void;
  showCategory?: boolean;
}

const ExpiryBadge: React.FC<{ doc: PortalDocument }> = ({ doc }) => {
  const state = expiryState(doc);
  if (state === 'none') return <span style={{ color: 'var(--text-muted)' }}>No expiry</span>;
  const cls = state === 'expired' ? 'badge-rose' : state === 'expiring' ? 'badge-amber' : 'badge-emerald';
  const label = state === 'expired' ? 'Expired' : state === 'expiring' ? 'Expiring' : 'Valid';
  return (
    <span className={`badge-status ${cls}`} title={`Valid until ${formatDate(doc.expiryDate)}`}>
      {label} · {formatDate(doc.expiryDate)}
    </span>
  );
};

export const DocumentTable: React.FC<Props> = ({ documents, onRemove, showCategory = true }) => (
  <div className="table-container">
    <table className="data-table">
      <thead>
        <tr>
          <th>Document</th>
          {showCategory && <th>Category</th>}
          <th>Validity</th>
          <th>Uploaded</th>
          <th style={{ width: 120 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((d) => (
          <tr key={d.id}>
            <td>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                {d.file.fileType.startsWith('image/') ? (
                  <ImageIcon size={16} color="var(--ikpm-teal-500)" />
                ) : (
                  <FileText size={16} color="var(--ikpm-emerald-600)" />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{d.title}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {d.file.fileName} • {formatBytes(d.file.fileSize)}
                    {d.issuedBy ? ` • ${d.issuedBy}` : ''}
                    {d.file.storage === 'local' && (
                      <span title="Stored on this device only — configure Cloudinary to share via link">
                        {' '}• <HardDrive size={10} /> local
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </td>
            {showCategory && <td><span className="badge-status badge-slate">{categoryLabel(d.category)}</span></td>}
            <td><ExpiryBadge doc={d} /></td>
            <td style={{ fontSize: '0.78rem' }}>
              {formatDate(d.uploadedAt)}
              <div style={{ color: 'var(--text-muted)' }}>{d.uploadedByName}</div>
            </td>
            <td>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <a className="icon-btn" href={d.file.url} target="_blank" rel="noreferrer" title="View">
                  <Eye size={14} />
                </a>
                <a className="icon-btn" href={downloadUrl(d.file)} download={d.file.fileName} target="_blank" rel="noreferrer" title="Download">
                  <Download size={14} />
                </a>
                {onRemove && (
                  <button className="icon-btn danger" title="Remove from portal" onClick={() => onRemove(d)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
