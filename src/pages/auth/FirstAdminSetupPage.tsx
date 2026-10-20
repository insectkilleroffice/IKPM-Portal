import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, KeyRound, CheckCircle, ArrowRight, Lock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';

export const FirstAdminSetupPage: React.FC = () => {
  const { setupFirstAdmin, isInitialized } = useAuth();
  const { success, error } = useNotification();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('Salman (CEO & Founder)');
  const [email, setEmail] = useState('salman@insectkiller.pk');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupKey, setSetupKey] = useState('IKPM-2026-PAKISTAN-SECURE');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      error('Passwords Do Not Match', 'Please confirm your administrator password.');
      return;
    }
    if (password.length < 6) {
      error('Password Too Short', 'Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      await setupFirstAdmin(email, password, displayName, setupKey);
      success('First Administrator Initialized!', 'Welcome Salman. The portal is now securely initialized.');
      navigate('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Setup failed';
      error('Setup Failed', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--ikpm-navy-900)',
        padding: '1.5rem',
        backgroundImage: 'radial-gradient(circle at 50% 20%, rgba(16, 185, 129, 0.15) 0%, transparent 60%)',
      }}
    >
      <div
        className="card animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '520px',
          padding: '2.5rem',
          backgroundColor: '#FFFFFF',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '54px',
              height: '54px',
              borderRadius: 'var(--radius-lg)',
              backgroundColor: 'var(--ikpm-navy-800)',
              color: 'var(--ikpm-emerald-400)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--shadow-glow-emerald)',
              marginBottom: '1rem',
            }}
          >
            <ShieldAlert size={30} />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', letterSpacing: '-0.02em' }}>
            First-Administrator Setup
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Secure one-time bootstrap wizard for Insect Killer Pest Management (IKPM)
          </p>
        </div>

        <div
          style={{
            padding: '0.85rem 1rem',
            backgroundColor: 'var(--ikpm-emerald-50)',
            border: '1px solid var(--ikpm-emerald-100)',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.8rem',
            color: '#065F46',
            marginBottom: '1.5rem',
            display: 'flex',
            gap: '0.65rem',
            alignItems: 'flex-start',
          }}
        >
          <CheckCircle size={18} color="var(--ikpm-emerald-600)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Least-Privilege Security Notice:</strong> Public user registration does not grant administrative privileges.
            This wizard creates the master Super Administrator account and permanently seals self-privilege elevation.
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">
              Administrator Full Name <span className="required">*</span>
            </label>
            <input
              type="text"
              required
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Salman (CEO)"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Official Email Address <span className="required">*</span>
            </label>
            <input
              type="email"
              required
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="salman@insectkiller.pk"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">
                Master Password <span className="required">*</span>
              </label>
              <input
                type="password"
                required
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Confirm Password <span className="required">*</span>
              </label>
              <input
                type="password"
                required
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Initialization Bootstrap Key <span className="required">*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                required
                className="form-input"
                value={setupKey}
                onChange={(e) => setSetupKey(e.target.value)}
                placeholder="IKPM-2026-PAKISTAN-SECURE"
                style={{ paddingLeft: '2.4rem' }}
              />
              <KeyRound size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Provided in master setup instructions. Protects against unauthorized bootstrap.
            </p>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
            style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem' }}
          >
            <Lock size={16} />
            <span>{isSubmitting ? 'Initializing Super Admin...' : 'Claim Super Admin & Initialize'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.825rem' }}>
          <a href="/login" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
            Already set up? Go to Sign In
          </a>
        </div>
      </div>
    </div>
  );
};
