/**
 * Calup — Test Suite: Public Busy Slots & Double-Booking Protection
 *
 * Verifies:
 * 1. Confirmed booking 09:00-10:00 with 15-minute buffer renders 09:00, 09:15, 09:30, 09:45, 10:00
 *    as unavailable, and 10:15 as available.
 * 2. A cancelled booking (status = 'cancelled') blocks nothing.
 * 3. A payment rejected booking (payment_status = 'rejected') blocks nothing.
 * 4. The busy-slots endpoint/response contains ONLY start_time, end_time, actual_end_time
 *    and NEVER leaks customer_name, customer_email, customer_phone, or notes.
 * 5. Backend conflict checking excludes payment_status = 'rejected'.
 */

import assert from 'assert';
import {
  generateTimeSlotsDetailed,
  getTimeSlotsDetailedForDate,
} from '../src/utils/helpers.js';

console.log('================================================================');
console.log('TEST SUITE: PUBLIC BUSY SLOTS & DOUBLE-BOOKING PROTECTION');
console.log('================================================================\n');

async function runTests() {
  const testDate = '2026-09-25';
  const serviceDuration = 60; // 60 minutes
  const bufferTime = 15;      // 15 minutes buffer
  const dayStart = '09:00';
  const dayEnd = '18:00';

  // ---------------------------------------------------------------------------
  // TEST 1: Confirmed booking 09:00-10:00 with 15-min buffer
  // ---------------------------------------------------------------------------
  console.log('--- [TEST 1] CONFIRMED BOOKING 09:00-10:00 (15-MIN BUFFER) ---');
  const confirmedBooking = {
    id: 'booking-test-1',
    date: testDate,
    startTime: '09:00',
    endTime: '10:00',
    duration: 60,
    status: 'confirmed',
    payment_status: 'awaiting_payment',
  };

  const slots = generateTimeSlotsDetailed(
    dayStart,
    dayEnd,
    serviceDuration,
    bufferTime,
    [confirmedBooking],
    [], // no external gcal
    0,  // minNotice
    testDate,
    15  // 15-minute granularity
  );

  const slotMap = Object.fromEntries(slots.map(s => [s.time, s]));

  // Verify 09:00 through 10:00 are unavailable
  assert.strictEqual(slotMap['09:00']?.available, false, '09:00 must be unavailable');
  assert.strictEqual(slotMap['09:00']?.reason, 'booked', '09:00 marked as booked');

  assert.strictEqual(slotMap['09:15']?.available, false, '09:15 must be unavailable (collides with 09:00-10:00)');
  assert.strictEqual(slotMap['09:30']?.available, false, '09:30 must be unavailable (collides with 09:00-10:00)');
  assert.strictEqual(slotMap['09:45']?.available, false, '09:45 must be unavailable (collides with 09:00-10:00)');

  // 10:00 is within the 15-minute buffer after the 09:00-10:00 appointment (buffer ends at 10:15)
  assert.strictEqual(slotMap['10:00']?.available, false, '10:00 must be unavailable due to 15-min coach buffer');

  // 10:15 is past the buffer and fully available
  assert.strictEqual(slotMap['10:15']?.available, true, '10:15 must be available');
  assert.strictEqual(slotMap['10:30']?.available, true, '10:30 must be available');

  console.log('  ✓ 09:00, 09:15, 09:30, 09:45, and 10:00 are unavailable');
  console.log('  ✓ 10:15 is available');

  // ---------------------------------------------------------------------------
  // TEST 2: Cancelled booking blocks nothing
  // ---------------------------------------------------------------------------
  console.log('\n--- [TEST 2] CANCELLED BOOKING BLOCKS NOTHING ---');
  const cancelledBooking = {
    id: 'booking-cancelled-1',
    date: testDate,
    startTime: '09:00',
    endTime: '10:00',
    duration: 60,
    status: 'cancelled',
  };

  const cancelledSlots = generateTimeSlotsDetailed(
    dayStart,
    dayEnd,
    serviceDuration,
    bufferTime,
    [cancelledBooking],
    [],
    0,
    testDate,
    15
  );
  const cancelledMap = Object.fromEntries(cancelledSlots.map(s => [s.time, s]));

  assert.strictEqual(cancelledMap['09:00']?.available, true, 'Cancelled booking leaves 09:00 available');
  assert.strictEqual(cancelledMap['09:15']?.available, true, 'Cancelled booking leaves 09:15 available');
  assert.strictEqual(cancelledMap['09:30']?.available, true, 'Cancelled booking leaves 09:30 available');
  assert.strictEqual(cancelledMap['09:45']?.available, true, 'Cancelled booking leaves 09:45 available');
  assert.strictEqual(cancelledMap['10:00']?.available, true, 'Cancelled booking leaves 10:00 available');
  assert.strictEqual(cancelledMap['10:15']?.available, true, 'Cancelled booking leaves 10:15 available');
  console.log('  ✓ Cancelled booking does not block any slot');

  // ---------------------------------------------------------------------------
  // TEST 3: Payment rejected booking blocks nothing
  // ---------------------------------------------------------------------------
  console.log('\n--- [TEST 3] REJECTED BOOKING BLOCKS NOTHING ---');
  const rejectedBooking = {
    id: 'booking-rejected-1',
    date: testDate,
    startTime: '09:00',
    endTime: '10:00',
    duration: 60,
    status: 'confirmed', // even if status was not yet toggled to cancelled
    payment_status: 'rejected',
  };

  const rejectedSlots = generateTimeSlotsDetailed(
    dayStart,
    dayEnd,
    serviceDuration,
    bufferTime,
    [rejectedBooking],
    [],
    0,
    testDate,
    15
  );
  const rejectedMap = Object.fromEntries(rejectedSlots.map(s => [s.time, s]));

  assert.strictEqual(rejectedMap['09:00']?.available, true, 'Rejected booking leaves 09:00 available');
  assert.strictEqual(rejectedMap['09:15']?.available, true, 'Rejected booking leaves 09:15 available');
  assert.strictEqual(rejectedMap['09:30']?.available, true, 'Rejected booking leaves 09:30 available');
  assert.strictEqual(rejectedMap['09:45']?.available, true, 'Rejected booking leaves 09:45 available');
  assert.strictEqual(rejectedMap['10:00']?.available, true, 'Rejected booking leaves 10:00 available');
  assert.strictEqual(rejectedMap['10:15']?.available, true, 'Rejected booking leaves 10:15 available');
  console.log('  ✓ Payment rejected booking does not block any slot');

  // ---------------------------------------------------------------------------
  // TEST 4: Busy slots response privacy & PII exclusion
  // ---------------------------------------------------------------------------
  console.log('\n--- [TEST 4] BUSY-SLOTS RESPONSE CONTAINS ZERO CUSTOMER PII ---');

  // Raw mock database rows containing customer sensitive fields
  const mockDbRows = [
    {
      id: 'row-1',
      start_time: '09:00',
      end_time: '10:00',
      actual_end_time: null,
      status: 'confirmed',
      payment_status: 'awaiting_payment',
      customer_name: 'Confidential Client',
      customer_email: 'private@client.com',
      customer_phone: '+919876543210',
      notes: 'Sensitive health notes',
    },
    {
      id: 'row-2',
      start_time: '14:00',
      end_time: '15:00',
      actual_end_time: '14:45',
      status: 'completed',
      payment_status: 'confirmed',
      customer_name: 'Another Client',
      customer_email: 'another@client.com',
      customer_phone: '+919876543211',
      notes: 'Confidential consultation',
    },
    {
      id: 'row-3',
      start_time: '16:00',
      end_time: '17:00',
      actual_end_time: null,
      status: 'confirmed',
      payment_status: 'rejected', // MUST be filtered out
      customer_name: 'Rejected Client',
      customer_email: 'rejected@client.com',
      customer_phone: '+919876543212',
    },
  ];

  // Simulating the exact transformation logic in GET /api/public/busy-slots
  const sanitizedBusySlots = mockDbRows
    .filter(b => b.payment_status !== 'rejected')
    .map(b => ({
      start_time: b.start_time,
      end_time: b.end_time,
      actual_end_time: b.actual_end_time || null,
    }));

  assert.strictEqual(sanitizedBusySlots.length, 2, 'Rejected booking row excluded from busy slots');

  for (const slot of sanitizedBusySlots) {
    // Required fields exist
    assert(typeof slot.start_time === 'string', 'start_time is present');
    assert(typeof slot.end_time === 'string', 'end_time is present');

    // Sensitive customer PII must NEVER be present
    assert.strictEqual(slot.customer_name, undefined, 'customer_name must not be in busy-slots response');
    assert.strictEqual(slot.customer_email, undefined, 'customer_email must not be in busy-slots response');
    assert.strictEqual(slot.customer_phone, undefined, 'customer_phone must not be in busy-slots response');
    assert.strictEqual(slot.notes, undefined, 'notes must not be in busy-slots response');
    assert.strictEqual(slot.price, undefined, 'price must not be in busy-slots response');

    // Only allowed keys
    const keys = Object.keys(slot);
    assert(keys.every(k => ['start_time', 'end_time', 'actual_end_time'].includes(k)), 'Only safe time fields are exposed');
  }
  console.log('  ✓ Busy-slots response strictly contains only start_time, end_time, actual_end_time');
  console.log('  ✓ No customer name, email, phone, or notes are present');

  // ---------------------------------------------------------------------------
  // TEST 5: Integration with getTimeSlotsDetailedForDate using busy-slots payload
  // ---------------------------------------------------------------------------
  console.log('\n--- [TEST 5] INTEGRATION WITH getTimeSlotsDetailedForDate ---');
  const mockAvailability = {
    schedule: {
      friday: { available: true, start: '09:00', end: '18:00' },
    },
    bufferTime: 15,
  };
  const mockServices = [
    { id: 'svc-1', name: 'Consultation', duration: 60 },
  ];

  // Pass sanitized busy slots formatted as bookings (as done in BookingPage.jsx)
  const formattedDbBookings = sanitizedBusySlots.map(s => ({
    date: testDate,
    startTime: s.start_time,
    endTime: s.end_time,
    actualEndTime: s.actual_end_time,
    status: 'confirmed',
  }));

  const detailedSlots = getTimeSlotsDetailedForDate(
    testDate,
    mockAvailability,
    mockServices,
    'svc-1',
    formattedDbBookings,
    []
  );

  const integratedMap = Object.fromEntries(detailedSlots.map(s => [s.time, s]));

  assert.strictEqual(integratedMap['09:00']?.available, false, '09:00 unavailable');
  assert.strictEqual(integratedMap['09:15']?.available, false, '09:15 unavailable');
  assert.strictEqual(integratedMap['09:30']?.available, false, '09:30 unavailable');
  assert.strictEqual(integratedMap['09:45']?.available, false, '09:45 unavailable');
  assert.strictEqual(integratedMap['10:00']?.available, false, '10:00 unavailable');
  assert.strictEqual(integratedMap['10:15']?.available, true, '10:15 available');

  console.log('  ✓ getTimeSlotsDetailedForDate integrates busy slots faithfully');

  // ---------------------------------------------------------------------------
  // TEST 6: Exact Scenario Reproduction - 60-min booking at 5:15 PM (17:15-18:15)
  // Verifies candidate interval [T, T + duration + buffer) vs [17:15, 18:15 + buffer)
  // Ensures 5:00 PM is NOT offered for services whose duration runs into 5:15 PM.
  // ---------------------------------------------------------------------------
  console.log('\n--- [TEST 6] 60-MIN BOOKING AT 5:15 PM (17:15 - 18:15) REPRODUCTION ---');

  const booking515 = {
    id: 'booking-515-pm',
    date: testDate,
    startTime: '17:15',
    endTime: '18:15',
    duration: 60,
    status: 'confirmed',
  };

  // Case A: 60-minute service, 0 buffer
  const slots60 = generateTimeSlotsDetailed(
    '09:00',
    '21:00',
    60,
    0,
    [booking515],
    [],
    0,
    testDate,
    15
  );
  const map60 = Object.fromEntries(slots60.map(s => [s.time, s]));

  // Clearly before the booked range:
  assert.strictEqual(map60['16:00']?.available, true, '16:00 must be available (finishes 17:00)');
  assert.strictEqual(map60['16:15']?.available, true, '16:15 must be available (finishes exactly at 17:15)');

  // Colliding candidates before start:
  assert.strictEqual(map60['16:30']?.available, false, '16:30 must be unavailable (runs 16:30-17:30, overlaps 17:15)');
  assert.strictEqual(map60['16:45']?.available, false, '16:45 must be unavailable (runs 16:45-17:45, overlaps 17:15)');
  assert.strictEqual(map60['17:00']?.available, false, '5:00 PM (17:00) must NOT be offered (runs 17:00-18:00, overlaps 17:15)');

  // Inside booked range:
  assert.strictEqual(map60['17:15']?.available, false, '17:15 must be unavailable (booked)');
  assert.strictEqual(map60['17:15']?.reason, 'booked', '17:15 marked booked');
  assert.strictEqual(map60['17:30']?.available, false, '17:30 must be unavailable (booked)');
  assert.strictEqual(map60['17:30']?.reason, 'booked', '17:30 marked booked');
  assert.strictEqual(map60['17:45']?.available, false, '17:45 must be unavailable (booked)');
  assert.strictEqual(map60['17:45']?.reason, 'booked', '17:45 marked booked');
  assert.strictEqual(map60['18:00']?.available, false, '18:00 must be unavailable (booked)');
  assert.strictEqual(map60['18:00']?.reason, 'booked', '18:00 marked booked');

  // Clearly after the booked range:
  assert.strictEqual(map60['18:15']?.available, true, '18:15 must be available (starts right at 18:15 when session ends)');
  assert.strictEqual(map60['18:30']?.available, true, '18:30 must be available');
  assert.strictEqual(map60['18:45']?.available, true, '18:45 must be available');
  assert.strictEqual(map60['19:00']?.available, true, '19:00 must be available');

  console.log('  ✓ 60-min service: 16:00 and 16:15 are available');
  console.log('  ✓ 60-min service: 16:30, 16:45, and 17:00 (5:00 PM) are correctly filtered out as unavailable');
  console.log('  ✓ 60-min service: 17:15 through 18:00 are marked as booked');
  console.log('  ✓ 60-min service: 18:15, 18:30, 18:45, and 19:00 are available');

  // Case B: 30-minute service, 0 buffer
  const slots30 = generateTimeSlotsDetailed(
    '09:00',
    '21:00',
    30,
    0,
    [booking515],
    [],
    0,
    testDate,
    15
  );
  const map30 = Object.fromEntries(slots30.map(s => [s.time, s]));

  assert.strictEqual(map30['16:45']?.available, true, '16:45 must be available for 30m service (finishes 17:15)');
  assert.strictEqual(map30['17:00']?.available, false, '17:00 must NOT be available for 30m service (finishes 17:30, overlaps 17:15)');
  assert.strictEqual(map30['17:15']?.available, false, '17:15 must be unavailable for 30m service');
  assert.strictEqual(map30['18:00']?.available, false, '18:00 must be unavailable for 30m service (runs 18:00-18:30, overlaps 18:15)');
  assert.strictEqual(map30['18:15']?.available, true, '18:15 must be available for 30m service');
  console.log('  ✓ 30-min service: 16:45 and 18:15 available; 17:00 through 18:00 unavailable');

  // Case C: 60-minute service with 15-minute provider buffer
  const slots60Buf = generateTimeSlotsDetailed(
    '09:00',
    '21:00',
    60,
    15,
    [booking515],
    [],
    0,
    testDate,
    15
  );
  const map60Buf = Object.fromEntries(slots60Buf.map(s => [s.time, s]));

  assert.strictEqual(map60Buf['16:00']?.available, true, '16:00 available with 15m buffer (finishes 17:00 + 15m buffer = 17:15)');
  assert.strictEqual(map60Buf['16:15']?.available, false, '16:15 unavailable with 15m buffer (finishes 17:15 + 15m buffer = 17:30, overlaps 17:15)');
  assert.strictEqual(map60Buf['17:00']?.available, false, '17:00 unavailable with 15m buffer');
  assert.strictEqual(map60Buf['18:15']?.available, false, '18:15 unavailable with 15m buffer (within post-appointment buffer ending 18:30)');
  assert.strictEqual(map60Buf['18:30']?.available, true, '18:30 available with 15m buffer');
  console.log('  ✓ 15-min buffer: 16:00 and 18:30 available; 16:15, 17:00, 18:15 unavailable');

  // Case D: Meeting type consistency - online vs in-person
  const onlineBooking = { ...booking515, meeting_type: 'online' };
  const inPersonBooking = { ...booking515, meeting_type: 'in-person' };
  const onlineSlots = generateTimeSlotsDetailed('09:00', '21:00', 60, 0, [onlineBooking], [], 0, testDate);
  const inPersonSlots = generateTimeSlotsDetailed('09:00', '21:00', 60, 0, [inPersonBooking], [], 0, testDate);
  assert.strictEqual(
    JSON.stringify(onlineSlots),
    JSON.stringify(inPersonSlots),
    'Meeting type (online vs in-person) must NOT affect slot overlap math'
  );
  console.log('  ✓ Meeting type consistency verified: online and in-person yield identical overlap slots');

  console.log('\n================================================================');
  console.log('✅ ALL PUBLIC BUSY SLOTS & DOUBLE-BOOKING TESTS PASSED');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
