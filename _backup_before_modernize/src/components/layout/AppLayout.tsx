import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { RoleSimulatorBanner } from '../common/RoleSimulatorBanner';

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
          <Outlet />
        </main>
      </div>
    </div>
  );
};
