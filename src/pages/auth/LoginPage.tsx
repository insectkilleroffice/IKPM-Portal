import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowRight, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';

const authError = (err: unknown) => {
  const code = (err as { code?: string }).code || '';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(code)) {
    return 'Email or password is incorrect.';
  }
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes or reset your password.';
  if (code === 'auth/network-request-failed') return 'No internet connection.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  return err instanceof Error ? err.message : 'Sign-in failed';
};

export const LoginPage: React.FC = () => {
  const { login, resetPassword, isInitialized, currentUser, isLoading: authLoading } = useAuth();
  const { success, error } = useNotification();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [problem, setProblem] = useState('');

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';

  // Already signed in (e.g. after reload): go straight to the portal
  useEffect(() => {
    if (!authLoading && currentUser) navigate(from, { replace: true });
  }, [authLoading, currentUser, from, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem('');
    setBusy(true);
    try {
      if (mode === 'reset') {
        await resetPassword(email);
        success('Check your inbox', `If ${email} has a portal account, a password-reset link is on its way.`);
        setMode('signin');
      } else {
        await login(email, password);
        navigate(from, { replace: true });
      }
    } catch (err) {
      const msg = authError(err);
      setProblem(msg);
      if (mode === 'reset') error('Could not send reset email', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 440 }}>
        <form className="auth-card animate-fade-in" onSubmit={handleSubmit}>
          <img src="/ik_logo.svg" alt="Insect Killer Pest Management" className="auth-logo" />
          <h1 className="auth-title">{mode === 'reset' ? 'Reset your password' : 'Sign in'}</h1>
          <p className="auth-subtitle">
            {mode === 'reset' ? 'We’ll email you a link to choose a new password.' : 'IKPM Business Portal: use your work email'}
          </p>

          {!isInitialized && mode === 'signin' && (
            <div className="info-hint" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <span>No administrator yet. Set up the owner account first.</span>
              <Link to="/setup-first-admin" className="btn btn-sm btn-primary">Set up</Link>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="login-email">Work email</label>
            <div className="input-with-icon">
              <Mail size={16} />
              <input
                id="login-email"
                type="email"
                className="form-input"
                placeholder="name@insectkiller.pk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </div>
          </div>

          {mode === 'signin' && (
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label className="form-label" htmlFor="login-password">Password</label>
                <button
                  type="button"
                  onClick={() => { setMode('reset'); setProblem(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--ikpm-blue-600)', fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer' }}
                >
                  Forgot password?
                </button>
              </div>
              <div className="input-with-icon">
                <Lock size={16} />
                <input
                  id="login-password"
                  type="password"
                  className="form-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>
          )}

          {problem && <div className="error-hint" style={{ marginBottom: '1rem' }}>{problem}</div>}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', height: 42 }} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
            {!busy && <ArrowRight size={16} />}
          </button>

          {mode === 'reset' && (
            <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: '0.5rem' }} onClick={() => setMode('signin')}>
              Back to sign in
            </button>
          )}
        </form>

        <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <ShieldCheck size={14} /> Accounts are created by your super admin. Access depends on your role and team.
        </p>
      </div>
    </div>
  );
};
