import assert from 'node:assert/strict';
import express from 'express';
import { createBookingRefundRequestsRouter } from '../server/routes/bookingRefundRequests.js';

process.env.DISABLE_RATE_LIMIT = 'true';
const appointmentId = '11111111-1111-4111-8111-111111111111';
const calls = [];
let error;
const client = { async rpc(name, args) { calls.push({ name, args }); return { data: { status: 'requested' }, error }; } };
const app = express();
app.use(express.json());
app.use(createBookingRefundRequestsRouter({ client, auth(req, _res, next) { req.providerId = 'provider-from-session'; req.user = { id: 'user-from-session' }; next(); } }));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'refund-http-test-0001' };
try {
  let response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ appointmentId, reason: 'Please refund the cancelled service.', amount: 1 }) });
  assert.equal(response.status, 422);
  assert.equal(calls.length, 0, 'Browser cannot supply a refund amount');
  response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ appointmentId, reason: 'Please refund the cancelled service.' }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.status, 'requested');
  assert.equal(calls.at(-1).args.p_provider_id, 'provider-from-session');
  assert.equal(calls.at(-1).args.p_user_id, 'user-from-session');
  assert.equal(calls.at(-1).name, 'request_booking_refund_v1');
  response = await fetch(`${base}/${appointmentId}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  error = { message: 'REFUND_ALREADY_IN_PROGRESS' };
  response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ appointmentId, reason: 'Please refund the cancelled service.' }) });
  assert.equal(response.status, 409);
  error = { message: 'private database details', code: 'XX000' };
  response = await fetch(`${base}/${appointmentId}`);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private database/);
  console.log('PASS: Refund request ownership, server-derived amount, stable retry contract and safe errors.');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
