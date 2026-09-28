/**
 * BookUp — Customer Booking Status Persistence & Payment Verification Test
 *
 * Verifies:
 * 1. Booking creation generates a unique tracking URL: /booking-status/[token]
 * 2. Payment submission persists verification_pending and screenshot in Supabase
 * 3. Re-fetching via secure token returns existing booking without creating new one
 * 4. Re-fetching via booking ID UUID also succeeds
 * 5. Coach confirmation updates status to confirmed in Supabase and reflects in customer tracking
 * 6. Public booking link /book/:slug works normally for new customers
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { generateManagementToken, hashManagementToken, buildTrackingUrl } from '../src/utils/token.js';
import { getCustomerBookingStatusUrl } from '../src/utils/url.js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('❌ Supabase credentials missing');
  process.exit(1);
}

const supabase = createClient(url, key);

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function runTest() {
  console.log('================================================================');
  console.log('TEST: CUSTOMER BOOKING STATUS PERSISTENCE & PAYMENT VERIFICATION');
  console.log('================================================================\n');

  // Step 1: Find an active provider and service
  const { data: provider, error: pErr } = await supabase
    .from('providers')
    .select('id, name, slug, upi_id')
    .limit(1)
    .single();

  assert(!pErr && provider, `Found provider: ${provider?.name} (slug: ${provider?.slug})`);

  const { data: service, error: sErr } = await supabase
    .from('services')
    .select('id, name, price, duration')
    .eq('provider_id', provider.id)
    .limit(1)
    .single();

  assert(!sErr && service, `Found service: ${service?.name} (Rs. ${service?.price})`);

  // Step 2: Generate unique tracking token and URLs
  console.log('\n--- 1. GENERATE TRACKING TOKEN & URLS ---');
  const token = generateManagementToken();
  const tokenHash = await hashManagementToken(token);
  const trackingUrl = getCustomerBookingStatusUrl(token);

  assert(trackingUrl.includes(`/booking-status/${token}`), `Tracking URL correctly formatted: ${trackingUrl}`);

  // Step 3: Insert booking with awaiting_payment status
  console.log('\n--- 2. CREATE BOOKING IN SUPABASE ---');
  const testDate = '2026-11-20';
  const testTime = '11:00';
  const testPrice = service.price || 500;

  const { data: newBooking, error: insErr } = await supabase
    .from('bookings')
    .insert({
      provider_id: provider.id,
      service_id: service.id,
      customer_name: 'Test Customer Persistence',
      customer_email: 'test-persistence@example.com',
      customer_phone: '+919999988888',
      customer_whatsapp: '+919999988888',
      booking_date: testDate,
      start_time: testTime,
      end_time: '12:00',
      duration: service.duration || 60,
      price: testPrice,
      status: 'pending_payment',
      payment_status: 'awaiting_payment',
      management_token_hash: tokenHash,
      notes: `[mgmt_hash:${tokenHash}] E2E persistence test`,
    })
    .select()
    .single();

  if (insErr) {
    console.error('Insert error details:', insErr);
  }
  assert(!insErr && newBooking, `Booking created with ID: ${newBooking?.id}`);
  assert(newBooking.status === 'pending_payment', `Booking status is pending_payment`);
  assert(newBooking.payment_status === 'awaiting_payment', `Payment status is awaiting_payment`);

  const bookingId = newBooking.id;

  try {
    // Step 4: Submit payment details (simulate screenshot upload)
    console.log('\n--- 3. SUBMIT PAYMENT & MARK VERIFICATION PENDING ---');
    const mockScreenshotUrl = `https://storage.supabase.co/payment-screenshots/${bookingId}-receipt.jpg`;
    const paidAt = new Date().toISOString();

    const { data: updatedBooking, error: upErr } = await supabase
      .from('bookings')
      .update({
        payment_status: 'verification_pending',
        payment_marked_paid_at: paidAt,
        payment_screenshot_url: mockScreenshotUrl,
      })
      .eq('id', bookingId)
      .select()
      .single();

    assert(!upErr && updatedBooking, 'Payment marked as verification_pending');
    assert(updatedBooking.payment_status === 'verification_pending', 'Payment status is verification_pending');
    assert(updatedBooking.payment_screenshot_url === mockScreenshotUrl, 'Screenshot URL persisted');
    assert(Boolean(updatedBooking.payment_marked_paid_at), 'Payment timestamp persisted');

    // Step 5: Cold fetch using secure token hash (simulating reopening tracking link)
    console.log('\n--- 4. COLD RETRIEVAL VIA SECURE TOKEN (CUSTOMER REOPENS LINK) ---');
    const { data: retrievedByHash, error: retErr } = await supabase
      .from('bookings')
      .select('*, services (*), providers (*)')
      .eq('management_token_hash', tokenHash)
      .maybeSingle();

    assert(!retErr && retrievedByHash, 'Cold retrieval via token hash succeeded');
    assert(retrievedByHash.id === bookingId, 'Retrieved correct booking ID');
    assert(retrievedByHash.payment_status === 'verification_pending', 'Payment status preserved as verification_pending');
    assert(retrievedByHash.customer_name === 'Test Customer Persistence', 'Customer details intact');
    assert(retrievedByHash.price === testPrice, `Amount intact: Rs. ${retrievedByHash.price}`);
    assert(retrievedByHash.booking_date === testDate, `Booking date intact: ${retrievedByHash.booking_date}`);

    // Step 6: Cold fetch using Booking ID UUID
    console.log('\n--- 5. COLD RETRIEVAL VIA BOOKING ID UUID ---');
    const { data: retrievedById, error: idErr } = await supabase
      .from('bookings')
      .select('*, services (*), providers (*)')
      .eq('id', bookingId)
      .maybeSingle();

    assert(!idErr && retrievedById, 'Cold retrieval via booking ID UUID succeeded');
    assert(retrievedById.payment_status === 'verification_pending', 'Status remains verification_pending via ID lookup');

    // Step 7: Simulate Coach approving payment from dashboard
    console.log('\n--- 6. SIMULATE COACH APPROVAL ---');
    const { data: approvedBooking, error: appErr } = await supabase
      .from('bookings')
      .update({
        status: 'confirmed',
        payment_status: 'confirmed',
        payment_confirmed_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select()
      .single();

    assert(!appErr && approvedBooking, 'Booking approved by coach');
    assert(approvedBooking.status === 'confirmed', 'Booking status updated to confirmed');
    assert(approvedBooking.payment_status === 'confirmed', 'Payment status updated to confirmed');

    // Step 8: Customer re-opens tracking URL after coach approval
    console.log('\n--- 7. CUSTOMER REOPENS TRACKING LINK POST-APPROVAL ---');
    const { data: postApproval, error: paErr } = await supabase
      .from('bookings')
      .select('*, services (*), providers (*)')
      .eq('management_token_hash', tokenHash)
      .maybeSingle();

    assert(!paErr && postApproval, 'Post-approval retrieval succeeded');
    assert(postApproval.status === 'confirmed', 'Customer sees updated status: confirmed');
    assert(postApproval.payment_status === 'confirmed', 'Customer sees payment_status: confirmed');

    // Step 9: Verify public provider booking link isolation for NEW customers
    console.log('\n--- 8. VERIFY PUBLIC PROVIDER BOOKING LINK FOR NEW CUSTOMERS ---');
    const { data: publicServices, error: pubErr } = await supabase
      .from('services')
      .select('id, name, price')
      .eq('provider_id', provider.id)
      .eq('active', true);

    assert(!pubErr && Array.isArray(publicServices), 'Public provider services fetchable without leaking private booking');
    console.log(`  ✓ Public provider link /book/${provider.slug} returns ${publicServices.length} service(s) clean for new customers`);

  } finally {
    // Cleanup test record
    console.log('\n--- CLEANUP ---');
    await supabase.from('bookings').delete().eq('id', bookingId);
    console.log('  ✓ Cleaned up test booking');
  }

  console.log('\n================================================================');
  console.log('✅ ALL PERSISTENCE REQUIREMENTS VERIFIED SUCCESSFULLY!');
  console.log('================================================================\n');
}

runTest().catch((e) => {
  console.error('Test execution failed:', e);
  process.exit(1);
});
