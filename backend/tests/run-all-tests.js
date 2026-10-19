import { spawnSync } from 'child_process';
import path from 'path';

process.env.DISABLE_RATE_LIMIT = 'true';
process.env.ENABLE_TEST_ROUTES = 'true';
process.env.NODE_ENV = 'test';
process.env.TOKEN_STORE_MEMORY_ONLY = 'true';

const testFiles = [
  'backend/tests/test-accessibility-ui.js',
  'backend/tests/test-admin-same-origin-proxy.js',
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
