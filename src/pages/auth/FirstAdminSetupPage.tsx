import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { KeyRound, Lock, Mail, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';

/**
 * One-time bootstrap: makes the owner the super admin. Works for a brand-new email or for a login
 * that already exists in Firebase Authentication. Locked by firestore.rules once initialized.
 */
export const FirstAdminSetupPage: React.FC = () => {
  const { setupFirstAdmin, isInitialized } = useAuth();
  const { success } = useNotification();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  if (isInitialized) return <Navigate to="/login" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem('');
    if (password.length < 6) {
      setProblem('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      await setupFirstAdmin(email, password, displayName, setupKey);
      success('Portal initialized', 'You are now the super admin. Add your staff under Team & Access.');
      navigate('/admin/team', { replace: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      setProblem(
        code === 'auth/invalid-credential' || code === 'auth/wrong-password'
          ? 'This email already has a login, and that password is wrong. Use its current password.'
          : err instanceof Error ? err.message : 'Setup failed'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="auth-card animate-fade-in" onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
        <img src="/ik_logo.svg" alt="Insect Killer Pest Management" className="auth-logo" />
        <h1 className="auth-title">Set up the owner account</h1>
        <p className="auth-subtitle">
          This one-time step makes you the super admin. If you already created a login, enter that same email and password.
        </p>

        <div className="form-group">
          <label className="form-label">Your name</label>
          <div className="input-with-icon">
            <User size={16} />
            <input className="form-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Salman Ahmed" required autoFocus />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Work email</label>
          <div className="input-with-icon">
            <Mail size={16} />
            <input type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@insectkiller.pk" autoComplete="username" required />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Password</label>
          <div className="input-with-icon">
            <Lock size={16} />
            <input type="password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Initialization key</label>
          <div className="input-with-icon">
            <KeyRound size={16} />
            <input className="form-input font-mono" value={setupKey} onChange={(e) => setSetupKey(e.target.value)} placeholder="Provided with your installation" required />
          </div>
        </div>

        {problem && <div className="error-hint" style={{ marginBottom: '1rem' }}>{problem}</div>}

        <button type="submit" className="btn btn-primary" style={{ width: '100%', height: 42 }} disabled={busy}>
          {busy ? 'Setting up…' : 'Become super admin'}
        </button>
        <div style={{ textAlign: 'center', marginTop: '0.85rem', fontSize: '0.8rem' }}>
          <Link to="/login">Back to sign in</Link>
        </div>
      </form>
    </div>
  );
};
