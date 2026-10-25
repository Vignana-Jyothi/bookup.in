import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { businessDate, bookingTotals, dashboardForDate, monthlyBookingAnalytics, shiftDate } from '../../frontend/src/utils/dashboardData.js';

assert.equal(businessDate('2026-10-16T18:29:59Z', 'Asia/Kolkata'), '2026-10-16');
assert.equal(businessDate('2026-10-16T18:30:00Z', 'Asia/Kolkata'), '2026-10-17', 'India midnight must not wait for UTC midnight');
assert.equal(shiftDate('2024-02-28', 1), '2024-02-29');
assert.equal(shiftDate('2025-12-31', 1), '2026-01-01');

const rows = [
  { id: 'one', date: '2026-01-01', startTime: '12:00', status: 'confirmed', paymentStatus: 'confirmed', price: 500 },
  { id: 'two', date: '2026-01-01', startTime: '09:00', status: 'confirmed', paymentStatus: 'pending', price: 700 },
  { id: 'cancelled', date: '2026-01-01', startTime: '10:00', status: 'cancelled', paymentStatus: 'confirmed', price: 100 },
  { id: 'prior-week', date: '2025-12-25', status: 'completed', paymentStatus: 'confirmed', price: 900 },
  { id: 'next-day', date: '2026-01-02', startTime: '08:00', status: 'confirmed', paymentStatus: 'confirmed', price: 300 },
  { id: 'booking-unsaved', date: '2026-01-01', status: 'confirmed', paymentStatus: 'confirmed', price: 10000 },
];
const day = dashboardForDate(rows, '2026-01-01');
assert.equal(day.totalBookings, 2, 'Cancelled and unsaved rows cannot inflate appointments');
assert.equal(day.paidValue, 600, 'Only verified paid values are included, before refunds');
assert.deepEqual(day.schedule.map(row => row.id), ['two', 'one'], 'Only the selected date is shown, sorted by time');
assert.equal(day.weekStart, '2025-12-29');
assert.deepEqual(day.weeklyCounts, [0, 0, 0, 2, 1, 0, 0], 'Week counts must not include other weeks or fabricate empty days');
assert.equal(dashboardForDate(rows, '2026-01-02').totalBookings, 1);
assert.equal(dashboardForDate([], '2026-01-01').totalBookings, 0);
assert.deepEqual(dashboardForDate([], '2026-01-01').weeklyCounts, [0, 0, 0, 0, 0, 0, 0]);
assert.equal(bookingTotals([]).noShowRate, 0);
assert.equal(bookingTotals([{ id: 'p1', date: '2026-01-01', paymentStatus: 'paid', price: 0.1 }, { id: 'p2', date: '2026-01-01', paymentStatus: 'paid', price: 0.2 }]).paidValue, 0.3, 'Sum verified values in integer paise');
const monthly = monthlyBookingAnalytics(rows, '2026-01-01').monthlyData;
assert.equal(monthly.length, 6);
assert.deepEqual(monthly.map(row => row.appointments), [0, 0, 0, 0, 1, 3]);
assert.equal(monthly.at(-1).revenue, 900);
console.log('PASS: dashboard timezone boundaries, selected dates, real zero states, paid totals, and week/month ranges.');

// Execute the hook against controlled browser, React, and transport adapters.
const source = fs.readFileSync(new URL('../../frontend/src/hooks/useLiveAppointments.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]*\n/gm, '').replace('export function', 'function');
let cleanup;
let poll;
let requests = 0;
let failure = false;
let snapshot = rows;
let sync;
const dispatches = [];
const listeners = new Map();
const target = {
  addEventListener(name, callback) { listeners.set(name, callback); },
  removeEventListener(name) { listeners.delete(name); },
};
const document = { ...target, visibilityState: 'visible' };
const context = {
  useEffect(callback) { cleanup = callback(); },
  useState(initial) { sync = initial; return [sync, update => { sync = typeof update === 'function' ? update(sync) : update; }]; },
  useStore() { return { dispatch: action => dispatches.push(action) }; },
  ACTIONS: { SET_BOOKINGS: 'SET_BOOKINGS' },
  dbService: { async getBookings(providerId, { signal }) {
    assert.equal(providerId, 'merchant');
    assert.equal(signal.aborted, false);
    requests++;
    if (failure) throw new Error('Unavailable');
    return snapshot;
  } },
  document, window: target, AbortController, Date, JSON,
  setInterval(callback, milliseconds) { assert.equal(milliseconds, 5000); poll = callback; return 1; },
  clearInterval() { poll = null; }, setTimeout, clearTimeout,
};
vm.runInNewContext(source + '\nuseLiveAppointments("merchant");', context);
await new Promise(resolve => setImmediate(resolve));
assert.equal(requests, 1);
assert.equal(dispatches.length, 1);
assert.equal(sync.loading, false);
await poll();
assert.equal(dispatches.length, 1, 'An unchanged server snapshot does not dispatch again');
document.visibilityState = 'hidden';
await poll();
assert.equal(requests, 2, 'Hidden dashboards do not poll');
document.visibilityState = 'visible';
failure = true;
await poll();
assert(sync.error.includes('Live updates are unavailable'));
assert.equal(dispatches.length, 1, 'A failed read preserves loaded appointments');
failure = false;
snapshot = [...rows, { id: 'fresh', date: '2026-01-01', status: 'confirmed' }];
await listeners.get('focus')();
assert.equal(dispatches.length, 2, 'Focus refresh propagates a newly booked appointment');
assert.equal(sync.error, '');
cleanup();
assert.equal(poll, null);
assert.equal(listeners.size, 0, 'Unmount removes refresh listeners');
console.log('PASS: live dashboard polling, unchanged snapshots, visibility, failure retention, focus recovery, and cleanup.');
