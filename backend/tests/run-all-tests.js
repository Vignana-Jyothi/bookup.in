import { spawnSync } from 'child_process';
import path from 'path';

process.env.DISABLE_RATE_LIMIT = 'true';
process.env.ENABLE_TEST_ROUTES = 'true';
process.env.NODE_ENV = 'test';
process.env.TOKEN_STORE_MEMORY_ONLY = 'true';

const testFiles = [
  'backend/tests/test-deployment-container-runner.js',
  'backend/tests/test-payment-notification-scheduler.js',
  'backend/tests/test-booking-phone-verification.js',
  'backend/tests/test-audit-dev-environment.js',
  'backend/tests/test-booking-calendar-preflight-contract.js',
  'backend/tests/test-calendar-invites.js',
  'backend/tests/test-calendar-route-authorization.js',
  'backend/tests/test-cashfree-dispatch-recovery.js',
  'backend/tests/test-cashfree-dispatch.js',
  'backend/tests/test-cashfree-payment-evidence.js',
  'backend/tests/test-cashfree-response-boundaries.js',
  'backend/tests/test-cashfree-webhook-boundaries.js',
  'backend/tests/test-checkout-calendar-availability.js',
  'backend/tests/test-google-calendar-safety.js',
  'backend/tests/test-integration-gateway-context-contract.js',
  'backend/tests/test-payment-notification-contract.js',
  'backend/tests/test-payment-notifications.js',
  'backend/tests/test-subscription-payment-evidence.js',
  'backend/tests/test-subscription-refund-identity.js',
  'backend/tests/test-audit-database-runner.js',
  'backend/tests/test-release-readiness-contract.js',
  'backend/tests/test-release-database-probe.js',
  'backend/tests/test-provider-read-errors.js',
  'backend/tests/test-email-deadline.js',
  'backend/tests/test-pending-booking-overlap-contract.js',
  'backend/tests/test-booking-table-access-contract.js',
  'backend/tests/test-subscription-refund-terminal.js',
  'backend/tests/test-bounded-frontend-fetch.js',
  'backend/tests/test-customer-booking-timing.js',
  'backend/tests/test-customer-reschedule-availability.js',
  'backend/tests/test-production-diagnostics.js',
  'backend/tests/test-booking-time-policy.js',
  'backend/tests/test-backend-bounded-fetch.js',
  'backend/tests/test-public-booking-cancel-state.js',
  'backend/tests/test-keyed-lock.js',
  'backend/tests/test-customer-booking-first-party.js',
  'backend/tests/test-provider-ownership.js',
  'backend/tests/test-legacy-booking-rpc-access.js',
  'backend/tests/test-internal-notification-auth.js',
  'backend/tests/test-manual-payment-transition-races.js',
  'backend/tests/test-manual-refund-lifecycle.js',
  'backend/tests/test-frontend-request-races.js',
  'backend/tests/test-public-booking-reschedule-atomic.js',
  'backend/tests/test-college-deployment.js',
  'backend/tests/test-public-api-probe.js',
  'backend/tests/test-public-booking-payment-scope.js',
  'backend/tests/test-onboarding-flow.js',
  'backend/tests/test-service-links.js',
  'backend/tests/test-accessibility-ui.js',
  'backend/tests/test-public-sandbox.js',
  'backend/tests/test-merchant-appointment-truth.js',
  'backend/tests/test-subscription-order-feedback.js',
  'backend/tests/test-admin-same-origin-proxy.js',
  'backend/tests/test-customer-same-origin-proxy.js',
  'backend/tests/test-merchant-phone-verification.js',
  'backend/tests/test-commerce-payments.js',
  'backend/tests/test-merchant-commerce.js',
  'backend/tests/test-commerce-customer-access.js',
  'backend/tests/test-admin-phone-mfa.js',
  'backend/tests/test-admin-dashboard.js',
  'backend/tests/test-admin-booking-refunds.js',
  'backend/tests/test-frontend-delivery.js',
  'backend/tests/test-api-route-contract.js',
  'backend/tests/test-support-tickets.js',
  'backend/tests/test-appointment-whatsapp.js',
  'backend/tests/test-booking-refund-requests.js',
  'backend/tests/test-google-calendar-host-contract.js',
  'backend/tests/test-google-token-storage-contract.js',
  'backend/tests/test-merchant-onboarding-contract.js',
  'backend/tests/test-password-management.js',
  // 'backend/tests/test-navigation.js', // Disabled with the navigation enhancements.
  'backend/tests/test-two-factor-otp.js',
  'backend/tests/test-subscription-v1-contract.js',
  'backend/tests/test-cashfree-client.js',
  'backend/tests/test-cashfree-checkout-sdk.js',
  'backend/tests/test-payment-status-recovery.js',
  'backend/tests/test-confirmed-feedback.js',
  'backend/tests/test-cashfree-booking-session.js',
  'backend/tests/test-pending-booking-payments.js',
  'backend/tests/test-cashfree-v1-contract.js',
  'backend/tests/test-cashfree-public-availability.js',
  'backend/tests/test-buffer-driven-slots.js',
  'backend/tests/test-multi-instructor-scheduling.js',
  'backend/tests/test-merchant-appointments-contract.js',
  'backend/tests/test-dashboard-data.js',
  'backend/tests/test-customer-booking-management.js',
  'backend/tests/test-phase1-verification.js',
  'backend/tests/test-phase4-whatsapp.js',
  'backend/tests/test-phase4b-email.js',
  'backend/tests/test-verified-domain.js',
  'backend/tests/test-payment-confirmation-notifications.js',
  'backend/tests/test-email-flow.js',
  'backend/tests/test-reject-payment-flow.js',
  'backend/tests/test-public-busy-slots.js',
  'backend/tests/test-slot-granularity-and-directions.js',
  'backend/tests/test-onboarding-slug-and-zero-services.js',
  'backend/tests/test-complete-real-user-flow.js',
  'backend/tests/test-upi-scoping.js',
  'backend/tests/test-payment-flow-fixes.js',
  'backend/tests/test-returning-customer-redirect.js',
  'backend/tests/test-concurrency-race-regression.js',
  'backend/tests/test-customer-booking-hooks-order.js',
  'backend/tests/test-security-hardening.js',
];

console.log('Running test suite (' + testFiles.length + ' test files)...');
let allPassed = true;

for (const testFile of testFiles) {
  console.log(`\n================================================================`);
  console.log(`RUNNING: ${testFile}`);
  console.log(`================================================================`);
  const result = spawnSync(process.execPath, [testFile], {
    encoding: 'utf-8',
    shell: false,
    env: { ...process.env, ENABLE_TEST_ROUTES: 'true', NODE_ENV: 'test', TOKEN_STORE_MEMORY_ONLY: 'true' },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error);

  const combinedOutput = (result.stdout || '') + '\n' + (result.stderr || '');
  const failLine = combinedOutput.split('\n').find(line => {
    const trimmed = line.trim();
    return trimmed.startsWith('❌') || trimmed.startsWith('FAIL');
  });

  if (result.status !== 0 || failLine) {
    console.error(`\n❌ ${testFile} FAILED (exit code: ${result.status}, detected failure line: "${failLine?.trim()}")`);
    allPassed = false;
    process.exit(result.status || 1);
  } else {
    console.log(`✓ ${testFile} PASSED`);
  }
}

console.log('\n================================================================');
console.log('🎉 ALL TEST SUITES PASSED SUCCESSFULLY!');
console.log('================================================================');
process.exit(0);
