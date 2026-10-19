import assert from 'node:assert/strict';
import { reconcileAttempt, restoreBookingCheckout } from '../server/routes/cashfreeV1.js';
import { bookingPaymentIntent, shouldResetBookingPaymentIntent } from '../../frontend/src/services/payments/bookingPaymentIntent.js';

const attempt = { attemptId: 'attempt-1', holdExpiresAt: new Date(Date.now() + 60000).toISOString(), paymentSessionId: 'cached-session' };
let order = { order_amount: 100, order_currency: 'INR', order_status: 'ACTIVE', payment_session_id: 'current-session' };
let lookedUp = 0;
let reconciled = 0;
const dependencies = {
  database: { async rpc(name, args) {
    assert.equal(name, 'get_cashfree_reconciliation_context_v1');
    assert.equal(args.p_attempt_id, attempt.attemptId);
    return { data: { attemptId: attempt.attemptId, providerOrderId: 'gateway-order', amountPaise: 10000, currency: 'INR' } };
  } },
  client: { async getOrder(id) { assert.equal(id, 'gateway-order'); lookedUp += 1; return order; } },
  async reconcile(id) { assert.equal(id, attempt.attemptId); reconciled += 1; return { attemptId: id, paymentStatus: 'succeeded' }; },
};

const restored = await restoreBookingCheckout(attempt, dependencies);
assert.equal(restored.paymentSessionId, 'current-session');
assert.equal(restored.holdExpiresAt, attempt.holdExpiresAt, 'Restoring checkout never extends the hold');
await assert.rejects(restoreBookingCheckout({ ...attempt, holdExpiresAt: new Date(Date.now() - 1000).toISOString() }, dependencies), { code: 'HOLD_EXPIRED' });
assert.equal(lookedUp, 1, 'Expired holds must not request a checkout session');
order = { ...order, order_amount: 200 };
await assert.rejects(restoreBookingCheckout(attempt, dependencies), /amount or currency mismatch/);
order = { ...order, order_amount: 100, order_status: 'PAID' };
const paid = await restoreBookingCheckout(attempt, dependencies);
assert.equal(paid.paymentSessionId, null, 'Paid orders cannot be reopened for payment');
assert.equal(reconciled, 1, 'Non-active gateway orders enter authoritative reconciliation');
const context = { ...attempt, providerOrderId: 'gateway-order', amountPaise: 10000, currency: 'INR', paymentStatus: 'pending', attemptStatus: 'hold_active' };
let transactionStatuses = ['FAILED'];
let paymentLookups = 0;
const retryDependencies = {
  database: { async rpc(name) { assert.equal(name, 'get_cashfree_reconciliation_context_v1', 'Retry classification must not create or release a hold/order'); return { data: { ...context } }; } },
  client: {
    async getOrder() { return { order_status: 'ACTIVE', order_amount: 100, order_currency: 'INR' }; },
    async getOrderPayments() { paymentLookups++; return transactionStatuses.map(payment_status => ({ payment_status })); },
  },
};
for (const [statuses, expected] of [
  [['FAILED'], true], [['USER_DROPPED'], true], [['FAILED', 'USER_DROPPED'], true],
  [[], false], [['FAILED', 'PENDING'], false], [['FAILED', 'SUCCESS'], false], [['UNKNOWN'], false],
]) {
  transactionStatuses = statuses;
  const result = await reconcileAttempt(attempt.attemptId, retryDependencies);
  assert.equal(result.retryableFailure, expected, `Retry availability for ${statuses}`);
  assert.equal(result.holdExpiresAt, attempt.holdExpiresAt, 'A retry never extends the deadline');
  assert.equal(result.paymentStatus, 'pending', 'A failed transaction does not fail the entire order');
}
context.paymentStatus = 'closed_unpaid';
const before = paymentLookups;
assert.equal((await reconcileAttempt(attempt.attemptId, retryDependencies)).paymentStatus, 'closed_unpaid');
assert.equal(paymentLookups, before, 'Closed local orders cannot be revived by ACTIVE gateway state');
context.paymentStatus = 'pending'; context.holdExpiresAt = new Date(0).toISOString();
assert.equal((await reconcileAttempt(attempt.attemptId, retryDependencies)).retryableFailure, undefined);
assert.equal(paymentLookups, before, 'Expired holds cannot advertise payment retries');
context.holdExpiresAt = attempt.holdExpiresAt; context.amountPaise = 20000;
await assert.rejects(reconcileAttempt(attempt.attemptId, retryDependencies), /amount or currency mismatch/);
console.log('PASS: current booking sessions, immutable hold deadline, amount checks, and paid-order reconciliation.');
console.log('PASS: failed/dropped payments reuse an active checkout; pending, successful, unknown, closed and expired outcomes do not offer an unsafe retry.');

const input = { providerId: 'test-provider', serviceId: 'test-service', customerName: 'Test Customer', customerPhone: '9876543210', customerEmail: 'fixture@example.invalid', bookingDate: '2026-11-01', startTime: '10:00', meetingType: 'online' };
let keys = 0;
const key = () => 'fixture-key-' + ++keys;
const intent = bookingPaymentIntent(null, input, key);
for (const error of [new TypeError('Network response lost'), { status: 500 }, { status: 503 }, { status: 408 }, { status: 429 }]) {
  assert.equal(shouldResetBookingPaymentIntent(error), false);
  const retry = bookingPaymentIntent(intent, { ...input }, key);
  assert.equal(retry.key, intent.key, 'Uncertain retry reuses the original server-owned hold');
  assert.deepEqual(retry.payload, intent.payload, 'Policy timestamp and the entire request remain identical');
}
assert.equal(keys, 1);
for (const error of [{ status: 410 }, { status: 409, code: 'ATTEMPT_TERMINAL' }, { status: 503, code: 'PAYMENTS_UNAVAILABLE' }]) assert(shouldResetBookingPaymentIntent(error));
assert.notEqual(bookingPaymentIntent(null, input, key).key, intent.key, 'Definitive terminal attempts start with a new key');
for (const patch of [{ customerName: 'Changed Customer' }, { customerEmail: 'other@example.invalid' }, { meetingType: 'in-person' }, { startTime: '11:00' }]) assert.notEqual(bookingPaymentIntent(intent, { ...input, ...patch }, key).key, intent.key);
console.log('PASS: lost-response retries retain the exact request/key; definitive failures and changed booking inputs start a new intent.');
