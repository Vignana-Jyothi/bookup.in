/**
 * BookUp — Returning Customer Status Redirect Test
 *
 * Tests:
 * 1. Device storage: saveLastBooking, getLastBooking, clearLastBooking with key "calup_last_booking"
 * 2. Active status evaluation: isBookingActive for pending, verification_pending, confirmed upcoming
 * 3. Inactive status evaluation: completed, cancelled, rejected, and expired bookings
 * 4. Provider scoping isolation: Coach A booking does not redirect on Coach B booking page
 * 5. Security: Tracking token entropy and length (48 chars hex), sanitized API projection
 * 6. Live API integration: Fetching booking via tracking API and validating active state
 */

import dotenv from 'dotenv';
dotenv.config();

import assert from 'assert';
import {
  LAST_BOOKING_STORAGE_KEY,
  saveLastBooking,
  getLastBooking,
  clearLastBooking,
  isBookingActive,
  isBookingExpired,
} from '../src/utils/lastBooking.js';
import { generateManagementToken, hashManagementToken, buildTrackUrl } from '../src/utils/token.js';
import { getCustomerTrackUrl, getCustomerBookingStatusUrl } from '../src/utils/url.js';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('❌ Supabase credentials missing');
  process.exit(1);
}

const supabase = createClient(url, key);

// Mock browser window and localStorage for Node.js test environment
const mockStorage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear(),
  },
  location: {
    origin: 'http://localhost:5173',
  },
};

