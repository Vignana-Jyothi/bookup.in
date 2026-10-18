import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServiceAvailability, getAvailableTimeSlotsForDate } from '../../frontend/src/utils/helpers.js';

const merchant = {
  bufferTime: 15,
  minNotice: 0,
  maxAdvanceBooking: 30,
  schedule: {
    monday: { available: true, start: '09:00', end: '18:00' },
    tuesday: { available: true, start: '09:00', end: '18:00' },
  },
};
const service = { id: 'service-a', duration: 60, availableWeekdays: ['monday'], instructorId: 'instructor-a' };
const instructor = {
  id: 'instructor-a',
  bufferTime: 10,
  minNotice: 1,
  maxAdvanceBooking: 14,
  schedule: {
    monday: { available: true, start: '10:00', end: '15:00' },
    tuesday: { available: true, start: '10:00', end: '15:00' },
  },
};

const effective = buildServiceAvailability(merchant, service, instructor);
assert.deepEqual(effective.schedule.monday, { available: true, start: '10:00', end: '15:00' });
assert.equal(effective.schedule.tuesday.available, false, 'service weekday restriction must win');
assert.equal(effective.bufferTime, 10);
assert.equal(effective.maxAdvanceBooking, 14);
assert.deepEqual(
  getAvailableTimeSlotsForDate('2026-10-19', effective, [service], service.id),
  ['10:00', '11:10', '12:20', '13:30'],
);

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.resolve(here, '../supabase/20261014_multi_instructor_service_scheduling.sql'), 'utf8');
for (const fragment of [
  'create table if not exists public.instructors',
  'available_weekdays text[]',
  'slot_allocations_no_overlap_v1',
  'instructor_id with =',
  'get_service_busy_slots_v1',
  'guard_booking_attempt_resource_v1',
  'guard_legacy_booking_resource_v1',
  'is_generated_booking_slot_v1',
]) {
  assert(migration.toLowerCase().includes(fragment), `Multi-instructor migration is missing: ${fragment}`);
}

const route = fs.readFileSync(path.resolve(here, '../server/routes/merchantScheduling.js'), 'utf8');
assert(route.includes("router.put('/services/:id'"));
assert(route.includes("router.put('/instructors/:id/availability'"));
assert(route.includes('validateInstructorDays'));
assert(route.includes(".eq('active', true)"));
assert(!route.includes("router.post('/instructors', requireActiveEntitlement"), 'setup must not require an active subscription');
assert(route.includes("instructorQuery.eq('is_owner', true)"), 'service creation must default to the merchant instructor');

const defaultInstructorMigration = fs.readFileSync(path.resolve(here, '../supabase/20261015_default_merchant_instructor.sql'), 'utf8');
for (const fragment of [
  'providers_sync_owner_instructor_v1',
  'sync_provider_owner_instructor_v1',
  'services_assign_default_instructor_v1',
  'assign_default_service_instructor_v1',
]) {
  assert(defaultInstructorMigration.toLowerCase().includes(fragment), `Default-instructor migration is missing: ${fragment}`);
}

console.log('Multi-instructor scheduling tests passed.');
