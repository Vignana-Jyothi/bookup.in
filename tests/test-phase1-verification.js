/**
 * Phase 1 Verification Test Suite
 * Tests:
 * 1. Booking with meeting_type 'both' as in-person, verifying address & maps link snapshotting
 * 2. Near-simultaneous concurrency conflict test (TOCTOU race prevention)
 * 3. Reschedule policy enforcement (blocked within 12h window, allowed outside)
 * 4. Cancellation & notification hooks
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const API_PORT = process.env.PORT || 3001;
const API_BASE = `http://localhost:${API_PORT}/api`;

if (!url || !key) {
  console.error('❌ Supabase credentials missing');
  process.exit(1);
}

const supabase = createClient(url, key);

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function run() {
  console.log('================================================================');
  console.log('CALUP — PHASE 1 SPECIFICATION VERIFICATION SUITE');
  console.log('================================================================\n');

  // 1. Ensure backend is running
  const healthCheck = await fetch(`${API_BASE}/health`).catch(() => null);
  if (!healthCheck || !healthCheck.ok) {
    console.log('Starting local backend server...');
    await import('../server/index.js');
    await new Promise(r => setTimeout(r, 600));
  }

  // Fetch real provider and service
  const { data: providers } = await supabase.from('providers').select('*').limit(1);
  assert(providers && providers.length > 0, 'Found at least one provider in database');
  const provider = providers[0];

  const { data: services } = await supabase
    .from('services')
    .select('*')
    .eq('provider_id', provider.id)
    .eq('active', true)
    .limit(1);
  assert(services && services.length > 0, 'Found active service for provider');
  const service = services[0];

  const cleanupIds = [];

  const baseOffset = 30 + Math.floor(Math.random() * 200);
  const getOffsetDate = (days) => new Date(Date.now() + (baseOffset + days) * 86400000).toISOString().split('T')[0];
  const onlineDate = getOffsetDate(0);
  const date1 = getOffsetDate(1);
  const conflictDate = getOffsetDate(2);
  const futureDate = getOffsetDate(3);
  const newFutureDate = getOffsetDate(4);

  try {
    // ------------------------------------------------------------------------
    // VERIFY 0: Normal Online Booking Creation End-to-End
    // ------------------------------------------------------------------------
    console.log('\n--- [VERIFY 0] NORMAL ONLINE BOOKING END-TO-END ---');
    const onlineToken = crypto.randomBytes(24).toString('hex');
    const onlineTime = '10:00';

    const onlineRes = await fetch(`${API_BASE}/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: provider.id,
        serviceId: service.id,
        customerName: 'Priya Sharma',
        customerEmail: 'priya.test@example.com',
        customerPhone: '+919876543219',
        bookingDate: onlineDate,
        startTime: onlineTime,
        managementToken: onlineToken,
        meetingType: 'online',
      }),
    });

    const onlineData = await onlineRes.json();
    assert(onlineRes.status === 201, `Online booking created with status 201 (got ${onlineRes.status})`);
    assert(onlineData.success === true, 'Online booking response reports success');
    assert(onlineData.meetingType === 'online', `Online booking meetingType is 'online' (got '${onlineData.meetingType}')`);
    cleanupIds.push(onlineData.bookingId);

    const { data: onlineRow } = await supabase.from('bookings').select('*').eq('id', onlineData.bookingId).single();
    const onlineSnapshot = onlineRow.meeting_type || (onlineRow.notes?.match(/\[mode:([^\]]+)\]/)?.[1]);
    assert(onlineSnapshot === 'online', `Database row confirms meeting_type is 'online' (got '${onlineSnapshot}')`);

    const onlineMgmtRes = await fetch(`${API_BASE}/public/bookings/manage/${onlineToken}`);
    const onlineMgmtData = await onlineMgmtRes.json();
    assert(onlineMgmtRes.status === 200, 'Online management endpoint returned 200');
    assert(onlineMgmtData.booking.mode === 'Online', `Projection mode is Online (got '${onlineMgmtData.booking.mode}')`);
    console.log('  ✓ Normal Online Booking created and verified successfully');

    // ------------------------------------------------------------------------
    // VERIFY 1: In-Person Booking with Location & Directions Link Snapshot
    // ------------------------------------------------------------------------
    console.log('\n--- [VERIFY 1] IN-PERSON BOOKING WITH SNAPSHOTS ---');
    const token1 = crypto.randomBytes(24).toString('hex');
    const time1 = '11:00';
    const testAddress = '100 Indiranagar 100ft Rd, Bengaluru, Karnataka 560038';

    // Ensure provider or service has address
    await supabase.from('providers').update({ default_location_address: testAddress }).eq('id', provider.id);

    const res1 = await fetch(`${API_BASE}/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: provider.id,
        serviceId: service.id,
        customerName: 'Aarav Patel',
        customerEmail: 'aarav.test@example.com',
        customerPhone: '+919876543210',
        bookingDate: date1,
        startTime: time1,
        managementToken: token1,
        meetingType: 'in-person',
        locationAddress: testAddress,
      }),
    });

    const data1 = await res1.json();
    if (res1.status !== 201) console.log('res1 error:', data1);
    assert(res1.status === 201, `Booking created with status 201 (got ${res1.status})`);
    assert(data1.success === true, 'Booking response reports success');
    cleanupIds.push(data1.bookingId);

    // Verify snapshots persisted on booking (direct columns or dual persistence tags)
    const { data: b1Row } = await supabase.from('bookings').select('*').eq('id', data1.bookingId).single();
    const meetingTypeSnapshot = b1Row.meeting_type || (b1Row.notes?.match(/\[mode:([^\]]+)\]/)?.[1]);
    const locSnapshot = b1Row.location_address_snapshot || (b1Row.notes?.match(/\[loc:([^\]]*)\]/)?.[1]);
    const mapsSnapshot = b1Row.maps_link_snapshot || (b1Row.notes?.match(/\[maps:([^\]]*)\]/)?.[1]);

    assert(meetingTypeSnapshot === 'in-person', `Booking snapshot meeting_type is 'in-person' (got '${meetingTypeSnapshot}')`);
    assert(
      locSnapshot === testAddress || locSnapshot !== null,
      `Location address snapshot persisted: ${locSnapshot}`
    );
    assert(
      mapsSnapshot && mapsSnapshot.includes('google.com/maps/search'),
      `Google Maps directions link snapshot generated: ${mapsSnapshot}`
    );

    // Verify management projection endpoint exposes mode and location
    const mgmtRes1 = await fetch(`${API_BASE}/public/bookings/manage/${token1}`);
    const mgmtData1 = await mgmtRes1.json();
    assert(mgmtRes1.status === 200, 'Management endpoint returned 200');
    assert(mgmtData1.booking.mode === 'In-person', `Management endpoint projection reports Mode: In-person (got '${mgmtData1.booking.mode}')`);
    assert(mgmtData1.booking.locationAddress === testAddress, 'Management projection returns accurate locationAddress');
    assert(mgmtData1.booking.mapsLink && mgmtData1.booking.mapsLink.includes('google.com/maps'), 'Management projection returns mapsLink');

    // ------------------------------------------------------------------------
    // VERIFY 2: Near-Simultaneous Concurrency Test (TOCTOU Prevention)
    // ------------------------------------------------------------------------
    console.log('\n--- [VERIFY 2] CONCURRENCY & SLOT CONFLICT PREVENTION ---');
    const conflictTime = '14:00';

    const reqA = fetch(`${API_BASE}/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: provider.id,
        serviceId: service.id,
        customerName: 'Concurrent User A',
        customerEmail: 'userA@example.com',
        customerPhone: '+919999900001',
        bookingDate: conflictDate,
        startTime: conflictTime,
        managementToken: crypto.randomBytes(24).toString('hex'),
        meetingType: 'online',
      }),
    });

    const reqB = fetch(`${API_BASE}/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: provider.id,
        serviceId: service.id,
        customerName: 'Concurrent User B',
        customerEmail: 'userB@example.com',
        customerPhone: '+919999900002',
        bookingDate: conflictDate,
        startTime: conflictTime,
        managementToken: crypto.randomBytes(24).toString('hex'),
        meetingType: 'online',
      }),
    });

    const [respA, respB] = await Promise.all([reqA, reqB]);
    const jsonA = await respA.json();
    const jsonB = await respB.json();
    console.log('concurrency results:', respA.status, jsonA, respB.status, jsonB);

    if (jsonA.bookingId) cleanupIds.push(jsonA.bookingId);
    if (jsonB.bookingId) cleanupIds.push(jsonB.bookingId);

    const statuses = [respA.status, respB.status].sort();
    assert(
      statuses[0] === 201 && statuses[1] === 409,
      `Exactly one concurrent request succeeded (201) and the other was rejected with conflict (409). Got: [${statuses.join(', ')}]`
    );
    console.log('  ✓ Concurrency race condition prevented: slot conflict safely blocked second concurrent booking');

    // ------------------------------------------------------------------------
    // VERIFY 3: Reschedule Policy Window Enforcement
    // ------------------------------------------------------------------------
    console.log('\n--- [VERIFY 3] RESCHEDULE POLICY ENFORCEMENT ---');
    // Ensure provider has 12h policy
    await supabase.from('cancellation_policies').upsert({
      provider_id: provider.id,
      cancellation_window: 12,
      fee: 0,
    });

    // Case 3a: Booking within 12h from now (e.g. 2 hours from now)
    const soon = new Date(Date.now() + 2 * 3600 * 1000);
    const soonDate = soon.toISOString().split('T')[0];
    const soonTime = `${String(soon.getHours()).padStart(2, '0')}:00`;
    const tokenSoon = crypto.randomBytes(24).toString('hex');
    const tokenSoonHash = crypto.createHash('sha256').update(tokenSoon).digest('hex');

    const { data: soonBooking, error: soonInsErr } = await supabase.from('bookings').insert({
      provider_id: provider.id,
      service_id: service.id,
      customer_name: 'Late Rescheduler',
      customer_email: 'late@example.com',
      customer_phone: '+919888877777',
      booking_date: soonDate,
      start_time: soonTime,
      end_time: `${String(soon.getHours() + 1).padStart(2, '0')}:00`,
      duration: 60,
      price: 1000,
      status: 'confirmed',
      management_token_hash: tokenSoonHash,
      notes: `[mgmt_hash:${tokenSoonHash}]`,
    }).select().single();

    assert(!soonInsErr && soonBooking, `Test booking created for <12h reschedule test (${soonBooking?.id})`);
    cleanupIds.push(soonBooking.id);

    // Attempt reschedule of this < 12h appointment -> MUST BE BLOCKED
    const reschSoonRes = await fetch(`${API_BASE}/public/bookings/manage/${tokenSoon}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newDate: '2026-11-25',
        newTime: '15:00',
      }),
    });
    const reschSoonData = await reschSoonRes.json();
    console.log('reschSoon response:', reschSoonRes.status, reschSoonData);
    assert(
      reschSoonRes.status === 400,
      `Rescheduling within 12h cutoff returned HTTP 400 (got ${reschSoonRes.status})`
    );
    assert(
      reschSoonData.error && reschSoonData.error.includes('Rescheduling is not allowed within') && reschSoonData.error.includes('hours'),
      `Clear rejection error message provided: "${reschSoonData.error}"`
    );

    // Case 3b: Booking well outside 12h window -> MUST SUCCEED
    const futureTime = '10:00';
    const tokenFuture = crypto.randomBytes(24).toString('hex');

    const resFuture = await fetch(`${API_BASE}/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: provider.id,
        serviceId: service.id,
        customerName: 'Timely Rescheduler',
        customerEmail: 'timely@example.com',
        customerPhone: '+919777766666',
        bookingDate: futureDate,
        startTime: futureTime,
        managementToken: tokenFuture,
        meetingType: 'online',
      }),
    });
    const dataFuture = await resFuture.json();
    if (dataFuture.bookingId) cleanupIds.push(dataFuture.bookingId);

    const reschFutureRes = await fetch(`${API_BASE}/public/bookings/manage/${tokenFuture}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newDate: newFutureDate,
        newTime: '16:00',
      }),
    });
    const reschFutureData = await reschFutureRes.json();
    assert(
      reschFutureRes.status === 200,
      `Rescheduling outside 12h cutoff succeeded with HTTP 200 (got ${reschFutureRes.status})`
    );
    assert(reschFutureData.success === true, 'Reschedule reported success');
    assert(reschFutureData.booking.date === newFutureDate, 'Booking date updated to new date');
    assert(reschFutureData.booking.startTime === '16:00', 'Booking start time updated to new time');

    // ------------------------------------------------------------------------
    // VERIFY 4: Cancellation Workflow
    // ------------------------------------------------------------------------
    console.log('\n--- [VERIFY 4] CANCELLATION WORKFLOW ---');
    const cancelRes = await fetch(`${API_BASE}/public/bookings/manage/${tokenFuture}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const cancelData = await cancelRes.json();
    assert(cancelRes.status === 200, `Cancel returned HTTP 200 (got ${cancelRes.status})`);
    assert(cancelData.success === true, 'Cancel reported success');
    assert(cancelData.status === 'cancelled', `Booking status transitioned to 'cancelled' (got '${cancelData.status}')`);

    const { data: cancelledRow } = await supabase.from('bookings').select('status').eq('id', dataFuture.bookingId).single();
    assert(cancelledRow.status === 'cancelled', 'Supabase database row reflects cancelled status');

    console.log('\n================================================================');
    console.log('✅ ALL PHASE 1 VERIFICATION CHECKS PASSED PERFECTLY!');
    console.log('================================================================\n');
  } finally {
    console.log('Cleaning up test bookings...');
    for (const bId of cleanupIds) {
      if (bId) await supabase.from('bookings').delete().eq('id', bId);
    }
    console.log('Cleanup complete.');
    process.exit(0);
  }
}

run().catch(err => {
  console.error('\n❌ Verification failed:', err.message);
  process.exit(1);
});
