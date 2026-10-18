import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  CashfreeClient,
  amountToPaise,
  cashfreeOrderExpiry,
  findSuccessfulPayment,
  toCashfreeTimestamp,
} from '../server/services/cashfree.js';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

const requests = [];
const client = new CashfreeClient({
  clientId: 'sandbox-id',
  clientSecret: 'sandbox-secret',
  environment: 'sandbox',
  apiVersion: '2023-08-01',
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/orders')) {
      return response(200, { order_id: 'calup_order_1', payment_session_id: 'session_1' });
    }
    return response(200, [{ cf_payment_id: 10, payment_status: 'SUCCESS', payment_amount: 125.5 }]);
  },
});

const order = await client.createOrder({ order_id: 'calup_order_1' }, 'create:local-1');
assert.equal(order.payment_session_id, 'session_1');
assert.equal(requests[0].url, 'https://sandbox.cashfree.com/pg/orders');
assert.equal(requests[0].options.headers['x-client-id'], 'sandbox-id');
assert.equal(requests[0].options.headers['x-api-version'], '2023-08-01');
assert.equal(requests[0].options.headers['x-idempotency-key'], 'create:local-1');

const payments = await client.getOrderPayments('calup_order_1');
assert.equal(payments.length, 1);
assert.equal(findSuccessfulPayment(payments).cf_payment_id, 10);
assert.equal(amountToPaise(125.5), 12550);
assert.equal(amountToPaise('bad'), null);
assert.equal(toCashfreeTimestamp('2026-10-13 17:50:04.899247+00'), '2026-10-13T17:50:04Z');
assert.throws(() => toCashfreeTimestamp('not-a-date'), /Invalid Cashfree timestamp/);
assert.equal(
  cashfreeOrderExpiry('2026-10-13T17:55:52Z', { now: '2026-10-13T17:40:52Z' }),
  '2026-10-13T18:10:52Z',
);
assert.equal(
  cashfreeOrderExpiry('2026-10-13T19:00:00Z', { now: '2026-10-13T17:40:52Z' }),
  '2026-10-13T19:00:00Z',
);
assert.throws(() => cashfreeOrderExpiry('not-a-date'), /Invalid Cashfree order expiry input/);

const rawBody = Buffer.from('{"type":"PAYMENT_SUCCESS_WEBHOOK"}');
const timestamp = '1700000000';
const signature = crypto.createHmac('sha256', 'sandbox-secret').update(`${timestamp}${rawBody}`).digest('base64');
assert.equal(client.verifyWebhookSignature({ rawBody, timestamp, signature }), true);
assert.equal(client.verifyWebhookSignature({ rawBody, timestamp, signature: `${signature}x` }), false);

const rejectedClient = new CashfreeClient({
  clientId: 'id', clientSecret: 'secret', fetchImpl: async () => response(400, { code: 'bad_request' }),
});
await assert.rejects(() => rejectedClient.getOrder('missing'), error => error.outcome === 'definitive' && error.status === 400);

const uncertainClient = new CashfreeClient({
  clientId: 'id', clientSecret: 'secret', fetchImpl: async () => response(503, { code: 'unavailable' }),
});
await assert.rejects(() => uncertainClient.getOrder('unknown'), error => error.outcome === 'unknown' && error.status === 503);

console.log('Cashfree client contract tests passed.');
