import React from 'react';
import { MessageCircle, Mail } from 'lucide-react';
import { useDataStore } from '../../hooks/useDataStore';
import { formatDateTime } from '../../lib/formatters';
import type { OutreachLog } from '../../types/document';

interface Props {
  related?: { kind: OutreachLog['related']['kind']; id: string };
  limit?: number;
  emptyText?: string;
}

const STATUS_LABEL: Record<OutreachLog['status'], string> = {
  sent: 'Delivered by API',
  opened: 'Opened for sending',
  failed: 'Failed',
};

export const OutreachHistory: React.FC<Props> = ({ related, limit = 10, emptyText = 'Nothing shared yet.' }) => {
  const store = useDataStore();
  const logs = store.getOutreachLogs(related).slice(0, limit);

  if (logs.length === 0) return <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{emptyText}</div>;

  return (
    <div className="timeline">
      {logs.map((l) => (
        <div key={l.id} className="timeline-item">
          <div className={`timeline-icon ${l.channel}`}>
            {l.channel === 'whatsapp' ? <MessageCircle size={13} /> : <Mail size={13} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>
              {l.attachmentUrls.length} document(s) → {l.recipientName}
              <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> ({l.recipient})</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {formatDateTime(l.sentAt)} • {l.sentByName} •{' '}
              <span style={{ color: l.status === 'failed' ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                {STATUS_LABEL[l.status]}
              </span>
              {!related && ` • ${l.related.title}`}
            </div>
            {l.error && <div style={{ fontSize: '0.72rem', color: 'var(--ikpm-rose-500)' }}>{l.error}</div>}
          </div>
        </div>
      ))}
    </div>
  );
};
