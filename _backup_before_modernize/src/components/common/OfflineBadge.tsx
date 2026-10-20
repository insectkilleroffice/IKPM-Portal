import React from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';

export const OfflineBadge: React.FC = () => {
  const { isOnline, pendingCount, isSyncing, triggerSync } = useSync();

  if (!isOnline) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.45rem',
          padding: '0.35rem 0.75rem',
          backgroundColor: 'var(--ikpm-amber-100)',
          color: '#92400E',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: 700,
          border: '1px solid #FCD34D',
        }}
      >
        <WifiOff size={14} />
        <span>Offline ({pendingCount} Local Drafts)</span>
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <button
        onClick={triggerSync}
        disabled={isSyncing}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.45rem',
          padding: '0.35rem 0.75rem',
          backgroundColor: 'var(--ikpm-emerald-100)',
          color: '#065F46',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: 700,
          border: '1px solid #A7F3D0',
          cursor: 'pointer',
        }}
      >
        <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
        <span>{isSyncing ? 'Syncing...' : `Sync Pending (${pendingCount})`}</span>
      </button>
    );
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding: '0.35rem 0.65rem',
        backgroundColor: 'rgba(16, 185, 129, 0.08)',
        color: 'var(--ikpm-emerald-600)',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
      }}
      title="Connected to Firebase Cloud Database"
    >
      <Wifi size={13} />
      <span>Online</span>
    </div>
  );
};
