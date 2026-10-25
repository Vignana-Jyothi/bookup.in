import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Full npm test includes real database/notification suites and is intentionally separate.
const tests = [
  'test-deployment-container-runner.js',
  'test-payment-notification-scheduler.js',
  'test-booking-phone-verification.js',
  'test-audit-dev-environment.js',
  'test-booking-calendar-preflight-contract.js',
  'test-calendar-invites.js',
  'test-calendar-route-authorization.js',
  'test-cashfree-dispatch-recovery.js',
  'test-cashfree-dispatch.js',
  'test-cashfree-payment-evidence.js',
  'test-cashfree-response-boundaries.js',
  'test-cashfree-webhook-boundaries.js',
  'test-checkout-calendar-availability.js',
  'test-google-calendar-safety.js',
  'test-integration-gateway-context-contract.js',
  'test-payment-notification-contract.js',
  'test-payment-notifications.js',
  'test-subscription-payment-evidence.js',
  'test-subscription-refund-identity.js',
  'test-audit-database-runner.js',
  'test-release-readiness-contract.js',
  'test-release-database-probe.js',
  'test-provider-read-errors.js',
  'test-email-deadline.js',
  'test-pending-booking-overlap-contract.js',
  'test-booking-table-access-contract.js',
  'test-subscription-refund-terminal.js',
  'test-bounded-frontend-fetch.js',
  'test-customer-booking-timing.js',
  'test-customer-reschedule-availability.js',
  'test-production-diagnostics.js',
  'test-booking-time-policy.js',
  'test-backend-bounded-fetch.js',
  'test-public-booking-cancel-state.js',
  'test-keyed-lock.js',
  'test-customer-booking-first-party.js',
  'test-provider-ownership.js',
  'test-legacy-booking-rpc-access.js',
  'test-internal-notification-auth.js',
  'test-manual-payment-transition-races.js',
  'test-manual-refund-lifecycle.js',
  'test-frontend-request-races.js',
  'test-public-booking-reschedule-atomic.js',
  'test-accessibility-ui.js',
  'test-merchant-appointment-truth.js',
  'test-subscription-order-feedback.js',
  'test-api-route-contract.js',
  'test-cashfree-client.js',
  'test-cashfree-checkout-sdk.js',
  'test-payment-status-recovery.js',
  'test-confirmed-feedback.js',
  'test-cashfree-booking-session.js',
  'test-pending-booking-payments.js',
  'test-cashfree-v1-contract.js',
  'test-cashfree-public-availability.js',
  'test-merchant-appointments-contract.js',
  'test-dashboard-data.js',
  'test-college-deployment.js', 'test-public-api-probe.js', 'test-public-booking-payment-scope.js',
  'test-onboarding-flow.js', 'test-service-links.js',
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
