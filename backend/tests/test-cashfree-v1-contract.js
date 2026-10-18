import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.resolve(here, '../supabase/20261013_cashfree_v1.sql'), 'utf8');
const abandonmentSql = fs.readFileSync(path.resolve(here, '../supabase/20261014_cashfree_checkout_abandonment.sql'), 'utf8');
const activeHoldSql = fs.readFileSync(path.resolve(here, '../supabase/20261014_cashfree_active_hold_recovery.sql'), 'utf8');
const receiptSql = fs.readFileSync(path.resolve(here, '../supabase/20261014_cashfree_booking_receipt.sql'), 'utf8');
const bookingReferenceSql = fs.readFileSync(path.resolve(here, '../supabase/20261014_public_booking_reference.sql'), 'utf8');
const bookingReferenceImmutabilitySql = fs.readFileSync(path.resolve(here, '../supabase/20261014_booking_reference_immutability.sql'), 'utf8');
const customerTrackingSql = fs.readFileSync(path.resolve(here, '../supabase/20261014_customer_booking_tracking.sql'), 'utf8');
const routeSource = fs.readFileSync(path.resolve(here, '../server/routes/cashfreeV1.js'), 'utf8');
const rateLimiterSource = fs.readFileSync(path.resolve(here, '../server/middleware/rateLimiter.js'), 'utf8');
const statusSource = fs.readFileSync(path.resolve(here, '../../frontend/src/pages/booking/CashfreePaymentStatus.jsx'), 'utf8');
const customerBookingSource = fs.readFileSync(path.resolve(here, '../../frontend/src/pages/booking/CustomerBooking.jsx'), 'utf8');
const customerBookingServiceSource = fs.readFileSync(path.resolve(here, '../../frontend/src/services/booking/customerBookingService.js'), 'utf8');
const receiptSource = fs.readFileSync(path.resolve(here, '../../frontend/src/components/ui/receipt-printer/BookingReceipt.jsx'), 'utf8');
const receiptStyles = fs.readFileSync(path.resolve(here, '../../frontend/src/components/ui/receipt-printer/BookingReceipt.css'), 'utf8');
const checkoutSource = fs.readFileSync(path.resolve(here, '../../frontend/src/services/payments/cashfreeCheckout.js'), 'utf8');

const requiredFragments = [
  "interval '15 minutes'",
  "payment_status in ('created', 'creation_unknown', 'pending', 'creation_failed', 'closed_unpaid', 'succeeded')",
  "fulfilment_status in ('not_ready', 'fulfilled', 'unfulfilled', 'not_applicable')",
  "status in ('held', 'manual_review', 'reserved', 'expired', 'released')",
  'slot_allocations_no_overlap_v1',
  'finalize_verified_payment_v1',
  "set fulfilment_status = 'unfulfilled'",
  'payment_resolution_cases',
  'payment_order_id uuid not null unique',
  'claim_cashfree_reconciliation_v1',
  'get_cashfree_busy_slots_v1',
  'claim_outbox_jobs_v1',
  'heartbeat_outbox_job_v1',
  'complete_outbox_job_v1',
  'and lease_generation = p_lease_generation',
];

for (const fragment of requiredFragments) {
  assert(sql.includes(fragment), `Cashfree migration is missing invariant: ${fragment}`);
}

const finalizer = sql.slice(sql.indexOf('create or replace function public.finalize_verified_payment_v1'));
assert(finalizer.includes("v_allocation.status = 'held'"), 'Finalizer must require current held ownership');
assert(finalizer.includes('clock_timestamp() < v_allocation.hold_expires_at'), 'Finalizer must enforce the current hold deadline');
assert(finalizer.indexOf("set fulfilment_status = 'unfulfilled'") < finalizer.indexOf("return jsonb_build_object('attemptId'", finalizer.indexOf("set fulfilment_status = 'unfulfilled'")), 'Unfulfilled state must be written before return');

