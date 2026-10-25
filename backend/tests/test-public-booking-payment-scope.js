import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { handleCreateBooking } from '../server/routes/publicBookings.js';
import { googleCalendarService } from '../server/services/googleCalendar.js';
import { emailService } from '../server/services/email.js';
import { refundService } from '../server/services/refundService.js';

const original = {
  fetch: globalThis.fetch, config: { ...config }, busy: googleCalendarService.getBusyIntervals,
  calendar: googleCalendarService.createEvent, customerEmail: emailService.sendCustomerBookingPendingEmail,
  providerEmail: emailService.sendCoachBookingAwaitingPaymentEmail, audit: refundService.logAudit,
};
const providerId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const bookingId = '33333333-3333-4333-8333-333333333333';
const json = (body, status = 200) => Response.json(body, { status });
let scenario;
let saved;
let updates;
let calendarCalls;
let notificationCalls;

Object.assign(config, {
  supabaseUrl: 'https://fixture.supabase.co', supabaseServiceRoleKey: 'fixture-service-role-key',
  tokenEncryptionKey: '0'.repeat(64), frontendUrl: 'https://calup.example',
});
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.origin, 'https://fixture.supabase.co', 'No real external requests are permitted');
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  const table = url.pathname.replace('/rest/v1/', '');
  if (table === 'rpc/is_generated_booking_slot_v1') return json(scenario.validSlot !== false);
  if (table === 'rpc/create_booking_atomic') {
    if (scenario.fallback) return json({ code: 'PGRST202', message: 'Fixture RPC unavailable' }, 404);
    saved.push({ id: bookingId });
    return json({ success: true, bookingId, endTime: '10:00' });
  }
  if (table === 'services') return json({ id: serviceId, provider_id: providerId, name: 'Fixture consultation', price: scenario.price, duration: 60, active: true, meeting_type: 'online' });
  if (table === 'providers') return json({ id: providerId, name: 'Fixture merchant', email: 'merchant@example.invalid', timezone: 'Asia/Kolkata' });
  if (table === 'customers') return method === 'GET' ? json([{ id: 'fixture-customer' }]) : json({ id: 'fixture-customer' });
  if (table === 'cancellation_policies') return json([]);
  if (table === 'bookings') {
    if (method === 'GET') return json(url.searchParams.get('select') === 'booking_reference' ? [{ booking_reference: 'M123456789' }] : []);
    if (method === 'POST') {
      saved.push(body);
      return json({ id: bookingId });
    }
    if (method === 'PATCH') {
      updates.push(body);
      return scenario.postUpdateError ? json({ code: 'PGRST204', message: 'Fixture optional metadata unavailable' }, 400) : json(null);
    }
  }
  throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`);
};
googleCalendarService.getBusyIntervals = async () => ({ connected: false, busyTimes: [] });
googleCalendarService.createEvent = async (...args) => {
  calendarCalls.push(args);
  return { success: true, eventId: 'fixture-event', meetLink: 'https://meet.google.com/fixture-test' };
};
emailService.sendCustomerBookingPendingEmail = async payload => { notificationCalls.push(payload); return { success: true, messageId: 'fixture-customer-email' }; };
emailService.sendCoachBookingAwaitingPaymentEmail = async payload => { notificationCalls.push(payload); return { success: true, messageId: 'fixture-provider-email' }; };
refundService.logAudit = async () => {};

async function create(input) {
  scenario = input; saved = []; updates = []; calendarCalls = []; notificationCalls = [];
  const req = { body: {
    providerId, serviceId, customerName: 'Fixture customer', customerEmail: 'customer@example.invalid',
    customerPhone: '9876543210', bookingDate: '2030-01-07', startTime: '09:00',
    managementToken: 'fixture-management-token-no-real-access', price: 0,
  } };
  const res = { statusCode: 200, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.headersSent = true; return this; },
  };
  await handleCreateBooking(req, res);
  return res;
}

try {
  for (const input of [
    { price: 250, fallback: false }, { price: 0, fallback: false },
    { price: '250', fallback: true }, { price: '0', fallback: true },
    { price: 250, fallback: false, postUpdateError: true },
  ]) {
    const response = await create(input);
    assert.equal(saved.length, 1, 'Each request persists one fixture booking');
    assert.equal(response.statusCode, 201, `Post-insert processing must finish: ${response.body?.error || ''}`);
    assert.equal(response.body.success, true);
    assert.equal(response.body.bookingId, bookingId);
    assert.equal(response.body.price, input.price, 'The server service price wins over the client price');
    const paid = Number(input.price) > 0;
    const stateUpdate = updates.find(update => update.payment_status);
    assert.equal(stateUpdate.status, paid ? 'pending_payment' : 'confirmed');
    assert.equal(stateUpdate.payment_status, paid ? 'awaiting_payment' : 'not_required');
    assert.equal(calendarCalls.length, paid ? 0 : 1, 'Paid bookings wait for payment; free bookings create the calendar event');
    assert.equal(response.body.meetLink, paid ? null : 'https://meet.google.com/fixture-test');
    assert.equal(notificationCalls.length, 2, 'Notification processing remains reachable');
  }
  const invalid = await create({ price: 250, validSlot: false });
  assert.equal(invalid.statusCode, 422);
  assert.equal(saved.length, 0);
  console.log('PASS: public paid/free booking creation, RPC/fallback paths, payment states, Calendar gating, notifications and invalid-slot no-write');
} finally {
  globalThis.fetch = original.fetch;
  Object.assign(config, original.config);
  googleCalendarService.getBusyIntervals = original.busy;
  googleCalendarService.createEvent = original.calendar;
  emailService.sendCustomerBookingPendingEmail = original.customerEmail;
  emailService.sendCoachBookingAwaitingPaymentEmail = original.providerEmail;
  refundService.logAudit = original.audit;
}
