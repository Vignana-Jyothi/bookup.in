/**
 * BookUp Backend Server Entry Point
 * Runs on port 3001 and handles Google Calendar OAuth 2.0 and API synchronization.
 */

import dns from 'dns';
import express from 'express';
import cors from 'cors';
import { resetAllLimiters, setLimiterOverride } from './middleware/rateLimiter.js';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}
import { createClient } from '@supabase/supabase-js';
import { config, validateConfig } from './config.js';
import authRoutes from './routes/auth.js';
import { createAdminAuthRouter } from './routes/adminAuth.js';
import { createAdminDashboardRouter } from './routes/adminDashboard.js';
import { createAdminBookingRefundsRouter, createBookingRefundWebhookRouter } from './routes/adminBookingRefunds.js';
import { startBookingRefundWorker } from './services/bookingRefundExecution.js';
import calendarRoutes from './routes/calendar.js';
import publicBookingsRoutes from './routes/publicBookings.js';
import internalNotificationsRoutes from './routes/internalNotifications.js';
import paymentVerificationRoutes from './routes/paymentVerification.js';
import policiesRoutes from './routes/policies.js';
import refundsRoutes from './routes/refunds.js';
import { createCashfreeV1Router, createCashfreeWebhookRouter } from './routes/cashfreeV1.js';
import { startCashfreeReconciliationWorker } from './services/cashfreeReconciliation.js';
import { startGoogleCalendarSyncWorker } from './services/googleCalendarSync.js';
import merchantAppointmentsRoutes from './routes/merchantAppointments.js';
import merchantSchedulingRoutes from './routes/merchantScheduling.js';
import merchantSubscriptionRoutes from './routes/merchantSubscription.js';
import merchantOnboardingRoutes from './routes/merchantOnboarding.js';
import { startSubscriptionLifecycleWorker } from './services/subscriptionLifecycle.js';
import { createSupportTicketsRouter } from './routes/supportTickets.js';
import { startSupportLifecycleWorker } from './services/supportLifecycle.js';
import { startAppointmentWhatsAppWorker } from './services/appointmentWhatsApp.js';
import { createBookingRefundRequestsRouter } from './routes/bookingRefundRequests.js';
import { createMerchantCommerceRouter } from './routes/merchantCommerce.js';
import { createPublicCommerceRouter, createCommerceWebhookRouter } from './routes/publicCommerce.js';
import { startCommercePaymentWorker } from './services/commerceOrderPayments.js';

// Validate required environment variables at startup (fails loudly if missing)
validateConfig();

const app = express();

app.use((_req, res, next) => {
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  next();
});

// Trust reverse proxy (Render, Vercel, etc.) so rate limiting works per real client IP
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

// CORS configuration: safely allow configured frontend origins without wildcard
const allowedOrigins = [
  config.frontendUrl,
  config.corsOrigin,
]
  .filter(Boolean)
  .flatMap(str => str.split(','))
  .map(url => url.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. server-to-server, curl, health probes)
    if (!origin) return callback(null, true);

    const normalizedOrigin = origin.replace(/\/+$/, '');
    if (
      allowedOrigins.includes(normalizedOrigin) ||
      (process.env.NODE_ENV !== 'production' && (normalizedOrigin.startsWith('http://localhost:') || normalizedOrigin.startsWith('http://127.0.0.1:')))
    ) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));
// Cashfree signatures cover the untouched request body, so this route must run before JSON parsing.
app.use('/api/v1/webhooks/cashfree/payments', express.raw({ type: 'application/json', limit: '256kb' }), createCashfreeWebhookRouter());
app.use('/api/v1/webhooks/cashfree/refunds', express.raw({ type: 'application/json', limit: '256kb' }), createBookingRefundWebhookRouter());
app.use('/api/v1/webhooks/cashfree/commerce', express.raw({ type: 'application/json', limit: '256kb' }), createCommerceWebhookRouter());
app.use(express.json({ limit: '256kb' }));

