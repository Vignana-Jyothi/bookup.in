/**
 * CalUp — Main Application
 * Routing, providers, and app shell
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { StoreProvider, useAuth, useStore } from './data/store';
import { onboardingService } from './services/merchant/onboardingService';
import { isSupabaseConfigured } from './services/supabase/supabaseClient';
import { isCalupAdmin } from './services/supabase/adminMfa.js';
import Admin, { AdminRoute } from './pages/Admin.jsx';

import { LEGAL_PAGES } from './data/legalContent';

/* Disabled navigation enhancement (user request):
const NotFound = lazy(() => import('./pages/NotFound.jsx'));
*/
const LegalPage = lazy(() => import('./pages/LegalPage.jsx'));
const SubscriptionHero = lazy(() => import('./pages/SubscriptionHero.jsx'));

// Pages
import Landing from './pages/Landing';
import { Login, Signup } from './pages/Auth';
import Onboarding from './pages/Onboarding';
import PasswordRecovery from './pages/PasswordRecovery';

// Dashboard
import DashboardLayout from './layouts/DashboardLayout';
import Overview from './pages/dashboard/Overview';
import Appointments from './pages/dashboard/Appointments';
import Services from './pages/dashboard/Services';
import Availability from './pages/dashboard/Availability';
import BookingPageMgmt from './pages/dashboard/BookingPageMgmt';
import Policies from './pages/dashboard/Policies';
import Analytics from './pages/dashboard/Analytics';
import Settings from './pages/dashboard/Settings';
import Subscription from './pages/dashboard/Subscription';
import Support from './pages/dashboard/Support';
import CommerceCatalog from './pages/booking/CommerceCatalog.jsx';

// Booking
import PublicBookingPage from './pages/booking/BookingPage';
import CustomerBooking from './pages/booking/CustomerBooking';
import CashfreePaymentStatus from './pages/booking/CashfreePaymentStatus';

// Components & Context
import ErrorBoundary from './components/ui/ErrorBoundary';
import NotificationViewport from './components/ui/NotificationViewport';
import { ThemeProvider } from './context/ThemeContext';

// Styles
import './styles/global.css';
import './styles/components.css';

function ProtectedRoute({ children }) {
  const auth = useAuth();
  if (auth.loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-subtle, #f8fafc)'
      }}>
        <div className="spinner" />
      </div>
    );
  }
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (isCalupAdmin(auth.user)) return <Navigate to="/admin" replace />;
  return children;
}

function RouteLoading() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--color-bg-subtle, #f8fafc)' }}>
      <div className="spinner" />
    </div>
  );
}

function useDurableOnboardingStatus(userId, localCompleted) {
  const [result, setResult] = useState({ userId: null, status: null });

  useEffect(() => {
    if (!userId || !isSupabaseConfigured()) return undefined;
    let active = true;
    onboardingService.load()
      .then(onboarding => {
        const identityReady = Boolean(onboarding?.identity?.emailVerified && onboarding?.identity?.phoneVerified);
        if (active) setResult({ userId, status: onboarding?.status === 'completed' && identityReady ? 'completed' : 'incomplete' });
      })
      .catch(error => {
        console.error('Could not verify onboarding access:', error);
        if (active) setResult({ userId, status: 'incomplete' });
      });
    return () => { active = false; };
  }, [userId]);

  if (!isSupabaseConfigured()) return localCompleted ? 'completed' : 'incomplete';
  return result.userId === userId ? result.status : null;
}

function AuthRoute({ children }) {
  const auth = useAuth();
  const { state } = useStore();
  const onboardingStatus = useDurableOnboardingStatus(isCalupAdmin(auth.user) ? null : auth.user?.id, state.onboarding.completed);
  if (!auth.loading && isCalupAdmin(auth.user)) return <Navigate to="/admin" replace />;
  if (auth.loading || (auth.isAuthenticated && !onboardingStatus)) return <RouteLoading />;
  if (auth.isAuthenticated && !auth.isDemoMode) {
    return <Navigate to={onboardingStatus === 'completed' ? '/dashboard' : '/onboarding'} replace />;
  }
  return children;
}

