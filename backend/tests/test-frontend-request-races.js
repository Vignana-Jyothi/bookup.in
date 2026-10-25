import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Execute the production callbacks with controlled Auth/DB/fetch promises; no network or DB.
const read = path => path === 'frontend/src/data/store.jsx' && process.env.FRONTEND_RACE_STORE_BASELINE
  ? Promise.resolve(process.env.FRONTEND_RACE_STORE_BASELINE)
  : readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
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
const busyBody = page.split('const fetchDatabaseBusySlots = useCallback(')[1].split('\n  }, []);')[0] + '\n  }';
const slots = [];
const busySlotVersion = { current: 1 };
const first = deferred();
const second = deferred();
const fetchBusy = new Function('dbService', 'busySlotVersion', 'setLiveDbBusySlots', `return ${busyBody}`)(
  { getBusySlots: (_provider, date) => date === '2026-11-01' ? first.promise : second.promise }, busySlotVersion, value => slots.push(value),
);
fetchBusy('2026-11-01', 'provider', 'service', 1);
busySlotVersion.current = 2;
fetchBusy('2026-11-02', 'provider', 'service', 2);
second.resolve([{ start_time: '12:00' }]);
await tick();
first.resolve([{ start_time: '09:00' }]);
await tick();
assert.deepEqual(slots, [[{ start_time: '12:00' }]], 'Old date busy intervals must not overwrite current date');

const calendarBody = page.split('const fetchDateBusySlots = useCallback(')[1].split('\n  }, [fetchDatabaseBusySlots]);')[0] + '\n  }';
const calendarFirst = deferred();
const calendarSecond = deferred();
const calendarSlots = [];
const fetchCalendar = new Function('realGoogleCalendarService', 'busySlotVersion', 'setLiveGcalBusyTimes', 'fetchDatabaseBusySlots', `return ${calendarBody}`)(
  { getBusyTimes: date => date === '2026-11-01' ? calendarFirst.promise : calendarSecond.promise },
  busySlotVersion, value => calendarSlots.push(value), () => {},
);
fetchCalendar('2026-11-01', 'provider', 'Asia/Kolkata', 'service', true, 2);
busySlotVersion.current = 3;
fetchCalendar('2026-11-02', 'provider', 'Asia/Kolkata', 'service', true, 3);
calendarSecond.resolve([{ start: '12:00' }]);
await tick();
calendarFirst.resolve([{ start: '09:00' }]);
await tick();
assert.deepEqual(calendarSlots, [[{ start: '12:00' }]], 'Old Google calendar intervals must not overwrite the current date');

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
