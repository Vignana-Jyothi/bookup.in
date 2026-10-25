import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createManualAppointmentHandler } from '../server/routes/merchantAppointments.js';

const provider = '11111111-1111-4111-8111-111111111111';
const service = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';
const body = { serviceId: service, customerName: 'Fixture Customer', customerPhone: '9876543210', bookingDate: '2026-12-22', startTime: '10:00' };
let result = { data: { id, provider_id: provider, service_id: service, customer_name: body.customerName, price: 1000, status: 'confirmed', payment_status: 'awaiting_payment' } };
const calls = [];
const handler = createManualAppointmentHandler({ rpc: async (name, input) => { calls.push({ name, input }); return result; } });
async function request(input = body, requestKey = key) {
  const res = { code: 200, set() {}, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ providerId: provider, body: input, headers: { 'idempotency-key': requestKey } }, res);
  return res;
}
let response = await request();
assert.equal(response.code, 201);
assert.equal(response.body.appointment.id, id);
assert.equal(response.body.appointment.paymentStatus, 'awaiting_payment');
assert.equal(response.body.appointment.syncedToGoogleCalendar, false);
assert.equal(calls[0].input.p_provider_id, provider);
assert.equal(calls[0].input.p_key, key);
assert.equal((await request({ ...body, providerId: id })).code, 422);
assert.equal((await request({ ...body, price: 1 })).code, 422);
assert.equal((await request({ ...body, customerName: { name: 'Invalid shape' } })).code, 422);
assert.equal((await request({ ...body, bookingDate: '2026-02-30' })).code, 422);
assert.equal((await request(body, '')).code, 422);
result = { error: { code: 'PGRST202', message: 'Missing function' } };
assert.equal((await request()).code, 503);
result = { error: { message: 'SLOT_UNAVAILABLE' } };
assert.equal((await request()).code, 409);
result = { data: { id, provider_id: id } };
assert.equal((await request()).code, 503);

