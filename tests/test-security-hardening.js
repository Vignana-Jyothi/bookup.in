/**
 * CalUp — Security Hardening Tests
 *
 * Verifies:
 * 1. POST /api/calendar/events without auth → 401
 * 2. GET  /api/admin/disputed-bookings      → 404 (route removed)
 * 3. GET  booking-status with raw UUID       → 404 (allowUuid removed)
 * 4. Booking creation rate limit (21st req)  → 429
 * 5. Rate limit per-IP isolation (X-Forwarded-For)
 */

process.env.ENABLE_TEST_ROUTES = 'true';

import { config } from '../server/config.js';

const API = process.env.VITE_API_URL || process.env.API_URL || `http://localhost:${config.port}`;
let passed = 0;
let failed = 0;
const results = [];

function assert(label, condition, detail = '') {
  if (condition) {
    passed++;
    results.push(`  ✅ ${label}`);
  } else {
    failed++;
    results.push(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function testCalendarEventsRequiresAuth() {
  console.log('\n🔒 Test: POST /api/calendar/events without auth → 401');
  try {
    const res = await fetch(`${API}/api/calendar/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'fake-provider-id',
        booking: { id: 'fake', date: '2026-01-01', startTime: '10:00', endTime: '11:00' },
      }),
    });
    assert('POST /api/calendar/events → 401', res.status === 401, `got ${res.status}`);
  } catch (err) {
    assert('POST /api/calendar/events → 401', false, err.message);
  }
}

async function testDisputedBookingsRemoved() {
  console.log('\n🔒 Test: GET /api/admin/disputed-bookings → 404 (route deleted)');
  try {
    const res = await fetch(`${API}/api/admin/disputed-bookings`);
    // Route was removed, Express returns 404 for unknown routes
    assert('GET /api/admin/disputed-bookings → 404', res.status === 404, `got ${res.status}`);
  } catch (err) {
    assert('GET /api/admin/disputed-bookings → 404', false, err.message);
  }
}

async function testUuidBypassRemoved() {
  console.log('\n🔒 Test: GET booking-status with raw UUID → 404');
  // Use a valid-format UUID that doesn't correspond to any management token hash
  const fakeUuid = '00000000-0000-4000-a000-000000000000';
  try {
    const res = await fetch(`${API}/api/public/bookings/booking-status/${fakeUuid}`);
    assert('GET /booking-status/:uuid → 404', res.status === 404, `got ${res.status}`);
  } catch (err) {
    assert('GET /booking-status/:uuid → 404', false, err.message);
  }
}

async function testBookingCreationRateLimit() {
  console.log('\n🔒 Test: Booking creation rate limit (21st request → 429)');

  // 1. Reset rate limiters via test-only endpoint and ensure override is not disabling them
  try {
    const resetRes = await fetch(`${API}/__test__/reset-rate-limits`, { method: 'POST' });
    if (!resetRes.ok) {
      assert('Rate limiter reset', false, `reset endpoint returned ${resetRes.status} — is NODE_ENV != production?`);
      return;
    }
    await fetch(`${API}/__test__/rate-limit-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: false }),
    });
    assert('Rate limiter reset', true);
  } catch (err) {
    assert('Rate limiter reset', false, err.message);
    return;
  }

  // 2. Send 21 booking creation requests with minimal (invalid) body
  //    The first 20 should get 400 (missing fields), the 21st should get 429
  let lastStatus = 0;
  let hitRateLimit = false;
  const statusCodes = [];

  for (let i = 1; i <= 21; i++) {
    try {
      const res = await fetch(`${API}/api/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'rate-limit-test' }), // intentionally incomplete
      });
      lastStatus = res.status;
      statusCodes.push(res.status);
      if (res.status === 429) {
        hitRateLimit = true;
        break;
      }
    } catch (err) {
      statusCodes.push(`ERR:${err.message}`);
    }
  }

  assert(
    '21st booking POST → 429',
    hitRateLimit,
    `last status: ${lastStatus}, statuses: [${statusCodes.slice(-3).join(', ')}]`
  );

  // 3. Reset again and disable so subsequent tests in the suite are not rate limited
  try {
    await fetch(`${API}/__test__/reset-rate-limits`, { method: 'POST' });
    await fetch(`${API}/__test__/rate-limit-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
  } catch (_) {}
}

async function testRateLimitPerIpIsolation() {
  console.log('\n🔒 Test: Rate limit per IP isolation (X-Forwarded-For)');

  // 1. Reset rate limiters and ensure override is enabled
  try {
    const resetRes = await fetch(`${API}/__test__/reset-rate-limits`, { method: 'POST' });
    if (!resetRes.ok) {
      assert('Rate limiter reset (per-IP)', false, `reset endpoint returned ${resetRes.status}`);
      return;
    }
    await fetch(`${API}/__test__/rate-limit-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: false }),
    });
  } catch (err) {
    assert('Rate limiter reset (per-IP)', false, err.message);
    return;
  }

  // 2. Exhaust rate limit for IP A (198.51.100.1) with 21 requests
  const ipA = '198.51.100.1';
  const ipB = '198.51.100.2';
  let ipAHit429 = false;

  for (let i = 1; i <= 21; i++) {
    try {
      const res = await fetch(`${API}/api/public/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': ipA,
        },
        body: JSON.stringify({ providerId: 'ip-a-test' }),
      });
      if (res.status === 429) {
        ipAHit429 = true;
        break;
      }
    } catch (_) {}
  }

  assert('IP A exhausted rate limit (21st request → 429)', ipAHit429);

  // 3. Send request from IP B (198.51.100.2) — should NOT be rate limited
  let ipBStatus = 0;
  try {
    const resB = await fetch(`${API}/api/public/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': ipB,
      },
      body: JSON.stringify({ providerId: 'ip-b-test' }),
    });
    ipBStatus = resB.status;
  } catch (err) {
    ipBStatus = `ERR:${err.message}`;
  }

  // IP B should get 400 (validation error), definitely NOT 429 (rate limited)
  assert(
    'IP B is NOT blocked by IP A rate limit (status !== 429)',
    ipBStatus === 400,
    `got ${ipBStatus}`
  );

  // 4. Reset again and disable override
  try {
    await fetch(`${API}/__test__/reset-rate-limits`, { method: 'POST' });
    await fetch(`${API}/__test__/rate-limit-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
  } catch (_) {}
}

async function main() {
  console.log('='.repeat(60));
  console.log('🛡️  CalUp Security Hardening Tests');
  console.log('='.repeat(60));

  // Auto-start server if not already running
  try {
    const health = await fetch(`${API}/api/health`).catch(() => null);
    if (!health || !health.ok) {
      await import('../server/index.js');
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  } catch (_) {}

  await testCalendarEventsRequiresAuth();
  await testDisputedBookingsRemoved();
  await testUuidBypassRemoved();
  await testBookingCreationRateLimit();
  await testRateLimitPerIpIsolation();

  console.log('\n' + '='.repeat(60));
  console.log(results.join('\n'));
  console.log('='.repeat(60));
  console.log(`\n${passed} passed, ${failed} failed\n`);

  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
