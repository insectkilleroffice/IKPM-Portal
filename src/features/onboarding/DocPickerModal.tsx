import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { formatDate } from '../../lib/formatters';
import type { PortalDocument } from '../../types/document';

interface Props {
  title: string;
  subtitle?: string;
  documents: PortalDocument[];
  selected: string[];
  multiple?: boolean;
  emptyText: string;
  onClose: () => void;
  onSave: (ids: string[]) => void;
}

/** Pick documents for an onboarding item (MSDS, certificate, SOP, layout). */
export const DocPickerModal: React.FC<Props> = ({ title, subtitle, documents, selected, multiple, emptyText, onClose, onSave }) => {
  const [ids, setIds] = useState<string[]>(selected);
  const [q, setQ] = useState('');
  const visible = documents.filter((d) => `${d.title} ${d.file.fileName}`.toLowerCase().includes(q.toLowerCase().trim()));
  const toggle = (id: string) => setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : multiple ? [...prev, id] : [id]));

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      maxWidth="560px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(ids)}>Use {ids.length || 'none'}</button>
        </>
      }
    >
      {documents.length === 0 ? (
        <div className="empty-hint">{emptyText}</div>
      ) : (
        <>
          <div className="drive-search" style={{ marginBottom: '0.75rem' }}>
            <Search size={15} color="var(--text-muted)" />
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="doc-check-list">
            {visible.map((d) => (
              <label key={d.id} className="doc-check">
                <input type={multiple ? 'checkbox' : 'radio'} name="doc-pick" checked={ids.includes(d.id)} onChange={() => toggle(d.id)} />
                <span style={{ flex: 1 }}>{d.title}<span className="cell-sub"> · {d.file.fileName} · {formatDate(d.uploadedAt)}</span></span>
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
};

export default DocPickerModal;
