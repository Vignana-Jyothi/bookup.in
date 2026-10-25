import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boundedFetch } from '../server/utils/boundedFetch.js';
import { config } from '../server/config.js';
const originalFetch = globalThis.fetch;
const originalConfig = { ...config };
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let originalToken;
let calendar;
try {
  for (const stage of ['headers', 'body']) {
    let calls = 0;
    let capturedSignal;
    const start = performance.now();
    await assert.rejects(boundedFetch('https://fixture.invalid/stall', {}, { timeoutMs: 15, fetchImpl: async (_url, options) => {
      calls++; capturedSignal = options.signal;
      if (stage === 'headers') return new Promise(() => {});
      return new Response(new ReadableStream({ start() {} }));
    } }), error => error.name === 'TimeoutError');
    assert.equal(calls, 1, 'Timed-out writes must never retry');
    assert.equal(capturedSignal.aborted, true);
    assert.ok(performance.now() - start < 500);
  }
  const caller = new AbortController();
  const pending = boundedFetch('https://fixture.invalid/cancel', { signal: caller.signal }, { fetchImpl: async () => new Promise(() => {}) });
  caller.abort(new Error('Caller cancelled'));
  await assert.rejects(pending, /Caller cancelled/);
  const success = await boundedFetch('https://fixture.invalid/ok', {}, { fetchImpl: async () => Response.json({ success: true }, { status: 201, headers: { 'x-fixture': 'yes' } }) });
  assert.equal(success.status, 201);
  assert.equal(success.headers.get('x-fixture'), 'yes');
  assert.deepEqual(await success.json(), { success: true });
  const empty = await boundedFetch('https://fixture.invalid/empty', {}, { fetchImpl: async () => new Response(null, { status: 204 }) });
  assert.equal(await empty.text(), '');
  Object.assign(config, { supabaseUrl: 'https://fixture.supabase.co', supabaseServiceRoleKey: 'fixture-key', supabaseKey: 'fixture-key', supabaseAnonKey: 'fixture-anon' });
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-key';
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.ok(options.signal instanceof AbortSignal, 'Every wired backend client sends a deadline signal');
    calls.push(url);
    if (url.origin === 'https://fixture.supabase.co') return Response.json([{ id: 'fixture-service' }]);
    assert.equal(url.href, 'https://www.googleapis.com/calendar/v3/freeBusy');
    return Response.json({ calendars: { primary: { busy: [] } } });
  };
  const { serviceRoleClient, authClient } = await import('../server/middleware/auth.js');
  assert.equal((await serviceRoleClient.from('services').select('id')).error, null);
  assert.equal((await authClient.from('services').select('id')).error, null);
  ({ googleCalendarService: calendar } = await import('../server/services/googleCalendar.js'));
  originalToken = calendar.getValidTokenDetails;
  calendar.getValidTokenDetails = async () => ({ success: true, accessToken: 'fixture-access-token' });
  assert.deepEqual(await calendar.getBusyIntervals('fixture-provider', '2030-01-01'), { connected: true, busyTimes: [] });
  assert.equal(calls.length, 3);
  const googleSource = readFileSync('backend/server/services/googleCalendar.js', 'utf8');
  assert.doesNotMatch(googleSource, /\bfetch\(/, 'All OAuth and Calendar fetches use the shared bounded helper');
  const authSource = readFileSync('backend/server/middleware/auth.js', 'utf8');
  assert.match(authSource, /global: \{ fetch: boundedFetch, headers: \{ Authorization:/, 'User-scoped Authorization must survive deadline wiring');
  const publicSource = readFileSync('backend/server/routes/publicBookings.js', 'utf8');
  assert.match(publicSource, /createClient\(config.supabaseUrl, key, \{\s+global: \{ fetch: boundedFetch \}/);
  console.log('PASS: backend fetch bounds hanging headers/body, propagates cancellation, never retries, and wires Calendar/Supabase clients.');
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(config, originalConfig);
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  if (calendar && originalToken) calendar.getValidTokenDetails = originalToken;
}
