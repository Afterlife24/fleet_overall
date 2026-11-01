import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingState } from '@/components/common/EmptyState';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { appForPath, landingPathForActiveApps } from '@/constants/apps';

// Lazy load pages
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const FleetPage = lazy(() => import('@/features/fleet/FleetPage').then(m => ({ default: m.FleetPage })));
const PlannerPage = lazy(() => import('@/features/planner/PlannerPage').then(m => ({ default: m.PlannerPage })));
const WorkshopPage = lazy(() => import('@/features/workshop/WorkshopPage').then(m => ({ default: m.WorkshopPage })));
const KanbanPage = lazy(() => import('@/features/kanban/KanbanPage').then(m => ({ default: m.KanbanPage })));
const FleetMapPage = lazy(() => import('@/features/map/FleetMapPage').then(m => ({ default: m.FleetMapPage })));
const JobTrackingPage = lazy(() => import('@/features/tracking/JobTrackingPage').then(m => ({ default: m.JobTrackingPage })));
const RulesPage = lazy(() => import('@/features/rules/RulesPage').then(m => ({ default: m.RulesPage })));
const TruckTrackingPage = lazy(() => import('@/features/trucks/TruckTrackingPage').then(m => ({ default: m.TruckTrackingPage })));
const TripbaseReportPage = lazy(() => import('@/features/reports/TripbaseReportPage').then(m => ({ default: m.TripbaseReportPage })));
const SalesPortalPage = lazy(() => import('@/features/sales/SalesPortalPage').then(m => ({ default: m.SalesPortalPage })));
const CrossHirePage = lazy(() => import('@/features/crosshire/CrossHirePage').then(m => ({ default: m.CrossHirePage })));
const TransportPage = lazy(() => import('@/features/transport/TransportPage').then(m => ({ default: m.TransportPage })));
const GatePage = lazy(() => import('@/features/gate/GatePage').then(m => ({ default: m.GatePage })));
const InspectionPage = lazy(() => import('@/features/inspections/InspectionPage').then(m => ({ default: m.InspectionPage })));
const JobCardsPage = lazy(() => import('@/features/workshop/JobCardsPage').then(m => ({ default: m.JobCardsPage })));
const MandatoryChecksPage = lazy(() => import('@/features/inspections/MandatoryChecksPage').then(m => ({ default: m.MandatoryChecksPage })));
const MQDPage = lazy(() => import('@/features/inspections/MQDPage').then(m => ({ default: m.MQDPage })));
const BreakdownsPage = lazy(() => import('@/features/breakdowns/BreakdownsPage').then(m => ({ default: m.BreakdownsPage })));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then(m => ({ default: m.ReportsPage })));
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage').then(m => ({ default: m.NotificationsPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const LoginPage = lazy(() => import('@/features/auth/LoginPage').then(m => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import('@/features/auth/SignupPage').then(m => ({ default: m.SignupPage })));
const TeamPage = lazy(() => import('@/features/team/TeamPage').then(m => ({ default: m.TeamPage })));
const AppsPage = lazy(() => import('@/features/apps/AppsPage').then(m => ({ default: m.AppsPage })));
const SixSigmaPage = lazy(() => import('@/features/sixsigma/SixSigmaPage').then(m => ({ default: m.SixSigmaPage })));
const StatisticsPage = lazy(() => import('@/features/statistics/StatisticsPage').then(m => ({ default: m.StatisticsPage })));
const BranchesPage = lazy(() => import('@/features/branches/BranchesPage').then(m => ({ default: m.BranchesPage })));
const DocumentAppPage = lazy(() => import('@/features/documents/DocumentAppPage').then(m => ({ default: m.DocumentAppPage })));
const NotFoundPage = lazy(() => import('@/features/common/NotFoundPage').then(m => ({ default: m.NotFoundPage })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Guards a page by its owning app. If the page belongs to an app the current
 * company hasn't activated, redirect to the Apps screen (Odoo-style: you can't
 * open a module that isn't installed).
 */
function AppGuard({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAppActive = useOrgStore((s) => s.isAppActive);
  const roleCanAccessApp = useOrgStore((s) => s.roleCanAccessApp);
  const app = appForPath(pathname);
  if (app && !app.core && user) {
    const activated = isAppActive(user.orgId, app.id);
    const allowed = roleCanAccessApp(user.orgId, user.role, app.id, user.isOwner);
    if (!activated || !allowed) return <Navigate to="/apps" replace />;
  }
  return <>{children}</>;
}

/**
 * The "/" landing route. Single-page roles (Security, Driver, Operator,
 * Field Technician, Procurement) are sent straight to their working page
 * instead of an empty dashboard. Everyone else sees the dashboard.
 */
function HomeLanding() {
  const user = useAuthStore((s) => s.user);
  const getActiveApps = useOrgStore((s) => s.getActiveApps);
  const roleCanAccessApp = useOrgStore((s) => s.roleCanAccessApp);

  if (!user) return <Suspense fallback={<LoadingState />}><DashboardPage /></Suspense>;

  const isAdmin = user.isOwner || user.role === 'Managing Director' || user.role === 'Executive Manager';
  // An employee only lands among the apps their role can access.
  const activeIds = getActiveApps(user.orgId).filter(
    (id) => isAdmin || roleCanAccessApp(user.orgId, user.role, id, user.isOwner)
  );

  const landing = landingPathForActiveApps(activeIds);
  // Non-admins have no Apps screen; if they have no apps, show an empty notice.
  if (landing === '/apps' && !isAdmin) return <NoAppsLanding />;
  if (landing !== '/') return <Navigate to={landing} replace />;

  return <Suspense fallback={<LoadingState />}><DashboardPage /></Suspense>;
}

function NoAppsLanding() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6 text-center">
      <div>
        <p className="text-lg font-semibold text-foreground">No apps assigned yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your administrator hasn't granted you access to any apps. Please contact your company owner.
        </p>
      </div>
    </div>
  );
}

// Admin-only pages (Apps, Team, Settings). Employees are redirected home.
function AdminGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const isAdmin = !!user && (user.isOwner || user.role === 'Managing Director' || user.role === 'Executive Manager');
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Suspense fallback={<LoadingState />}><LoginPage /></Suspense>} />
        <Route path="/signup" element={<Suspense fallback={<LoadingState />}><SignupPage /></Suspense>} />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<HomeLanding />} />
          <Route path="/apps" element={<AdminGuard><Suspense fallback={<LoadingState />}><AppsPage /></Suspense></AdminGuard>} />
          <Route path="/fleet" element={<AppGuard><Suspense fallback={<LoadingState />}><FleetPage /></Suspense></AppGuard>} />
          <Route path="/planner" element={<AppGuard><Suspense fallback={<LoadingState />}><PlannerPage /></Suspense></AppGuard>} />
          <Route path="/workshop" element={<AppGuard><Suspense fallback={<LoadingState />}><WorkshopPage /></Suspense></AppGuard>} />
          <Route path="/board" element={<AppGuard><Suspense fallback={<LoadingState />}><KanbanPage /></Suspense></AppGuard>} />
          <Route path="/map" element={<AppGuard><Suspense fallback={<LoadingState />}><FleetMapPage /></Suspense></AppGuard>} />
          <Route path="/tracking" element={<AppGuard><Suspense fallback={<LoadingState />}><JobTrackingPage /></Suspense></AppGuard>} />
          <Route path="/trucks" element={<AppGuard><Suspense fallback={<LoadingState />}><TruckTrackingPage /></Suspense></AppGuard>} />
          <Route path="/transport" element={<AppGuard><Suspense fallback={<LoadingState />}><TransportPage /></Suspense></AppGuard>} />
          <Route path="/gate" element={<AppGuard><Suspense fallback={<LoadingState />}><GatePage /></Suspense></AppGuard>} />
          <Route path="/inspections/phi" element={<AppGuard><Suspense fallback={<LoadingState />}><InspectionPage type="PHI" /></Suspense></AppGuard>} />
          <Route path="/inspections/pdi" element={<AppGuard><Suspense fallback={<LoadingState />}><InspectionPage type="PDI" /></Suspense></AppGuard>} />
          <Route path="/job-cards" element={<AppGuard><Suspense fallback={<LoadingState />}><JobCardsPage /></Suspense></AppGuard>} />
          <Route path="/mandatory-checks" element={<AppGuard><Suspense fallback={<LoadingState />}><MandatoryChecksPage /></Suspense></AppGuard>} />
          <Route path="/mqd" element={<AppGuard><Suspense fallback={<LoadingState />}><MQDPage /></Suspense></AppGuard>} />
          <Route path="/breakdowns" element={<AppGuard><Suspense fallback={<LoadingState />}><BreakdownsPage /></Suspense></AppGuard>} />
          <Route path="/reports" element={<AppGuard><Suspense fallback={<LoadingState />}><ReportsPage /></Suspense></AppGuard>} />
          <Route path="/reports/tripbase" element={<AppGuard><Suspense fallback={<LoadingState />}><TripbaseReportPage /></Suspense></AppGuard>} />
          <Route path="/sales-portal" element={<AppGuard><Suspense fallback={<LoadingState />}><SalesPortalPage /></Suspense></AppGuard>} />
          <Route path="/cross-hire" element={<AppGuard><Suspense fallback={<LoadingState />}><CrossHirePage /></Suspense></AppGuard>} />
          <Route path="/six-sigma" element={<AppGuard><Suspense fallback={<LoadingState />}><SixSigmaPage /></Suspense></AppGuard>} />
          <Route path="/statistics" element={<AppGuard><Suspense fallback={<LoadingState />}><StatisticsPage /></Suspense></AppGuard>} />
          <Route path="/branches" element={<AppGuard><Suspense fallback={<LoadingState />}><BranchesPage /></Suspense></AppGuard>} />
          <Route path="/docs/quotation" element={<AppGuard><Suspense fallback={<LoadingState />}><DocumentAppPage appId="quotation" /></Suspense></AppGuard>} />
          <Route path="/docs/lpo" element={<AppGuard><Suspense fallback={<LoadingState />}><DocumentAppPage appId="lpo" /></Suspense></AppGuard>} />
          <Route path="/docs/delivery-note" element={<AppGuard><Suspense fallback={<LoadingState />}><DocumentAppPage appId="delivery_note" /></Suspense></AppGuard>} />
          <Route path="/docs/collection-note" element={<AppGuard><Suspense fallback={<LoadingState />}><DocumentAppPage appId="collection_note" /></Suspense></AppGuard>} />
          <Route path="/docs/invoice" element={<AppGuard><Suspense fallback={<LoadingState />}><DocumentAppPage appId="invoice" /></Suspense></AppGuard>} />
          <Route path="/docs/soa" element={<AppGuard><Suspense fallback={<LoadingState />}><DocumentAppPage appId="soa" /></Suspense></AppGuard>} />
          <Route path="/docs/payment-receipt" element={<AppGuard><Suspense fallback={<LoadingState />}><DocumentAppPage appId="payment_receipt" /></Suspense></AppGuard>} />
          <Route path="/notifications" element={<Suspense fallback={<LoadingState />}><NotificationsPage /></Suspense>} />
          <Route path="/users" element={<Navigate to="/team" replace />} />
          <Route path="/settings" element={<AdminGuard><Suspense fallback={<LoadingState />}><SettingsPage /></Suspense></AdminGuard>} />
          <Route path="/rules" element={<Suspense fallback={<LoadingState />}><RulesPage /></Suspense>} />
          <Route path="/team" element={<AdminGuard><Suspense fallback={<LoadingState />}><TeamPage /></Suspense></AdminGuard>} />
        </Route>
        <Route path="*" element={<Suspense fallback={<LoadingState />}><NotFoundPage /></Suspense>} />
      </Routes>
    </BrowserRouter>
  );
}
