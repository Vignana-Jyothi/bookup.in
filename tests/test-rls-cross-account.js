/**
 * BookUp — RLS Cross-Account Isolation Test Script
 * 
 * Verifies that Supabase Row Level Security (RLS) strictly blocks:
 * 1. Fetching another provider's bookings
 * 2. Fetching another provider's customer list
 * 3. Fetching another provider's QR code URL
 * 4. Fetching another provider's UPI ID
 * 5. Fetching another provider's availability schedule
 * 
 * Directly executed via Supabase client calls using authenticated session tokens.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase configuration in .env');
  process.exit(1);
}

async function runRLSTest() {
  console.log('=== STARTING RLS CROSS-ACCOUNT ISOLATION TEST ===\n');

  const ts = Date.now();
  const emailA = `coach_a_${ts}@testbookup.dev`;
  const emailB = `coach_b_${ts}@testbookup.dev`;
  const password = 'Password_12345!';

  const clientA = createClient(supabaseUrl, supabaseAnonKey);
  const clientB = createClient(supabaseUrl, supabaseAnonKey);

  // 1. Sign up Coach A and Coach B
  console.log('1. Creating test accounts for Coach A and Coach B...');
  const resA = await clientA.auth.signUp({ email: emailA, password });
  const resB = await clientB.auth.signUp({ email: emailB, password });

  if (resA.error || !resA.data.user) throw new Error(`Coach A signup failed: ${resA.error?.message}`);
  if (resB.error || !resB.data.user) throw new Error(`Coach B signup failed: ${resB.error?.message}`);

  const userA = resA.data.user;
  const userB = resB.data.user;
  console.log(`   Coach A user ID: ${userA.id}`);
  console.log(`   Coach B user ID: ${userB.id}\n`);

  // 2. Set up Coach B provider profile with sensitive UPI ID and QR code URL
  console.log('2. Setting up Coach B profile with private UPI and QR code...');
  const { data: provB, error: provBErr } = await clientB
    .from('providers')
    .insert({
      user_id: userB.id,
      name: 'Coach B Confidential',
      business_name: 'Confidential Coaching',
      slug: `coach-b-${ts}`,
      email: emailB,
      upi_id: 'coachb_secret@okhdfcbank',
      qr_code_url: 'https://storage.supabase.co/private-bucket/coachb_secret_qr.png',
    })
    .select()
    .single();

  if (provBErr || !provB) throw new Error(`Provider B creation failed: ${provBErr?.message}`);
  console.log(`   Coach B provider ID: ${provB.id}`);
  console.log(`   Coach B UPI ID: ${provB.upi_id}`);
  console.log(`   Coach B QR URL: ${provB.qr_code_url}\n`);

  // 3. Set up Coach B availability
  console.log('3. Setting up Coach B availability schedule...');
  const { error: availBErr } = await clientB
    .from('availability')
    .insert({
      provider_id: provB.id,
      day_of_week: 'monday',
      start_time: '08:00',
      end_time: '17:00',
      active: true,
    });
  if (availBErr) console.warn('   Coach B availability insert warning:', availBErr.message);

  // 4. Set up Coach B service & booking with customer info
  console.log('4. Creating Coach B service and booking with customer PII...');
  const { data: svcB } = await clientB
    .from('services')
    .insert({
      provider_id: provB.id,
      name: 'Private Executive Coaching',
      duration: 60,
      price: 5000,
      active: true,
    })
    .select()
    .single();

  let bookingBId = null;
  if (svcB) {
    const { data: bkgB, error: bkgErr } = await clientB
      .from('bookings')
      .insert({
        provider_id: provB.id,
        service_id: svcB.id,
        customer_name: 'Confidential Client B',
        customer_email: `client_b_${ts}@vip.com`,
        customer_phone: '+919999988888',
        booking_date: '2026-10-15',
        start_time: '10:00',
        end_time: '11:00',
        duration: 60,
        price: 5000,
        status: 'confirmed',
        payment_status: 'confirmed',
      })
      .select()
      .single();
    if (!bkgErr && bkgB) {
      bookingBId = bkgB.id;
      console.log(`   Created booking for Coach B: ${bookingBId}`);
    }
  }

  console.log('\n--- EXECUTING CROSS-ACCOUNT ACCESS TESTS (Coach A attempting to read Coach B data) ---\n');

  const results = {};

  // TEST 1: Coach A attempts to fetch Coach B's bookings
  console.log('TEST 1: Fetching other provider\'s bookings directly via Supabase client...');
  const { data: bkgRead, error: bkgReadErr } = await clientA
    .from('bookings')
    .select('*')
    .eq('provider_id', provB.id);

  const bookingsBlocked = (!bkgRead || bkgRead.length === 0);
  console.log(`   Result: ${bookingsBlocked ? 'PASSED (0 rows returned)' : `FAILED (${bkgRead?.length} rows returned)`}`);
  results.bookings = bookingsBlocked ? 'PASS' : 'FAIL';

  // TEST 2: Coach A attempts to fetch customers / Coach B's customer list
  console.log('TEST 2: Fetching customer list directly via Supabase client...');
  const { data: custRead, error: custReadErr } = await clientA
    .from('customers')
    .select('*');

  // Also check if Coach A can read Coach B's booking customer info
  const { data: bkgCustRead } = await clientA
    .from('bookings')
    .select('customer_name, customer_email, customer_phone')
    .eq('provider_id', provB.id);

  // If customers table has RLS, Coach B's customer should not be in custRead
  const clientBExposedInCustomers = custRead?.some(c => c.email === `client_b_${ts}@vip.com`);
  const clientBExposedInBookings = (bkgCustRead && bkgCustRead.length > 0);
  const customersBlocked = !clientBExposedInCustomers && !clientBExposedInBookings;

  console.log(`   Result: ${customersBlocked ? 'PASSED (Coach B customer list isolated)' : 'FAILED (Coach B customer info exposed)'}`);
  results.customers = customersBlocked ? 'PASS' : 'FAIL';

  // TEST 3 & 4: Coach A attempts to fetch Coach B's QR code URL and UPI ID
  console.log('TEST 3 & 4: Fetching other provider\'s QR code URL and UPI ID...');
  const { data: provBRead, error: provBReadErr } = await clientA
    .from('providers')
    .select('id, name, upi_id, qr_code_url')
    .eq('id', provB.id);

  const provData = provBRead && provBRead[0];
  const upiBlocked = (!provData || !provData.upi_id);
  const qrBlocked = (!provData || !provData.qr_code_url);

  console.log(`   UPI ID Result: ${upiBlocked ? 'PASSED (empty/blocked)' : `FAILED (leaked: ${provData?.upi_id})`}`);
  console.log(`   QR Code Result: ${qrBlocked ? 'PASSED (empty/blocked)' : `FAILED (leaked: ${provData?.qr_code_url})`}`);
  results.upi_id = upiBlocked ? 'PASS' : 'FAIL';
  results.qr_code_url = qrBlocked ? 'PASS' : 'FAIL';

  // TEST 5: Coach A attempts to fetch Coach B's availability
  console.log('TEST 5: Fetching other provider\'s availability schedule directly via Supabase client...');
  const { data: availRead, error: availReadErr } = await clientA
    .from('availability')
    .select('*')
    .eq('provider_id', provB.id);

  const availBlocked = (!availRead || availRead.length === 0);
  console.log(`   Result: ${availBlocked ? 'PASSED (0 rows returned)' : `FAILED (${availRead?.length} rows returned)`}`);
  results.availability = availBlocked ? 'PASS' : 'FAIL';

  console.log('\n=== RLS CROSS-ACCOUNT TEST SUMMARY ===');
  console.log(`Bookings Isolation:    ${results.bookings}`);
  console.log(`Customer List:         ${results.customers}`);
  console.log(`QR Code URL Isolation: ${results.qr_code_url}`);
  console.log(`UPI ID Isolation:      ${results.upi_id}`);
  console.log(`Availability Schedule: ${results.availability}`);
  console.log('=====================================\n');

  const allPassed = Object.values(results).every(r => r === 'PASS');
  return { allPassed, results };
}

runRLSTest()
  .then(({ allPassed }) => {
    process.exit(allPassed ? 0 : 1);
  })
  .catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
  });
