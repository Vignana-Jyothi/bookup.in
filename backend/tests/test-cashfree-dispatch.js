import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import router, { reconcileSubscriptionOrder } from '../server/routes/merchantSubscription.js';
import { serviceRoleClient } from '../server/middleware/auth.js';
import { cashfreeClient } from '../server/services/cashfree.js';
import { config } from '../server/config.js';
const sql = readFileSync('backend/supabase/20261025_zzb_cashfree_dispatch.sql', 'utf8');
assert.match(sql, /where id = p_payment_order_id for update/);
assert.match(sql, /payment_status = 'creation_unknown', provider_order_id = p_provider_order_id/);
assert.match(sql, /where id = p_payment_order_id and payment_status = 'created'/);
assert.match(sql, /interval '60 seconds'/);
assert.match(sql, /PROVIDER_ORDER_MISMATCH/);
assert.match(sql, /from public, anon, authenticated/);
assert.match(sql, /to service_role/);
const originals = { rpc: serviceRoleClient.rpc, create: cashfreeClient.createOrder, get: cashfreeClient.getOrder, payments: cashfreeClient.getOrderPayments, configured: config.isCashfreeConfigured, fetch: globalThis.fetch };
const paymentOrderId = '11111111-1111-4111-8111-111111111111';
const reference = `calup_sub_${paymentOrderId.replaceAll('-', '')}`;
const expiresAt = new Date(Date.now() + 600000).toISOString();
let state = 'created'; let persistedReference = null; let session = null; let posts = 0; let activated = false; let visible = false; let failSessionSave = true; let failDispatch = false;
const calls = [];
let readCount = 0; let releaseReads;
const bothReads = new Promise(resolve => { releaseReads = resolve; });
let releasePost; let notifyPost;
const postStarted = new Promise(resolve => { notifyPost = resolve; });
const postReply = new Promise(resolve => { releasePost = resolve; });
const snapshot = () => ({ orderId: 'local-order', providerId: 'fixture-provider', paymentOrderId, providerOrderId: persistedReference,
  environment: cashfreeClient.environment, gatewayAccount: 'calup_subscription', purpose: 'subscription', paymentPath: 'cashfree',
  amountPaise: 10000, currency: 'INR', paymentStatus: state, expiresAt });
const local = () => ({ orderId: 'local-order', paymentOrderId, paymentSessionId: session, amountPaise: 10000, currency: 'INR', expiresAt });
try {
  globalThis.fetch = async () => { throw new Error('No real external requests permitted'); };
  config.isCashfreeConfigured = () => true;
  serviceRoleClient.rpc = async (name, input) => {
    calls.push({ name, input });
    if (name === 'create_subscription_order_v1') return { data: local() };
    if (name === 'get_subscription_reconciliation_context_v1') {
      const value = snapshot(); readCount++;
      if (readCount <= 2) { if (readCount === 2) releaseReads(); await bothReads; }
      return { data: value };
    }
    if (name === 'begin_cashfree_order_dispatch_v1') {
      assert.equal(input.p_payment_order_id, paymentOrderId); assert.equal(input.p_provider_order_id, reference);
      if (failDispatch) return { error: { message: 'Fixture dispatch persistence unavailable' } };
      if (state !== 'created') return { data: false };
      state = 'creation_unknown'; persistedReference = input.p_provider_order_id;
      return { data: true };
    }
    if (name === 'mark_subscription_cashfree_order_created_v1') {
      if (failSessionSave) { failSessionSave = false; return { error: { message: 'Fixture session persistence failed after POST' } }; }
      state = 'pending'; session = input.p_payment_session_id; return { data: local() };
    }
    assert.equal(name, 'finalize_subscription_payment_v1', '404 or uncertain create must never mark creation failed');
    activated = true; state = 'succeeded'; return { data: { subscriptionStatus: 'active' } };
  };
  cashfreeClient.createOrder = async input => {
    posts++; assert.equal(persistedReference, reference, 'Provider reference must commit before POST'); assert.equal(state, 'creation_unknown');
    notifyPost(); await postReply;
    return { order_id: input.order_id, order_amount: 100, order_currency: 'INR', payment_session_id: 'verified-session' };
  };
  cashfreeClient.getOrder = async () => {
    if (!visible) throw Object.assign(new Error('Create still in flight'), { outcome: 'definitive', status: 404 });
    return { order_id: reference, order_status: 'PAID', order_amount: 100, order_currency: 'INR', payment_session_id: 'verified-session' };
  };
  cashfreeClient.getOrderPayments = async () => [{ cf_payment_id: 1234, payment_status: 'SUCCESS', payment_amount: 100, payment_currency: 'INR' }];
  const handler = router.stack.find(layer => layer.route?.path === '/orders').route.stack.at(-1).handle;
  const invoke = async () => {
    const res = { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ headers: { 'idempotency-key': 'fixture-key-1234' }, body: { planId: paymentOrderId }, providerId: 'fixture-provider', provider: { phone: '9876543210', email: 'merchant@example.invalid' } }, res);
    return res;
  };
  const first = invoke(); const second = invoke(); await postStarted;
  assert.equal(posts, 1);
  releasePost();
  const responses = await Promise.all([first, second]);
  assert.ok(responses.every(response => response.statusCode === 202));
  assert.equal(state, 'creation_unknown'); assert.equal(persistedReference, reference);
  assert.equal(posts, 1, 'Concurrent retries must not dispatch a second create');
  await assert.rejects(reconcileSubscriptionOrder('local-order'), error => error.status === 404);
  assert.equal(state, 'creation_unknown'); assert.equal(activated, false);
  visible = true;
  await reconcileSubscriptionOrder('local-order');
  assert.equal(state, 'succeeded'); assert.equal(activated, true); assert.equal(posts, 1);
  state = 'created'; persistedReference = null; session = null;
  cashfreeClient.createOrder = async () => { posts++; throw Object.assign(new Error('Duplicate gateway order'), { outcome: 'definitive', status: 409 }); };
  const duplicate = await invoke(); assert.equal(duplicate.statusCode, 202); assert.equal(state, 'creation_unknown'); assert.equal(persistedReference, reference);
  await reconcileSubscriptionOrder('local-order'); assert.equal(state, 'succeeded');
  const beforeUnavailable = posts;
  state = 'created'; persistedReference = null; session = null; failDispatch = true;
  const unavailable = await invoke(); assert.equal(unavailable.statusCode, 503); assert.equal(posts, beforeUnavailable); assert.equal(persistedReference, null);
  assert.ok(!calls.some(call => call.name === 'fail_subscription_order_creation_v1'));
  console.log('PASS: durable Cashfree dispatch source contract and actual concurrent subscription handlers preserve one POST, unknown-state recovery and late verified success. SQL runtime remains unexecuted.');
} finally {
  serviceRoleClient.rpc = originals.rpc; cashfreeClient.createOrder = originals.create; cashfreeClient.getOrder = originals.get; cashfreeClient.getOrderPayments = originals.payments; config.isCashfreeConfigured = originals.configured; globalThis.fetch = originals.fetch;
}
