import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  error: Error | null;
}

/** Catches render errors (and failed page-chunk loads after a new deploy) and offers a reload. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[IKPM] Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // Navigating to another page clears the error
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = /dynamically imported module|Importing a module script failed|does not provide an export|Failed to fetch/i.test(error.message);
    return (
      <div style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>
        <AlertTriangle size={36} color="var(--ikpm-amber-500)" style={{ marginBottom: '0.75rem' }} />
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.35rem' }}>
          {stale ? 'A newer version of the portal is available' : 'Something went wrong on this page'}
        </h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: 520, margin: '0 auto 1.25rem' }}>
          {stale ? 'Reload to load the latest version.' : error.message}
        </p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          <RefreshCw size={15} /> Reload
        </button>
      </div>
    );
  }
}
