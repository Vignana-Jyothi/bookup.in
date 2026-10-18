import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { config } from '../server/config.js';
import { createAdminAuthRouter } from '../server/routes/adminAuth.js';
import { startAdminPhoneChallenge, verifyAdminPhoneChallenge, verifyAdminAccess, endAdminVerification } from '../../frontend/src/services/supabase/adminMfa.js';

process.env.DISABLE_RATE_LIMIT = 'true';
config.tokenEncryptionKey = 'a1'.repeat(32);
const user = { id: crypto.randomUUID(), email: 'test@example.invalid', app_metadata: { role: 'calup_admin', admin_phone: '+919876543210' } };
let currentUser = user;
let sessionId = crypto.randomUUID();
let methods = ['password'];
let jwtValid = true;
let grantHash = null;
let storageError = null;
let operationError = null;
let challenge;
let sends = 0;
let providerVerified = true;
let providerFailure = false;
const calls = [];
const storage = { async rpc(name, args) {
  calls.push({ name, args });
  if (storageError) return { error: storageError };
  if (name === 'verify_calup_admin_sms_session_v1') return { data: args.p_token_hash === grantHash && args.p_session_id === challenge?.sessionId };
  if (operationError) return { data: { error: operationError, retryAfter: 60 } };
  const action = args.p_action;
  let data;
  if (action === 'reserve_send') { challenge = { id: args.p_id, sessionId: args.p_session_id }; grantHash = null; data = { id: args.p_id }; }
  if (action === 'finish_send') { challenge.ciphertext = args.p_ciphertext; data = { ok: true }; }
  if (action === 'reserve_verify') {
    data = challenge?.id === args.p_id && !challenge.used ? { ciphertext: challenge.ciphertext } : { error: 'NO_CHALLENGE' };
  }
  if (action === 'finish_verify') {
    if (args.p_verified) { grantHash = args.p_token_hash; challenge.used = true; }
    data = { verified: args.p_verified || false };
  }
  if (action === 'revoke') { grantHash = null; data = { ok: true }; }
  return { data };
} };
const otp = {
  isConfigured: () => true,
  async sendOtp(phone) { sends++; assert.equal(phone, user.app_metadata.admin_phone); if (providerFailure) throw new Error('private provider detail'); return { sessionId: 'private-provider-session' }; },
  async verifyOtp(id) { assert.equal(id, 'private-provider-session'); if (providerFailure) throw new Error('private provider detail'); return { verified: providerVerified }; },
};
const verifier = { auth: { getUser: async () => jwtValid ? { data: { user: currentUser } } : { error: {} } } };
const app = express();
app.use(express.json());
app.use('/api/v1/admin/auth', createAdminAuthRouter({ verifier, storage, otp }));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}/api/v1/admin/auth`;
const request = (path, method = 'GET', body, cookie = '') => fetch(`${url}${path}`, { method,
  headers: { Authorization: `Bearer a.${Buffer.from(JSON.stringify({ amr: methods, aal: 'aal1', session_id: sessionId })).toString('base64url')}.c`, 'Content-Type': 'application/json', Cookie: cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
try {
  assert.equal((await fetch(`${url}/session`)).status, 401);
  assert.equal((await request('/session')).status, 403, 'Password alone is insufficient');
  assert.equal((await request('/sms/send', 'POST', { phone: '+919999999999' })).status, 422);
  assert.equal(sends, 0, 'Caller cannot choose destination');
  currentUser = { ...user, app_metadata: {}, user_metadata: user.app_metadata };
  assert.equal((await request('/sms/send', 'POST', {})).status, 403);
  currentUser = user;
  methods = ['otp'];
  assert.equal((await request('/sms/send', 'POST', {})).status, 403);
  methods = ['password'];
  jwtValid = false;
  assert.equal((await request('/sms/send', 'POST', {})).status, 401);
  jwtValid = true;
  let response = await request('/sms/send', 'POST', {});
  assert.equal(response.status, 200);
  const sent = await response.json();
  assert.equal(sent.maskedPhone, '**** 3210');
  assert.ok(challenge.ciphertext && !challenge.ciphertext.includes('private-provider-session'));
  assert.equal((await request('/sms/verify', 'POST', { challengeId: sent.challengeId, code: 'abc' })).status, 422);
  providerVerified = false;
  response = await request('/sms/verify', 'POST', { challengeId: sent.challengeId, code: '000000' });
  assert.equal(response.status, 422);
  assert.equal(grantHash, null);
  providerFailure = true;
  response = await request('/sms/verify', 'POST', { challengeId: sent.challengeId, code: '123456' });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private provider/);
  assert.equal(calls.at(-1).args.p_action, 'finish_verify', 'Provider verification failures release the reserved attempt safely');
  assert.equal(grantHash, null);
  providerFailure = false;
  providerVerified = true;
  response = await request('/sms/verify', 'POST', { challengeId: sent.challengeId, code: '123456' });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(grantHash, crypto.createHash('sha256').update(cookie.split('=')[1]).digest('hex'));
  assert.equal((await request('/session')).status, 403, 'JWT without private cookie is insufficient');
  assert.equal((await request('/session', 'GET', undefined, cookie)).status, 200);
  assert.equal((await request('/sms/verify', 'POST', { challengeId: sent.challengeId, code: '123456' })).status, 409, 'No consumed OTP replay');
  const original = sessionId;
  sessionId = crypto.randomUUID();
  assert.equal((await request('/session', 'GET', undefined, cookie)).status, 403);
  sessionId = original;
  storageError = { message: 'secret database details' };
  response = await request('/session', 'GET', undefined, cookie);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret database/);
  storageError = null;
  assert.equal((await request('/session', 'DELETE', undefined, cookie)).status, 200);
  assert.equal((await request('/session', 'GET', undefined, cookie)).status, 403);
  operationError = 'COOLDOWN';
  response = await request('/sms/send', 'POST', {});
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  operationError = null;
  providerFailure = true;
  response = await request('/sms/send', 'POST', {});
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private provider/);
  assert.equal(calls.at(-1).args.p_action, 'finish_send', 'Provider failure is persisted');
  process.env.NODE_ENV = 'production';
  const count = sends;
  assert.equal((await request('/sms/send', 'POST', {})).status, 403, 'Production writes require trusted Origin');
  assert.equal(sends, count);
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-only' } } }) } };
const fakeRequest = async (path, options) => {
  assert.match(path, /\/api\/v1\/admin\/auth\//);
  assert.equal(options.headers.Authorization, 'Bearer test-only');
  assert.equal(options.credentials, 'include');
  assert.equal(options.cache, 'no-store');
  return { ok: true, json: async () => ({ verified: true }) };
};
await startAdminPhoneChallenge(client, fakeRequest);
await verifyAdminPhoneChallenge(client, crypto.randomUUID(), '123456', fakeRequest);
await verifyAdminAccess(client, fakeRequest);
await endAdminVerification(client, fakeRequest);
await assert.rejects(verifyAdminAccess(client, async () => ({ ok: false, json: async () => { throw new Error('HTML'); } })), /unavailable/);
console.log('PASS: 2Factor admin OTP, encrypted references, session/cookie binding, revocation, safe errors and CSRF. No real SMS sent.');
