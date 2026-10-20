import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { RoleSimulatorBanner } from '../common/RoleSimulatorBanner';
import { LoadingSpinner } from '../common/LoadingSpinner';

export const AppLayout: React.FC = () => {
  return (
    <div className="app-container">
      {/* Collapsible Left Sidebar */}
      <Sidebar />

      {/* Main Content Viewport */}
      <div className="main-wrapper" style={{ marginLeft: 'var(--sidebar-width)' }}>
        {/* Role Simulator Banner (SRS RBAC-004) */}
        <RoleSimulatorBanner />

        {/* Global Top Header */}
        <Header />

        {/* Dynamic Route Content */}
        <main className="content-area">
          {/* Keep sidebar & header on screen while a lazy page chunk loads */}
          <Suspense fallback={<LoadingSpinner message="Loading…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
};
