import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTimeSlotsDetailed, getAvailableTimeSlotsForDate } from '../../frontend/src/utils/helpers.js';

const slots = generateTimeSlotsDetailed('09:00', '14:00', 60, 15, [], [], 0, '2026-10-21');
assert.deepEqual(slots.map(slot => slot.time), ['09:00', '10:15', '11:30', '12:45']);
assert(slots.every(slot => slot.available));

const availableViaDateHelper = getAvailableTimeSlotsForDate(
  '2026-10-21',
  {
    bufferTime: 15,
    schedule: { wednesday: { available: true, start: '09:00', end: '14:00' } },
  },
  [{ id: 'service-1', duration: 60 }],
  'service-1',
);
assert.deepEqual(availableViaDateHelper, ['09:00', '10:15', '11:30', '12:45']);

const withBooking = generateTimeSlotsDetailed(
  '09:00',
  '14:00',
  60,
  15,
  [{ startTime: '10:15', endTime: '11:15', status: 'confirmed' }],
  [],
  0,
  '2026-10-21',
);
assert.equal(withBooking.find(slot => slot.time === '10:15')?.reason, 'booked');
assert.equal(withBooking.find(slot => slot.time === '09:00')?.available, true);
assert.equal(withBooking.find(slot => slot.time === '11:30')?.available, true);

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.resolve(here, '../supabase/20261014_buffer_driven_slots.sql'), 'utf8');
for (const fragment of [
  'is_generated_booking_slot_v1',
  'v_step := v_duration + v_buffer',
  'mod(v_start_min - v_open_min, v_step) = 0',
  'booking_attempts_generated_slot_v1',
  'bookings_generated_slot_v1',
]) {
  assert(migration.includes(fragment), `Buffer slot migration is missing: ${fragment}`);
}

console.log('Buffer-driven slot tests passed.');
