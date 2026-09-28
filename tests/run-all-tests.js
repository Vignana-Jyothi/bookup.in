import { spawnSync } from 'child_process';
import path from 'path';

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
];

console.log('Running test suite (' + testFiles.length + ' test files)...');
let allPassed = true;

for (const testFile of testFiles) {
  console.log(`\n================================================================`);
  console.log(`RUNNING: ${testFile}`);
  console.log(`================================================================`);
  const result = spawnSync('node', [testFile], {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`❌ ${testFile} failed with exit code ${result.status}`);
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
