import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, CheckCheck, ClipboardCheck, UserCheck, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { dataService } from '../../services/dataService';
import {
  computeNotifications,
  getReadIds,
  markAsRead,
  CATEGORY_COLOR,
  type AppNotification,
  type NotificationCategory,
} from '../../lib/notifications';
import { formatDate } from '../../lib/formatters';

const CATEGORY_ICON: Record<NotificationCategory, React.ElementType> = {
  assigned: UserCheck,
  completed: ClipboardCheck,
  action_needed: AlertTriangle,
};

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  assigned: 'Assigned',
  completed: 'Completed',
  action_needed: 'Action needed',
};

export const NotificationBell: React.FC = () => {
  const { userProfile, effectiveRole } = useAuth();
  const store = useDataStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() =>
    userProfile ? getReadIds(userProfile.uid) : new Set()
  );
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reload read state when user changes
  useEffect(() => {
    setReadIds(userProfile ? getReadIds(userProfile.uid) : new Set());
  }, [userProfile?.uid]);

  const notifications = useMemo<AppNotification[]>(() => {
    if (!userProfile || !effectiveRole) return [];
    return computeNotifications(
      store.getLeads(),
      store.getJobs(),
      userProfile,
      effectiveRole,
      dataService.getProposals()
    );
  }, [store, userProfile, effectiveRole]);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  const handleOpen = () => {
    setOpen((v) => !v);
  };

  const go = (notif: AppNotification) => {
    if (!userProfile) return;
    const updated = new Set(readIds);
    updated.add(notif.id);
    markAsRead(userProfile.uid, [notif.id]);
    setReadIds(updated);
    setOpen(false);
    navigate(notif.link);
  };

  const markAll = () => {
    if (!userProfile) return;
    const ids = notifications.map((n) => n.id);
    markAsRead(userProfile.uid, ids);
    setReadIds(new Set(ids));
  };

  if (!userProfile || !effectiveRole) return null;

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      {/* Bell button */}
      <button
        type="button"
        className="header-icon-btn"
        onClick={handleOpen}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        title="Notifications"
        style={{ position: 'relative' }}
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: 'var(--ikpm-rose-500, #F43F5E)',
              color: '#fff',
              fontSize: '0.65rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              lineHeight: 1,
              border: '2px solid var(--bg-surface, #fff)',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="dropdown-panel animate-fade-in"
          style={{ width: 340, maxHeight: 480, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.6rem 0.75rem 0.5rem',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.88rem' }}>
              <Bell size={15} />
              Notifications
              {unreadCount > 0 && (
                <span
                  style={{
                    background: 'var(--ikpm-rose-500, #F43F5E)',
                    color: '#fff',
                    borderRadius: 999,
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '1px 6px',
                  }}
                >
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAll}
                style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.2rem 0.3rem', borderRadius: 4 }}
                title="Mark all as read"
              >
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '2rem 1rem',
                  gap: '0.5rem',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                }}
              >
                <BellOff size={28} color="var(--text-muted)" />
                No pending actions
              </div>
            ) : (
              notifications.map((n) => {
                const isUnread = !readIds.has(n.id);
                const Icon = CATEGORY_ICON[n.category];
                const color = CATEGORY_COLOR[n.category];
                return (
                  <button
                    key={n.id}
                    type="button"
                    className="dropdown-item"
                    onClick={() => go(n)}
                    style={{
                      alignItems: 'flex-start',
                      gap: '0.6rem',
                      padding: '0.55rem 0.75rem',
                      background: isUnread ? 'var(--ikpm-emerald-50, #f0fdf4)' : undefined,
                      borderLeft: isUnread ? `3px solid ${color}` : '3px solid transparent',
                      width: '100%',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        background: `${color}22`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      <Icon size={15} color={color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '0.82rem',
                          fontWeight: isUnread ? 700 : 500,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {n.title}
                      </div>
                      <div
                        style={{
                          fontSize: '0.73rem',
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {n.body}
                      </div>
                      <div
                        style={{
                          fontSize: '0.68rem',
                          color: 'var(--text-muted)',
                          marginTop: 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                        }}
                      >
                        <span
                          style={{
                            background: `${color}22`,
                            color,
                            borderRadius: 3,
                            padding: '0px 4px',
                            fontSize: '0.65rem',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                          }}
                        >
                          {CATEGORY_LABEL[n.category]}
                        </span>
                        {formatDate(n.createdAt)}
                      </div>
                    </div>
                    {isUnread && (
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: color,
                          flexShrink: 0,
                          marginTop: 6,
                        }}
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
