import assert from 'node:assert/strict';
import { restoreBookingCheckout } from '../server/routes/cashfreeV1.js';

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
console.log('PASS: current booking sessions, immutable hold deadline, amount checks, and paid-order reconciliation.');
