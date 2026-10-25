import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const page = await read('frontend/src/pages/booking/CustomerBooking.jsx');
const body = page.split('  const fetchRescheduleSlots = useCallback(async (date) => {')[1].split('\n  }, [provider?.id')[0];
const state = { time: '09:00', ready: 'stale' };
const version = { current: 0 };
const requests = new Map();
const calendar = new Map();
const dbService = { getBusySlots: (_provider, date, _booking, service, options) => {
  assert.equal(service, 'service'); assert.equal(options.strict, true);
  const pending = deferred(); requests.set(date, pending); return pending.promise;
} };
const dependencies = {
  rescheduleRequestVersion: version, provider: { id: 'provider', timezone: 'Asia/Kolkata' }, resolvedBooking: { id: 'booking' }, targetServiceId: 'service', dbService,
  realGoogleCalendarService: { getBusyTimes: date => { const pending = deferred(); calendar.set(date, pending); return pending.promise; } },
  setNewTime: value => { state.time = value; }, setLoadedRescheduleScope: value => { state.ready = value; },
  setRescheduleDbBusySlots: value => { state.db = value; }, setRescheduleGcalBusyTimes: value => { state.calendar = value; },
  setIsLoadingRescheduleSlots: value => { state.loading = value; }, setRescheduleSlotsError: value => { state.error = value; },
};
const fetchSlots = new Function(...Object.keys(dependencies), `return async date => {${body}}`)(...Object.values(dependencies));
const old = fetchSlots('2026-11-01');
const latest = fetchSlots('2026-11-02');
assert.equal(state.time, '', 'Any refresh clears the previously selected slot');
assert.equal(state.ready, null);
requests.get('2026-11-01').resolve([{ start_time: '09:00' }]);
calendar.get('2026-11-01').resolve([{ start: '09:00' }]);
await old;
assert.equal(state.loading, true, 'Old response cannot stop the current loading indicator');
assert.equal(state.ready, null);
requests.get('2026-11-02').resolve([{ start_time: '12:00' }]);
calendar.get('2026-11-02').resolve([]);
await latest;
assert.equal(state.ready, 'provider:booking:2026-11-02');
assert.deepEqual(state.db, [{ start_time: '12:00' }]);

const failed = fetchSlots('2026-11-03');
requests.get('2026-11-03').reject(new Error('Fixture unavailable'));
calendar.get('2026-11-03').resolve([]);
await failed;
assert.match(state.error, /Unable to load/);
assert.equal(state.ready, null, 'Failure cannot publish empty-busy availability');
assert.deepEqual(state.db, []);
assert.equal(state.loading, false);
const retry = fetchSlots('2026-11-03');
requests.get('2026-11-03').resolve([]);
calendar.get('2026-11-03').resolve([]);
await retry;
assert.equal(state.error, null);
assert.equal(state.ready, 'provider:booking:2026-11-03', 'Successful genuinely empty availability can be published');
const closed = fetchSlots('2026-11-04');
++version.current; // Same invalidation as the production effect cleanup.
requests.get('2026-11-04').resolve([]); calendar.get('2026-11-04').resolve([]);
await closed;
assert.equal(state.ready, null, 'Closed or changed dialog cannot receive a late result');

const guard = page.split('  const handleConfirmReschedule = async () => {')[1].split('\n  };')[0];
let writes = 0;
await new Function('rescheduleSlotsReady', 'newDate', 'newTime', 'isSubmittingReschedule', 'customerBookingService', `return async () => {${guard}}`)(
  false, '2026-11-03', '09:00', false, { rescheduleBooking: () => { ++writes; } },
)();
assert.equal(writes, 0);
assert.match(page, /disabled=\{!rescheduleSlotsReady \|\| !newDate \|\| !newTime \|\| isSubmittingReschedule\}/);

const calendarSource = await read('frontend/src/services/calendar/RealGoogleCalendarProvider.js');
const busyBody = calendarSource.split("  async getBusyTimes(dateStr, providerId, timeZone = 'Asia/Kolkata') {")[1].split('\n  }')[0];
const calendarMethod = transport => new Function('boundedFetch', `return async function(dateStr, providerId, timeZone = 'Asia/Kolkata') {${busyBody}}`)(transport).bind({ apiBase: '/api' });
assert.deepEqual(await calendarMethod(async () => new Response(JSON.stringify({ connected: false, busyTimes: [] })))('2026-11-03', 'provider'), []);
await assert.rejects(calendarMethod(async () => new Response('{}', { status: 503 }))('2026-11-03', 'provider'), /unavailable/);
await assert.rejects(calendarMethod(async () => { throw new Error('Fixture network failure'); })('2026-11-03', 'provider'), /Fixture network/);

const dbSource = (await read('frontend/src/services/supabase/dbService.js')).replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
const db = new Function('supabase', 'isSupabaseConfigured', 'getApiBase', 'boundedFetch', `${dbSource}\nreturn dbService;`)(
  { rpc: async () => ({ error: new Error('Fixture RPC unavailable') }) }, () => true, () => '/api', async () => { throw new Error('Fixture backend unavailable'); },
);
await assert.rejects(db.getBusySlots('provider', '2026-11-03', null, 'service', { strict: true }), /Unable to verify/);
assert.deepEqual(await db.getBusySlots('provider', '2026-11-03'), [], 'Other callers retain their legacy fallback contract');
console.log('PASS: reschedule deferred request ordering, failure/retry closure, cleared selection, strict DB and disconnected calendar');
