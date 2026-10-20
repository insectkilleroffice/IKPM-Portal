import React from 'react';

interface StatusBadgeProps {
  status: string;
  type?: 'lead' | 'proposal' | 'job' | 'invoice' | 'contract' | 'general';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const normalized = status.toLowerCase().replace(/_/g, ' ');

  let badgeClass = 'badge-slate';

  if (['active', 'won', 'approved', 'accepted', 'completed', 'paid', 'verified'].includes(status.toLowerCase())) {
    badgeClass = 'badge-emerald';
  } else if (['pending_approval', 'inspection_scheduled', 'in_progress', 'partially_paid', 'negotiation', 'scheduled'].includes(status.toLowerCase())) {
    badgeClass = 'badge-amber';
  } else if (['lost', 'rejected', 'cancelled', 'declined', 'expired', 'void_reversed'].includes(status.toLowerCase())) {
    badgeClass = 'badge-rose';
  } else if (['sent', 'sent_to_client', 'en_route', 'posted', 'new', 'contacted', 'qualified'].includes(status.toLowerCase())) {
    badgeClass = 'badge-navy';
  }

  return (
    <span className={`badge-status ${badgeClass}`}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'currentColor', display: 'inline-block' }} />
      {normalized}
    </span>
  );
};
