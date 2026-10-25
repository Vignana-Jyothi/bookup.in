import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHealthHandler } from '../server/routes/health.js';
import { config, validateConfig } from '../server/config.js';
const originalConfig = { ...config };
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const originalError = console.error;
globalThis.fetch = async () => { throw new Error('Unexpected external network access'); };
const secret = 'fixture-private-key-never-return';
const settings = { supabaseUrl: 'https://private-fixture.supabase.co', supabaseServiceRoleKey: secret };
async function invoke(result, mode = 'result') {
  let signal;
  const clientFactory = () => ({ from(table) { assert.equal(table, 'services'); return { select(fields) { assert.equal(fields, 'id'); return { limit(count) { assert.equal(count, 1); return { abortSignal(value) {
    signal = value;
    if (mode === 'throw') throw new Error(secret);
    if (mode === 'stall') return new Promise(() => {});
    return Promise.resolve(result);
  } }; } }; } }; } });
  const res = { set(key, value) { assert.equal(key, 'Cache-Control'); assert.equal(value, 'no-store'); }, json(body) { this.body = body; return this; } };
  const start = performance.now();
  await createHealthHandler({ settings, clientFactory, timeoutMs: 15 })({}, res);
  assert.ok(performance.now() - start < 500, 'Dependency health must finish even if client ignores cancellation');
  assert.deepEqual(Object.keys(res.body).sort(), ['service', 'status', 'supabase', 'timestamp']);
  assert.deepEqual(Object.keys(res.body.supabase), ['status']);
  assert.equal(res.body.status, 'ok');
  assert.ok(!JSON.stringify(res.body).includes(secret));
  if (mode === 'stall') assert.equal(signal.aborted, true);
  return res.body;
}
try {
  assert.equal((await invoke({ data: [{ id: 'private-service-id', name: secret }] })).supabase.status, 'connected');
  assert.equal((await invoke({ error: { message: secret, details: secret, hint: secret } })).supabase.status, 'error');
  assert.equal((await invoke(null, 'throw')).supabase.status, 'error');
  assert.equal((await invoke(null, 'stall')).supabase.status, 'error');
  let body;
  await createHealthHandler({ settings: {}, clientFactory: () => { throw new Error('Must not create an unconfigured client'); } })({}, { set() {}, json(value) { body = value; } });
  assert.equal(body.supabase.status, 'unconfigured');
  Object.assign(config, { supabaseUrl: 'https://fixture.supabase.co', supabaseServiceRoleKey: secret, frontendUrl: 'https://calup.example', tokenEncryptionKey: '0'.repeat(64), googleClientId: '', googleClientSecret: '', resendApiKey: '', twoFactorTemplateName: '', cashfreeEnabled: false });
  process.env.NODE_ENV = 'production'; console.error = () => {};
  for (const flag of ['ENABLE_TEST_ROUTES', 'DEBUG_ROUTES']) {
    process.env.ENABLE_TEST_ROUTES = 'false'; process.env.DEBUG_ROUTES = 'false'; process.env[flag] = 'true';
    assert.throws(validateConfig, new RegExp(`${flag} must be false in production`));
  }
  process.env.ENABLE_TEST_ROUTES = 'false'; process.env.DEBUG_ROUTES = 'false';
  assert.doesNotThrow(validateConfig);
  process.env.NODE_ENV = 'test'; process.env.ENABLE_TEST_ROUTES = 'true'; process.env.DEBUG_ROUTES = 'true';
  assert.doesNotThrow(validateConfig);
  const childEnv = { ...process.env };
  for (const match of readFileSync('.env.example', 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) childEnv[match[1]] = '';
  Object.assign(childEnv, { NODE_ENV: 'production', PORT: '0', BACKGROUND_WORKERS_ENABLED: 'false', TOKEN_STORE_MEMORY_ONLY: 'true',
    ENABLE_TEST_ROUTES: 'false', DEBUG_ROUTES: 'false', SUPABASE_URL: settings.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: secret,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key', FRONTEND_URL: 'https://calup.example', TOKEN_ENCRYPTION_KEY: '0'.repeat(64) });
  Object.assign(process.env, childEnv);
  Object.assign(config, { supabaseUrl: settings.supabaseUrl, supabaseServiceRoleKey: secret, supabaseKey: secret, supabaseAnonKey: 'fixture-public-key', port: 0 });
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname === '127.0.0.1') return originalFetch(input, options);
    assert.equal(url.origin, settings.supabaseUrl);
    assert.equal(url.pathname, '/rest/v1/services');
    return Response.json([{ id: 'private-row-never-return' }]);
  };
  const { server } = await import('../server/index.js');
  try {
    if (!server.listening) await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = 'http://127.0.0.1:' + server.address().port;
    const root = await (await fetch(base + '/health')).json();
    assert.deepEqual(Object.keys(root).sort(), ['status', 'timestamp']);
    const health = await (await fetch(base + '/api/health')).json();
    assert.deepEqual(Object.keys(health).sort(), ['service', 'status', 'supabase', 'timestamp']);
    assert.deepEqual(health.supabase, { status: 'connected' });
    for (const path of ['/__test__/reset-rate-limits', '/__test__/rate-limit-override']) {
      assert.equal((await fetch(base + path, { method: 'POST' })).status, 404);
    }
    assert.equal((await fetch(base + '/api/auth/google/debug')).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  console.log('PASS: public health redacts credentials/records/errors, dependency timeout is bounded, production rejects diagnostic routes.');
} finally {
  Object.assign(config, originalConfig);
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  globalThis.fetch = originalFetch;
  console.error = originalError;
}
