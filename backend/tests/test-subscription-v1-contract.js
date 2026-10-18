import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CashfreeClient } from '../server/services/cashfree.js';

const migration = fs.readFileSync('backend/supabase/20261015_subscriptions_v1.sql', 'utf8');
const dispatchMigration = fs.readFileSync('backend/supabase/20261015_subscription_cashfree_dispatch.sql', 'utf8');
const indexMigration = fs.readFileSync('backend/supabase/20261015_subscription_indexes.sql', 'utf8');
const receiptMigration = fs.readFileSync('backend/supabase/20261015_subscription_receipt_projection.sql', 'utf8');
const cancellationMigration = fs.readFileSync('backend/supabase/20261015_subscription_cancellation.sql', 'utf8');
const individualCancellationMigration = fs.readFileSync('backend/supabase/20261015_subscription_individual_cancellation.sql', 'utf8');
const route = fs.readFileSync('backend/server/routes/merchantSubscription.js', 'utf8');
const webhook = fs.readFileSync('backend/server/routes/cashfreeV1.js', 'utf8');
const page = fs.readFileSync('frontend/src/pages/dashboard/Subscription.jsx', 'utf8');
const layout = fs.readFileSync('frontend/src/layouts/DashboardLayout.jsx', 'utf8');
const checkout = fs.readFileSync('frontend/src/services/payments/cashfreeCheckout.js', 'utf8');
const subscriptionReceipt = fs.readFileSync('frontend/src/components/ui/receipt-printer/SubscriptionReceipt.jsx', 'utf8');

assert.match(migration, /status in \('active', 'grace', 'frozen', 'deletion_scheduled', 'operational_deleted'\)/);
assert.match(migration, /grace_ends_at = expires_at \+ interval '5 days'/);
assert.match(migration, /clock_timestamp\(\) \+ interval '90 days'/);
assert.match(migration, /subscription_orders_one_open_per_provider/);
assert.match(migration, /purpose = 'subscription' and booking_attempt_id is null and subscription_order_id is not null/);
assert.match(migration, /application_status = 'review_required'/);
assert.match(migration, /application_status = 'refund_required'/);
assert.match(migration, /on conflict \(subscription_order_id\) do nothing/);
assert.match(migration, /booking_attempt_entitlement_guard_v1/);
assert.match(migration, /access_code\.redeemed/);

assert.match(dispatchMigration, /purpose = 'service_booking'/);
assert.match(indexMigration, /merchant_entitlements_plan_id_idx/);
assert.match(indexMigration, /subscription_invoices_provider_id_idx/);
assert.match(receiptMigration, /cashfreePaymentId/);
assert.match(receiptMigration, /where i\.id = p_document_id and i\.provider_id = p_provider_id/);
assert.match(cancellationMigration, /create table if not exists finance\.subscription_periods/);
assert.match(cancellationMigration, /cancel_advance_subscription_v1/);
assert.match(cancellationMigration, /Unused prepaid Calup subscription period cancelled by merchant/);
assert.match(cancellationMigration, /last_subscription_order_id = v_active\.subscription_order_id/);
assert.match(cancellationMigration, /subscription_credit_notes[\s\S]*refund_id/);
assert.match(individualCancellationMigration, /cancel_subscription_period_v1/);
assert.match(individualCancellationMigration, /starts_at = starts_at - v_duration/);
assert.match(individualCancellationMigration, /sp\.id = p_period_id and sp\.provider_id = p_provider_id/);
assert.match(route, /requireProviderAuth/);
assert.match(route, /finalize_subscription_payment_v1/);
assert.match(route, /router\.post\('\/periods\/:periodId\/cancellation'/);
assert.match(route, /reconcileSubscriptionRefund/);
assert.match(route, /order_tags: \{ purpose: 'subscription'/);
assert.match(checkout, /redirectTarget: '_modal'/);
assert.match(webhook, /reconcileSubscriptionOrder/);
assert.match(webhook, /calup_subscription/);

assert.match(page, /Billing identity/);
assert.match(page, /Have an access code/);
assert.match(page, /Check payment status/);
assert.match(page, /Automatic recurring debit is not enabled/);
assert.match(page, /openLatestReceipt/);
assert.match(page, /<SubscriptionReceipt/);
assert.match(page, /PREPAID PERIODS/);
assert.match(page, /Cancel period and refund/);
assert.match(subscriptionReceipt, /ReceiptPrinter/);
assert.match(subscriptionReceipt, /SUBSCRIPTION RECEIPT/);
assert.match(subscriptionReceipt, /Cashfree order/);
assert.match(layout, /dashboard\/subscription/);

const requests = [];
const cashfree = new CashfreeClient({
  clientId: 'sandbox-id',
  clientSecret: 'sandbox-secret',
  environment: 'sandbox',
  apiVersion: '2025-01-01',
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ refund_id: 'subref_test', refund_status: 'PENDING' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});
await cashfree.createRefund('calup_sub_order', {
  refund_id: 'subref_test', refund_amount: 1.18, refund_note: 'Unused period', refund_speed: 'STANDARD',
});
await cashfree.getRefund('calup_sub_order', 'subref_test');
assert.match(requests[0].url, /\/orders\/calup_sub_order\/refunds$/);
assert.equal(requests[0].options.method, 'POST');
assert.equal(requests[0].options.headers['x-idempotency-key'], 'subref_test');
assert.match(requests[1].url, /\/orders\/calup_sub_order\/refunds\/subref_test$/);

console.log('PASS: subscription entitlement, payment separation, late review, code, UI, and navigation contracts are present.');
