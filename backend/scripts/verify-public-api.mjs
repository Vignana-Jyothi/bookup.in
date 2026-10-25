import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// No credentials or database writes. A protected route must reject an anonymous
// request promptly; a hanging /api route cannot be hidden by a healthy /health.
export async function verifyPublicApi(origin = 'https://calup.app', { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const base = new URL(origin);
  assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password, 'Invalid public API origin');
  async function request(path) {
    try {
      return await fetchImpl(new URL(path, base), {
        signal: AbortSignal.timeout(timeoutMs), redirect: 'manual', credentials: 'omit',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      });
    } catch (cause) {
      const error = new Error(`Public API did not respond at ${path}: ${cause.name === 'TimeoutError' ? 'request timed out' : 'connection failed'}`);
      error.code = 'PUBLIC_API_UNREACHABLE';
      throw error;
    }
  }
  const health = await request('/health');
  assert.equal(health.status, 200, 'Public /health must return 200');
  assert.equal((await health.json()).status, 'ok', 'Public /health must be the API health response');
  const auth = await request('/api/v1/merchant/onboarding');
  assert.equal(auth.status, 401, 'Anonymous /api request must reach Express and return 401, not a gateway error or SPA');
  assert.match(auth.headers.get('content-type') || '', /application\/json/, 'Auth rejection must be JSON');
  const result = await auth.json();
  const message = typeof result.error === 'string' ? result.error : result.error?.message;
  assert.match(message || '', /auth|token/i, 'Expected an authentication-required response');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await verifyPublicApi(process.argv[2]);
    console.log('PASS: public health and protected API routing; anonymous request reaches Express without credentials');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
