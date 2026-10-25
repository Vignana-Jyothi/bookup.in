import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Full npm test includes real database/notification suites and is intentionally separate.
const tests = [
  'test-college-deployment.js', 'test-public-api-probe.js', 'test-onboarding-flow.js', 'test-service-links.js',
  'test-admin-same-origin-proxy.js', 'test-customer-same-origin-proxy.js',
  'test-frontend-delivery.js', 'test-buffer-driven-slots.js', 'test-multi-instructor-scheduling.js',
  'test-merchant-onboarding-contract.js', 'test-google-calendar-host-contract.js',
  'test-google-token-storage-contract.js', 'test-subscription-v1-contract.js',
];
const env = { ...process.env };
for (const name of readFileSync('.env.example', 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) env[name[1]] = '';
Object.assign(env, {
  NODE_ENV: 'test', BACKGROUND_WORKERS_ENABLED: 'false', ENABLE_TEST_ROUTES: 'false',
  TOKEN_STORE_MEMORY_ONLY: 'true', VITE_SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_URL: 'https://fixture.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ci_fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'ci-fixture-server-key', TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
  VITE_APP_URL: 'https://calup.example', FRONTEND_URL: 'https://calup.example', VITE_API_URL: '/api',
});
for (const test of tests) {
  console.log(`\nRunning isolated suite: ${test}`);
  const result = spawnSync(process.execPath, [`backend/tests/${test}`], { env, stdio: 'inherit', timeout: 120000 });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS: ${tests.length} isolated suites`);
