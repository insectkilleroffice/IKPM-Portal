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
        // Name the record so a refused save can be traced (e.g. "service_jobs/JOB-…")
        const where = e.collection ? ` [${e.collection}${e.id ? `/${e.id}` : ''}${e.fields?.length ? ` · fields: ${e.fields.join(', ')}` : ''}]` : '';
        if (e.code !== 'permission-denied') return error('Not saved to the cloud', `${e.message}${where}`);
        // Refused: say whether the live database still has old rules (the usual cause)
        dataService.rulesAreCurrent().then((current) => {
          if (current === false) {
            error('Not saved: database rules are out of date',
              dataService.isSuperAdminSession()
                ? `The live Firebase rules are older than this portal. Publish firestore.rules (Firebase Console → Firestore → Rules → Publish).${where}`
                : 'The system is being updated. Please tell the administrator and try again shortly.');
          } else {
            // Plain reason for everyone; technical details only for the super admin
            dataService.explainAccess(e.collection, e.id, e.fields).then(({ reason, details }) =>
              error('Not saved: not allowed',
                dataService.isSuperAdminSession() ? `${reason}${where} — ${details}` : reason));
          }
        });
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
