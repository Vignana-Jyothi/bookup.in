import assert from 'node:assert/strict';
import express from 'express';
process.env.SUPABASE_URL = 'https://calendar-route-fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-key';
process.env.SUPABASE_ANON_KEY = 'fixture-anon-key';
const originalFetch = globalThis.fetch;
const providerId = '11111111-1111-1111-1111-111111111111';
const bookingId = '22222222-2222-2222-2222-222222222222';
const provider = { id: providerId, user_id: 'fixture-user', name: 'Host', email: 'host@example.com' };
const valid = { id: bookingId, provider_id: providerId, status: 'confirmed', payment_status: 'confirmed', price: 100,
  booking_date: '2030-06-20', start_time: '09:00:00', end_time: '09:30:00', duration: 30,
  services: { name: 'Persisted service' }, providers: { timezone: 'Europe/London', name: 'Persisted host' },
  customer_name: 'Persisted customer', customer_email: 'customer@example.com', customer_phone: '123', meeting_type: 'in-person' };
let saved = { ...valid }; let denied = false; let updates = 0; let googleCalls = 0; let eventBody;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === '127.0.0.1') return originalFetch(input, options);
  if (url.hostname === 'calendar-route-fixture.invalid') {
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'fixture-user', email: 'host@example.com' });
    if (url.pathname.endsWith('/providers')) return Response.json(provider);
    assert.ok(url.pathname.endsWith('/bookings'));
    assert.equal(url.searchParams.get('provider_id'), `eq.${providerId}`, 'Every booking query/write is provider scoped');
    if (options.method === 'PATCH') { updates++; return Response.json({ id: bookingId }); }
    if (denied) return Response.json({ message: 'fixture denied', code: '42501' }, { status: 403 });
    return Response.json(saved);
  }
  assert.equal(url.hostname, 'www.googleapis.com');
  googleCalls++; eventBody = options.body ? JSON.parse(options.body) : null;
  return Response.json({ id: 'persisted-event', htmlLink: 'https://fixture.invalid/event' });
};
const { googleCalendarService: calendar } = await import('../server/services/googleCalendar.js');
const oldDetails = calendar.getValidTokenDetails;
calendar.getValidTokenDetails = async () => ({ success: true, accessToken: 'fixture-token' });
const { default: router } = await import('../server/routes/calendar.js');
const app = express(); app.use(express.json()); app.use('/api/calendar', router);
const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function post(booking = { id: bookingId, googleEventId: 'forged-event', date: '1999-01-01', startTime: '00:00', endTime: '23:59', customerEmail: 'attacker@example.com' }) {
  const response = await fetch(`${base}/api/calendar/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-jwt' }, body: JSON.stringify({ booking, timeZone: 'Pacific/Honolulu' }) });
  return { status: response.status, data: await response.json() };
}
try {
  saved = null; assert.equal((await post()).status, 404);
  denied = true; assert.equal((await post()).status, 503); denied = false;
  saved = { ...valid, provider_id: 'another-provider', google_event_id: 'private-event' }; assert.equal((await post()).status, 404);
  saved = { ...valid, payment_status: 'pending', google_event_id: 'ineligible-event' }; assert.equal((await post()).status, 409);
  saved = { ...valid, status: 'pending_payment' }; assert.equal((await post()).status, 409);
  assert.equal((await post({ id: 'booking-demo', googleEventId: 'forged-event' })).status, 400);
  assert.equal(googleCalls, 0); assert.equal(updates, 0);
  saved = { ...valid, google_event_id: 'owned-event', meet_link: 'https://fixture.invalid/owned-meet' };
  const duplicate = await post(); assert.equal(duplicate.data.eventId, 'owned-event'); assert.equal(googleCalls, 0);
  saved = { ...valid }; const created = await post(); assert.equal(created.data.success, true); assert.equal(updates, 1);
  assert.equal(eventBody.attendees[0].email, valid.customer_email);
  assert.match(eventBody.summary, /Persisted service/); assert.match(eventBody.summary, /Persisted customer/);
  assert.equal(eventBody.start.dateTime, '2030-06-20T08:00:00.000Z');
  assert.equal(eventBody.start.timeZone, 'Europe/London');
  saved = { ...valid, price: 0, payment_status: 'pending' }; assert.equal((await post()).data.success, true);
  for (const method of ['PATCH', 'DELETE']) {
    saved = null;
    const absent = await fetch(`${base}/api/calendar/events/unknown-event`, { method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-jwt' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ booking: { date: 'forged' } }) } : {}) });
    assert.equal(absent.status, 404);
    saved = { ...valid, google_event_id: 'owned-event' };
    const before = googleCalls;
    const owned = await fetch(`${base}/api/calendar/events/owned-event`, { method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-jwt' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ booking: { date: 'forged' } }) } : {}) });
    assert.equal(owned.status, 200); assert.equal(googleCalls, before + 1);
    if (method === 'PATCH') assert.equal(eventBody.start.dateTime, '2030-06-20T08:00:00.000Z');
  }
  const oldBusy = calendar.getBusyIntervals;
  calendar.getBusyIntervals = async () => { throw new Error('private Google account detail'); };
  const busy = await fetch(`${base}/api/calendar/busy?providerId=${providerId}&date=2030-01-01`);
  assert.equal(busy.status, 503); const busyData = await busy.json(); assert.ok(!JSON.stringify(busyData).includes('private')); assert.equal(busyData.busyTimes, undefined);
  calendar.getBusyIntervals = oldBusy;
  console.log('PASS: Calendar router authorizes persisted eligible bookings before deduplication/Google, ignores forged event details, scopes writes and fails closed.');
} finally {
  calendar.getValidTokenDetails = oldDetails; globalThis.fetch = originalFetch;
  await new Promise(resolve => server.close(resolve));
}
