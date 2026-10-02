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
} catch (_e) {}
import { createClient } from '@supabase/supabase-js';
import { config, validateConfig } from './config.js';
import authRoutes from './routes/auth.js';
import calendarRoutes from './routes/calendar.js';
import publicBookingsRoutes from './routes/publicBookings.js';
import internalNotificationsRoutes from './routes/internalNotifications.js';
import paymentVerificationRoutes from './routes/paymentVerification.js';
import policiesRoutes from './routes/policies.js';
import refundsRoutes from './routes/refunds.js';

// Validate required environment variables at startup (fails loudly if missing)
validateConfig();

const app = express();

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
app.use(express.json());

// Minimal root health check endpoint (for Railway / load balancers)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth/google', authRoutes);
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

// Test-only endpoints for rate limiter control (never available in production)
if (process.env.NODE_ENV !== 'production') {
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

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(`🚀 CalUp Backend running on port ${config.port} (0.0.0.0)`);
  console.log(`📅 Google OAuth Configured: ${config.isGoogleConfigured() ? 'YES ✓' : 'NO (Add credentials to .env)'}`);
  console.log(`🔗 Redirect URI: ${config.googleRedirectUri}`);
  console.log(`==================================================\n`);
});

export default app;
export { app, server };

