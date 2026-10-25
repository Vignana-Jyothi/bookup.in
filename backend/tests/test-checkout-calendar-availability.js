import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { serviceRoleClient } from '../server/middleware/auth.js';
import { cashfreeClient } from '../server/services/cashfree.js';
import { googleCalendarService } from '../server/services/googleCalendar.js';
import { assertCalendarAvailability } from '../server/services/calendarAvailability.js';
import { createCashfreeV1Router } from '../server/routes/cashfreeV1.js';

let calendarCalls = 0;
const database = owner => ({ from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: 'resource', is_owner: owner } }; } }; } });
const args = { database: database(false), providerId: 'provider', service: { instructor_id: 'resource', duration: 60 }, provider: { timezone: 'Asia/Kolkata' }, date: '2030-01-07', startTime: '09:00',
  calendar: { async getBusyIntervals() { calendarCalls++; throw new Error('fixture outage'); } } };
await assertCalendarAvailability(args);
assert.equal(calendarCalls, 0, 'Staff appointments must not inherit the owner Calendar');
await assert.rejects(assertCalendarAvailability({ ...args, database: database(true) }), error => error.status === 503);
await assert.rejects(assertCalendarAvailability({ ...args, database: database(true), calendar: { async getBusyIntervals() { return { connected: true, busyTimes: [{ start: '09:00', end: '10:00' }] }; } } }), error => error.status === 409);
await assert.rejects(assertCalendarAvailability({ ...args, database: database(true), calendar: { async getBusyIntervals() { return { connected: true, busyTimes: [{ start: 'invalid', end: '10:00' }] }; } } }), error => error.status === 503);

const originals = { config: { ...config }, rpc: serviceRoleClient.rpc, create: cashfreeClient.createOrder, busy: googleCalendarService.getBusyIntervals, fetch: globalThis.fetch, environment: cashfreeClient.environment };
const providerId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const paymentOrderId = '33333333-3333-4333-8333-333333333333';
const attempt = { attemptId: 'fixture-attempt', paymentOrderId, amountPaise: 10000, currency: 'INR', paymentStatus: 'created', holdExpiresAt: new Date(Date.now() + 60000).toISOString() };
let scenario;
let holds;
let charges;
Object.assign(config, { cashfreeEnabled: true, cashfreeClientId: 'fixture-id', cashfreeClientSecret: 'fixture-secret', backendPublicUrl: 'https://calup.example', cashfreeAllowUnverifiedContact: true, tokenEncryptionKey: '0'.repeat(64) });
cashfreeClient.environment = 'sandbox';
globalThis.fetch = async () => { throw new Error('No external request permitted'); };
googleCalendarService.getBusyIntervals = async () => {
  calendarCalls++;
  if (scenario === 'outage') throw new Error('Fixture outage');
  return { connected: true, busyTimes: scenario === 'conflict' ? [{ start: '09:00', end: '10:00' }] : [] };
};
serviceRoleClient.rpc = async name => {
  if (name === 'get_booking_calendar_preflight_v1') return { data: { existingAttempt: scenario === 'existing', service: { id: serviceId, duration: 60 }, provider: { timezone: 'Asia/Kolkata' } } };
  if (name === 'acquire_booking_hold_v1') { holds++; return { data: attempt }; }
  if (name === 'get_cashfree_reconciliation_context_v1') return { data: { environment: 'sandbox', gatewayAccount: 'calup_primary', purpose: 'service_booking', paymentPath: 'cashfree' } };
  if (name === 'begin_cashfree_order_dispatch_v1') return { data: true };
  if (name === 'mark_cashfree_order_created_v1') return { data: { ...attempt, paymentStatus: 'pending', paymentSessionId: 'fixture-session' } };
  throw new Error(`Unexpected mutation: ${name}`);
};
cashfreeClient.createOrder = async input => { charges++; return { ...input, payment_session_id: 'fixture-session' }; };
try {
  const handler = createCashfreeV1Router().stack.find(layer => layer.route?.path === '/booking-attempts').route.stack.at(-1).handle;
  for (scenario of ['outage', 'conflict', 'available', 'existing']) {
    holds = 0; charges = 0; calendarCalls = 0;
    const req = { headers: { 'idempotency-key': 'fixture-idempotency-key' }, body: { providerId, serviceId, bookingDate: '2030-01-07', startTime: '09:00', customerName: 'Fixture customer', customerPhone: '9876543210' } };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, append() {} };
    await handler(req, res);
    assert.equal(res.code, scenario === 'outage' ? 503 : scenario === 'conflict' ? 409 : 201, scenario);
    assert.equal(holds, ['available', 'existing'].includes(scenario) ? 1 : 0);
    assert.equal(charges, holds, 'Calendar failures/conflicts must never reserve or dispatch payment');
    assert.equal(calendarCalls, scenario === 'existing' ? 0 : 1, 'Idempotent recovery must not conflict with its own previously created event');
  }
  console.log('PASS: owner/staff Calendar boundaries and actual Cashfree hold handler reject unavailable calendars before reservation/payment');
} finally {
  Object.assign(config, originals.config); serviceRoleClient.rpc = originals.rpc; cashfreeClient.createOrder = originals.create;
  googleCalendarService.getBusyIntervals = originals.busy; globalThis.fetch = originals.fetch; cashfreeClient.environment = originals.environment;
}
