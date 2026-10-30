import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { SyncProvider } from './contexts/SyncContext';

import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import type { ModuleKey } from './lib/permissions';

/** Route element restricted to the roles allowed to use a module (see src/lib/permissions.ts). */
const guard = (module: ModuleKey | ModuleKey[], element: React.ReactNode) => <ProtectedRoute module={module}>{element}</ProtectedRoute>;

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
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const TeamAccessPage = lazy(() => import('./pages/admin/TeamAccessPage').then((m) => ({ default: m.TeamAccessPage })));
const InspectionsPage = lazy(() => import('./pages/inspections/InspectionsPage').then((m) => ({ default: m.InspectionsPage })));
const MeetingsPage = lazy(() => import('./pages/meetings/MeetingsPage').then((m) => ({ default: m.MeetingsPage })));
const ComplaintsPage = lazy(() => import('./pages/complaints/ComplaintsPage').then((m) => ({ default: m.ComplaintsPage })));
const ApprovalsPage = lazy(() => import('./pages/approvals/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })));
const DocumentLibraryPage = lazy(() => import('./features/documents/DocumentLibraryPage').then((m) => ({ default: m.DocumentLibraryPage })));
const ChallansPage = lazy(() => import('./pages/operations/ChallansPage').then((m) => ({ default: m.ChallansPage })));
const EmployeesPage = lazy(() => import('./pages/hr/EmployeesPage').then((m) => ({ default: m.EmployeesPage })));
const AttendancePage = lazy(() => import('./pages/operations/AttendancePage').then((m) => ({ default: m.AttendancePage })));
const PayrollPage = lazy(() => import('./pages/hr/PayrollPage').then((m) => ({ default: m.PayrollPage })));
const SearchPage = lazy(() => import('./pages/search/SearchPage').then((m) => ({ default: m.SearchPage })));

function App() {
  return (
    <BrowserRouter>
      <NotificationProvider>
        <SyncProvider>
          <AuthProvider>
            <ErrorBoundary>
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
                <Route path="/" element={guard('dashboard', <DashboardPage />)} />

                {/* Customers & sales pipeline */}
                <Route path="/customers" element={guard('customers', <CustomerListPage />)} />
                <Route path="/customers/company/:id" element={guard('customers', <CompanyDetailPage />)} />
                <Route path="/customers/branch/:id" element={guard('customers', <BranchDetailPage />)} />
                <Route path="/customers/individual/:id" element={guard('customers', <IndividualDetailPage />)} />
                <Route path="/crm" element={guard('crm', <LeadsListPage />)} />
                <Route path="/meetings" element={guard(['pco', 'inspections', 'crm'], <MeetingsPage />)} />
                <Route path="/inspections" element={guard(['inspections', 'crm'], <InspectionsPage />)} />
                <Route path="/proposals" element={guard('proposals', <ProposalsListPage />)} />
                <Route path="/contracts" element={guard('contracts', <ContractsListPage />)} />

                {/* Field operations */}
                <Route path="/operations/jobs" element={guard(['jobs', 'pco'], <JobsListPage />)} />
                <Route path="/operations/challans" element={guard(['challans', 'jobs', 'invoices'], <ChallansPage />)} />
                <Route path="/operations/attendance" element={guard('attendance', <AttendancePage />)} />
                <Route path="/operations/calendar" element={guard('calendar', <DispatchCalendarPage />)} />
                <Route path="/complaints" element={guard('complaints', <ComplaintsPage />)} />
                <Route path="/approvals" element={guard('approvals', <ApprovalsPage />)} />

                {/* Finance & invoicing */}
                <Route path="/finance/invoices" element={guard('invoices', <InvoicesListPage />)} />
                <Route path="/hr/payroll" element={guard('payroll', <PayrollPage />)} />

                {/* HR */}
                <Route path="/hr/employees" element={guard('hr', <EmployeesPage />)} />

                {/* Search */}
                <Route path="/search" element={guard('search', <SearchPage />)} />

                {/* Document Library */}
                <Route path="/documents" element={guard('documents', <DocumentLibraryPage />)} />

                {/* Administration */}
                <Route path="/admin/team" element={guard(['team', 'roles'], <TeamAccessPage />)} />
                <Route path="/settings" element={guard('settings', <SettingsPage />)} />
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
            </ErrorBoundary>
          </AuthProvider>
        </SyncProvider>
      </NotificationProvider>
    </BrowserRouter>
  );
}

export default App;
