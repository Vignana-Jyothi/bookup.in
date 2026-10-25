import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { config } from '../server/config.js';
import { serviceRoleClient } from '../server/middleware/auth.js';
import { cashfreeClient } from '../server/services/cashfree.js';
import { createCashfreeWebhookRouter } from '../server/routes/cashfreeV1.js';

const original = { config: { ...config }, rpc: serviceRoleClient.rpc, secret: cashfreeClient.clientSecret, environment: cashfreeClient.environment,
  order: cashfreeClient.getOrder, payments: cashfreeClient.getOrderPayments, fetch: globalThis.fetch };
Object.assign(config, { cashfreeEnabled: true, cashfreeClientId: 'fixture-id', cashfreeClientSecret: 'fixture-secret', backendPublicUrl: 'https://calup.example', cashfreeEnvironment: 'sandbox' });
cashfreeClient.clientSecret = 'fixture-secret'; cashfreeClient.environment = 'sandbox';
let scenario = 'valid';
let calls = [];
let complete;
const timestamp = '1700000000';
const raw = '{ "type":"PAYMENT_SUCCESS_WEBHOOK", "data":{"order":{"order_id":"calup_fixture","order_amount":999999},"payment":{"cf_payment_id":99,"payment_amount":999999,"payment_currency":"USD"}} }';
const signature = value => crypto.createHmac('sha256', 'fixture-secret').update(timestamp).update(value).digest('base64');
serviceRoleClient.rpc = async (name, args) => {
  calls.push({ name, args });
  if (name === 'record_cashfree_event_v1') return scenario === 'storage-error' ? { error: { message: 'Fixture unavailable' } } : { data: { alreadyProcessed: scenario === 'duplicate' } };
  if (name === 'find_attempt_by_provider_order_v1') return { data: 'fixture-attempt' };
  if (name === 'get_cashfree_reconciliation_context_v1') return { data: { attemptId: 'fixture-attempt', providerOrderId: 'calup_fixture', paymentOrderId: 'fixture-order', amountPaise: 10000, currency: 'INR', environment: 'sandbox', gatewayAccount: 'calup_primary', purpose: 'service_booking', paymentPath: 'cashfree', paymentStatus: 'pending' } };
  if (name === 'finalize_verified_payment_v1') return { data: { paymentStatus: 'succeeded' } };
  if (name === 'finish_cashfree_event_scoped_v1') { complete?.(); return { data: true }; }
  throw new Error(`Unexpected RPC: ${name}`);
};
cashfreeClient.getOrder = async () => ({ order_id: scenario === 'wrong-order' ? 'wrong' : 'calup_fixture', order_status: 'PAID', order_amount: 100, order_currency: 'INR' });
cashfreeClient.getOrderPayments = async () => [{ cf_payment_id: 99, payment_status: 'SUCCESS', payment_amount: 100, payment_currency: 'INR' }];
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.hostname, '127.0.0.1', 'Only the local webhook fixture may receive a real request');
  return original.fetch(input, options);
};
const app = express(); app.use(express.raw({ type: 'application/json' })); app.use('/webhook', createCashfreeWebhookRouter());
const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const post = (body, sig = signature(body)) => fetch(`http://127.0.0.1:${server.address().port}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-timestamp': timestamp, 'x-webhook-signature': sig }, body });
try {
  assert.equal((await post(raw, 'wrong')).status, 401); assert.equal(calls.length, 0);
  assert.equal((await post(raw, signature(JSON.stringify(JSON.parse(raw))))).status, 401, 'Signature must cover untouched request bytes');
  assert.equal((await post('{broken')).status, 400); assert.equal(calls.length, 0);
  scenario = 'storage-error'; assert.equal((await post(raw)).status, 503); assert.equal(calls.length, 1);
  scenario = 'duplicate'; calls = []; assert.equal((await post(raw)).status, 200);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 1, 'Processed duplicates must not repeat financial effects');
  for (scenario of ['valid', 'wrong-order']) {
    calls = [];
    const finished = new Promise(resolve => { complete = resolve; });
    assert.equal((await post(raw)).status, 200, 'A durable event may acknowledge before reconciliation finishes');
    let timer;
    try { await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture reconciliation stalled')), 2000); })]); }
    finally { clearTimeout(timer); }
    const final = calls.find(call => call.name === 'finalize_verified_payment_v1');
    if (scenario === 'valid') {
      assert.equal(final.args.p_paid_amount_paise, 10000, 'Webhook monetary claims never replace authoritative lookup');
      assert.equal(final.args.p_currency, 'INR');
    } else assert.equal(final, undefined);
    const finish = calls.find(call => call.name === 'finish_cashfree_event_scoped_v1');
    assert.equal(finish.args.p_environment, 'sandbox'); assert.equal(finish.args.p_gateway_account, 'calup_primary');
    assert.equal(finish.args.p_status, scenario === 'valid' ? 'processed' : 'review_required');
  }
  console.log('PASS: raw Cashfree signatures, durable acknowledgement, duplicates, authoritative evidence and account-scoped webhook completion');
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  Object.assign(config, original.config); serviceRoleClient.rpc = original.rpc; cashfreeClient.clientSecret = original.secret;
  cashfreeClient.environment = original.environment; cashfreeClient.getOrder = original.order; cashfreeClient.getOrderPayments = original.payments; globalThis.fetch = original.fetch;
}