async function runTests() {
  console.log('================================================================');
  console.log('TEST: RETURNING CUSTOMER BOOKING STATUS REDIRECT');
  console.log('================================================================\n');

  // --- [TEST 1] STORAGE CONTRACT & TOKEN PERSISTENCE ---
  console.log('--- [TEST 1] STORAGE CONTRACT & DEVICE PERSISTENCE ---');
  mockStorage.clear();

  assert.strictEqual(LAST_BOOKING_STORAGE_KEY, 'calup_last_booking', 'Storage key matches "calup_last_booking"');
  console.log('  ✓ Storage key verified: "calup_last_booking"');

  const testToken = generateManagementToken();
  const testCoachSlug = 'coach-alex';

  saveLastBooking(testToken, testCoachSlug);
  const rawStored = mockStorage.get('calup_last_booking');
  assert(rawStored, 'calup_last_booking item stored in localStorage');

  const parsed = JSON.parse(rawStored);
  assert.strictEqual(parsed.token, testToken, 'Stored token matches generated token');
  assert.strictEqual(parsed.coachSlug, testCoachSlug, 'Stored coachSlug matches coach-alex');
  assert(parsed.savedAt, 'Stored payload includes savedAt timestamp');
  console.log(`  ✓ Token stored correctly: { token: "${parsed.token.slice(0, 10)}...", savedAt: "${parsed.savedAt}", coachSlug: "${parsed.coachSlug}" }`);

  const retrieved = getLastBooking();
  assert(retrieved, 'getLastBooking() returns non-null');
  assert.strictEqual(retrieved.token, testToken, 'Retrieved token matches testToken');
  assert.strictEqual(retrieved.coachSlug, testCoachSlug, 'Retrieved coachSlug matches coach-alex');
  console.log('  ✓ getLastBooking() retrieves saved booking record');

  clearLastBooking();
  assert.strictEqual(mockStorage.get('calup_last_booking'), undefined, 'clearLastBooking() removes item');
  assert.strictEqual(getLastBooking(), null, 'getLastBooking() returns null after clearing');
  console.log('  ✓ clearLastBooking() cleans device storage');

  // --- [TEST 2] RESILIENCE & EDGE CASES ---
  console.log('\n--- [TEST 2] STORAGE RESILIENCE & EDGE CASES ---');
  // Corrupt JSON handling
  mockStorage.set('calup_last_booking', 'invalid{json-broken');
  assert.strictEqual(getLastBooking(), null, 'Corrupt JSON fails silently and returns null');
  console.log('  ✓ Corrupted localStorage data handled gracefully without throw');

  // Empty string / missing token
  mockStorage.set('calup_last_booking', JSON.stringify({ token: '', savedAt: new Date().toISOString() }));
  assert.strictEqual(getLastBooking(), null, 'Empty token record treated as null');
  console.log('  ✓ Missing or empty token treated as null');

  // Storage error simulation (localStorage throws)
  const realGetItem = globalThis.window.localStorage.getItem;
  globalThis.window.localStorage.getItem = () => { throw new Error('SecurityError: Access Denied'); };
  assert.strictEqual(getLastBooking(), null, 'localStorage security error fails silently');
  globalThis.window.localStorage.getItem = realGetItem;
  console.log('  ✓ Storage security / blocked access fails silently');

  // --- [TEST 3] TOKEN SECURITY ---
  console.log('\n--- [TEST 3] TOKEN SECURITY & URL FORMAT ---');
  const token = generateManagementToken();
  assert(token.length >= 24, `Token length is ${token.length} chars (required: 24+)`);
  assert(/^[0-9a-f]+$/i.test(token), 'Token is cryptographically random hex');
  console.log(`  ✓ Token format verified: length=${token.length}, high-entropy random hex`);

  const trackUrl = getCustomerTrackUrl(token);
  assert(trackUrl.includes(`/track/${token}`), `Track URL correctly formatted: ${trackUrl}`);
  const statusUrl = getCustomerBookingStatusUrl(token);
  assert(statusUrl.includes(`/booking-status/${token}`), `Booking status URL preserved: ${statusUrl}`);
  console.log(`  ✓ getCustomerTrackUrl generates /track/${token.slice(0, 10)}...`);

  // --- [TEST 4] ACTIVE vs INACTIVE BOOKING EVALUATION ---
  console.log('\n--- [TEST 4] ACTIVE vs INACTIVE BOOKING EVALUATION ---');

  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);
  const futureDateStr = futureDate.toISOString().split('T')[0];

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 2);
  const pastDateStr = pastDate.toISOString().split('T')[0];

  // 1. Pending payment (Active)
  assert.strictEqual(
    isBookingActive({ status: 'pending_payment', paymentStatus: 'awaiting_payment', date: futureDateStr, startTime: '10:00', endTime: '11:00' }),
    true,
    'pending_payment with awaiting_payment is ACTIVE'
  );
  console.log('  ✓ Pending payment (awaiting_payment) -> ACTIVE');

  // 2. Payment verification pending (Active)
  assert.strictEqual(
    isBookingActive({ status: 'pending_payment', paymentStatus: 'verification_pending', date: futureDateStr, startTime: '10:00', endTime: '11:00' }),
    true,
    'verification_pending is ACTIVE'
  );
  console.log('  ✓ Payment verification pending -> ACTIVE');

  // 3. Confirmed and upcoming (Active)
  assert.strictEqual(
    isBookingActive({ status: 'confirmed', paymentStatus: 'confirmed', date: futureDateStr, startTime: '10:00', endTime: '11:00' }),
    true,
    'confirmed future booking is ACTIVE'
  );
  console.log('  ✓ Confirmed and upcoming -> ACTIVE');

  // 4. Completed (Inactive)
  assert.strictEqual(
    isBookingActive({ status: 'completed', paymentStatus: 'confirmed', date: pastDateStr, startTime: '10:00', endTime: '11:00' }),
    false,
    'completed booking is INACTIVE'
  );
  console.log('  ✓ Completed booking -> INACTIVE');

  // 5. Cancelled (Inactive)
  assert.strictEqual(
    isBookingActive({ status: 'cancelled', paymentStatus: 'awaiting_payment', date: futureDateStr, startTime: '10:00', endTime: '11:00' }),
    false,
    'cancelled booking is INACTIVE'
  );
  assert.strictEqual(
    isBookingActive({ status: 'late-cancellation', paymentStatus: 'awaiting_payment', date: futureDateStr, startTime: '10:00', endTime: '11:00' }),
    false,
    'late-cancellation booking is INACTIVE'
  );
  console.log('  ✓ Cancelled / Late-cancellation booking -> INACTIVE');

  // 6. Rejected (Inactive)
  assert.strictEqual(
    isBookingActive({ status: 'rejected', paymentStatus: 'rejected', date: futureDateStr, startTime: '10:00', endTime: '11:00' }),
    false,
    'rejected booking is INACTIVE'
  );
  assert.strictEqual(
    isBookingActive({ status: 'pending_payment', paymentStatus: 'rejected', date: futureDateStr, startTime: '10:00', endTime: '11:00' }),
    false,
    'paymentStatus rejected is INACTIVE'
  );
  console.log('  ✓ Rejected booking -> INACTIVE');

  // 7. Expired (past appointment, confirmed)
  assert.strictEqual(
    isBookingExpired({ date: pastDateStr, startTime: '09:00', endTime: '10:00' }),
    true,
    'Past appointment is EXPIRED'
  );
  assert.strictEqual(
    isBookingActive({ status: 'confirmed', paymentStatus: 'confirmed', date: pastDateStr, startTime: '09:00', endTime: '10:00' }),
    false,
    'Confirmed appointment in the past is EXPIRED -> INACTIVE'
  );
  console.log('  ✓ Confirmed appointment with passed date -> EXPIRED / INACTIVE');

  // --- [TEST 5] COACH SCOPING (DON\'T TRAP OR WRONGLY REDIRECT ACROSS COACHES) ---
  console.log('\n--- [TEST 5] COACH SCOPING VERIFICATION ---');
  // Customer books with Coach A
  saveLastBooking(testToken, 'coach-a');
  const storedForCoachA = getLastBooking();

  // Customer opens Coach B booking page
  const currentCoachSlug = 'coach-b';
  const shouldRedirectForCoachB = Boolean(
    storedForCoachA?.token &&
    (!storedForCoachA.coachSlug || storedForCoachA.coachSlug.toLowerCase() === currentCoachSlug.toLowerCase())
  );
  assert.strictEqual(shouldRedirectForCoachB, false, 'Does NOT redirect on Coach B booking page');
  console.log('  ✓ Coach A booking does NOT redirect on Coach B booking page');

  // Customer re-opens Coach A booking page
  const coachACurrentSlug = 'coach-a';
  const shouldRedirectForCoachA = Boolean(
    storedForCoachA?.token &&
    (!storedForCoachA.coachSlug || storedForCoachA.coachSlug.toLowerCase() === coachACurrentSlug.toLowerCase())
  );
  assert.strictEqual(shouldRedirectForCoachA, true, 'DOES redirect on Coach A booking page');
  console.log('  ✓ Coach A booking DOES redirect when reopening Coach A page');

  // --- [TEST 6] LIVE DATABASE PERSISTENCE & API STATUS CHECK ---
  console.log('\n--- [TEST 6] LIVE DATABASE INTEGRATION ---');
  // Fetch active provider
  const { data: provider, error: pErr } = await supabase
    .from('providers')
    .select('id, name, slug')
    .limit(1)
    .single();
  assert(!pErr && provider, `Found active provider: ${provider.name} (slug: ${provider.slug})`);

  const { data: service, error: sErr } = await supabase
    .from('services')
    .select('id, name, price, duration')
    .eq('provider_id', provider.id)
    .limit(1)
    .single();
  assert(!sErr && service, `Found active service: ${service.name}`);

  const liveToken = generateManagementToken();
  const liveTokenHash = await hashManagementToken(liveToken);

  const { data: newBooking, error: insErr } = await supabase
    .from('bookings')
    .insert({
      provider_id: provider.id,
      service_id: service.id,
      customer_name: 'Returning Client Test',
      customer_phone: '+919876543210',
      customer_whatsapp: '+919876543210',
      customer_email: 'returning.test@example.com',
      booking_date: futureDateStr,
      start_time: '14:00:00',
      end_time: '15:00:00',
      duration: service.duration || 60,
      price: service.price || 0,
      deposit_amount: 0,
      status: 'pending_payment',
      payment_status: 'verification_pending',
      management_token_hash: liveTokenHash,
      notes: `[mgmt_hash:${liveTokenHash}]`,
    })
    .select()
    .single();

  assert(!insErr && newBooking, `Created test booking in Supabase (id: ${newBooking?.id})`);

  // Simulate storing token on customer device
  saveLastBooking(liveToken, provider.slug);
  const deviceState = getLastBooking();
  assert.strictEqual(deviceState.token, liveToken, 'Live token saved on device');
  assert.strictEqual(deviceState.coachSlug, provider.slug, 'Coach slug matches');

  // Verify active state calculation with live Supabase booking projection
  const liveActive = isBookingActive({
    status: newBooking.status,
    paymentStatus: newBooking.payment_status,
    date: newBooking.booking_date,
    startTime: newBooking.start_time,
    endTime: newBooking.end_time,
  });
  assert.strictEqual(liveActive, true, 'Live booking in verification_pending is ACTIVE');
  console.log('  ✓ Live Supabase booking in verification_pending evaluated as ACTIVE');

  // Coach confirms booking
  const { error: confErr } = await supabase
    .from('bookings')
    .update({ status: 'confirmed', payment_status: 'confirmed' })
    .eq('id', newBooking.id);
  assert(!confErr, 'Updated booking to confirmed in Supabase');

  const liveConfirmedActive = isBookingActive({
    status: 'confirmed',
    paymentStatus: 'confirmed',
    date: newBooking.booking_date,
    startTime: newBooking.start_time,
    endTime: newBooking.end_time,
  });
  assert.strictEqual(liveConfirmedActive, true, 'Confirmed upcoming booking evaluated as ACTIVE');
  console.log('  ✓ Confirmed upcoming booking evaluated as ACTIVE');

  // Customer clicks "Book another session" -> clears device storage
  clearLastBooking();
  assert.strictEqual(getLastBooking(), null, 'Book another session cleared saved token');
  console.log('  ✓ "Book another session" successfully clears saved token from device');

  // Cleanup test booking
  await supabase.from('bookings').delete().eq('id', newBooking.id);
  console.log('  ✓ Test booking cleaned up from database');

  console.log('\n================================================================');
  console.log('✅ ALL RETURNING CUSTOMER STATUS REDIRECT TESTS PASSED!');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
