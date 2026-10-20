import React, { useState } from 'react';
import { Modal } from './Modal';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  isDestructive?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm Action',
  requireReason = false,
  reasonLabel = 'Reason for this change / action (Audit-logged):',
  isDestructive = true,
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleConfirm = () => {
    if (requireReason && !reason.trim()) {
      setError('Please provide a mandatory reason before confirming.');
      return;
    }
    onConfirm(reason);
    setReason('');
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="480px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${isDestructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start' }}>
        <div style={{ color: isDestructive ? 'var(--ikpm-rose-500)' : 'var(--ikpm-amber-500)', marginTop: '2px' }}>
          <AlertTriangle size={24} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>{message}</p>

          {requireReason && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">
                {reasonLabel} <span className="required">*</span>
              </label>
              <textarea
                className="form-textarea"
                rows={3}
                placeholder="Enter authorized justification..."
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError('');
                }}
              />
              {error && <p style={{ fontSize: '0.75rem', color: 'var(--ikpm-rose-500)', marginTop: '4px' }}>{error}</p>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
