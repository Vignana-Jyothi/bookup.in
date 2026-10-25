import assert from 'node:assert/strict';
import { reconcileSubscriptionRefund } from '../server/routes/merchantSubscription.js';
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No real network access is permitted'); };
const expected = { order_id: 'fixture-order', refund_id: 'subref_fixturerefund', refund_status: 'SUCCESS', refund_currency: 'INR', refund_amount: 100 };
async function run({ status = 'requested', result = expected, postError, getError, postResult = expected, amountPaise = 10000, scope = {} } = {}) {
  const marks = []; const calls = []; let released = false;
  const database = { async rpc(name, input) {
    if (name === 'get_subscription_refund_context_v1') return { data: { status, amountPaise, environment: 'sandbox', gatewayAccount: 'calup_subscription', purpose: 'subscription', paymentPath: 'cashfree', providerId: 'fixture-provider', providerOrderId: expected.order_id, ...scope } };
    assert.equal(name, 'mark_subscription_refund_v1'); marks.push(input);
    if (input.p_status === 'succeeded') released = true;
    return { data: true };
  } };
  const client = { environment: 'sandbox',
    async createRefund(orderId, input) { calls.push('POST'); assert.equal(orderId, expected.order_id); assert.equal(input.refund_id, expected.refund_id); if (postError) throw postError; return postResult; },
    async getRefund(orderId, id) { calls.push('GET'); assert.equal(orderId, expected.order_id); assert.equal(id, expected.refund_id); if (getError) throw getError; return result; },
  };
  const settled = await Promise.allSettled([reconcileSubscriptionRefund('fixture-refund', { database, client })]);
  return { marks, calls, released, outcome: settled[0] };
}
try {
  for (const scope of [{ environment: 'production' }, { environment: undefined }, { gatewayAccount: 'calup_primary' }, { purpose: 'service_booking' }, { paymentPath: 'manual' }]) {
    const mismatch = await run({ scope });
    assert.equal(mismatch.outcome.status, 'rejected');
    assert.deepEqual(mismatch.calls, []); assert.deepEqual(mismatch.marks, []);
  }
  const success = await run();
  assert.deepEqual(success.calls, ['POST', 'GET']); assert.equal(success.released, true);
  for (const invalid of [{ order_id: 'other-order' }, { refund_id: 'other-refund' }, { refund_currency: 'USD' }, { refund_amount: 99 }, { refund_amount: null }]) {
    const failed = await run({ result: { ...expected, ...invalid } });
    assert.equal(failed.outcome.status, 'rejected'); assert.equal(failed.released, false);
    assert.equal(failed.marks.at(-1).p_status, 'review_required');
    assert.equal(failed.marks.at(-1).p_provider_refund_id, expected.refund_id);
  }
  const pending = await run({ postResult: expected, result: { ...expected, refund_status: 'PENDING' } });
  assert.equal(pending.released, false, 'Successful POST cannot override authoritative pending GET');
  assert.equal(pending.marks.at(-1).p_status, 'processing');
  const recovered = await run({ postError: Object.assign(new Error('Timeout'), { outcome: 'unknown' }) });
  assert.equal(recovered.released, true); assert.deepEqual(recovered.calls, ['POST', 'GET']);
  const duplicate = await run({ postError: Object.assign(new Error('Duplicate'), { outcome: 'definitive', status: 409 }) });
  assert.equal(duplicate.released, true);
  const missing = await run({ status: 'submitted', getError: Object.assign(new Error('Not visible yet'), { outcome: 'definitive', status: 404 }) });
  assert.equal(missing.marks.at(-1).p_status, 'submitted'); assert.equal(missing.released, false); assert.deepEqual(missing.calls, ['GET']);
  const rejected = await run({ postError: Object.assign(new Error('Bad request'), { outcome: 'definitive', status: 400 }), getError: Object.assign(new Error('Absent'), { status: 404 }) });
  assert.equal(rejected.marks.at(-1).p_status, 'failed'); assert.equal(rejected.released, false);
  const terminal = await run({ status: 'succeeded' }); assert.deepEqual(terminal.calls, []); assert.deepEqual(terminal.marks, []);
  const invalidAmount = await run({ amountPaise: -1 }); assert.deepEqual(invalidAmount.calls, []); assert.equal(invalidAmount.marks.at(-1).p_status, 'review_required');
  console.log('PASS: subscription refund identity, authoritative GET, timeout/duplicate recovery, absent-result retry and settled-state preservation. No real services.');
} finally { globalThis.fetch = originalFetch; }
