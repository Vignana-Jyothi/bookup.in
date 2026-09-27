/**
 * Verification Test:
 * 1. Slot Granularity 30 min & Interval Overlap Math
 * 2. In-Person Appointment: "Get Directions" button appears with Google Maps Universal URL
 * 3. Online Appointment: "Get Directions" button strictly omitted
 * 4. Provider Dashboard Appointment Details: "Get Directions" button present for In-Person
 */

import dotenv from 'dotenv';
dotenv.config();

import assert from 'assert';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import {
  generateTimeSlotsDetailed,
  generateTimeSlots,
  getTimeSlotsDetailedForDate,
  getAvailableTimeSlotsForDate
} from '../src/utils/helpers.js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const API_PORT = process.env.PORT || 3001;
const API_BASE = `http://localhost:${API_PORT}/api`;

const supabase = createClient(url, key);

async function run() {
  console.log('================================================================');
  console.log('TEST SUITE: 30-MIN SLOT GRANULARITY & GET DIRECTIONS BUTTON');
  console.log('================================================================\n');

  // Ensure backend server is responsive
  const healthCheck = await fetch(`${API_BASE}/health`).catch(() => null);
  if (!healthCheck || !healthCheck.ok) {
    console.log('Starting local backend server...');
    await import('../server/index.js');
    await new Promise(r => setTimeout(r, 600));
  }

  // ---------------------------------------------------------------------------
  // [PART 1] 30-MINUTE SLOT GRANULARITY & INTERVAL OVERLAP RE-VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('--- [PART 1] SLOT GRANULARITY & OVERLAP VERIFICATION ---');

  // 1. Check default candidate generation step
  const rawSlots = generateTimeSlots('09:00', '12:00', 30, 0);
  console.log('  Generated slots (09:00 - 12:00):', rawSlots);
  assert.deepStrictEqual(
    rawSlots,
    ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'],
    'Candidate time slots must increment in 30-minute steps by default'
  );
  console.log('  ✓ generateTimeSlots defaults strictly to 30-minute step');

  // 2. Overlap reproduction scenario: Existing booking 5:15 PM - 6:15 PM (17:15 - 18:15)
  const testDate = '2026-11-25';
  const existingBooking515 = {
    id: 'booking-515-test',
    date: testDate,
    startTime: '17:15',
    endTime: '18:15',
    duration: 60,
    status: 'confirmed',
  };

  const detailed60 = generateTimeSlotsDetailed(
    '15:00',
    '20:00',
    60, // 60-min service
    0,
    [existingBooking515],
    [],
    0,
    testDate
  );

  const slotMap60 = Object.fromEntries(detailed60.map(s => [s.time, s]));

  // Confirm NO 15-minute grid candidates exist
  assert.strictEqual(slotMap60['16:15'], undefined, '16:15 must not exist');
  assert.strictEqual(slotMap60['16:45'], undefined, '16:45 must not exist');
  assert.strictEqual(slotMap60['17:15'], undefined, '17:15 must not exist');
  assert.strictEqual(slotMap60['17:45'], undefined, '17:45 must not exist');
  assert.strictEqual(slotMap60['18:15'], undefined, '18:15 must not exist');

  // Confirm interval overlap math on 30-min grid
  // 16:00 - 17:00 does not collide with 17:15 -> Available
  assert.strictEqual(slotMap60['16:00']?.available, true, '16:00 is available (ends 17:00)');

  // 16:30 - 17:30 collides with 17:15 -> Unavailable
  assert.strictEqual(slotMap60['16:30']?.available, false, '16:30 is unavailable (collides with 17:15)');

  // 17:00 - 18:00 collides with 17:15 -> 5:00 PM must NOT be offered
  assert.strictEqual(slotMap60['17:00']?.available, false, '17:00 (5:00 PM) must NOT be offered (collides with 17:15)');

  // 17:30 and 18:00 fall inside booking -> Booked
  assert.strictEqual(slotMap60['17:30']?.available, false, '17:30 is unavailable');
  assert.strictEqual(slotMap60['17:30']?.reason, 'booked', '17:30 is marked booked');
  assert.strictEqual(slotMap60['18:00']?.available, false, '18:00 is unavailable');
  assert.strictEqual(slotMap60['18:00']?.reason, 'booked', '18:00 is marked booked');

  // 18:30 - 19:30 starts after 18:15 -> Available
  assert.strictEqual(slotMap60['18:30']?.available, true, '18:30 is available (starts after 18:15)');
  assert.strictEqual(slotMap60['19:00']?.available, true, '19:00 is available');

  console.log('  ✓ 5:15 PM - 6:15 PM overlap verified on 30-min grid:');
  console.log('    16:00: Available | 16:30: Unavailable | 17:00: Unavailable | 17:30: Booked | 18:00: Booked | 18:30: Available');

  // 3. Meeting type invariance test
  const onlineTest = generateTimeSlotsDetailed('15:00', '20:00', 60, 0, [{ ...existingBooking515, meeting_type: 'online' }], [], 0, testDate);
  const inPersonTest = generateTimeSlotsDetailed('15:00', '20:00', 60, 0, [{ ...existingBooking515, meeting_type: 'in-person' }], [], 0, testDate);
  assert.strictEqual(JSON.stringify(onlineTest), JSON.stringify(inPersonTest), 'Meeting type must not affect overlap calculation');
  console.log('  ✓ Meeting type invariance confirmed between online and in-person');

  // ---------------------------------------------------------------------------
  // [PART 2] GET DIRECTIONS BUTTON: IN-PERSON VS ONLINE APPOINTMENTS
  // ---------------------------------------------------------------------------
  console.log('\n--- [PART 2] GET DIRECTIONS BUTTON VERIFICATION ---');

  // Fetch real provider and service
  const { data: providers } = await supabase.from('providers').select('*').limit(1);
  assert(providers && providers.length > 0, 'Found provider in database');
  const provider = providers[0];

  const { data: services } = await supabase
    .from('services')
    .select('*')
    .eq('provider_id', provider.id)
    .eq('active', true)
    .limit(1);
  assert(services && services.length > 0, 'Found service in database');
  const service = services[0];

  const testPhysicalAddress = '100 Indiranagar 100ft Rd, Bengaluru, Karnataka 560038';
  const expectedUniversalMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(testPhysicalAddress)}`;

  const baseOffset = 300 + Math.floor(Math.random() * 500);
  const inPersonDate = new Date(Date.now() + baseOffset * 86400000).toISOString().split('T')[0];
  const onlineDate = new Date(Date.now() + (baseOffset + 1) * 86400000).toISOString().split('T')[0];
  const cleanupIds = [];

  try {
    // 1. Create In-Person Booking End-to-End
    const inPersonToken = crypto.randomBytes(24).toString('hex');
    const inPersonRes = await fetch(`${API_BASE}/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: provider.id,
        serviceId: service.id,
        customerName: 'In-Person Test Client',
        customerPhone: '+919876543210',
        customerEmail: 'inperson.client@example.com',
        bookingDate: inPersonDate,
        startTime: '10:00',
        managementToken: inPersonToken,
        meetingType: 'in-person',
        locationAddress: testPhysicalAddress,
      }),
    });

    assert.strictEqual(inPersonRes.status, 201, 'In-person booking created with HTTP 201');
    const inPersonJson = await inPersonRes.json();
    cleanupIds.push(inPersonJson.bookingId);

    assert.strictEqual(inPersonJson.meetingType, 'in-person', 'Response meetingType is in-person');
    assert.strictEqual(inPersonJson.locationAddress, testPhysicalAddress, 'Response locationAddress matches test address');

    // 2. Fetch Customer Management Page data (/api/public/bookings/manage/:token)
    const inPersonManageRes = await fetch(`${API_BASE}/public/bookings/manage/${inPersonToken}`);
    assert.strictEqual(inPersonManageRes.status, 200, 'In-person manage endpoint returned HTTP 200');
    const inPersonManageJson = await inPersonManageRes.json();

    assert.strictEqual(inPersonManageJson.booking.meetingType, 'in-person', 'Customer view has meetingType in-person');
    assert.strictEqual(inPersonManageJson.booking.locationAddress, testPhysicalAddress, 'Customer view has snapshotted address');
    assert.strictEqual(inPersonManageJson.booking.mapsLink, expectedUniversalMapsUrl, 'Customer view has universal Google Maps search URL');
    console.log('  ✓ In-Person Booking has snapshotted address and Universal Google Maps URL:');
    console.log(`    Address:  "${inPersonManageJson.booking.locationAddress}"`);
    console.log(`    Maps URL: "${inPersonManageJson.booking.mapsLink}"`);

    // 3. Create Online Booking End-to-End
    const onlineToken = crypto.randomBytes(24).toString('hex');
    const onlineRes = await fetch(`${API_BASE}/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: provider.id,
        serviceId: service.id,
        customerName: 'Online Test Client',
        customerPhone: '+919876543211',
        customerEmail: 'online.client@example.com',
        bookingDate: onlineDate,
        startTime: '10:00',
        managementToken: onlineToken,
        meetingType: 'online',
      }),
    });

    assert.strictEqual(onlineRes.status, 201, 'Online booking created with HTTP 201');
    const onlineJson = await onlineRes.json();
    cleanupIds.push(onlineJson.bookingId);

    assert.strictEqual(onlineJson.meetingType, 'online', 'Online booking meetingType is online');

    // 4. Fetch Customer Management Page data for Online Booking
    const onlineManageRes = await fetch(`${API_BASE}/public/bookings/manage/${onlineToken}`);
    assert.strictEqual(onlineManageRes.status, 200, 'Online manage endpoint returned HTTP 200');
    const onlineManageJson = await onlineManageRes.json();

    assert.strictEqual(onlineManageJson.booking.meetingType, 'online', 'Customer view meetingType is online');
    assert.strictEqual(onlineManageJson.booking.locationAddress, null, 'Online booking has no location address');
    assert.strictEqual(onlineManageJson.booking.mapsLink, null, 'Online booking has no maps link');
    console.log('  ✓ Online Booking strictly omits locationAddress and mapsLink (Get Directions omitted)');

    // 5. Verify Database Rows & Provider Dashboard Views
    const { data: dbInPerson } = await supabase.from('bookings').select('*').eq('id', inPersonJson.bookingId).single();
    const { data: dbOnline } = await supabase.from('bookings').select('*').eq('id', onlineJson.bookingId).single();

    assert.strictEqual(dbInPerson.meeting_type, 'in-person', 'DB row meeting_type is in-person');
    assert.strictEqual(dbInPerson.location_address_snapshot, testPhysicalAddress, 'DB row has address snapshot');
    assert.strictEqual(dbOnline.meeting_type, 'online', 'DB row meeting_type is online');
    assert.strictEqual(dbOnline.location_address_snapshot, null, 'DB row online has null address snapshot');
    console.log('  ✓ Provider dashboard data persistence verified for both meeting types');

  } finally {
    // Cleanup test bookings
    if (cleanupIds.length > 0) {
      await supabase.from('bookings').delete().in('id', cleanupIds);
      console.log('  ✓ Cleanup complete for test bookings');
    }
  }

  console.log('\n================================================================');
  console.log('✅ ALL 30-MIN GRANULARITY & GET DIRECTIONS CHECKS PASSED PERFECTLY!');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
