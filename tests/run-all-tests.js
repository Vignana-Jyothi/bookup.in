import { spawnSync } from 'child_process';
import path from 'path';

process.env.DISABLE_RATE_LIMIT = 'true';
process.env.ENABLE_TEST_ROUTES = 'true';

const testFiles = [
  'tests/test-customer-booking-management.js',
  'tests/test-phase1-verification.js',
  'tests/test-phase4-whatsapp.js',
  'tests/test-phase4b-email.js',
  'tests/test-verified-domain.js',
  'tests/test-payment-confirmation-notifications.js',
  'tests/test-email-flow.js',
  'tests/test-reject-payment-flow.js',
  'tests/test-public-busy-slots.js',
  'tests/test-slot-granularity-and-directions.js',
  'tests/test-onboarding-slug-and-zero-services.js',
  'tests/test-complete-real-user-flow.js',
  'tests/test-upi-scoping.js',
  'tests/test-payment-flow-fixes.js',
  'tests/test-returning-customer-redirect.js',
  'tests/test-concurrency-race-regression.js',
  'tests/test-customer-booking-hooks-order.js',
  'tests/test-security-hardening.js',
];

console.log('Running test suite (' + testFiles.length + ' test files)...');
let allPassed = true;

for (const testFile of testFiles) {
  console.log(`\n================================================================`);
  console.log(`RUNNING: ${testFile}`);
  console.log(`================================================================`);
  const result = spawnSync('node', [testFile], {
    encoding: 'utf-8',
    shell: true,
    env: { ...process.env, ENABLE_TEST_ROUTES: 'true' },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

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