// Run production page handlers with local dependencies. No database or gateway.
const source = await readFile(new URL('../../frontend/src/pages/dashboard/Appointments.jsx', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('  const runSavedAction ='), source.indexOf('  // Modals'));
function harness(name, next) {
  const dispatches = []; const notices = []; const closed = []; const requests = []; const calendarCalls = [];
  let fail = true;
  const booking = { id, serviceId: service, duration: 30, date: body.bookingDate, startTime: '10:00', endTime: '10:30', googleEventId: 'fictional-event' };
  const env = {
    state: { auth: {}, provider: { id: provider }, googleCalendar: { isConnected: true }, bookings: [booking], services: [], availability: {} },
    isSupabaseConfigured: () => true,
    actionBusyRef: { current: false }, manualIntentRef: { current: null },
    setActionBusy() {}, setActionError() {}, addToast: (...args) => notices.push(args),
    dispatch: value => dispatches.push(value), ACTIONS: { ADD_BOOKING: 'ADD', RESCHEDULE_BOOKING: 'RESCHEDULE', DELETE_BOOKING: 'DELETE' },
    manualForm: { serviceId: service, customerName: body.customerName, customerPhone: body.customerPhone, customerWhatsApp: '', customerEmail: '', date: body.bookingDate, startTime: '10:00', notes: '' },
    manualSlotsDetailed: [{ time: '10:00', available: true }], gcalConnected: false,
    getTimeSlotsDetailedForDate: () => [{ time: '11:00', available: true }], getGcalBusyTimesForDate: () => [],
    rescheduleDate: body.bookingDate, rescheduleTime: '11:00', setRescheduleTime() {},
    selectedBooking: id, setSelectedBooking() {}, setActionBooking() {},
    setShowManualModal: value => closed.push(value), setShowRescheduleModal: value => closed.push(value), setShowDeleteModal: value => closed.push(value),
    dbService: {
      createMerchantBooking: async (payload, requestKey) => { requests.push(requestKey); if (fail) throw Error('Fixture save failure'); return { id, customerName: body.customerName, customerPhone: body.customerPhone }; },
      rescheduleBooking: async () => { if (fail) throw Error('Fixture save failure'); return true; },
      deleteBooking: async () => { if (fail) throw Error('Fixture save failure'); return true; },
    },
    realGoogleCalendarService: { updateEvent: async () => { calendarCalls.push('update'); return { success: true }; }, deleteEvent: async () => { calendarCalls.push('delete'); return { success: true }; } },
  };
  const code = source.slice(source.indexOf(`  const ${name} =`), source.indexOf(next, source.indexOf(`  const ${name} =`)));
  const action = new Function('env', `with (env) { ${helpers}; ${code}; return ${name}; }`)(env);
  return { action, booking, dispatches, notices, closed, requests, calendarCalls, succeed: () => { fail = false; } };
}
const manual = harness('handleCreateManualBooking', '  // Tab counts');
await manual.action({ preventDefault() {} });
assert.equal(manual.dispatches.length, 0);
assert.equal(manual.closed.length, 0, 'Failed save leaves the form open');
manual.succeed(); await manual.action({ preventDefault() {} });
assert.equal(manual.requests[0], manual.requests[1], 'Lost/failed response retains idempotency key');
assert.equal(manual.dispatches[0].payload.booking.id, id);
assert.equal(manual.dispatches[0].payload.booking.syncedToGoogleCalendar, undefined);
const reschedule = harness('handleConfirmReschedule', '  const handleOpenComplete');
await reschedule.action(reschedule.booking);
assert.equal(reschedule.dispatches.length, 0); assert.equal(reschedule.closed.length, 0); assert.equal(reschedule.calendarCalls.length, 0);
reschedule.succeed(); await reschedule.action(reschedule.booking);
assert.equal(reschedule.dispatches.length, 1); assert.equal(reschedule.calendarCalls.length, 1);
const deletion = harness('handleConfirmDelete', '  // Payment verification handlers');
await deletion.action(id);
assert.equal(deletion.dispatches.length, 0); assert.equal(deletion.closed.length, 0); assert.equal(deletion.calendarCalls.length, 0);
deletion.succeed(); await deletion.action(id);
assert.equal(deletion.dispatches.length, 1); assert.equal(deletion.calendarCalls.length, 1);
const sql = await readFile(new URL('../supabase/20261019_merchant_manual_booking.sql', import.meta.url), 'utf8');
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /IDEMPOTENCY_CONFLICT/);
assert.match(sql, /revoke all on function.*from public, anon, authenticated/);
assert.match(sql, /public\.create_booking_atomic/);
const adapter = await readFile(new URL('../../frontend/src/services/supabase/dbService.js', import.meta.url), 'utf8');
for (const [name, next, args] of [
  ['updateProviderProfile', 'uploadAvatar', [provider, { name: 'Saved name' }]],
  ['updateBookingStatus', 'rescheduleBooking', [id, 'completed']],
  ['rescheduleBooking', 'deleteBooking', [id, body.bookingDate, '11:00', '11:30']],
  ['deleteBooking', null, [id]],
]) {
  const start = adapter.indexOf(`  async ${name}(`);
  const end = next ? adapter.indexOf(`  async ${next}(`, start) : adapter.indexOf('  // ===========================================================================', start);
  const method = adapter.slice(start, end);
  let saved = null;
  const query = { update() { return this; }, delete() { return this; }, eq() { return this; }, select() { return this; }, maybeSingle: async () => ({ data: saved, error: null }) };
  const operation = new Function('env', `with(env){ return ({${method}}).${name}; }`)({ isSupabaseConfigured: () => true, supabase: { from: () => query } });
  await assert.rejects(operation(...args), /not saved/);
  saved = { id: args[0] };
  assert.equal(await operation(...args), true);
}
console.log('PASS: owned manual saves, validation, safe unavailable/conflict states, no fabricated payment/calendar success; failed mutations retain forms and never change calendars; retry reuses the request key. No real writes.');
