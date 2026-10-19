import assert from 'node:assert/strict';
import { createCustomerProxy } from '../../frontend/server/customerProxy.mjs';
import entry from '../../frontend/api/customer-proxy.mjs';
import { getPublicSessionApiBase } from '../../frontend/src/utils/api.js';
import { verifyCustomerProxyOutput } from '../scripts/verify-vercel-admin-proxy.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(body) { this.body = body; } });
const request = url => ({ url, method: 'POST', body: { fixture: true }, headers: {
  host: 'frontend.example', origin: 'https://frontend.example', 'content-type': 'application/json',
  'idempotency-key': 'fixture-request-key', authorization: 'Bearer unrelated',
  'x-support-context': 'payment',
  cookie: 'calup_admin_sms=private; unrelated=private; calup_attempt_v1=fixture; calup_attempt_reference_v1=reference; calup_commerce_access=access; calup_commerce_challenge=challenge',
} });
let forwarded; let status = 200;
const handler = createCustomerProxy({ target: () => 'https://backend.example/api', fetchImpl: async (url, options) => {
  forwarded = { url: String(url), options };
  const headers = new Headers({ 'Content-Type': 'application/json', 'Retry-After': '60' });
  for (const cookie of ['calup_attempt_v1=fixture; Path=/api/v1/public; HttpOnly; Secure; SameSite=None', 'calup_attempt_reference_v1=reference; Path=/api/v1/public; HttpOnly; Secure', 'calup_commerce_access=access; Path=/api/v1/public/commerce; HttpOnly; Secure', 'calup_commerce_challenge=; Max-Age=0; Path=/api/v1/public/commerce; HttpOnly; Secure', 'calup_admin_sms=private; Path=/api', 'calup_attempt_v1=wrong; Domain=backend.example']) headers.append('Set-Cookie', cookie);
  return new Response('{}', { status, headers });
} });
assert.equal(typeof entry, 'function');
let res = response(); await handler(request('/api/v1/public/booking-attempts'), res);
assert.equal(res.statusCode, 200);
assert.equal(forwarded.url, 'https://backend.example/api/v1/public/booking-attempts');
assert.equal(forwarded.options.headers['idempotency-key'], 'fixture-request-key');
assert.equal(forwarded.options.headers.origin, 'https://frontend.example');
assert.equal(forwarded.options.headers.authorization, undefined);
assert.equal(forwarded.options.headers['x-support-context'], 'payment');
assert.doesNotMatch(forwarded.options.headers.cookie, /unrelated|admin/);
assert.match(forwarded.options.headers.cookie, /calup_attempt_reference_v1=reference/);
assert.equal(res.headers['set-cookie'].length, 4, 'Both checkout cookies and both commerce cookies must survive');
assert(res.headers['set-cookie'].every(value => !/Domain=|admin/.test(value)));
assert.equal(res.headers['cache-control'], 'private, no-store');
res = response(); await handler(request('/api/customer-proxy?__calup_public_path=commerce/merchant/booking-payments'), res);
assert.equal(forwarded.url, 'https://backend.example/api/v1/public/commerce/merchant/booking-payments');
res = response(); const rewritten = request('/api/customer-proxy'); rewritten.query = { __calup_public_path: 'checkout-sessions/current/open' }; await handler(rewritten, res);
assert.equal(forwarded.url, 'https://backend.example/api/v1/public/checkout-sessions/current/open');
for (const denied of ['/api/v1/admin/auth/session', '/api/v1/merchant/appointments', '/api/v1/public/unknown']) {
  res = response(); await handler(request(denied), res); assert.equal(res.statusCode, 404);
}
for (const target of ['https://user:secret@backend.example', 'https://frontend.example', 'http://backend.example']) {
  res = response(); await createCustomerProxy({ target: () => target })(request('/api/v1/public/checkout-sessions/current'), res); assert.equal(res.statusCode, 503);
}
status = 401; res = response(); await handler(request('/api/v1/public/checkout-sessions/current/open'), res); assert.equal(res.statusCode, 401);
status = 302; res = response(); await handler(request('/api/v1/public/checkout-sessions/current/open'), res); assert.equal(res.statusCode, 502);
res = response(); const huge = request('/api/v1/public/booking-attempts'); huge.body = 'x'.repeat(262145); await handler(huge, res); assert.equal(res.statusCode, 413);
const priorWindow = globalThis.window; const priorApi = process.env.VITE_API_URL;
try { globalThis.window = {}; process.env.VITE_API_URL = 'https://backend.example'; assert.equal(getPublicSessionApiBase(), '/api'); }
finally { if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow; if (priorApi === undefined) delete process.env.VITE_API_URL; else process.env.VITE_API_URL = priorApi; }
const temp = await mkdtemp(path.join(os.tmpdir(), 'calup-customer-proxy-'));
try {
  await writeFile(path.join(temp, 'config.json'), JSON.stringify({ routes: [{ src: '/api/v1/public/(.*)', dest: '/api/customer-proxy?__calup_public_path=$1' }] }));
  await assert.rejects(verifyCustomerProxyOutput(temp), /ENOENT/);
  const fn = path.join(temp, 'functions', 'api', 'customer-proxy.func'); await mkdir(fn, { recursive: true });
  await writeFile(path.join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'entry.mjs' }));
  await assert.rejects(verifyCustomerProxyOutput(temp), /ENOENT/);
  await writeFile(path.join(fn, 'entry.mjs'), 'export default () => {};'); await verifyCustomerProxyOutput(temp);
} finally { assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert(path.basename(temp).startsWith('calup-customer-proxy-')); await rm(temp, { recursive: true, force: true }); }
console.log('PASS: first-party checkout/OTP routing, all four proof cookies, strict scope/target/header filtering, access denials and function packaging.');
