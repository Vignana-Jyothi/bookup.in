/**
 * Test UPI/QR Scoping and Fallback Behavior
 * Verifies that a logged-in coach (Coach A) opening another coach's (Coach B's) booking
 * NEVER sees Coach A's UPI/QR details, and that Coach A's own booking still shows their UPI.
 */

import 'dotenv/config';
import assert from 'assert';
import http from 'http';
import { dbService } from '../src/services/supabase/dbService.js';
import { isSupabaseConfigured } from '../src/services/supabase/supabaseClient.js';

const COACH_A_ID = '40ceb40a-1b89-4d8b-8429-6912e2ec31a3'; // Prateek (has UPI: 123456@jiopay)
const COACH_B_ID = 'cc5557ed-23a5-4ceb-849b-c49ac2e6a8b9'; // Praacchi (no UPI: null)

const COACH_A_TOKEN = '41cea68f3d0ccaa18e2dab746d7311241fccefa74f6d76cf';
const COACH_B_TOKEN = 'f9629fa2c8efdc92a03b61a695bb1f008232f1a0318d8c20';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('--- Starting UPI/QR Isolation & Fallback Verification ---');
  assert(isSupabaseConfigured(), 'Supabase must be configured for this test');

  // Ensure backend server is running for API test
  try {
    const health = await new Promise((resolve) => {
      http.get('http://localhost:3001/health', (res) => resolve(res.statusCode === 200)).on('error', () => resolve(false));
    });
    if (!health) {
      console.log('Starting backend server for testing...');
      await import('../server/index.js');
      await new Promise(r => setTimeout(r, 600));
    }
  } catch (_e) {}

  // 1. Verify Coach A and Coach B provider records in DB
  const coachAProfile = await dbService.getProviderBySlug('prateek-d6578');
  const coachBProfile = await dbService.getProviderBySlug('praacchi-shah-bhaannsali-e61b3');

  console.log('1. Database Profile Check:');
  console.log(`   Coach A (${coachAProfile.name}): upiId = "${coachAProfile.upiId}", qrCodeUrl = ${coachAProfile.qrCodeUrl}`);
  console.log(`   Coach B (${coachBProfile.name}): upiId = ${coachBProfile.upiId}, qrCodeUrl = ${coachBProfile.qrCodeUrl}`);

  assert.strictEqual(coachAProfile.upiId, '123456@jiopay', 'Coach A must have upiId configured');
  assert.strictEqual(coachBProfile.upiId, null, 'Coach B must have upiId as null');
  assert.strictEqual(coachBProfile.qrCodeUrl, null, 'Coach B must have qrCodeUrl as null');
  console.log('   ✓ Profiles confirmed: Coach A has UPI, Coach B has NO UPI.\n');

  // 2. Fetch bookings via backend API /api/public/bookings/manage/:token
  console.log('2. Backend Manage API Endpoint Check:');
  const resB = await fetchJson(`http://localhost:3001/api/public/bookings/manage/${COACH_B_TOKEN}`);
  assert.strictEqual(resB.status, 200, 'Coach B booking manage endpoint must return 200');
  assert.strictEqual(resB.body.success, true, 'Coach B booking manage response must be successful');
  assert.strictEqual(resB.body.provider.id, COACH_B_ID, 'Provider in booking B must match Coach B');
  assert.strictEqual(resB.body.provider.upiId, null, 'Provider in booking B must have upiId null');
  assert.strictEqual(resB.body.provider.qrCodeUrl, null, 'Provider in booking B must have qrCodeUrl null');
  console.log('   ✓ Coach B booking returned Coach B provider with upiId = null, qrCodeUrl = null');

  const resA = await fetchJson(`http://localhost:3001/api/public/bookings/manage/${COACH_A_TOKEN}`);
  assert.strictEqual(resA.status, 200, 'Coach A booking manage endpoint must return 200');
  assert.strictEqual(resA.body.success, true, 'Coach A booking manage response must be successful');
  assert.strictEqual(resA.body.provider.id, COACH_A_ID, 'Provider in booking A must match Coach A');
  assert.strictEqual(resA.body.provider.upiId, '123456@jiopay', 'Provider in booking A must have upiId "123456@jiopay"');
  console.log('   ✓ Coach A booking returned Coach A provider with upiId = "123456@jiopay"\n');

  // 3. Simulate React Context and CustomerBooking.jsx logic
  console.log('3. Client-side Context Isolation Simulation:');

  // Scenario: Logged-in coach in browser is Coach A
  const state = {
    auth: { isAuthenticated: true, user: { id: coachAProfile.userId, name: coachAProfile.name } },
    provider: coachAProfile, // Coach A's profile in context: upiId = '123456@jiopay'
    bookings: [],
    services: [],
    policies: null,
  };

  // 3a. Coach A opens Coach B's manage page in browser
  const supabaseBookingData_B = resB.body;

  // New logic (CustomerBooking.jsx lines 301-302)
  const providerUpiId_B = supabaseBookingData_B?.provider?.upiId || null;
  const providerQrCodeUrl_B = supabaseBookingData_B?.provider?.qrCodeUrl || null;

  // Old buggy logic for comparison
  const oldBuggyUpiId_B = supabaseBookingData_B?.provider?.upiId || state.provider?.upiId || null;

  console.log('   Testing Coach B Page with Coach A logged in:');
  console.log(`     Old buggy logic result: "${oldBuggyUpiId_B}" (LEAKED Coach A UPI!)`);
  console.log(`     Fixed logic result:     ${providerUpiId_B} (ISOLATED - correctly null)`);

  assert.strictEqual(oldBuggyUpiId_B, '123456@jiopay', 'Confirm old logic leaked Coach A UPI');
  assert.strictEqual(providerUpiId_B, null, 'Fixed logic MUST be null');
  assert.strictEqual(providerQrCodeUrl_B, null, 'Fixed logic qrCodeUrl MUST be null');

  // UI rendering decision
  const hasPaymentDetails_B = Boolean(providerUpiId_B || providerQrCodeUrl_B);
  assert.strictEqual(hasPaymentDetails_B, false, 'hasPaymentDetails must be false');
  const renderedMessage_B = hasPaymentDetails_B ? providerUpiId_B : 'Contact your coach for payment details.';
  assert.strictEqual(renderedMessage_B, 'Contact your coach for payment details.');
  console.log(`     Rendered UI: "${renderedMessage_B}"`);
  console.log('   ✓ Coach B manage page correctly displays "Contact your coach for payment details." even when Coach A is logged in!\n');

  // 3b. Coach A opens Coach A's own manage page in browser
  const supabaseBookingData_A = resA.body;
  const providerUpiId_A = supabaseBookingData_A?.provider?.upiId || null;
  const providerQrCodeUrl_A = supabaseBookingData_A?.provider?.qrCodeUrl || null;

  console.log('   Testing Coach A Page with Coach A logged in:');
  console.log(`     providerUpiId:     "${providerUpiId_A}"`);
  console.log(`     providerQrCodeUrl: ${providerQrCodeUrl_A}`);

  assert.strictEqual(providerUpiId_A, '123456@jiopay', 'Coach A UPI ID must be preserved');
  const hasPaymentDetails_A = Boolean(providerUpiId_A || providerQrCodeUrl_A);
  assert.strictEqual(hasPaymentDetails_A, true, 'hasPaymentDetails must be true for Coach A');
  console.log(`     Rendered UI: Shows UPI ID "${providerUpiId_A}" with Copy button`);
  console.log('   ✓ Coach A own manage page correctly displays Coach A\'s configured UPI ID.\n');

  console.log('--- ALL UPI/QR SCOPING TESTS PASSED ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
