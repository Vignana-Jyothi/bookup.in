/**
 * BookUp Google OAuth Routes
 * /api/auth/google/*
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import { googleCalendarService, REQUIRED_GOOGLE_SCOPES } from '../services/googleCalendar.js';
import { tokenStore } from '../services/tokenStore.js';
import { config } from '../config.js';
import { requireProviderAuth } from '../middleware/auth.js';
import { verifyOAuthState } from '../utils/crypto.js';

const router = Router();

/**
 * GET /api/auth/google/url
 * Returns authorization URL to initiate Google OAuth consent
 * Authenticated provider only: resolves provider strictly from Supabase Auth session
 */
router.get('/url', requireProviderAuth, (req, res) => {
  try {
    const providerId = req.providerId;
    const merchantEmail = String(req.provider?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merchantEmail)) {
      return res.status(422).json({ success: false, error: 'Add a valid merchant email in Settings before connecting Google Calendar.' });
    }
    const returnTo = req.query.returnTo === 'onboarding' ? 'onboarding' : 'settings';
    const url = googleCalendarService.generateAuthUrl(providerId, merchantEmail, { returnTo, popup: req.query.popup === 'true' });
    res.json({ success: true, url, callbackOrigin: new URL(config.googleRedirectUri).origin });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/auth/google/debug
 * Safe diagnostic endpoint to verify auth token and provider resolution.
 * Gated behind DEBUG_ROUTES=true (disabled by default in production).
 */
if (process.env.DEBUG_ROUTES === 'true') {
router.get('/debug', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing Bearer token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const { authClient, serviceRoleClient } = await import('../middleware/auth.js');
    const { data: { user }, error: userError } = await authClient.auth.getUser(token);
    if (userError || !user) {
      return res.status(401).json({ error: 'invalid token', details: userError });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const anonClient = createClient(config.supabaseUrl, config.supabaseAnonKey || config.supabaseKey);
    const byUidAnon = await anonClient.from('providers').select('id, user_id, name, slug, email').eq('user_id', user.id).maybeSingle();
    const byEmailAnon = await anonClient.from('providers').select('id, user_id, name, slug, email').eq('email', user.email.toLowerCase()).maybeSingle();

    let byUidAdmin = null;
    let byEmailAdmin = null;
    if (serviceRoleClient) {
      byUidAdmin = await serviceRoleClient.from('providers').select('id, user_id, name, slug, email').eq('user_id', user.id).maybeSingle();
      byEmailAdmin = await serviceRoleClient.from('providers').select('id, user_id, name, slug, email').eq('email', user.email.toLowerCase()).maybeSingle();
    }

    res.json({
      userId: user.id,
      userEmail: user.email,
      hasServiceRoleClient: Boolean(serviceRoleClient),
      byUidAnon,
      byEmailAnon,
      byUidAdmin,
      byEmailAdmin,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
} // end DEBUG_ROUTES gate

/**
 * GET /api/auth/google/callback
 * Handles Google OAuth redirect and HMAC-signed state verification
 */
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const stateResult = verifyOAuthState(state);
  const callbackPath = stateResult.valid && stateResult.returnTo === 'onboarding'
    ? '/onboarding'
    : '/dashboard/settings';
  const finish = (result, destination = callbackPath) => {
    if (!stateResult.valid || !stateResult.popup) {
      return res.redirect(`${config.frontendUrl}${destination}?calendar=${result}`);
    }
    const nonce = crypto.randomBytes(16).toString('base64');
    const message = JSON.stringify({ type: 'calup-google-oauth', result });
    const targetOrigin = JSON.stringify(new URL(config.frontendUrl).origin);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
    return res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Calup Google connection</title><body><p>Google connection finished. You can close this window and return to Calup.</p><script nonce="${nonce}">if(window.opener)window.opener.postMessage(${message},${targetOrigin});window.close();</script></body></html>`);
  };

  // Handle user cancellation on Google consent screen
  if (error) {
    console.warn('Google OAuth denied or cancelled by user:', error);
    return finish('error');
  }

  if (!code || !state) {
    return finish('error');
  }

  try {
    const connected = await googleCalendarService.handleCallback(code, state);
    if (connected?.providerId) {
      try {
        const { serviceRoleClient } = await import('../middleware/auth.js');
        if (serviceRoleClient) {
          const { error: requeueError } = await serviceRoleClient.rpc('requeue_google_calendar_sync_v1', {
            p_provider_id: connected.providerId,
          });
          if (requeueError) console.warn('[GoogleOAuth] Could not requeue pending calendar work:', requeueError.message);
        }
      } catch (requeueError) {
        console.warn('[GoogleOAuth] Calendar work will be retried by the worker:', requeueError.message);
      }
    }
    const destination = connected?.returnTo === 'onboarding' ? '/onboarding' : '/dashboard/settings';
    return finish('connected', destination);
  } catch (err) {
    console.error('Google OAuth callback failed:', err.message);
    const result = err.code === 'GOOGLE_ACCOUNT_MISMATCH' ? 'account_mismatch' : 'error';
    return finish(result);
  }
});

/**
 * GET /api/auth/google/status
 * Check if the authenticated provider has an active Google Calendar integration
 * Authenticated provider only: resolves provider strictly from Supabase Auth session
 */
router.get('/status', requireProviderAuth, async (req, res) => {
  try {
    const providerId = req.providerId;
    const status = await tokenStore.getStatus(providerId);
    const profileEmail = String(req.provider?.email || '').trim().toLowerCase() || null;
    const connectedEmail = String(status.email || '').trim().toLowerCase() || null;
    const grantedScopes = new Set(String(status.scope || '').split(/\s+/).filter(Boolean));
    const permissionsReady = REQUIRED_GOOGLE_SCOPES.every(scope => scope === 'openid' || grantedScopes.has(scope));
    const hostAccessReady = Boolean(status.isConnected && permissionsReady && profileEmail && connectedEmail === profileEmail);
    return res.json({
      success: true,
      isConnected: hostAccessReady,
      email: connectedEmail,
      connectedAt: status.connectedAt || null,
      connectedEmail,
      profileEmail,
      hostAccessReady,
      permissionsReady,
      reconnectRequired: Boolean(status.isConnected && !hostAccessReady),
      provider: 'google',
      capabilities: {
        calendarEvents: hostAccessReady,
        availability: hostAccessReady,
        googleMeet: hostAccessReady,
      },
    });
  } catch (err) {
    console.error('Google connection status failed:', err.message);
    return res.status(503).json({ success: false, isConnected: false, error: 'Google connection status is temporarily unavailable.' });
  }
});

/**
 * POST /api/auth/google/test
 * Performs a live, side-effect-free identity and Calendar permission check.
 */
router.post('/test', requireProviderAuth, async (req, res) => {
  try {
    const result = await googleCalendarService.testConnection(req.providerId);
    return res.status(result.success ? 200 : 409).json(result);
  } catch (err) {
    console.error('Google connection test failed:', err.message);
    return res.status(502).json({ success: false, connected: false, reason: 'google_unavailable', error: 'Google connection could not be verified right now.' });
  }
});

/**
 * POST /api/auth/google/disconnect
 * Disconnect Google Calendar and revoke tokens for the authenticated provider
 * Authenticated provider only: resolves provider strictly from Supabase Auth session
 */
router.post('/disconnect', requireProviderAuth, async (req, res) => {
  const providerId = req.providerId;
  try {
    await googleCalendarService.disconnect(providerId);
    res.json({ success: true, message: 'Google Calendar disconnected' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
