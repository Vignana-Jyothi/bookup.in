import assert from 'node:assert/strict';
import router from '../server/routes/publicBookings.js';
import { config } from '../server/config.js';
import { refundService } from '../server/services/refundService.js';

const original = { fetch: globalThis.fetch, config: { ...config }, audit: refundService.logAudit, refund: refundService.processRefund };
const handler = router.stack.find(layer => layer.route?.path?.includes('/current/cancel')).route.stack.at(-1).handle;
let scenario;
let writes;
let effects;
Object.assign(config, { supabaseUrl: 'https://cancel-fixture.supabase.co', supabaseServiceRoleKey: 'fixture-key' });
refundService.logAudit = async () => { effects++; };
refundService.processRefund = async () => { effects++; return { refund: {} }; };
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.origin, 'https://cancel-fixture.supabase.co', 'No external requests');
  assert.equal(url.pathname, '/rest/v1/bookings');
  if ((options.method || 'GET') === 'PATCH') {
    assert.equal(url.searchParams.get('status'), `eq.${scenario.status}`);
    assert.equal(url.searchParams.get('payment_status'), 'eq.not_required');
    if (scenario.race) return Response.json(null);
    writes++;
    return Response.json({ id: 'fixture-booking' });
  }
  return Response.json({ id: 'fixture-booking', provider_id: 'fixture-provider', status: scenario.status,
    payment_status: 'not_required', price: 0, duration: 60, booking_date: '2090-01-02', start_time: '09:00:00',
    providers: { timezone: 'Asia/Kolkata' }, services: { name: 'Fixture service' }, policy_snapshot: {} });
};
try {
  for (scenario of [
    { status: 'completed', expected: 409 }, { status: 'rejected', expected: 409 },
    { status: 'no-show', expected: 409 }, { status: 'disputed', expected: 409 },
    { status: 'cancelled', expected: 200, idempotent: true },
    { status: 'late-cancellation', expected: 200, idempotent: true },
    { status: 'confirmed', race: true, expected: 409 },
    { status: 'confirmed', expected: 200 }, { status: 'pending_payment', expected: 200 },
  ]) {
    writes = 0; effects = 0;
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { token: 'fixture-management-token' }, headers: {}, body: {} }, res);
    assert.equal(res.statusCode, scenario.expected, scenario.status);
    assert.equal(writes, scenario.expected === 200 && !scenario.idempotent ? 1 : 0);
    if (!writes) assert.equal(effects, 0, 'Failed/stale/terminal cancellation must have no side effects');
  }
  console.log('PASS: customer cancellation preserves terminal decisions, detects concurrent changes and handles repeats');
} finally {
  globalThis.fetch = original.fetch;
  Object.assign(config, original.config);
  refundService.logAudit = original.audit;
  refundService.processRefund = original.refund;
}