for (const fragment of [
  'abandon_cashfree_checkout_v1',
  "payment_status = 'closed_unpaid'",
  "release_reason = 'customer_checkout_ended'",
  "'payment.checkout_ended_unpaid'",
  'for update of po',
]) {
  assert(abandonmentSql.includes(fragment), `Checkout abandonment migration is missing: ${fragment}`);
}
assert(routeSource.includes("/booking-attempts/:id/checkout-ended"), 'Server must expose the checkout-ended transition');
assert(routeSource.includes("if (order.order_status !== 'PAID') return context"), 'Reconciliation must preserve closed-unpaid state');
assert(routeSource.includes('getActiveHoldDetails'), 'Active-hold conflicts must include safe remaining-time recovery details');
assert(activeHoldSql.includes('get_active_hold_conflict_v1'), 'Active-hold recovery must use a server-only RPC');
assert(activeHoldSql.includes("jsonb_build_object('attemptId', v_attempt.id)"), 'Same-browser active holds must be resumable');
assert(activeHoldSql.includes("revoke all on function public.get_active_hold_conflict_v1"), 'Browser roles must not call active-hold recovery');
assert(checkoutSource.includes('finishCheckoutReturn'), 'Frontend service must call the checkout-ended transition');
assert(statusSource.includes("'Payment failed'"), 'Status page must render the failed outcome');
assert(statusSource.includes('Restart booking'), 'Failed checkout must provide a restart action');
assert(statusSource.includes('Cancel payment and restart'), 'Active checkout must offer safe cancellation before restart');
for (const fragment of [
  "v_order.payment_status = 'succeeded'",
  "v_order.fulfilment_status = 'fulfilled'",
  "'bookingId', v_appointment.id",
  "'cashfreeOrderId', v_order.provider_order_id",
  'revoke all on function public.get_booking_attempt_v1(uuid, text) from public, anon, authenticated',
]) {
  assert(receiptSql.includes(fragment), `Booking receipt projection is missing: ${fragment}`);
}
assert(routeSource.includes("res.set('Cache-Control', 'private, no-store')"), 'Attempt receipt response must not be cached');
assert(statusSource.includes('Print or save receipt'), 'Successful status must offer a receipt action');
assert(statusSource.includes('await readAttempt()'), 'Payment mutations must reload the token-protected receipt projection');
assert(receiptSource.includes('receipt.bookingId'), 'Printed receipt must show the authoritative appointment ID');
assert(receiptSource.includes('tabIndex={0}'), 'Long receipts must be keyboard-scrollable');
assert(receiptStyles.includes(".rp[data-stage='complete'] .rp-output"), 'Completed receipt output must enable scrolling');
assert(receiptStyles.includes('overflow-y: auto'), 'Long receipt content must remain reachable');
for (const fragment of [
  'generate_booking_reference_v1',
  "v_reference := 'M' || v_number::text",
  "check (booking_reference ~ '^M[0-9]{9}$')",
  'appointments_booking_reference_unique_v1',
  "'bookingId', v_appointment.booking_reference",
  "'appointmentId', v_appointment.id",
]) {
  assert(bookingReferenceSql.includes(fragment), `Public booking reference migration is missing: ${fragment}`);
}
assert(bookingReferenceImmutabilitySql.includes('BOOKING_REFERENCE_IMMUTABLE'), 'Public booking IDs must reject updates');
assert(bookingReferenceImmutabilitySql.includes('before update of booking_reference'), 'Booking ID immutability must be enforced by a trigger');
for (const fragment of [
  'get_customer_booking_by_reference_v1',
  'a.customer_phone = p_customer_phone',
  "po.payment_status = 'succeeded'",
  "po.fulfilment_status = 'fulfilled'",
  "'readOnly', true",
  'revoke all on function public.get_customer_booking_by_reference_v1(text, text) from public, anon, authenticated',
]) {
  assert(customerTrackingSql.includes(fragment), `Customer booking tracking migration is missing: ${fragment}`);
}
assert(routeSource.includes("router.post('/customer-bookings/track', customerTrackingLimiter"), 'Cashfree router must expose the protected tracking lookup');
assert(routeSource.includes("!/^M\\d{9}$/.test(bookingId)"), 'Tracking route must validate the public reference format');
assert(rateLimiterSource.includes('customerTrackingLimiter'), 'Customer tracking lookup must be rate limited');
assert(customerBookingServiceSource.includes('/v1/public/customer-bookings/track'), 'Frontend service must use the server-owned tracking endpoint');
assert(customerBookingSource.includes('The booking ID alone cannot open customer details.'), 'Tracking UI must request the booking phone');
assert(customerBookingSource.includes("resolvedBooking?.readOnly === true"), 'Cashfree tracking results must disable legacy management actions');

console.log('Cashfree v1 migration invariant tests passed.');
