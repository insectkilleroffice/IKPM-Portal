import React from 'react';

/** Red message under a form field. Renders nothing when there is no problem. */
export const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? (
    <div role="alert" style={{ color: 'var(--ikpm-rose-600, #DC2626)', fontSize: '0.74rem', marginTop: 4 }}>
      {message}
    </div>
  ) : null;
