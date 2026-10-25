import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import router from '../server/routes/refunds.js';
import { refundService } from '../server/services/refundService.js';
import { googleCalendarService } from '../server/services/googleCalendar.js';
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalDelete = googleCalendarService.deleteEvent;
const database = createClient('https://fixture.supabase.co', 'fixture-key');
let booking;
let refund;
let writes;
let race;
let refundRace;
let lookupFailure;
let writeFailure;
let auditWrites;
function reset(overrides = {}, ledger = null) {
  booking = { id: 'fixture-booking', provider_id: 'fixture-provider', status: 'confirmed', payment_status: 'confirmed', price: 500, booking_date: '2020-01-01', start_time: '09:00:00', updated_at: new Date().toISOString(), ...overrides };
  refund = ledger ? { id: 'fixture-refund', booking_id: booking.id, provider_id: booking.provider_id, amount: 500, reason: 'coach_cancelled', ...ledger } : null;
  writes = []; race = null; refundRace = null; lookupFailure = false; writeFailure = false; auditWrites = 0;
}
googleCalendarService.deleteEvent = async () => { throw new Error('Unexpected calendar side effect'); };
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.ok(url.pathname.startsWith('/rest/v1/'), 'No external requests are allowed');
  const table = url.pathname.split('/').at(-1);
  assert.ok(['bookings', 'refunds', 'audit_logs'].includes(table));
  const method = options.method || 'GET';
  if (table === 'audit_logs') { auditWrites++; return Response.json(null); }
  if (lookupFailure && table === 'refunds' && method === 'GET') return Response.json({ message: 'fixture lookup failed' }, { status: 500 });
  if (method === 'GET') return Response.json(table === 'bookings' ? { ...booking } : refund ? { ...refund, bookings: { ...booking } } : null);
  const body = JSON.parse(options.body);
  if (method === 'POST') { assert.equal(table, 'refunds'); refund = { id: 'fixture-refund', ...body }; writes.push({ table, body }); return Response.json(refund); }
  assert.equal(method, 'PATCH');
  if (writeFailure) return Response.json({ message: 'Fixture write failed' }, { status: 500 });
  if (refundRace && table === 'refunds') { Object.assign(refund, refundRace); refundRace = null; }
  if (race && table === 'bookings') { Object.assign(booking, race); race = null; }
  const target = table === 'bookings' ? booking : refund;
  const matches = [...url.searchParams].every(([key, value]) => key === 'select' || key === 'management_token_hash' || value === `eq.${target?.[key]}`);
  if (!matches) return table === 'refunds'
    ? Response.json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' }, { status: 406 })
    : Response.json(null);
  Object.assign(target, body); writes.push({ table, body });
  return Response.json(url.searchParams.has('select') ? { ...target } : null);
};
async function invoke(action) {
  const layer = router.stack.find(entry => Array.isArray(entry.route?.path) ? entry.route.path.includes(`/:token/${action}`) : entry.route?.path === `/bookings/:id/${action}`);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await layer.route.stack.at(-1).handle({ params: { id: booking.id, token: 'fixture-token' }, providerId: booking.provider_id, body: {} }, res);
  return res;
}
try {
  for (const status of ['cancelled', 'late-cancellation', 'rejected', 'completed']) {
    reset({ status });
    assert.equal((await invoke('report-coach-no-show')).statusCode, 409);
    assert.equal(writes.length, 0);
    assert.equal((await invoke('mark-no-show')).statusCode, 409);
    assert.equal(writes.length, 0);
  }
  reset({ payment_status: 'awaiting_payment' });
  assert.equal((await invoke('report-coach-no-show')).statusCode, 409);
  assert.equal(writes.length, 0);
  reset();
  assert.equal((await invoke('report-coach-no-show')).statusCode, 200);
  assert.equal(refund.status, 'refund_due');
  const firstReport = booking.coach_no_show_reported_at;
  const firstWrites = writes.length;
  refund.status = 'confirmed'; booking.refund_status = 'confirmed';
  assert.equal((await invoke('report-coach-no-show')).statusCode, 200);
  assert.equal(writes.length, firstWrites);
  assert.equal(booking.coach_no_show_reported_at, firstReport);
  assert.equal(refund.status, 'confirmed');
  reset({ price: 0, payment_status: 'not_required' });
  assert.equal((await invoke('report-coach-no-show')).statusCode, 200);
  assert.equal(refund, null);
  reset();
  assert.equal((await invoke('mark-no-show')).statusCode, 200);
  const noShowTime = booking.customer_no_show_at;
  const noShowWrites = writes.length;
  assert.equal((await invoke('mark-no-show')).statusCode, 200);
  assert.equal(writes.length, noShowWrites);
  assert.equal(booking.customer_no_show_at, noShowTime);
  reset({ booking_date: '2099-01-01' });
  assert.equal((await invoke('mark-no-show')).statusCode, 400, 'Postgres time with seconds must enforce future grace period');
  assert.equal(writes.length, 0);
  for (const action of ['mark-no-show', 'report-coach-no-show']) {
    reset({ booking_date: '2030-01-01', start_time: '09:00:00', providers: { timezone: 'Asia/Kolkata' } });
    Date.now = () => Date.parse('2030-01-01T03:44:00Z');
    assert.equal((await invoke(action)).statusCode, 400, 'Kolkata grace period must not expire early');
    Date.now = () => Date.parse('2030-01-01T03:46:00Z');
    assert.equal((await invoke(action)).statusCode, 200, 'Kolkata wall-clock session must expire independently of server timezone');
    reset({ booking_date: '2030-01-01', start_time: '09:00', providers: { timezone: 'UTC' } });
    assert.equal((await invoke(action)).statusCode, 400, 'Provider timezone changes the absolute appointment start');
    Date.now = originalNow;
  }
  reset({ status: 'no-show', customer_no_show_at: new Date().toISOString() });
  writeFailure = true;
  assert.equal((await invoke('dispute-no-show')).statusCode, 500);
  assert.equal(auditWrites, 0, 'Failed dispute writes must not produce success audits');
  assert.equal(booking.status, 'no-show');
  reset({ status: 'no-show', customer_no_show_at: new Date().toISOString() });
  race = { status: 'cancelled' };
  assert.equal((await invoke('dispute-no-show')).statusCode, 409);
  assert.equal(auditWrites, 0);
  reset({ status: 'no-show', customer_no_show_at: new Date().toISOString() });
  assert.equal((await invoke('dispute-no-show')).statusCode, 200);
  assert.equal(booking.status, 'disputed');
  assert.equal(auditWrites, 1);
  reset({ payment_status: 'awaiting_payment', status: 'pending_payment' });
  assert.equal((await invoke('coach-cancel')).statusCode, 200);
  assert.equal(booking.refund_amount, 0);
  assert.equal(booking.refund_status, 'none');
  assert.equal(refund, null);
  for (const action of ['coach-cancel', 'mark-no-show', 'report-coach-no-show']) {
    reset(); race = { status: 'cancelled' };
    assert.equal((await invoke(action)).statusCode, 409);
    assert.equal(writes.length, 0);
  }
  reset();
  await refundService.processRefund(database, { booking, amount: 500, reason: 'coach_cancelled' });
  assert.equal(refund.status, 'refund_due');
  for (const status of ['refund_due', 'refunded', 'confirmed', 'disputed']) {
    reset({}, { status, amount: 250 });
    const result = await refundService.processRefund(database, { booking, amount: 500, reason: 'coach_no_show' });
    assert.equal(result.status, status);
    assert.equal(result.refundAmount, 250);
    assert.equal(writes.length, 0, 'Repeated refund processing never reopens or changes existing obligations');
  }
  reset({ payment_status: 'awaiting_payment' });
  await assert.rejects(refundService.processRefund(database, { booking, amount: 500, reason: 'coach_no_show' }), /verified payment/);
  assert.equal(writes.length, 0);
  reset(); lookupFailure = true;
  await assert.rejects(refundService.processRefund(database, { booking, amount: 500, reason: 'coach_no_show' }));
  assert.equal(writes.length, 0);
  reset({}, { status: 'confirmed' });
  assert.equal((await refundService.markRefundSent(database, { refundId: refund.id, providerId: booking.provider_id })).status, 'confirmed');
  assert.equal(writes.length, 0);
  await assert.rejects(refundService.customerRefundAction(database, { bookingId: booking.id, action: 'dispute' }), /marked sent/);
  assert.equal(writes.length, 0);
  reset({ refund_status: 'confirmed' }, { status: 'refund_due' });
  refundRace = { status: 'confirmed' };
  await assert.rejects(refundService.markRefundSent(database, { refundId: refund.id, providerId: booking.provider_id }));
  assert.equal(writes.length, 0);
  assert.equal(booking.refund_status, 'confirmed');
  reset({ refund_status: 'confirmed' }, { status: 'refunded' });
  refundRace = { status: 'confirmed' };
  await assert.rejects(refundService.customerRefundAction(database, { bookingId: booking.id, action: 'dispute' }));
  assert.equal(writes.length, 0);
  assert.equal(booking.refund_status, 'confirmed');
  reset({}, { status: 'refund_due' });
  await assert.rejects(refundService.customerRefundAction(database, { bookingId: booking.id, action: 'confirm' }), /marked sent/);
  await refundService.markRefundSent(database, { refundId: refund.id, providerId: booking.provider_id });
  assert.equal(refund.status, 'refunded');
  await refundService.customerRefundAction(database, { bookingId: booking.id, action: 'confirm' });
  assert.equal(refund.status, 'confirmed');
  console.log('PASS: manual refund lifecycle guards, repeat safety, conditional writes, and successful settlement.');
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  googleCalendarService.deleteEvent = originalDelete;
}
