import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authClient, serviceRoleClient } from '../middleware/auth.js';
import { tokenRouteLimiter } from '../middleware/rateLimiter.js';
import { twoFactorOtpService } from '../services/twoFactorOtp.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';
import { customerRequestIsTrusted } from '../utils/customerAccess.js';
import { config } from '../config.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cookieName = 'calup_admin_sms';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const adminSmsLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== 'production' && process.env.DISABLE_RATE_LIMIT === 'true',
  handler: (_req, res) => res.status(429).json({ error: 'Too many SMS requests. Please try again later.' }),
});
const failures = {
  FORBIDDEN: [403, 'Administrator access or the approved phone has changed. Sign in again.'],
  COOLDOWN: [429, 'Wait one minute before requesting another SMS code.'],
  SEND_LIMIT: [429, 'The SMS limit has been reached. Try again in one hour.'],
  ATTEMPTS: [429, 'Too many verification attempts. Request a new SMS code when available.'],
  BUSY: [409, 'Verification is already in progress. Please wait.'],
  EXPIRED: [410, 'Your SMS code has expired. Request another code.'],
  NO_CHALLENGE: [409, 'Request a new SMS code to continue.'],
  STALE: [409, 'This verification request is no longer current. Request another code.'],
  INVALID: [422, 'Check your verification details.'],
};

