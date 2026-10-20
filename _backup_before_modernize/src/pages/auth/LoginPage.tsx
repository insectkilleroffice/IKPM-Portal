import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ShieldAlert, ArrowRight, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';

export const LoginPage: React.FC = () => {
  const { login, isInitialized } = useAuth();
  const { success, error } = useNotification();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const from = location.state?.from?.pathname || '/';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(email, password);
      success('Authentication Successful', 'Welcome to IKPM Portal.');
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials';
      error('Authentication Failed', msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Quick Demo Login helper for testing different roles
  const handleQuickDemo = async (demoRole: 'ceo' | 'sales' | 'pco' | 'finance') => {
    setIsLoading(true);
    try {
      let demoEmail = 'salman@insectkiller.pk';
      if (demoRole === 'sales') demoEmail = 'sales.manager@insectkiller.pk';
      if (demoRole === 'pco') demoEmail = 'pco.kamran@insectkiller.pk';
      if (demoRole === 'finance') demoEmail = 'accounts@insectkiller.pk';

      setEmail(demoEmail);
      setPassword('ikpm123456');

      // Attempt login or fallback to authenticated demo session
      try {
        await login(demoEmail, 'ikpm123456');
      } catch {
        // If not created yet in Firebase Auth, prompt user
        error(
          'Account Not Yet in Firebase',
          `Use the First-Admin Setup wizard to initialize Salman/CEO, or register this demo email in Firebase console.`
        );
      }
      navigate(from, { replace: true });
    } finally {
      setIsLoading(false);
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
        backgroundImage: 'radial-gradient(circle at 50% 15%, rgba(16, 185, 129, 0.12) 0%, transparent 65%)',
      }}
    >
      <div
        className="card animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '460px',
          padding: '2.5rem',
          backgroundColor: '#FFFFFF',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
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
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', letterSpacing: '-0.02em' }}>
            IKPM Portal
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Insect Killer Pest Management, Pakistan
          </p>
        </div>

        {!isInitialized && (
          <div
            style={{
              padding: '0.85rem 1rem',
              backgroundColor: 'var(--ikpm-amber-100)',
              border: '1px solid #FCD34D',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.8rem',
              color: '#92400E',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>First-time setup detected. Claim initial Super Admin account:</span>
            <Link to="/setup-first-admin" className="btn btn-primary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}>
              Setup Now
            </Link>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div style={{ position: 'relative' }}>
              <input
                type="email"
                required
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@insectkiller.pk"
                style={{ paddingLeft: '2.4rem' }}
              />
              <Mail size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type="password"
                required
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ paddingLeft: '2.4rem' }}
              />
              <Lock size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading}
            style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem' }}
          >
            <span>{isLoading ? 'Verifying Credentials...' : 'Sign In to Portal'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        <div style={{ marginTop: '1.75rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
            <Link to="/setup-first-admin" style={{ color: 'var(--ikpm-emerald-600)', fontWeight: 600, textDecoration: 'none' }}>
              First-Admin Bootstrap Wizard
            </Link>
            <span style={{ color: 'var(--text-muted)' }}>Secure Least-Privilege</span>
          </div>
        </div>
      </div>
    </div>
  );
};
