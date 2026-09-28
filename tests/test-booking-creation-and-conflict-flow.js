/**
 * CalUp — Test Suite: Booking Creation, Conflict Handling, and Phantom Slot Elimination
 *
 * Verifies:
 * 1. A customer books an available slot successfully and receives the correct confirmation (201 Created).
 * 2. A failed booking attempt (invalid service, missing params) does NOT create a phantom booking or hold.
 * 3. The customer can retry after a failure and successfully book the slot if it remains available.
 * 4. Attempting to book an already occupied slot returns HTTP 409 Conflict.
 * 5. Concurrent booking attempts for the same slot: exactly one succeeds (201) and the other is rejected (409).
 * 6. GET /api/public/busy-slots accurately returns only committed confirmed bookings (no stale holds).
 * 7. Both online and in-person meeting modes persist correctly with locations and maps links.
 */

import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { customerBookingService } from '../src/services/booking/customerBookingService.js';
import { config } from '../server/config.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || config.supabaseUrl;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || config.supabaseServiceRoleKey || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || config.supabaseKey;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: BOOKING CREATION, CONFLICTS & PHANTOM SLOT PREVENTION');
  console.log('================================================================');

  // Ensure backend is reachable
  const healthCheck = await fetch('http://localhost:3001/health').catch(() => null);
  if (!healthCheck || !healthCheck.ok) {
    await import('../server/index.js');
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  // Find a provider with services in the database
  const { data: providers } = await sb.from('providers').select('*').limit(5);
  assert(providers && providers.length > 0, 'Must have at least one provider');

  let provider = null;
  let service = null;

  for (const p of providers) {
    const { data: svcs } = await sb.from('services').select('*').eq('provider_id', p.id).eq('active', true).limit(1);
    if (svcs && svcs.length > 0) {
      provider = p;
      service = svcs[0];
      break;
    }
  }

  assert(provider && service, 'Found provider with active service in database');
  console.log(`Using test provider: "${provider.name}" (${provider.id}), service: "${service.name}" (${service.id})`);

  // Use a unique far-future test date
  const randomOffset = 180 + Math.floor(Math.random() * 50);
  const testDate = new Date(Date.now() + randomOffset * 86400000).toISOString().split('T')[0];
  console.log(`Isolated test date: ${testDate}`);

  const cleanupBookingIds = [];

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Successful Booking Creation
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST 1] SUCCESSFUL BOOKING CREATION & CONFIRMATION ---');
    const slot1Time = '10:00';
    const bookingRes = await customerBookingService.createBooking({
      providerId: provider.id,
      serviceId: service.id,
      customerName: 'Aarav Sharma',
      customerEmail: 'aarav@example.com',
      customerPhone: '+919876543210',
      customerWhatsApp: '+919876543210',
      bookingDate: testDate,
      startTime: slot1Time,
      meetingType: 'online',
    });

    assert(bookingRes.success === true, 'Booking creation should succeed with success: true');
    assert(bookingRes.bookingId, 'Booking response must include bookingId');
    assert(bookingRes.managementToken, 'Booking response must include managementToken');
    assert(bookingRes.managementUrl, 'Booking response must include managementUrl');
    cleanupBookingIds.push(bookingRes.bookingId);
    console.log(`  ✓ Slot ${slot1Time} booked successfully (Booking ID: ${bookingRes.bookingId})`);
    console.log(`  ✓ Management URL: ${bookingRes.managementUrl}`);

    // Verify row committed to database
    const { data: dbBooking } = await sb.from('bookings').select('*').eq('id', bookingRes.bookingId).single();
    assert(dbBooking, 'Booking record must exist in Supabase database');
    assert.strictEqual(dbBooking.status, 'confirmed', 'Booking status must be confirmed');
    assert.strictEqual(dbBooking.start_time, '10:00', 'Booking start_time must be 10:00');
    console.log('  ✓ Booking row verified in Supabase with status: confirmed');

    // -------------------------------------------------------------------------
    // TEST 2: Busy Slots Reflect Committed Booking Only (No Phantom Holds)
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST 2] BUSY SLOTS REFLECTION ---');
    const busyRes = await fetch(`http://localhost:3001/api/public/busy-slots?providerId=${provider.id}&date=${testDate}`);
    assert(busyRes.ok, 'Busy slots endpoint should return 200');
    const busyJson = await busyRes.json();
    assert(Array.isArray(busyJson.busySlots), 'busySlots must be an array');
    const hasSlot1 = busyJson.busySlots.some(s => s.start_time === '10:00');
    assert(hasSlot1, 'Committed booking at 10:00 must appear in busy slots');
    console.log(`  ✓ Slot 10:00 accurately returned in busy intervals (count: ${busyJson.busySlots.length})`);

    // -------------------------------------------------------------------------
    // TEST 3: Duplicate Booking on Same Slot Returns 409 Conflict
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST 3] DUPLICATE BOOKING ATTEMPT (EXPECT 409 CONFLICT) ---');
    let duplicateError = null;
    try {
      await customerBookingService.createBooking({
        providerId: provider.id,
        serviceId: service.id,
        customerName: 'Second Client',
        customerEmail: 'client2@example.com',
        customerPhone: '+919876543211',
        bookingDate: testDate,
        startTime: slot1Time,
        meetingType: 'online',
      });
    } catch (err) {
      duplicateError = err;
    }

    assert(duplicateError, 'Duplicate booking attempt must throw an error');
    assert.strictEqual(duplicateError.status, 409, 'Duplicate booking must return HTTP 409 Conflict');
    assert(
      duplicateError.message.includes('no longer available') || duplicateError.isConflict,
      'Error message must indicate slot is no longer available'
    );
    console.log(`  ✓ Duplicate booking correctly rejected with HTTP 409: "${duplicateError.message}"`);

    // -------------------------------------------------------------------------
    // TEST 4: Failed Request Does NOT Create Phantom Bookings or Stale Holds
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST 4] FAILED ATTEMPT CREATES NO PHANTOM BOOKINGS ---');
    const slot2Time = '11:30';
    let failedError = null;
    try {
      await customerBookingService.createBooking({
        providerId: provider.id,
        serviceId: '00000000-0000-0000-0000-000000000000', // Non-existent service
        customerName: 'Failed Attempt Customer',
        customerEmail: 'failed@example.com',
        customerPhone: '+919999999999',
        bookingDate: testDate,
        startTime: slot2Time,
        meetingType: 'online',
      });
    } catch (err) {
      failedError = err;
    }

    assert(failedError, 'Invalid service request must fail');
    console.log(`  ✓ Invalid booking rejected as expected: "${failedError.message}"`);

    // Verify database has NO booking for slot2Time
    const { data: phantomCheck } = await sb
      .from('bookings')
      .select('id')
      .eq('provider_id', provider.id)
      .eq('booking_date', testDate)
      .eq('start_time', slot2Time);

    assert.strictEqual(phantomCheck.length, 0, 'No booking record should exist for failed attempt');
    console.log('  ✓ Verified 0 phantom bookings created in Supabase database');

    // Verify slot2Time is still free in busy slots
    const busyCheckAfterFail = await fetch(`http://localhost:3001/api/public/busy-slots?providerId=${provider.id}&date=${testDate}`).then(r => r.json());
    const slot2Busy = busyCheckAfterFail.busySlots.some(s => s.start_time === slot2Time);
    assert.strictEqual(slot2Busy, false, 'Slot 11:30 must remain completely free and available');
    console.log(`  ✓ Slot ${slot2Time} remains completely free and available for booking`);

    // -------------------------------------------------------------------------
    // TEST 5: Customer Retries After Failure and Successfully Books
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST 5] CUSTOMER RETRY AFTER FAILURE ---');
    const retryRes = await customerBookingService.createBooking({
      providerId: provider.id,
      serviceId: service.id,
      customerName: 'Failed Attempt Customer',
      customerEmail: 'failed@example.com',
      customerPhone: '+919999999999',
      bookingDate: testDate,
      startTime: slot2Time,
      meetingType: 'online',
    });

    assert(retryRes.success === true, 'Retry with valid service should succeed');
    assert(retryRes.bookingId, 'Retry response must contain bookingId');
    cleanupBookingIds.push(retryRes.bookingId);
    console.log(`  ✓ Customer retry succeeded! Booking ID: ${retryRes.bookingId} at ${slot2Time}`);

    // -------------------------------------------------------------------------
    // TEST 6: In-Person Booking with Snapshotted Location & Directions
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST 6] IN-PERSON BOOKING WITH SNAPSHOTTED LOCATION ---');
    const slot3Time = '14:00';
    const testLocation = '100 Indiranagar 100ft Rd, Bengaluru, Karnataka 560038';
    const inPersonRes = await customerBookingService.createBooking({
      providerId: provider.id,
      serviceId: service.id,
      customerName: 'Pooja Reddy',
      customerEmail: 'pooja@example.com',
      customerPhone: '+919123456780',
      bookingDate: testDate,
      startTime: slot3Time,
      meetingType: 'in-person',
      locationAddress: testLocation,
    });

    assert(inPersonRes.success === true, 'In-person booking must succeed');
    assert.strictEqual(inPersonRes.meetingType, 'in-person', 'meetingType must be in-person');
    assert(inPersonRes.locationAddress?.includes('Indiranagar'), 'locationAddress must be present');
    assert(inPersonRes.mapsLink?.includes('google.com/maps'), 'mapsLink must be valid Google Maps URL');
    cleanupBookingIds.push(inPersonRes.bookingId);
    console.log(`  ✓ In-Person booking confirmed at ${slot3Time}:`);
    console.log(`    Location: "${inPersonRes.locationAddress}"`);
    console.log(`    Maps Link: "${inPersonRes.mapsLink}"`);

    // -------------------------------------------------------------------------
    // TEST 7: Race Condition / Concurrency Lock Protection
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST 7] CONCURRENT ATTEMPTS FOR SAME SLOT ---');
    const raceSlot = '16:00';
    const [raceA, raceB] = await Promise.allSettled([
      customerBookingService.createBooking({
        providerId: provider.id,
        serviceId: service.id,
        customerName: 'Concurrent Client A',
        customerPhone: '+919876500001',
        bookingDate: testDate,
        startTime: raceSlot,
        meetingType: 'online',
      }),
      customerBookingService.createBooking({
        providerId: provider.id,
        serviceId: service.id,
        customerName: 'Concurrent Client B',
        customerPhone: '+919876500002',
        bookingDate: testDate,
        startTime: raceSlot,
        meetingType: 'online',
      }),
    ]);

    const successes = [raceA, raceB].filter(r => r.status === 'fulfilled');
    const conflicts = [raceA, raceB].filter(r => r.status === 'rejected' && r.reason?.status === 409);

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent booking attempt must succeed');
    assert.strictEqual(conflicts.length, 1, 'Exactly one concurrent booking attempt must receive 409 Conflict');
    cleanupBookingIds.push(successes[0].value.bookingId);
    console.log('  ✓ Concurrency lock verified: Exactly 1 succeeded (201), exactly 1 rejected with 409 Conflict');

    // Verify database only has 1 record for this slot
    const { data: raceDbBookings } = await sb
      .from('bookings')
      .select('id, customer_name')
      .eq('provider_id', provider.id)
      .eq('booking_date', testDate)
      .eq('start_time', raceSlot);

    assert.strictEqual(raceDbBookings.length, 1, 'Database must have exactly 1 record for the contested slot');
    console.log(`  ✓ Database integrity verified: 1 record exists (Won by "${raceDbBookings[0].customer_name}")`);

    console.log('\n================================================================');
    console.log('🎉 ALL BOOKING CREATION & CONFLICT TESTS PASSED PERFECTLY!');
    console.log('================================================================');
  } finally {
    // Cleanup test bookings
    if (cleanupBookingIds.length > 0) {
      console.log('\nCleaning up test bookings...');
      await sb.from('bookings').delete().in('id', cleanupBookingIds);
      console.log(`Cleanup complete (${cleanupBookingIds.length} bookings removed).`);
    }
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
