import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { RoleSimulatorBanner } from '../common/RoleSimulatorBanner';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { dataService } from '../../services/dataService';
import { useNotification } from '../../contexts/NotificationContext';

/** Surfaces failed Firestore writes as a toast (throttled so a burst shows once). */
function useCloudErrorToasts() {
  const { error } = useNotification();
  const last = useRef(0);
  useEffect(
    () =>
      dataService.onWriteError((e) => {
        if (Date.now() - last.current < 4000) return;
        last.current = Date.now();
        error('Not saved to the cloud', e.message);
      }),
    [error]
  );
}

export const AppLayout: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useCloudErrorToasts();

  // Close the mobile drawer whenever the route changes
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="app-container">
      <Sidebar mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <div className={`sidebar-backdrop ${mobileOpen ? 'show' : ''}`} onClick={() => setMobileOpen(false)} />

      <div className="main-wrapper">
        <RoleSimulatorBanner />
        <Header onMenu={() => setMobileOpen(true)} />

        <main className="content-area">
          {/* Keep sidebar & header on screen while a lazy page chunk loads */}
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<LoadingSpinner message="Loading…" />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
};