function DashboardRoute({ children }) {
  const auth = useAuth();
  const { state } = useStore();
  const onboardingStatus = useDurableOnboardingStatus(isCalupAdmin(auth.user) ? null : auth.user?.id, state.onboarding.completed);
  if (!auth.loading && isCalupAdmin(auth.user)) return <Navigate to="/admin" replace />;
  if (auth.loading || (auth.isAuthenticated && !onboardingStatus)) return <RouteLoading />;
  if (!auth.isAuthenticated) return <Navigate to="/login" replace />;
  if (onboardingStatus !== 'completed') return <Navigate to="/onboarding" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/subscriptions" element={<Suspense fallback={<RouteLoading />}><SubscriptionHero /></Suspense>} />
      {LEGAL_PAGES.map(page => <Route key={page.slug} path={`/${page.slug}`} element={<Suspense fallback={<RouteLoading />}><LegalPage slug={page.slug} /></Suspense>} />)}
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<PasswordRecovery key="request" />} />
      <Route path="/reset-password" element={<PasswordRecovery key="reset" reset />} />
      <Route path="/signup" element={<AuthRoute><Signup /></AuthRoute>} />
      <Route path="/onboarding" element={
        <ProtectedRoute>
          <Onboarding />
        </ProtectedRoute>
      } />

      {/* Public booking page & Customer management / tracking */}
      <Route path="/book/:slug" element={
        <ErrorBoundary title="Booking page error, please refresh">
          <PublicBookingPage />
        </ErrorBoundary>
      } />
      <Route path="/track/:token" element={
        <ErrorBoundary title="Something went wrong, please refresh">
          <CustomerBooking />
        </ErrorBoundary>
      } />
      <Route path="/track/:id" element={
        <ErrorBoundary title="Something went wrong, please refresh">
          <CustomerBooking />
        </ErrorBoundary>
      } />
      <Route path="/track" element={
        <ErrorBoundary title="Something went wrong, please refresh">
          <CustomerBooking />
        </ErrorBoundary>
      } />
      <Route path="/booking-status/:token" element={
        <ErrorBoundary title="Something went wrong, please refresh">
          <CustomerBooking />
        </ErrorBoundary>
      } />
      <Route path="/booking-status/:id" element={
        <ErrorBoundary title="Something went wrong, please refresh">
          <CustomerBooking />
        </ErrorBoundary>
      } />
      <Route path="/booking-status" element={
        <ErrorBoundary title="Something went wrong, please refresh">
          <CustomerBooking />
        </ErrorBoundary>
      } />
      <Route path="/booking-details" element={
        <ErrorBoundary title="Something went wrong, please refresh">
          <CustomerBooking />
        </ErrorBoundary>
      } />
      <Route path="/payment-status" element={
        <ErrorBoundary title="Payment status error, please refresh">
          <CashfreePaymentStatus />
        </ErrorBoundary>
      } />
      <Route path="/manage/:token" element={
        <ErrorBoundary title="Something went wrong, please refresh">
          <CustomerBooking />
        </ErrorBoundary>
      } />
      <Route path="/booking/:token" element={
        <ErrorBoundary title="Something went wrong, please refresh">
          <CustomerBooking />
        </ErrorBoundary>
      } />
      <Route path="/booking/:id" element={
        <ErrorBoundary title="Something went wrong, please refresh">
          <CustomerBooking />
        </ErrorBoundary>
      } />

      {/* Dashboard (protected) */}
      <Route path="/book/:slug/marketplace" element={<CommerceCatalog kind="product" />} />
      <Route path="/book/:slug/memberships" element={<CommerceCatalog kind="membership" />} />
      <Route path="/dashboard" element={
        <DashboardRoute>
          <DashboardLayout />
        </DashboardRoute>
      }>
        <Route index element={<Overview />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="services" element={<Services />} />
        <Route path="availability" element={<Availability />} />
        <Route path="booking-page" element={<BookingPageMgmt />} />
        <Route path="policies" element={<Policies />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="subscription" element={<Subscription />} />
        <Route path="support" element={<Support />} />
      </Route>

      {/* Catch-all */}
      <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
      <Route path="/support/admin" element={<AdminRoute><Navigate to="/admin?section=support" replace /></AdminRoute>} />
      {/* Disabled navigation enhancement (user request):
<Route path="*" element={<Suspense fallback={<RouteLoading />}><NotFound /></Suspense>} />
*/}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <StoreProvider>
          <BrowserRouter>
            <AppRoutes />
            <NotificationViewport />
          </BrowserRouter>
        </StoreProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
