import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { serviceRoleClient } from '../server/middleware/auth.js';
import { cashfreeClient } from '../server/services/cashfree.js';
import { createCashfreeV1Router } from '../server/routes/cashfreeV1.js';

const original = { config: { ...config }, rpc: serviceRoleClient.rpc, create: cashfreeClient.createOrder, fetch: globalThis.fetch, now: Date.now, environment: cashfreeClient.environment };
const providerId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const paymentOrderId = '33333333-3333-4333-8333-333333333333';
const providerOrderId = 'calup_' + paymentOrderId.replaceAll('-', '');
const now = Date.now();
let clock = now;
Date.now = () => clock;
let scenario;
let dispatched;
let charges;
let writes;
let reference;
Object.assign(config, { cashfreeEnabled: true, cashfreeClientId: 'fixture-id', cashfreeClientSecret: 'fixture-secret', backendPublicUrl: 'https://calup.example', cashfreeAllowUnverifiedContact: true, tokenEncryptionKey: '0'.repeat(64) });
cashfreeClient.environment = 'sandbox';
globalThis.fetch = async () => { throw new Error('External requests are forbidden'); };
const attempt = () => ({ attemptId: 'fixture-attempt', paymentOrderId, amountPaise: 10000, currency: 'INR', paymentStatus: scenario === 'paid' ? 'succeeded' : 'created', holdExpiresAt: new Date(scenario === 'expired' ? now - 1 : now + 60000).toISOString() });
serviceRoleClient.rpc = async (name, args) => {
  if (name === 'get_booking_calendar_preflight_v1') return { data: { existingAttempt: true } };
  if (name === 'acquire_booking_hold_v1') return { data: attempt() };
  if (name === 'get_cashfree_reconciliation_context_v1') return { data: { environment: 'sandbox', gatewayAccount: 'calup_primary', purpose: 'service_booking', paymentPath: 'cashfree' } };
  writes.push(name);
  if (name === 'begin_cashfree_order_dispatch_v1') {
    if (scenario === 'dispatch-error') return { error: { code: '08006', message: 'Fixture database unavailable' } };
    if (dispatched || scenario === 'claimed') return { data: false };
    assert.equal(args.p_provider_order_id, providerOrderId);
    reference = args.p_provider_order_id; dispatched = true;
    return { data: true };
  }
  if (name === 'mark_cashfree_order_created_v1') return scenario === 'persist-error'
    ? { error: { code: '08006', message: 'Fixture write lost' } }
    : { data: { ...attempt(), paymentStatus: 'pending', paymentSessionId: 'fixture-session' } };
  throw new Error(`Unexpected financial mutation: ${name}`);
};
cashfreeClient.createOrder = async input => {
  assert.equal(reference, providerOrderId, 'Durable dispatch/reference must precede gateway POST'); charges++;
  if (scenario === 'expires-during-post') clock = now + 60001;
  if (scenario === 'duplicate') throw Object.assign(new Error('Duplicate order'), { outcome: 'definitive', status: 409 });
  return { ...input, payment_session_id: 'fixture-session' };
};
const req = () => ({ headers: { 'idempotency-key': 'fixture-same-idempotency-key' }, body: { providerId, serviceId, bookingDate: '2030-01-07', startTime: '09:00', customerName: 'Fixture customer', customerPhone: '9876543210' } });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, append() {} });
try {
  const handler = createCashfreeV1Router().stack.find(layer => layer.route?.path === '/booking-attempts').route.stack.at(-1).handle;
  for (scenario of ['paid', 'expired', 'claimed', 'dispatch-error', 'persist-error', 'expires-during-post', 'duplicate', 'valid']) {
    clock = now; dispatched = false; charges = 0; writes = []; reference = null;
    const res = response(); await handler(req(), res);
    const expected = { paid: 200, expired: 410, claimed: 202, 'dispatch-error': 503, 'persist-error': 202, 'expires-during-post': 202, duplicate: 202, valid: 201 }[scenario];
    assert.equal(res.code, expected, scenario);
    assert.equal(charges, ['persist-error', 'expires-during-post', 'duplicate', 'valid'].includes(scenario) ? 1 : 0);
    if (scenario === 'paid' || scenario === 'expires-during-post' || scenario === 'claimed') assert.equal(res.body.data.paymentSessionId, null, 'Terminal/expired handoffs must not expose a checkout');
    assert(!writes.includes('mark_cashfree_order_creation_failed_v1'), 'Ambiguous/duplicate POST and DB errors must not release a possibly paid order');
  }
  scenario = 'valid'; clock = now; dispatched = false; charges = 0; writes = []; reference = null;
  const responses = [response(), response()];
  await Promise.all(responses.map(res => handler(req(), res)));
  assert.equal(charges, 1, 'Concurrent identical requests must dispatch exactly one gateway POST');
  assert.deepEqual(responses.map(res => res.code).sort(), [201, 202]);
  console.log('PASS: durable Cashfree dispatch precedes POST, concurrent claims send once, and expired/paid/ambiguous outcomes never reopen checkout');
} finally {
  Object.assign(config, original.config); serviceRoleClient.rpc = original.rpc; cashfreeClient.createOrder = original.create;
  globalThis.fetch = original.fetch; Date.now = original.now; cashfreeClient.environment = original.environment;
}
