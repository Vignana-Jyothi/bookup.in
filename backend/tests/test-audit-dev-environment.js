import assert from 'node:assert/strict';
import { auditEnvironment } from '../scripts/run-audit-dev.mjs';

const ref = 'jmgylovlxiiomvcejuhd';
const jwt = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;
const settings = {
  CALUP_AUDIT_PROJECT_REF: ref,
  SUPABASE_URL: `https://${ref}.supabase.co`,
  VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref }),
  CASHFREE_ENVIRONMENT: 'sandbox',
};
const env = auditEnvironment(settings, { PATH: 'fixture-path', GOOGLE_CLIENT_SECRET: 'old-secret', BACKGROUND_WORKERS_ENABLED: 'true' }, { SUPABASE_ANON_KEY: 'old-key', RESEND_API_KEY: 'old-email-key' });
assert.equal(env.PATH, 'fixture-path');
for (const key of ['GOOGLE_CLIENT_SECRET', 'SUPABASE_ANON_KEY', 'RESEND_API_KEY']) assert.equal(env[key], '');
assert.equal(env.BACKGROUND_WORKERS_ENABLED, 'false');
assert.equal(env.SUPABASE_URL, settings.SUPABASE_URL);
assert.equal(env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, '');
for (const patch of [
  { SUPABASE_URL: 'https://original.supabase.co' },
  { VITE_SUPABASE_URL: 'https://original.supabase.co' },
  { SUPABASE_SERVICE_ROLE_KEY: '' },
  { SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: 'original' }) },
  { VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role', ref }) },
  { VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon', ref: 'original' }) },
  { CASHFREE_ENVIRONMENT: 'production' },
  { CASHFREE_V1_ENABLED: 'true', CASHFREE_CLIENT_ID: 'PROD', CASHFREE_CLIENT_SECRET: 'fixture' },
  { CASHFREE_V1_ENABLED: 'true', CASHFREE_CLIENT_ID: 'TEST_fixture', CASHFREE_CLIENT_SECRET: 'fixture', BACKEND_PUBLIC_URL: 'http://localhost:5173' },
  { CASHFREE_MARKETPLACE_ENABLED: 'true' },
]) assert.throws(() => auditEnvironment({ ...settings, ...patch }));
assert.equal(auditEnvironment({ ...settings, CASHFREE_V1_ENABLED: 'true', CASHFREE_CLIENT_ID: 'TEST_fixture', CASHFREE_CLIENT_SECRET: 'fixture', BACKEND_PUBLIC_URL: 'https://fixture.ngrok-free.dev' }).CASHFREE_ENVIRONMENT, 'sandbox');
console.log('PASS: audit launcher fences project/key, rejects live gateway configuration, and prevents original environment fallback.');
assert.equal(auditEnvironment({ ...settings, BACKEND_PUBLIC_URL: 'https://fixture.ngrok-free.dev' }, { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: '.evil.example' }).__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, 'fixture.ngrok-free.dev');
