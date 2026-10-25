import assert from 'node:assert/strict';
import { bookingStartMillis } from '../server/utils/bookingTime.js';
import { calculateCancellationRefund } from '../server/services/policyEngine.js';
import { calculateCancellationRefund as previewRefund, getHoursUntilSession } from '../../frontend/src/utils/policyEngine.js';
import { bookingStartMillis as previewStart } from '../../frontend/src/utils/bookingTime.js';
for (const start_time of ['09:00', '09:00:00', '09:00:00.000000']) {
  const booking = { booking_date: '2030-01-02', start_time, price: 1000 };
  assert.equal(bookingStartMillis(booking, 'Asia/Kolkata'), Date.parse('2030-01-02T03:30:00Z'));
  assert.equal(bookingStartMillis(booking, 'UTC'), Date.parse('2030-01-02T09:00:00Z'));
  for (const [instant, percent, amount] of [
    ['2030-01-01T03:29:59Z', 100, 1000], ['2030-01-01T03:30:00Z', 100, 1000],
    ['2030-01-01T03:30:01Z', 50, 500], ['2030-01-02T01:30:00Z', 50, 500],
    ['2030-01-02T01:30:01Z', 0, 0],
  ]) {
    const result = calculateCancellationRefund({ booking, currentTime: new Date(instant), timezone: 'Asia/Kolkata' });
    assert.equal(result.refundPercent, percent, `${start_time} at ${instant}`);
    assert.equal(result.refundAmount, amount);
    assert.deepEqual(previewRefund({ booking, currentTime: new Date(instant), timezone: 'Asia/Kolkata' }), result, 'Browser preview matches authoritative policy');
    assert.equal(previewStart(booking, 'Asia/Kolkata'), bookingStartMillis(booking, 'Asia/Kolkata'));
  }
}
assert.equal(bookingStartMillis({ booking_date: '2030-07-02', start_time: '09:00' }, 'America/New_York'), Date.parse('2030-07-02T13:00:00Z'));
assert.ok(Number.isNaN(bookingStartMillis({ booking_date: '2030-02-30', start_time: '09:00' })));
assert.ok(Number.isNaN(bookingStartMillis({ booking_date: '2030-01-02', start_time: '99:00' })));
assert.ok(Number.isNaN(bookingStartMillis({ booking_date: '2030-01-02', start_time: '09:00' }, 'Invalid/Timezone')));
console.log('PASS: booking time interprets PostgreSQL times in provider timezone and enforces exact cancellation cutoffs.');

const originalNow = Date.now;
try {
  Date.now = () => Date.parse('2030-01-01T03:30:00Z');
  assert.equal(getHoursUntilSession('2030-01-02', '09:00:00', 'Asia/Kolkata'), 24);
} finally { Date.now = originalNow; }
