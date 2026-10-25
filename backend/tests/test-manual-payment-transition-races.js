import assert from 'node:assert/strict';
import router from '../server/routes/paymentVerification.js';
import { config } from '../server/config.js';
import { googleCalendarService } from '../server/services/googleCalendar.js';
import { emailService } from '../server/services/email.js';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalConfig = { ...config };
const originalCalendar = googleCalendarService.createEvent;
const originalDelete = googleCalendarService.deleteEvent;
const originalEmail = emailService.sendCoachBookingConfirmedEmail;
const originalSubmit = emailService.sendPaymentSubmittedEmailToProvider;
let row;
let race;
let writes;
let effects;
Object.assign(config, { supabaseUrl: 'https://fixture.supabase.co', supabaseServiceRoleKey: 'fixture-key' });
googleCalendarService.createEvent = async () => { effects++; return { skipped: true }; };
googleCalendarService.deleteEvent = async () => { effects++; };
emailService.sendCoachBookingConfirmedEmail = async () => { effects++; return { skipped: true }; };
emailService.sendPaymentSubmittedEmailToProvider = async () => { effects++; return { skipped: true }; };
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.ok(url.pathname.startsWith('/rest/v1/'), 'Only mocked database calls are allowed');
  if (url.pathname.endsWith('/providers')) return Response.json(null);
  assert.ok(url.pathname.endsWith('/bookings'));
  if ((options.method || 'GET') === 'GET') return Response.json({ ...row });
  assert.equal(options.method, 'PATCH');
  if (race) { Object.assign(row, race); race = null; }
  const matches = [...url.searchParams].every(([key, value]) => key === 'select' || value === `eq.${row[key]}`);
  if (!matches) return Response.json(null);
  writes++;
  Object.assign(row, JSON.parse(options.body));
  return Response.json({ id: row.id });
};
async function invoke(action, overrides = {}, concurrentChange = null) {
  row = { id: 'fixture-booking', provider_id: 'fixture-provider', status: 'pending_payment', created_at: new Date(Date.now() - 60000).toISOString(), payment_status: action === 'mark-paid' ? 'awaiting_payment' : 'verification_pending', google_event_id: 'existing-event', ...overrides };
  race = concurrentChange; writes = 0; effects = 0;
  const layer = router.stack.find(entry => Array.isArray(entry.route?.path) ? entry.route.path.includes('/:token/mark-paid') && action === 'mark-paid' : entry.route?.path === `/:id/${action}`);
  const handler = layer.route.stack.at(-1).handle;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { id: row.id, token: 'fixture-token' }, providerId: row.provider_id, provider: { email: 'fixture@example.invalid' }, body: {} }, res);
  return res;
}
try {
  for (const action of ['mark-paid', 'confirm-payment', 'reject-payment']) {
    for (const status of ['cancelled', 'completed', 'rejected', 'no_show']) {
      const response = await invoke(action, { status });
      assert.equal(response.statusCode, 409, `${action} must reject ${status}`);
      assert.equal(writes, 0);
      assert.equal(effects, 0);
    }
    for (const change of [{ status: 'cancelled' }, { payment_status: 'rejected', status: 'rejected' }, { payment_status: 'confirmed', status: 'confirmed' }]) {
      const response = await invoke(action, {}, change);
      assert.equal(response.statusCode, 409, `${action} must detect a concurrent decision`);
      assert.equal(writes, 0);
      assert.equal(effects, 0);
      assert.equal(row.status, change.status);
    }
    const success = await invoke(action);
    assert.equal(success.statusCode, 200, `${action} active transition should succeed`);
    assert.equal(writes, 1);
    if (action === 'reject-payment') {
      assert.equal(success.body.booking.status, row.status, 'Rejection response must match persisted booking status');
    }
  }
  const fixedNow = Date.parse('2030-01-01T10:00:00Z');
  Date.now = () => fixedNow;
  for (const created_at of [undefined, 'invalid', new Date(fixedNow - 30 * 60000).toISOString(), new Date(fixedNow - 31 * 60000).toISOString()]) {
    const expired = await invoke('mark-paid', { created_at });
    assert.equal(expired.statusCode, 409, 'Expired or unverifiable holds cannot be revived');
    assert.equal(writes, 0);
    assert.equal(effects, 0);
  }
  const validBoundary = await invoke('mark-paid', { created_at: new Date(fixedNow - 30 * 60000 + 1).toISOString() });
  assert.equal(validBoundary.statusCode, 200);
  assert.equal(writes, 1);
  const verifiedOld = await invoke('confirm-payment', { created_at: new Date(fixedNow - 86400000).toISOString() });
  assert.equal(verifiedOld.statusCode, 200, 'Already submitted payments remain manually confirmable after hold deadline');
  console.log('PASS: manual payment transitions preserve terminal bookings and reject stale writes (30 cases).');
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  Object.assign(config, originalConfig);
  googleCalendarService.createEvent = originalCalendar;
  googleCalendarService.deleteEvent = originalDelete;
  emailService.sendCoachBookingConfirmedEmail = originalEmail;
  emailService.sendPaymentSubmittedEmailToProvider = originalSubmit;
}
