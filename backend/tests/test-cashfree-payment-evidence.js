import assert from 'node:assert/strict';
import { reconcileAttempt, restoreBookingCheckout } from '../server/routes/cashfreeV1.js';

const base = { attemptId: 'fixture-attempt', paymentOrderId: 'fixture-payment-order', providerOrderId: 'fixture-gateway-order',
  amountPaise: 10000, currency: 'INR', environment: 'sandbox', gatewayAccount: 'calup_primary', purpose: 'service_booking', paymentPath: 'cashfree',
  paymentStatus: 'pending', attemptStatus: 'hold_active', holdExpiresAt: new Date(Date.now() + 60000).toISOString() };
const validOrder = { order_id: base.providerOrderId, order_status: 'PAID', order_amount: 100, order_currency: 'INR' };
const validPayment = { cf_payment_id: 12345, payment_status: 'SUCCESS', payment_amount: 100, payment_currency: 'INR' };
let context;
let order;
let payment;
let gatewayCalls;
let mutations;
const database = { async rpc(name, args) {
  if (name === 'get_cashfree_reconciliation_context_v1') return { data: context };
  mutations.push({ name, args });
  if (name === 'finalize_verified_payment_v1') return { data: { paymentStatus: 'succeeded' } };
  if (name === 'mark_cashfree_order_created_v1') return { data: { paymentStatus: 'pending' } };
  throw new Error(`Unexpected mutation: ${name}`);
} };
const client = { environment: 'sandbox', async getOrder() { gatewayCalls++; return order; }, async getOrderPayments() { gatewayCalls++; return [payment]; } };
const reset = () => { context = { ...base }; order = { ...validOrder }; payment = { ...validPayment }; gatewayCalls = 0; mutations = []; };
reset();
assert.equal((await reconcileAttempt(base.attemptId, { database, client })).paymentStatus, 'succeeded');
assert.equal(mutations.length, 1);
assert.equal(mutations[0].args.p_provider_payment_id, '12345');
for (const patch of [{ order_id: 'different-order' }, { order_currency: 'USD' }, { order_amount: 1 }]) {
  reset(); Object.assign(order, patch);
  await assert.rejects(reconcileAttempt(base.attemptId, { database, client }), /mismatch/);
  assert.equal(mutations.length, 0);
}
for (const patch of [{ cf_payment_id: undefined }, { cf_payment_id: {} }, { cf_payment_id: 'undefined' }, { payment_currency: 'USD' }, { payment_currency: undefined }, { payment_amount: 1 }]) {
  reset(); Object.assign(payment, patch);
  await assert.rejects(reconcileAttempt(base.attemptId, { database, client }), /mismatch/);
  assert.equal(mutations.length, 0);
}
for (const patch of [{ environment: 'production' }, { gatewayAccount: 'calup_subscription' }, { purpose: 'subscription' }, { paymentPath: 'manual' }, { environment: undefined }]) {
  reset(); Object.assign(context, patch, { paymentStatus: 'creation_unknown' });
  await assert.rejects(reconcileAttempt(base.attemptId, { database, client }), /environment or account mismatch/);
  await assert.rejects(restoreBookingCheckout(base, { database, client }), /environment or account mismatch/);
  assert.equal(gatewayCalls, 0, 'Wrong-account/configuration lookups must not reach Cashfree');
  assert.equal(mutations.length, 0, 'Wrong-environment 404 must never fail an existing order');
}
reset(); payment.payment_status = 'PENDING';
assert.equal((await reconcileAttempt(base.attemptId, { database, client })).gatewayPaymentInProgress, true);
assert.equal(mutations.length, 0);
reset(); context.paymentStatus = 'creation_unknown';
const missing = { environment: 'sandbox', async getOrder() { throw Object.assign(new Error('Not yet visible'), { outcome: 'definitive', status: 404 }); } };
await assert.rejects(reconcileAttempt(base.attemptId, { database, client: missing }), /Not yet visible/);
assert.equal(mutations.length, 0, 'An uncertain POST may still become visible after a lookup 404');
assert.equal((await reconcileAttempt(base.attemptId, { database, client })).paymentStatus, 'succeeded');
assert.equal(mutations.at(-1).name, 'finalize_verified_payment_v1', 'Later authoritative payment must still be recoverable');
console.log('PASS: authoritative Cashfree order/payment identity, amount, currency and stored gateway scope required before finalization');
