import assert from 'node:assert/strict';
import { reconcileSubscriptionOrder } from '../server/routes/merchantSubscription.js';
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
globalThis.fetch = async () => { throw new Error('No real network requests permitted'); };
const expectedOrder = { order_id: 'expected-order', order_status: 'PAID', order_amount: 100, order_currency: 'INR', payment_session_id: 'fixture-session' };
const expectedPayment = { cf_payment_id: 12345, payment_status: 'SUCCESS', payment_amount: 100, payment_currency: 'INR', payment_time: '2030-01-01T00:00:00Z' };
async function run({ order = expectedOrder, payments = [expectedPayment], status = 'pending', scope = {} } = {}) {
  const calls = []; let gatewayCalls = 0;
  const database = { async rpc(name, input) {
    calls.push({ name, input });
    if (name === 'get_subscription_reconciliation_context_v1') return { data: { environment: 'sandbox', gatewayAccount: 'calup_subscription', purpose: 'subscription', paymentPath: 'cashfree', providerId: 'fixture-provider', providerOrderId: expectedOrder.order_id, amountPaise: 10000, currency: 'INR', paymentStatus: status, ...scope } };
    assert.ok(['mark_subscription_cashfree_order_created_v1', 'finalize_subscription_payment_v1'].includes(name));
    return { data: { subscriptionStatus: 'active' } };
  } };
  let projections = 0;
  const client = { environment: 'sandbox', getOrder: async () => { gatewayCalls++; return order; }, getOrderPayments: async () => { gatewayCalls++; return payments; } };
  const outcomes = await Promise.allSettled([reconcileSubscriptionOrder('fixture-subscription', { database, client, project: async () => { projections++; return { pending: true }; } })]);
  return { calls, gatewayCalls, projections, outcome: outcomes[0] };
}
try {
  for (const scope of [{ environment: 'production' }, { environment: undefined }, { gatewayAccount: 'calup_primary' }, { purpose: 'service_booking' }, { paymentPath: 'manual' }]) {
    const mismatch = await run({ scope });
    assert.equal(mismatch.outcome.status, 'rejected');
    assert.equal(mismatch.calls.length, 1); assert.equal(mismatch.gatewayCalls, 0);
  }
  const success = await run();
  assert.equal(success.outcome.status, 'fulfilled');
  const finalized = success.calls.find(call => call.name === 'finalize_subscription_payment_v1');
  assert.equal(finalized.input.p_provider_payment_id, '12345');
  assert.equal(finalized.input.p_paid_amount_paise, 10000);
  for (const bad of [{ order_id: 'other-order' }, { order_amount: 99 }, { order_currency: 'USD' }]) {
    const result = await run({ order: { ...expectedOrder, ...bad }, status: 'creation_unknown' });
    assert.equal(result.outcome.status, 'rejected');
    assert.equal(result.calls.length, 1, 'Mismatched order cannot persist a recovered session or finalize');
  }
  for (const bad of [{ cf_payment_id: undefined }, { cf_payment_id: '' }, { cf_payment_id: {} }, { cf_payment_id: true }, { payment_amount: 99 }, { payment_currency: 'USD' }]) {
    const result = await run({ payments: [{ ...expectedPayment, ...bad }] });
    assert.equal(result.outcome.status, 'rejected');
    assert.ok(!result.calls.some(call => call.name === 'finalize_subscription_payment_v1'));
  }
  for (const scenario of [{ payments: [] }, { payments: [{ ...expectedPayment, payment_status: 'PENDING' }] }, { order: { ...expectedOrder, order_status: 'ACTIVE' } }]) {
    const pending = await run(scenario);
    assert.equal(pending.outcome.status, 'fulfilled'); assert.equal(pending.projections, 1);
    assert.ok(!pending.calls.some(call => call.name === 'finalize_subscription_payment_v1'));
  }
  const { default: router } = await import('../server/routes/merchantSubscription.js');
  const { serviceRoleClient } = await import('../server/middleware/auth.js');
  const { cashfreeClient } = await import('../server/services/cashfree.js');
  const { config } = await import('../server/config.js');
  const originals = { rpc: serviceRoleClient.rpc, create: cashfreeClient.createOrder, get: cashfreeClient.getOrder, payments: cashfreeClient.getOrderPayments, configured: config.isCashfreeConfigured };
  try {
    config.isCashfreeConfigured = () => true;
    let networkCalls = 0;
    cashfreeClient.createOrder = async () => { networkCalls++; throw new Error('Must not dispatch mismatched scope'); };
    cashfreeClient.getOrder = async () => { networkCalls++; throw new Error('Must not restore mismatched scope'); };
    const handler = router.stack.find(layer => layer.route?.path === '/orders').route.stack.at(-1).handle;
    for (const restored of [false, true]) {
      const rpcCalls = [];
      serviceRoleClient.rpc = async (name) => {
        rpcCalls.push(name);
        if (name === 'create_subscription_order_v1') return { data: { orderId: 'fixture-order', paymentSessionId: restored ? 'old-session' : null } };
        assert.equal(name, 'get_subscription_reconciliation_context_v1');
        return { data: { environment: cashfreeClient.environment === 'sandbox' ? 'production' : 'sandbox', gatewayAccount: 'calup_subscription', purpose: 'subscription', paymentPath: 'cashfree', providerId: 'fixture-provider' } };
      };
      const res = { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ headers: { 'idempotency-key': 'fixture-key-1234' }, body: { planId: '11111111-1111-4111-8111-111111111111' }, providerId: 'fixture-provider', provider: {} }, res);
      assert.equal(res.statusCode, 503);
      assert.equal(networkCalls, 0);
      assert.deepEqual(rpcCalls, ['create_subscription_order_v1', 'get_subscription_reconciliation_context_v1']);
    }
    async function checkoutFixture({ expiresAt, restored = false, gatewayStatus = 'ACTIVE', advanceLookup = false, advanceCreate = false, unknown = false } = {}) {
      let now = Date.parse('2030-01-01T00:00:00Z');
      Date.now = () => now;
      const marks = []; let gets = 0; let posts = 0;
      const local = { orderId: 'fixture-order', paymentOrderId: '11111111-1111-4111-8111-111111111111', amountPaise: 10000, currency: 'INR', paymentSessionId: restored ? 'old-session' : null, expiresAt };
      const expectedId = restored || unknown ? expectedOrder.order_id : 'calup_sub_' + local.paymentOrderId.replaceAll('-', '');
      const context = { environment: cashfreeClient.environment, gatewayAccount: 'calup_subscription', purpose: 'subscription', paymentPath: 'cashfree', providerId: 'fixture-provider',
        providerOrderId: restored || unknown ? expectedId : null, amountPaise: 10000, currency: 'INR', expiresAt, paymentStatus: unknown ? 'creation_unknown' : 'pending' };
      serviceRoleClient.rpc = async (name, payload) => {
        if (name === 'create_subscription_order_v1') return { data: { ...local } };
        if (name === 'begin_cashfree_order_dispatch_v1') return { data: true };
        if (name === 'get_subscription_reconciliation_context_v1') return { data: context };
        if (name === 'mark_subscription_cashfree_order_created_v1') { marks.push({ name, payload }); return { data: { ...local, paymentSessionId: 'fresh-session' } }; }
        if (name === 'finalize_subscription_payment_v1') { marks.push({ name, payload }); return { data: { subscriptionStatus: 'active' } }; }
        if (name === 'get_merchant_subscription_v1') return { data: { subscriptionStatus: 'existing' } };
        assert.equal(name, 'get_subscription_cancellation_v1'); return { data: null };
      };
      cashfreeClient.getOrder = async () => { gets++; if (advanceLookup) now += 2000; return { ...expectedOrder, order_id: expectedId, order_status: gatewayStatus, payment_session_id: 'fresh-session' }; };
      cashfreeClient.getOrderPayments = async () => [expectedPayment];
      cashfreeClient.createOrder = async (input) => { posts++; assert.equal(input.order_id, expectedId); if (advanceCreate) now += 2000; return { ...expectedOrder, order_id: expectedId, payment_session_id: 'fresh-session' }; };
      const res = { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ headers: { 'idempotency-key': 'fixture-key-1234' }, body: { planId: '11111111-1111-4111-8111-111111111111' }, providerId: 'fixture-provider', provider: { phone: '9876543210', email: 'merchant@example.invalid' } }, res);
      Date.now = originalNow;
      return { res, marks, gets, posts };
    }
    for (const expiresAt of [undefined, 'invalid', '2030-01-01T00:00:00Z', '2029-12-31T23:59:00Z']) {
      const expired = await checkoutFixture({ expiresAt });
      assert.equal(expired.res.statusCode, 410); assert.equal(expired.posts, 0); assert.equal(expired.gets, 0); assert.deepEqual(expired.marks, []);
    }
    const expiredRestore = await checkoutFixture({ restored: true, expiresAt: '2029-12-31T23:59:00Z' });
    assert.equal(expiredRestore.res.statusCode, 410); assert.equal(expiredRestore.posts, 0); assert.equal(expiredRestore.res.body.data?.paymentSessionId, undefined);
    const created = await checkoutFixture({ expiresAt: '2030-01-01T00:01:00Z' });
    assert.equal(created.res.statusCode, 201); assert.equal(created.posts, 1); assert.equal(created.res.body.data.paymentSessionId, 'fresh-session');
    const fresh = await checkoutFixture({ restored: true, expiresAt: '2030-01-01T00:01:00Z' });
    assert.equal(fresh.res.statusCode, 200); assert.equal(fresh.res.body.data.paymentSessionId, 'fresh-session');
    const crossed = await checkoutFixture({ restored: true, expiresAt: '2030-01-01T00:00:01Z', advanceLookup: true });
    assert.equal(crossed.res.statusCode, 410);
    const createdLate = await checkoutFixture({ expiresAt: '2030-01-01T00:00:01Z', advanceCreate: true });
    assert.equal(createdLate.res.statusCode, 410); assert.equal(createdLate.posts, 1);
    assert.equal(createdLate.marks.filter(mark => mark.name === 'mark_subscription_cashfree_order_created_v1').length, 1, 'Known provider reference must persist before returning expiry');
    const paidLate = await checkoutFixture({ restored: true, expiresAt: '2029-12-31T23:59:00Z', gatewayStatus: 'PAID' });
    assert.equal(paidLate.res.statusCode, 202); assert.equal(paidLate.res.body.data.paymentSessionId, null);
    assert.equal(paidLate.marks.filter(mark => mark.name === 'finalize_subscription_payment_v1').length, 1, 'Expired checkout must still reconcile verified payments');
    const unknown = await checkoutFixture({ unknown: true, expiresAt: '2030-01-01T00:01:00Z' });
    assert.equal(unknown.res.statusCode, 200); assert.equal(unknown.posts, 0, 'Known uncertain order must use GET instead of another create');
  } finally {
    serviceRoleClient.rpc = originals.rpc; cashfreeClient.createOrder = originals.create; cashfreeClient.getOrder = originals.get; cashfreeClient.getOrderPayments = originals.payments; Date.now = originalNow; config.isCashfreeConfigured = originals.configured;
  }
  console.log('PASS: subscription reconciliation validates order/payment evidence before session recovery and activation; legitimate pending/success paths preserved.');
} finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
