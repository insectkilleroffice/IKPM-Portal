import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { SyncProvider } from './contexts/SyncContext';

import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { LoadingSpinner } from './components/common/LoadingSpinner';

// Pages are code-split per route so the first load stays small
const LoginPage = lazy(() => import('./pages/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const FirstAdminSetupPage = lazy(() => import('./pages/auth/FirstAdminSetupPage').then((m) => ({ default: m.FirstAdminSetupPage })));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const CustomerListPage = lazy(() => import('./pages/customers/CustomerListPage').then((m) => ({ default: m.CustomerListPage })));
const CompanyDetailPage = lazy(() => import('./pages/customers/CompanyDetailPage').then((m) => ({ default: m.CompanyDetailPage })));
const BranchDetailPage = lazy(() => import('./pages/customers/BranchDetailPage').then((m) => ({ default: m.BranchDetailPage })));
const IndividualDetailPage = lazy(() => import('./pages/customers/IndividualDetailPage').then((m) => ({ default: m.IndividualDetailPage })));
const LeadsListPage = lazy(() => import('./pages/crm/LeadsListPage').then((m) => ({ default: m.LeadsListPage })));
const ProposalsListPage = lazy(() => import('./pages/proposals/ProposalsListPage').then((m) => ({ default: m.ProposalsListPage })));
const ContractsListPage = lazy(() => import('./pages/contracts/ContractsListPage').then((m) => ({ default: m.ContractsListPage })));
const JobsListPage = lazy(() => import('./pages/operations/JobsListPage').then((m) => ({ default: m.JobsListPage })));
const DispatchCalendarPage = lazy(() => import('./pages/operations/DispatchCalendarPage').then((m) => ({ default: m.DispatchCalendarPage })));
const InvoicesListPage = lazy(() => import('./pages/finance/InvoicesListPage').then((m) => ({ default: m.InvoicesListPage })));
const TaxRulesPage = lazy(() => import('./pages/finance/TaxRulesPage').then((m) => ({ default: m.TaxRulesPage })));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PcoMobilePage = lazy(() => import('./pages/pco/PcoMobilePage').then((m) => ({ default: m.PcoMobilePage })));
const DocumentLibraryPage = lazy(() => import('./features/documents/DocumentLibraryPage').then((m) => ({ default: m.DocumentLibraryPage })));

function App() {
  return (
    <BrowserRouter>
      <NotificationProvider>
        <SyncProvider>
          <AuthProvider>
            <Suspense fallback={<LoadingSpinner fullPage />}>
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
                <Route path="/documents" element={<DocumentLibraryPage />} />

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
            </Suspense>
          </AuthProvider>
        </SyncProvider>
      </NotificationProvider>
    </BrowserRouter>
  );
}

export default App;
