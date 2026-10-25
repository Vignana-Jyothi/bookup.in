import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareCollegeEnvironment, writeCollegeEnvironment, fixtureSettings } from '../scripts/college-env.mjs';

const fixture = variables => prepareCollegeEnvironment({ secrets: fixtureSettings, variables, fixture: true });
const prepared = fixture({ VERCEL_TOKEN: 'not-an-application-setting', VITE_API_URL: 'https://obsolete-api.example' });
assert.equal(prepared.frontend.VITE_API_URL, '/api');
assert.equal(prepared.backend.BACKGROUND_WORKERS_ENABLED, 'false');
assert.equal(prepared.backend.FRONTEND_URL, 'https://calup.app');
assert.equal(prepared.backend.BACKEND_PUBLIC_URL, 'https://calup.app');
assert.equal(prepared.backend.GOOGLE_REDIRECT_URI, 'https://calup.app/api/auth/google/callback');
const google = fixture({ GOOGLE_CLIENT_ID: 'fixture-google-id', GOOGLE_CLIENT_SECRET: 'fixture-google-secret' });
assert.equal(google.backend.GOOGLE_REDIRECT_URI, 'https://calup.app/api/auth/google/callback');
assert.equal(fixture({ VITE_APP_URL: 'https://calup.app/' }).frontend.VITE_APP_URL, 'https://calup.app');
for (const name of ['VITE_APP_URL', 'FRONTEND_URL', 'BACKEND_PUBLIC_URL']) {
  assert.throws(() => fixture({ [name]: 'https://old-testing-host.example' }), /must be https:\/\/calup\.app/);
  assert.throws(() => fixture({ [name]: 'http://localhost:5173' }), /Invalid/);
}
for (const callback of ['https://old-api.example/api/auth/google/callback', 'http://localhost:5173/api/auth/google/callback', 'https://calup.app/wrong-callback']) {
  assert.throws(() => fixture({ GOOGLE_REDIRECT_URI: callback }), /GOOGLE_REDIRECT_URI must be/);
}
assert(!JSON.stringify(prepared.frontend).includes(fixtureSettings.SUPABASE_SERVICE_ROLE_KEY));
assert(!('VERCEL_TOKEN' in prepared.backend));
assert.throws(() => fixture({ SUPABASE_URL: 'https://different.supabase.co' }), /projects differ/);
assert.throws(() => prepareCollegeEnvironment({ secrets: { ...fixtureSettings, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_bad' }, fixture: true }), /Privileged/);
assert.throws(() => fixture({ RESEND_API_KEY: 'key-with\nnew-line' }), /single-line/);
assert.throws(() => fixture({ CASHFREE_V1_ENABLED: 'true' }), /CASHFREE_CLIENT_ID/);
assert.throws(() => fixture({ GOOGLE_CLIENT_ID: 'configured' }), /GOOGLE_CLIENT_SECRET/);
assert.throws(() => fixture({ CASHFREE_ENVIRONMENT: 'production', CASHFREE_SANDBOX_ALLOW_UNVERIFIED_CONTACT: 'true' }), /Unverified production/);

const directory = await mkdtemp(path.join(tmpdir(), 'calup-deploy-test-'));
try {
  const settings = fixture({ RESEND_API_KEY: 'literal$${VALUE}#"quoted"', RESEND_FROM_EMAIL: 'Calup <fixture@example.invalid>' });
  await writeCollegeEnvironment(settings, directory);
  const publicText = await readFile(path.join(directory, '.env'), 'utf8');
  const backendText = await readFile(path.join(directory, '.env.backend'), 'utf8');
  assert(!publicText.includes('RESEND_API_KEY'));
  assert(backendText.includes('RESEND_API_KEY=literal$${VALUE}#"quoted"\n'));
  assert(backendText.includes('ENABLE_TEST_ROUTES=false\n'));
  await writeCollegeEnvironment(fixture({}), directory);
  assert(!(await readFile(path.join(directory, '.env.backend'), 'utf8')).includes('literal$'), 'Reruns replace stale settings');
} finally { await rm(directory, { recursive: true, force: true }); }

// Launch the actual API with fixture-only settings and job ownership disabled.
// Overwrite all template variables to stop dotenv importing real local integration keys.
const env = { ...process.env };
for (const name of (await readFile('.env.example', 'utf8')).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) env[name[1]] = '';
Object.assign(env, prepared.backend, prepared.frontend, { PORT: '0', TOKEN_STORE_MEMORY_ONLY: 'true' });
Object.assign(process.env, env);
const originalFetch = globalThis.fetch;
const externalRequests = [];
globalThis.fetch = (input, ...args) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    externalRequests.push(url.origin);
    return Promise.reject(new Error('External network blocked in deployment fixture'));
  }
  return originalFetch(input, ...args);
};
let server;
try {
  ({ server } = await import('../server/index.js'));
  if (!server.listening) await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal((await response.json()).status, 'ok');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(externalRequests, [], 'Disabled workers must not execute external jobs');
} finally {
  globalThis.fetch = originalFetch;
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
}
console.log('PASS: deployment environment validation, privileged-key isolation, literal secret serialization, stale-file replacement and worker-disabled API startup');