function cookie(res, value = '') {
  res.cookie(cookieName, value, { httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', path: '/api', maxAge: value ? 30 * 60 * 1000 : 0 });
}
function proof(req) {
  const entry = String(req.headers.cookie || '').split(';').find(item => item.trim().startsWith(`${cookieName}=`));
  const value = entry?.trim().slice(cookieName.length + 1) || '';
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

// Password/role eligibility only. This predicate NEVER grants admin access on its own.
export function isAdminPasswordSession(user, claims) {
  const methods = Array.isArray(claims?.amr) ? claims.amr.map(entry => typeof entry === 'string' ? entry : entry.method) : [];
  return user?.app_metadata?.role === 'calup_admin' && methods.includes('password') && uuid.test(claims?.session_id || '');
}

export function createAdminAuth({ verifier = authClient, storage = serviceRoleClient, passwordOnly = false } = {}) {
  return async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!['GET','HEAD'].includes(req.method) && !customerRequestIsTrusted(req)) return res.status(403).json({ error: 'Open administrator access from Calup.' });
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
    if (!match || !verifier) return res.status(401).json({ error: 'Sign in to Calup.' });
    try {
      const { data, error } = await verifier.auth.getUser(match[1]);
      if (error || !data?.user) return res.status(401).json({ error: 'Sign in to Calup.' });
      const claims = JSON.parse(Buffer.from(match[1].split('.')[1], 'base64url').toString());
      if (!isAdminPasswordSession(data.user, claims)) return res.status(403).json({ error: 'Administrator access with password and SMS verification is required.' });
      if (!/^\+91[6-9]\d{9}$/.test(data.user.app_metadata.admin_phone || '')) return res.status(403).json({ error: 'Your approved administrator mobile number is not configured.' });
      if (!storage) return res.status(503).json({ error: 'Administrator verification is unavailable.' });
      if (!passwordOnly) {
        const token = proof(req);
        if (!token) return res.status(403).json({ error: 'Verify your administrator phone to continue.' });
        const result = await storage.rpc('verify_calup_admin_sms_session_v1', {
          p_user_id: data.user.id, p_session_id: claims.session_id, p_token_hash: hash(token),
        });
        if (result.error) return res.status(503).json({ error: 'Administrator verification is unavailable.' });
        if (result.data !== true) return res.status(403).json({ error: 'Your SMS verification has expired. Verify your phone again.' });
      }
      req.user = data.user;
      req.adminSessionId = claims.session_id;
      next();
    } catch { return res.status(401).json({ error: 'Sign in and verify your phone again.' }); }
  };
}

export const requireSupportAdmin = createAdminAuth();
export function createAdminAuthRouter({ verifier = authClient, storage = serviceRoleClient, otp = twoFactorOtpService,
  encryptionReady = () => /^(?!0{64}$)[a-f0-9]{64}$/i.test(config.tokenEncryptionKey) } = {}) {
  const router = Router();
  const identity = createAdminAuth({ verifier, storage, passwordOnly: true });
  const authorized = createAdminAuth({ verifier, storage });
  const operate = async (req, action, extra = {}) => {
    const result = await storage.rpc('admin_sms_operation_v1', {
      p_action: action, p_user_id: req.user.id, p_session_id: req.adminSessionId,
      p_phone: req.user.app_metadata.admin_phone, ...extra,
    });
    if (result.error || !result.data) throw new Error('STORAGE');
    if (result.data.error) {
      const error = new Error(result.data.error);
      error.retryAfter = result.data.retryAfter;
      throw error;
    }
    return result.data;
  };
  const failure = (res, error) => {
    const [status, message] = failures[error.message] || [503, 'SMS verification is temporarily unavailable. Please try again.'];
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    return res.status(status).json({ error: message });
  };
  router.get('/session', tokenRouteLimiter, authorized, (req, res) => {
    res.json({ user: { id: req.user.id, email: req.user.email }, role: 'calup_admin', verification: '2factor_sms' });
  });
  router.post('/sms/send', adminSmsLimiter, identity, async (req, res) => {
    if (Array.isArray(req.body) || Object.keys(req.body || {}).length) return res.status(422).json({ error: 'The administrator phone is configured by your account operator.' });
    if (!encryptionReady() || !otp.isConfigured()) return res.status(503).json({ error: 'Administrator SMS delivery is not configured.' });
    const id = crypto.randomUUID();
    try {
      await operate(req, 'reserve_send', { p_id: id });
      cookie(res);
      let ciphertext;
      try {
        const sent = await otp.sendOtp(req.user.app_metadata.admin_phone);
        if (typeof sent.sessionId !== 'string' || !sent.sessionId || sent.sessionId.length > 512) throw new Error('PROVIDER');
        ciphertext = encryptToken(sent.sessionId);
      }
      catch (error) { await operate(req, 'finish_send', { p_id: id }); throw error; }
      await operate(req, 'finish_send', { p_id: id, p_ciphertext: ciphertext });
      res.json({ challengeId: id, maskedPhone: `**** ${req.user.app_metadata.admin_phone.slice(-4)}`, retryAfter: 60 });
    } catch (error) { failure(res, error); }
  });
  router.post('/sms/verify', adminSmsLimiter, identity, async (req, res) => {
    const { challengeId, code } = req.body || {};
    if (typeof challengeId !== 'string' || typeof code !== 'string' || !uuid.test(challengeId) || !/^\d{4,8}$/.test(code) || Object.keys(req.body || {}).some(key => !['challengeId','code'].includes(key))) {
      return res.status(422).json({ error: 'Enter the SMS verification code.' });
    }
    if (!encryptionReady() || !otp.isConfigured()) return res.status(503).json({ error: 'Administrator SMS delivery is not configured.' });
    const lease = crypto.randomUUID();
    try {
      const reserved = await operate(req, 'reserve_verify', { p_id: challengeId, p_lease_id: lease });
      let verified;
      try { verified = (await otp.verifyOtp(decryptToken(reserved.ciphertext), code)).verified === true; }
      catch (error) { await operate(req, 'finish_verify', { p_id: challengeId, p_lease_id: lease }); throw error; }
      const token = crypto.randomBytes(32).toString('hex');
      const completed = await operate(req, 'finish_verify', { p_id: challengeId, p_lease_id: lease, p_verified: verified, p_token_hash: verified ? hash(token) : null });
      if (verified && completed.verified !== true) throw new Error('STALE');
      if (!verified) return res.status(422).json({ error: 'The SMS code is incorrect or expired. Try again or request another code.' });
      cookie(res, token);
      res.json({ verified: true });
    } catch (error) { failure(res, error); }
  });
  router.delete('/session', tokenRouteLimiter, identity, async (req, res) => {
    cookie(res);
    try { await operate(req, 'revoke'); res.json({ revoked: true }); }
    catch (error) { failure(res, error); }
  });
  return router;
}