// Minimal root health check endpoint (for Railway / load balancers)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth/google', authRoutes);
app.use('/api/v1/admin/auth', createAdminAuthRouter());
app.use('/api/v1/admin/dashboard', createAdminDashboardRouter());
app.use('/api/v1/admin/refund-requests', createAdminBookingRefundsRouter());
app.use('/api/calendar', calendarRoutes);
app.use('/api/policies', policiesRoutes);
app.use('/api/public', publicBookingsRoutes);
app.use('/api/public/bookings', publicBookingsRoutes);
app.use('/api/public/bookings/manage', publicBookingsRoutes);
app.use('/api/public/bookings/booking-status', publicBookingsRoutes);
app.use('/api/internal/notifications', internalNotificationsRoutes);
app.use('/api/public/bookings/manage', paymentVerificationRoutes);  // customer: mark-paid (token-authed)
app.use('/api/public/bookings/booking-status', paymentVerificationRoutes); // customer: mark-paid alias
app.use('/api/bookings', paymentVerificationRoutes);                // provider: confirm/reject (JWT-authed)
app.use('/api', refundsRoutes);                                     // refunds, disputes, admin & coach cancel/no-show
app.use('/api/v1/public', createCashfreeV1Router());                // additive Cashfree sandbox flow
app.use('/api/v1/public/bookings', publicBookingsRoutes);
app.use('/api/v1/public/bookings', paymentVerificationRoutes);
app.use('/api/v1/public/bookings', refundsRoutes);
app.use('/api/v1/merchant/appointments', merchantAppointmentsRoutes);
app.use('/api/v1/merchant/refund-requests', createBookingRefundRequestsRouter());
app.use('/api/v1/merchant/commerce', createMerchantCommerceRouter());
app.use('/api/v1/public/commerce', createPublicCommerceRouter());
app.use('/api/v1/merchant/scheduling', merchantSchedulingRoutes);
app.use('/api/v1/merchant/subscription', merchantSubscriptionRoutes);
app.use('/api/v1/merchant/onboarding', merchantOnboardingRoutes);
app.use('/api/v1/public/support/tickets', createSupportTicketsRouter('customer'));
app.use('/api/v1/merchant/support/tickets', createSupportTicketsRouter('merchant'));
app.use('/api/v1/admin/support/tickets', createSupportTicketsRouter('admin'));
app.use('/api/public/bookings/manage', refundsRoutes);             // customer: report-coach-no-show, refund-action, dispute-no-show
app.use('/api/public/bookings/booking-status', refundsRoutes);      // customer alias

// Health check endpoint
app.get('/api/health', async (req, res) => {
  let supabaseStatus = 'unconfigured';
  let supabaseError = null;
  let serviceCheck = null;

  const key = config.supabaseServiceRoleKey || config.supabaseKey;
  if (config.supabaseUrl && key) {
    try {
      const client = createClient(config.supabaseUrl, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.from('services').select('id, name, active').limit(3);
      if (error) {
        supabaseStatus = 'error';
        supabaseError = { message: error.message, code: error.code, details: error.details, hint: error.hint };
      } else {
        supabaseStatus = 'connected';
        serviceCheck = { count: data?.length, sample: data?.map(s => s.id) };
      }
    } catch (e) {
      supabaseStatus = 'exception';
      supabaseError = e.message;
    }
  }

  res.json({
    status: 'ok',
    version: 'phase4b-diagnostic-v2',
    service: 'CalUp Backend',
    uptimeSeconds: Math.floor(process.uptime()),
    googleConfigured: config.isGoogleConfigured(),
    emailConfigured: config.isEmailConfigured(),
    resendEnvKeys: Object.keys(process.env).filter(k => /resend/i.test(k)),
    richAutomateConfigured: config.isRichAutomateConfigured(),
    cashfree: {
      enabled: config.cashfreeEnabled,
      configured: config.isCashfreeConfigured(),
      environment: config.cashfreeEnvironment,
    },
    supabase: {
      status: supabaseStatus,
      host: config.supabaseUrl ? new URL(config.supabaseUrl).host : null,
      keyType: config.supabaseServiceRoleKey ? 'service_role' : (config.supabaseKey ? 'anon/publishable' : 'none'),
      keyPrefix: key ? key.substring(0, 10) + '...' : null,
      error: supabaseError,
      services: serviceCheck,
    },
    timestamp: new Date().toISOString(),
  });
});

// Test-only endpoints for rate limiter control (opt-in only, never available in production)
if (process.env.ENABLE_TEST_ROUTES === 'true') {
  app.post('/__test__/reset-rate-limits', (_req, res) => {
    resetAllLimiters();
    res.json({ success: true, message: 'All rate limiters reset' });
  });

  app.post('/__test__/rate-limit-override', (req, res) => {
    const { disabled } = req.body || {};
    setLimiterOverride({ disabled: Boolean(disabled) });
    res.json({ success: true, message: `Rate limit override set: disabled=${Boolean(disabled)}` });
  });
}

const server = app.listen(config.port, '0.0.0.0', error => {
  if (error) {
    console.error(`[Startup] Could not bind Calup backend to port ${config.port}: ${error.code || error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n==================================================`);
  console.log(`🚀 CalUp Backend running on port ${config.port} (0.0.0.0)`);
  console.log(`📅 Google OAuth Configured: ${config.isGoogleConfigured() ? 'YES ✓' : 'NO (Add credentials to .env)'}`);
  console.log(`🔗 Redirect URI: ${config.googleRedirectUri}`);
  console.log(`==================================================\n`);
});

startCashfreeReconciliationWorker();
startGoogleCalendarSyncWorker();
startSubscriptionLifecycleWorker();
startSupportLifecycleWorker();
startAppointmentWhatsAppWorker();
startBookingRefundWorker();
startCommercePaymentWorker();

export default app;
export { app, server };

