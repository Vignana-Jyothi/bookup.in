import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Execute the production callbacks with controlled Auth/DB/fetch promises; no network or DB.
const read = path => path === 'frontend/src/data/store.jsx' && process.env.FRONTEND_RACE_STORE_BASELINE
  ? Promise.resolve(process.env.FRONTEND_RACE_STORE_BASELINE)
  : readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const store = await read('frontend/src/data/store.jsx');
const hydration = store.split('const refreshFromSupabase = useCallback(async () => {')[1].split('\n  }, []);')[0];
const events = [];
const hydrationVersion = { current: 0 };
const isHydratingRef = { current: false };
let identity = 'old';
let oldDashboard = deferred();
const actions = { LOGOUT: 'logout', LOGIN: 'login', HYDRATE_DASHBOARD: 'hydrate', SET_AUTH_LOADING: 'loading' };
const refresh = new Function('supabase', 'dbService', 'dispatch', 'ACTIONS', 'isSupabaseConfigured', 'isCalupAdmin', 'hydrationVersion', 'isHydratingRef', `return async () => {${hydration}}`)(
  { auth: { getUser: async () => ({ data: { user: { id: identity } } }) } },
  { getDashboardData: uid => uid === 'old' ? oldDashboard.promise : Promise.resolve({ provider: { id: uid, name: uid } }) },
  action => events.push(action), actions, () => true, () => false, hydrationVersion, isHydratingRef,
);
const pendingOld = refresh();
await tick();
// Run the actual signed-out event body to invalidate the outstanding read.
const signOut = store.split("} else if (event === 'SIGNED_OUT') {")[1].split('\n      }')[0];
new Function('hydrationVersion', 'dispatch', 'ACTIONS', signOut)(hydrationVersion, action => events.push(action), actions);
oldDashboard.resolve({ provider: { id: 'old' } });
await pendingOld;
assert.deepEqual(events.map(action => action.type), ['logout'], 'Sign-out must survive late dashboard hydration');

// A newer identity must get its own refresh instead of losing the event behind an old request.
identity = 'old';
oldDashboard = deferred();
const previousIdentity = refresh();
await tick();
identity = 'new';
await refresh();
assert.equal(events.at(-1).payload.user.id, 'new');
oldDashboard.resolve({ provider: { id: 'old' } });
await previousIdentity;
assert.equal(events.at(-1).payload.user.id, 'new', 'Old identity must not overwrite the newer identity');

