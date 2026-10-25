import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/20261025_subscription_refund_terminal.sql', import.meta.url), 'utf8');
assert.match(sql, /where id = p_refund_id for update/);
assert.match(sql, /if v_current_status = 'succeeded' then return true; end if;/);
assert.ok(sql.indexOf("if v_current_status = 'succeeded'") < sql.indexOf('update finance.refunds_v1 set status = p_status'));
assert.match(sql, /on conflict \(refund_id\) do nothing/);

process.env.SUPABASE_URL = 'https://subscription-refund-fixture.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-key';
const { serviceRoleClient } = await import('../server/middleware/auth.js');
const { cashfreeClient } = await import('../server/services/cashfree.js');
const { reconcileSubscriptionRefund } = await import('../server/routes/merchantSubscription.js');
const original = { rpc: serviceRoleClient.rpc, getRefund: cashfreeClient.getRefund, fetch: globalThis.fetch };
let current = 'processing'; let contexts = 0; let lookups = 0;
let releaseStale;
const staleReady = new Promise(resolve => { releaseStale = resolve; });
let marks = [];
globalThis.fetch = async () => { throw new Error('No real network access is permitted'); };
serviceRoleClient.rpc = async (name, payload) => {
  if (name === 'get_subscription_refund_context_v1') {
    contexts++;
    return { data: { environment: cashfreeClient.environment, gatewayAccount: 'calup_subscription', purpose: 'subscription', paymentPath: 'cashfree', providerId: 'fixture-provider', providerOrderId: 'fixture-order', amountPaise: 10000,
      status: current, providerRefundId: 'fixture-refund' }, error: null };
  }
  assert.equal(name, 'mark_subscription_refund_v1');
  marks.push(payload.p_status);
  // Model the database's guarded transition; the source assertions above bind
  // this fixture to the SQL contract. Actual row locking needs isolated DB tests.
  if (current !== 'succeeded') current = payload.p_status;
  if (payload.p_status === 'succeeded') releaseStale();
  return { data: true, error: null };
};
cashfreeClient.getRefund = async () => {
  lookups++;
  if (lookups === 1) {
    await staleReady;
    throw Object.assign(new Error('Fixture timeout after another reconciler succeeded'), { outcome: 'unknown', code: 'FIXTURE_TIMEOUT' });
  }
  return { order_id: 'fixture-order', refund_id: 'fixture-refund', refund_status: 'SUCCESS', refund_currency: 'INR', refund_amount: 100 };
};
try {
  const results = await Promise.allSettled([reconcileSubscriptionRefund('fixture-id'), reconcileSubscriptionRefund('fixture-id')]);
  assert.equal(contexts, 2);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.deepEqual(marks, ['succeeded', 'submitted']);
  assert.equal(current, 'succeeded', 'Stale timeout observation must not regress authoritative success');
  console.log('Subscription refund reconciliation race fixture and SQL source contract passed.');
} finally {
  serviceRoleClient.rpc = original.rpc; cashfreeClient.getRefund = original.getRefund; globalThis.fetch = original.fetch;
}
