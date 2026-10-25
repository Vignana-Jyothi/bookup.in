import assert from 'node:assert/strict';
import express from 'express';
import { config } from '../server/config.js';
import { handleRescheduleBooking } from '../server/routes/publicBookings.js';
import { googleCalendarService } from '../server/services/googleCalendar.js';
import { refundService } from '../server/services/refundService.js';

const original = { fetch: globalThis.fetch, config: { ...config }, busy: googleCalendarService.getBusyIntervals, audit: refundService.logAudit };
let scenario; let writes; let rpcCalls;
Object.assign(config, { supabaseUrl: 'https://reschedule-fixture.supabase.co', supabaseServiceRoleKey: 'fixture-key' });
googleCalendarService.getBusyIntervals = async () => { if (scenario === 'calendar-error') throw new Error('Fixture Calendar outage'); return { connected: false }; };
refundService.logAudit = async () => {};
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === '127.0.0.1') return original.fetch(input, options);
  assert.equal(url.origin, 'https://reschedule-fixture.supabase.co');
  const path = url.pathname.replace('/rest/v1/', '');
  if (path === 'availability') return scenario === 'availability-error'
    ? Response.json({ code: '42501', message: 'Fixture unavailable' }, { status: 403 })
    : Response.json({ active: true, start_time: '09:00', end_time: '18:00' });
  if (path === 'rpc/is_generated_booking_slot_v1') return Response.json(true);
  if (path === 'rpc/reschedule_booking_atomic') {
    rpcCalls++;
    if (scenario === 'rpc-throw') throw new Error('Fixture transport failure');
    if (['PGRST202', '42501', '40001'].includes(scenario)) return Response.json({ code: scenario, message: 'Fixture RPC failure' }, { status: 400 });
    return Response.json(scenario === 'conflict' ? { success: false, error: 'This slot is no longer available' } : { success: true });
  }
  assert.equal(path, 'bookings');
  if ((options.method || 'GET') === 'PATCH') { writes++; return Response.json(null); }
  assert.ok(url.searchParams.has('management_token_hash'), 'No non-atomic overlap query fallback');
  return Response.json({ id: 'fixture-booking', provider_id: 'fixture-provider', service_id: 'fixture-service',
    status: 'confirmed', payment_status: 'not_required', duration: 60, booking_date: '2090-01-02', start_time: '09:00',
    policy_snapshot: { max_reschedules: 3, reschedule_min_hours_before: 0 },
    providers: { timezone: 'Asia/Kolkata', min_notice: 0 }, services: { name: 'Fixture service' } });
};
const app = express(); app.use(express.json());
app.post('/reschedule/:token', handleRescheduleBooking);
const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
try {
  for (scenario of ['calendar-error', 'availability-error', 'PGRST202', '42501', '40001', 'rpc-throw', 'conflict', 'success']) {
    writes = 0; rpcCalls = 0;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/reschedule/fixture-management-token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newDate: '2090-01-03', newTime: '10:00' }),
    });
    assert.equal(response.status, scenario === 'success' ? 200 : scenario === 'conflict' ? 409 : 503, scenario);
    assert.equal(writes, scenario === 'success' ? 1 : 0, 'Failed operations must never use a direct-write fallback');
    assert.equal(rpcCalls, ['availability-error', 'calendar-error'].includes(scenario) ? 0 : 1);
  }
  console.log('Atomic reschedule HTTP fixture tests passed.');
} finally {
  await new Promise(resolve => server.close(resolve)); globalThis.fetch = original.fetch;
  Object.assign(config, original.config); googleCalendarService.getBusyIntervals = original.busy; refundService.logAudit = original.audit;
}