const page = await read('frontend/src/pages/booking/BookingPage.jsx');
const busyBody = page.split('  const fetchDateBusySlots = useCallback(async (date, provId, timezone, serviceId, includeCalendar) => {')[1].split('\n  }, []);')[0];
const busySlotVersion = { current: 0 };
const busyScope = { current: null };
const requests = new Map();
const calendarRequests = new Map();
let availability;
let selectedTime = '09:00';
let dbSlots;
let googleSlots;
const busyDependencies = {
  busySlotVersion, busyScope,
  setSelectedTime: value => { selectedTime = value; },
  setSlotAvailability: value => { availability = value; },
  setLiveDbBusySlots: value => { dbSlots = value; },
  setLiveGcalBusyTimes: value => { googleSlots = value; },
  dbService: { getBusySlots: (_provider, date, _excluded, serviceId, options) => {
    assert.equal(serviceId, 'service'); assert.equal(options.strict, true);
    const pending = deferred(); requests.set(date, pending); return pending.promise;
  } },
  realGoogleCalendarService: { getBusyTimes: date => { const pending = deferred(); calendarRequests.set(date, pending); return pending.promise; } },
};
const fetchBusy = new Function(...Object.keys(busyDependencies), `return async (date, provId, timezone, serviceId, includeCalendar) => {${busyBody}}`)(...Object.values(busyDependencies));
const oldDate = fetchBusy('2026-11-01', 'provider', 'Asia/Kolkata', 'service', true);
assert.equal(availability.status, 'loading');
assert.equal(selectedTime, null, 'Changing the resource/date clears its old selected slot');
const newDate = fetchBusy('2026-11-02', 'provider', 'Asia/Kolkata', 'service', true);
requests.get('2026-11-02').resolve([{ start_time: '12:00' }]);
calendarRequests.get('2026-11-02').resolve([{ start: '13:00' }]);
await newDate;
requests.get('2026-11-01').resolve([{ start_time: '09:00' }]);
calendarRequests.get('2026-11-01').resolve([{ start: '10:00' }]);
await oldDate;
assert.equal(availability.scope, 'provider:service:2026-11-02:Asia/Kolkata:true');
assert.deepEqual(dbSlots, [{ start_time: '12:00' }]);
assert.deepEqual(googleSlots, [{ start: '13:00' }]);
selectedTime = '14:00';
const poll = fetchBusy('2026-11-02', 'provider', 'Asia/Kolkata', 'service', true);
assert.equal(selectedTime, '14:00', 'A same-scope refresh preserves the selection while booking is gated');
assert.equal(availability.status, 'loading');
requests.get('2026-11-02').resolve([]);
calendarRequests.get('2026-11-02').resolve([]);
await poll;
assert.equal(availability.status, 'ready');
const failure = fetchBusy('2026-11-03', 'provider', 'Asia/Kolkata', 'service', true);
requests.get('2026-11-03').resolve([]);
calendarRequests.get('2026-11-03').resolve(null);
await failure;
assert.equal(availability.status, 'error', 'Malformed calendar data must never mean every slot is free');
const retry = fetchBusy('2026-11-03', 'provider', 'Asia/Kolkata', 'service', false);
requests.get('2026-11-03').resolve([]);
await retry;
assert.equal(availability.status, 'ready');
assert.deepEqual(googleSlots, [], 'Staff services do not inherit the owner calendar');
const networkFailure = fetchBusy('2026-11-04', 'provider', 'Asia/Kolkata', 'service', true);
requests.get('2026-11-04').reject(new Error('Fixture DB unavailable'));
calendarRequests.get('2026-11-04').resolve([]);
await networkFailure;
assert.equal(availability.status, 'error', 'A failed DB lookup cannot publish free slots');
const readyBody = page.split('  const slotAvailabilityReady = ')[1].split(';')[0];
const isReady = new Function('isDemo', 'slotAvailability', 'slotScope', `return ${readyBody};`);
assert.equal(isReady(false, availability, 'another-resource'), false);
assert.equal(isReady(false, { ...availability, status: 'loading' }, availability.scope), false);
assert.equal(isReady(false, { ...availability, status: 'error' }, availability.scope), false);
assert.equal(isReady(true, { status: 'error' }, 'demo'), true, 'Demo slot generation remains independent');
const confirmBody = page.split('  const handleConfirmBooking = async (e) => {')[1].split('    // Validate all fields')[0];
let fieldValidation = false;
await new Function('submittingBooking', 'slotAvailabilityReady', 'setBookingError', 'validateAllFields', `return async e => {${confirmBody}}`)(
  false, false, () => {}, () => { fieldValidation = true; },
)();
assert.equal(fieldValidation, false, 'Unready availability cannot enter booking submission');

const service = (await read('frontend/src/services/merchant/onboardingService.js')).replace(/^import .*;\r?\n/gm, '').replace('export const onboardingService', 'const onboardingService');
let deadline;
let aborted = false;
const client = new Function('supabase', 'getApiBase', 'fetch', 'setTimeout', 'clearTimeout', `${service}\nreturn onboardingService;`)(
  { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) } }, () => '/api',
  (_url, options) => { options.signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); },
  callback => { deadline = callback; return 1; }, () => {},
);
const load = client.load();
await tick();
deadline();
await assert.rejects(load, /timed out/);
assert.equal(aborted, true, 'Deadline must abort the HTTP request');

const app = await read('frontend/src/App.jsx');
const hookBody = app.split('function useDurableOnboardingStatus(userId, localCompleted) {')[1].split('\nfunction OnboardingUnavailable')[0];
let effect;
let status;
const hook = new Function('useState', 'useEffect', 'isSupabaseConfigured', 'onboardingService', `return function(userId, localCompleted) {${hookBody}`)(
  initial => [initial, value => { if (value && typeof value === 'object') status = value; }],
  callback => { effect = callback; }, () => true,
  { load: async () => { throw new Error('Fixture outage'); } },
);
hook('merchant', true);
const originalError = console.error;
try {
  console.error = () => {};
  effect();
  await tick();
  assert.equal(status.status, 'unavailable', 'A setup outage must not classify a completed merchant as incomplete');
} finally { console.error = originalError; }
console.log('PASS: frontend Auth hydration, date request ordering, setup deadline and outage regressions');
