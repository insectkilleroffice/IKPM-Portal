import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { SyncProvider } from './contexts/SyncContext';

import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

// Pages
import { LoginPage } from './pages/auth/LoginPage';
import { FirstAdminSetupPage } from './pages/auth/FirstAdminSetupPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { CustomerListPage } from './pages/customers/CustomerListPage';
import { CompanyDetailPage } from './pages/customers/CompanyDetailPage';
import { BranchDetailPage } from './pages/customers/BranchDetailPage';
import { IndividualDetailPage } from './pages/customers/IndividualDetailPage';
import { LeadsListPage } from './pages/crm/LeadsListPage';
import { ProposalsListPage } from './pages/proposals/ProposalsListPage';
import { ContractsListPage } from './pages/contracts/ContractsListPage';
import { JobsListPage } from './pages/operations/JobsListPage';
import { DispatchCalendarPage } from './pages/operations/DispatchCalendarPage';
import { InvoicesListPage } from './pages/finance/InvoicesListPage';
import { TaxRulesPage } from './pages/finance/TaxRulesPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { PcoMobilePage } from './pages/pco/PcoMobilePage';

function App() {
  return (
    <BrowserRouter>
      <NotificationProvider>
        <SyncProvider>
          <AuthProvider>
            <Routes>
              {/* Public & Bootstrap Authentication */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/setup-first-admin" element={<FirstAdminSetupPage />} />

              {/* Protected Portal Workspaces */}
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<DashboardPage />} />

                {/* Structured Customer Accounts (Highest Priority) */}
                <Route path="/customers" element={<CustomerListPage />} />
                <Route path="/customers/company/:id" element={<CompanyDetailPage />} />
                <Route path="/customers/branch/:id" element={<BranchDetailPage />} />
                <Route path="/customers/individual/:id" element={<IndividualDetailPage />} />

                {/* CRM & Proposals */}
                <Route path="/crm" element={<LeadsListPage />} />
                <Route path="/proposals" element={<ProposalsListPage />} />
                <Route path="/contracts" element={<ContractsListPage />} />

                {/* Field Operations & PCO */}
                <Route path="/operations/jobs" element={<JobsListPage />} />
                <Route path="/operations/calendar" element={<DispatchCalendarPage />} />
                <Route path="/pco-field" element={<PcoMobilePage />} />

                {/* Finance, Invoicing & Tax */}
                <Route
                  path="/finance/invoices"
                  element={
                    <ProtectedRoute allowedRoles={['super_admin', 'management', 'finance']}>
                      <InvoicesListPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/finance/tax-rules"
                  element={
                    <ProtectedRoute allowedRoles={['super_admin', 'management', 'finance']}>
                      <TaxRulesPage />
                    </ProtectedRoute>
                  }
                />

                {/* Settings & System Governance */}
                <Route path="/settings" element={<SettingsPage />} />
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </SyncProvider>
      </NotificationProvider>
    </BrowserRouter>
  );
}

export default App;
