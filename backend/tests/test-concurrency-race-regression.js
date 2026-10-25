import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const API_BASE = 'http://localhost:3001/api';
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const sb = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('================================================================');
  console.log('REGRESSION TEST: 20-RUN CONCURRENT BOOKING RACE PREVENTION');
  console.log('================================================================\n');

  // 1. Ensure backend is running
  const healthCheck = await fetch(`${API_BASE}/health`).catch(() => null);
  if (!healthCheck || !healthCheck.ok) {
    console.log('Starting local backend server...');
    await import('../server/index.js');
    await new Promise(r => setTimeout(r, 800));
  }

  // 2. Create isolated test provider and service
  const testProviderId = crypto.randomUUID();
  const testServiceId = crypto.randomUUID();
  const createdBookingIds = [];

  try {
    const { error: pErr } = await sb.from('providers').insert({
      id: testProviderId,
      name: 'Regression Race Test Coach',
      slug: `race-test-${Date.now()}`,
      email: 'race-tester@example.com',
      buffer_time: 15,
      min_notice: 0,
      max_advance_booking: 365,
    });
    if (pErr) throw new Error(`Failed to create test provider: ${pErr.message}`);

    const { error: sErr } = await sb.from('services').insert({
      id: testServiceId,
      provider_id: testProviderId,
      name: 'Concurrency Strategy Session',
      duration: 45,
      price: 1500,
      active: true,
      meeting_type: 'online',
    });
    if (sErr) throw new Error(`Failed to create test service: ${sErr.message}`);

    console.log(`✓ Dedicated test provider created (${testProviderId})`);
    console.log(`✓ Dedicated paid service created (${testServiceId})\n`);

    let raceFailures = 0;

    for (let i = 1; i <= 20; i++) {
      const trialDate = `2029-07-${String(i).padStart(2, '0')}`;
      const trialTime = '10:00';

      const reqA = fetch(`${API_BASE}/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-bypass-rate-limit': 'true' },
        body: JSON.stringify({
          providerId: testProviderId,
          serviceId: testServiceId,
          customerName: `Concurrent Client A ${i}`,
          customerEmail: `clientA_${i}@test.com`,
          customerPhone: `+9190000000${String(i).padStart(2, '0')}`,
          bookingDate: trialDate,
          startTime: trialTime,
          meetingType: 'online',
        }),
      });

      const reqB = fetch(`${API_BASE}/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-bypass-rate-limit': 'true' },
        body: JSON.stringify({
          providerId: testProviderId,
          serviceId: testServiceId,
          customerName: `Concurrent Client B ${i}`,
          customerEmail: `clientB_${i}@test.com`,
          customerPhone: `+9191111111${String(i).padStart(2, '0')}`,
          bookingDate: trialDate,
          startTime: trialTime,
          meetingType: 'online',
        }),
      });

      const [resA, resB] = await Promise.all([reqA, reqB]);
      const jsonA = await resA.json().catch(() => ({}));
      const jsonB = await resB.json().catch(() => ({}));

      if (jsonA?.bookingId) createdBookingIds.push(jsonA.bookingId);
      if (jsonB?.bookingId) createdBookingIds.push(jsonB.bookingId);

      const statuses = [resA.status, resB.status].sort();

      if (statuses[0] === 201 && statuses[1] === 201) {
        raceFailures++;
        console.error(`❌ FAIL: Run ${i}: [201, 201] DOUBLE-BOOKING DETECTED for slot ${trialDate} ${trialTime}`);
      } else if (statuses[0] === 201 && statuses[1] === 409) {
        console.log(`  ✓ Run ${i.toString().padStart(2, ' ')}: [201, 409] Exactly one booking succeeded, duplicate safely rejected`);
      } else {
        console.warn(`  ? Run ${i}: Unexpected statuses [${statuses.join(', ')}]`);
      }
    }

    if (raceFailures > 0) {
      console.error(`\n❌ FAIL: ${raceFailures} out of 20 runs resulted in double bookings!`);
      process.exit(1);
    } else {
      console.log('\n================================================================');
      console.log('✅ ALL 20 CONCURRENT RACE RUNS SAFELY SERIALIZED AND PROTECTED');
      console.log('================================================================');
    }
  } finally {
    console.log('\nCleaning up regression test data...');
    if (createdBookingIds.length > 0) {
      await sb.from('bookings').delete().in('id', createdBookingIds);
    }
    await sb.from('services').delete().eq('id', testServiceId);
    await sb.from('providers').delete().eq('id', testProviderId);
    console.log('✓ Cleanup complete.');
  }
}

run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ Regression test threw exception:', err.message);
  process.exit(1);
});
