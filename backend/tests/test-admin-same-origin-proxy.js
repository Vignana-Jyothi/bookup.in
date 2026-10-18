import assert from 'node:assert/strict';
import { createAdminProxy } from '../../frontend/api/v1/admin/[...path].js';
import { getAdminApiBase } from '../../frontend/src/utils/api.js';
import { completeAdminPhoneChallenge } from '../../frontend/src/services/supabase/adminMfa.js';

let forwarded;
let status = 200;
const token = 'a'.repeat(64);
const handler = createAdminProxy({ target: () => 'https://backend.example/api', fetchImpl: async (url, options) => {
  forwarded = { url: String(url), options };
  return new Response(JSON.stringify({ verified: true }), { status, headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': `calup_admin_sms=${token}; Path=/api; HttpOnly; Secure; SameSite=None`,
    'Retry-After': '60',
  } });
} });
const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value) { this.body = value; } });
const request = (url, body) => ({ url, method: body ? 'POST' : 'GET', body,
  headers: { host: 'frontend.example', authorization: 'Bearer test-only', origin: 'https://frontend.example',
    cookie: `unrelated=private; calup_admin_sms=${token}`, 'content-type': 'application/json' } });
let res = response();
await handler(request('/api/v1/admin/auth/sms/verify', { challengeId: 'fixture', code: '123456' }), res);
assert.equal(res.statusCode, 200);
assert.equal(forwarded.url, 'https://backend.example/api/v1/admin/auth/sms/verify');
assert.equal(forwarded.options.headers.authorization, 'Bearer test-only');
assert.equal(forwarded.options.headers.cookie, `calup_admin_sms=${token}`);
assert.equal(forwarded.options.headers.origin, 'https://frontend.example');
assert.equal(forwarded.options.redirect, 'manual');
assert.match(res.headers['set-cookie'][0], /HttpOnly; Secure/);
assert.equal(res.headers['cache-control'], 'private, no-store');
status = 403;
res = response();
await handler(request('/api/v1/admin/auth/session'), res);
assert.equal(res.statusCode, 403, 'Bridge must preserve access denials');
status = 302;
res = response();
await handler(request('/api/v1/admin/auth/session'), res);
assert.equal(res.statusCode, 502, 'Do not follow credential-bearing redirects');
res = response();
await handler(request('/api/v1/public/commerce/test/orders'), res);
assert.equal(res.statusCode, 404, 'Not a public arbitrary backend proxy');
res = response();
await createAdminProxy({ target: () => 'https://user:secret@backend.example' })(request('/api/v1/admin/auth/session'), res);
assert.equal(res.statusCode, 503);
res = response();
await createAdminProxy({ target: () => 'https://frontend.example' })(request('/api/v1/admin/auth/session'), res);
assert.equal(res.statusCode, 503, 'Reject proxy loops');
res = response();
await handler(request('/api/v1/admin/auth/sms/send', 'x'.repeat(262145)), res);
assert.equal(res.statusCode, 413);
const oldWindow = globalThis.window;
try {
  globalThis.window = {};
  assert.equal(getAdminApiBase(), '/api', 'Browser admin calls must stay same-origin');
} finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
let consumed = false;
let requests = 0;
const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) } };
await assert.rejects(completeAdminPhoneChallenge(client, 'challenge', '123456', () => { consumed = true; }, async () => {
  requests++;
  if (requests === 1) return { ok: true, json: async () => ({ verified: true }) };
  assert.equal(consumed, true, 'Clear accepted OTP before checking its cookie');
  return { ok: false, status: 403, json: async () => ({ error: 'Verify your administrator phone to continue.' }) };
}), error => error.status === 403 && /SMS code accepted/.test(error.message));
assert.equal(requests, 2, 'Never automatically replay the consumed OTP');
console.log('PASS: same-origin admin proof forwarding, secure cookie relay, access denials, restricted targets, payload limits and consumed-code recovery. No external requests or SMS.');
