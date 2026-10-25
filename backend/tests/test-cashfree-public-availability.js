import assert from 'node:assert/strict';
import { mergeBusySlots } from '../server/services/busySlots.js';

const result = mergeBusySlots(
  [{ start_time: '09:30:00', end_time: '10:30:00', actual_end_time: null }],
  [
    { start_time: '10:00:00', end_time: '11:00:00', actual_end_time: null },
    { start_time: '09:30:00', end_time: '10:30:00', actual_end_time: null },
    { start_time: 'invalid', end_time: '12:00:00', customer_phone: '9999999999' },
  ],
);

assert.deepEqual(result, [
  { start_time: '09:30:00', end_time: '10:30:00', actual_end_time: null },
  { start_time: '10:00:00', end_time: '11:00:00', actual_end_time: null },
]);
assert(result.every(slot => Object.keys(slot).every(key => ['start_time', 'end_time', 'actual_end_time'].includes(key))));
assert(result.every(slot => slot.customer_phone === undefined));

console.log('Cashfree public availability tests passed.');
