import assert from 'node:assert/strict';
import { verifyPublicApi } from '../scripts/verify-public-api.mjs';

let calls = [];
const json = (value, status = 200) => Response.json(value, { status });
const good = async (url, options) => {
  calls.push({ url: String(url), options });
  return new URL(url).pathname === '/health'
    ? json({ status: 'ok' })
    : json({ success: false, error: 'Authentication required: missing Bearer token' }, 401);
};
await verifyPublicApi('https://calup.example', { fetchImpl: good });
assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/health', '/api/v1/merchant/onboarding']);
assert(calls.every(c => c.options.credentials === 'omit' && !c.options.headers.Authorization));
assert(calls.every(c => c.options.signal instanceof AbortSignal && c.options.redirect === 'manual'));

for (const status of [200, 302, 502, 504]) {
  await assert.rejects(verifyPublicApi('https://calup.example', { fetchImpl: async url =>
    new URL(url).pathname === '/health' ? json({ status: 'ok' }) : new Response('<html>not the API</html>', { status }),
  }), /Anonymous \/api request must reach Express/);
}
await assert.rejects(verifyPublicApi('https://calup.example', { fetchImpl: async url =>
  new URL(url).pathname === '/health' ? json({ status: 'ok' }) : new Response('not JSON', { status: 401 }),
}), /Auth rejection must be JSON/);

calls = [];
const stalled = async (url, options) => {
  if (new URL(url).pathname === '/health') return good(url, options);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(json({ error: 'too late' }, 401)), 1000);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
  });
};
await assert.rejects(verifyPublicApi('https://calup.example', { fetchImpl: stalled, timeoutMs: 20 }),
  error => error.code === 'PUBLIC_API_UNREACHABLE' && /timed out/.test(error.message));
console.log('PASS: public API probe rejects healthy-frontend/broken-API, SPA redirects, non-JSON rejection and stalled upstreams without credentials');
