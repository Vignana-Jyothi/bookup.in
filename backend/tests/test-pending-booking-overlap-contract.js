import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const original = read('20261014_multi_instructor_service_scheduling.sql');
const migration = read('20261025_pending_booking_overlap.sql');
const originalCreate = original.slice(original.indexOf('create or replace function public.create_booking_atomic('));
const expected = originalCreate
  .replace("and booking_date = p_booking_date and status in ('confirmed', 'completed')", "and booking_date = p_booking_date\n    and status in ('pending', 'pending_payment', 'confirmed', 'completed')")
  .replace('  perform id from public.bookings', '  perform public.expire_legacy_booking_holds_v1(p_provider_id, v_service.instructor_id, p_booking_date);\n\n  perform id from public.bookings')
  .replace('deposit_status, status, notes, management_token_hash, meeting_type,', 'deposit_status, status, payment_status, notes, management_token_hash, meeting_type,')
  .replace("case when coalesce(v_service.deposit_amount, 0) > 0 then 'paid' else 'na' end,\n    'confirmed', p_notes", "case when coalesce(v_service.deposit_amount, 0) > 0 then 'pending' else 'na' end,\n    case when coalesce(v_service.price, 0) > 0 then 'pending_payment' else 'confirmed' end,\n    case when coalesce(v_service.price, 0) > 0 then 'awaiting_payment' else 'not_required' end, p_notes");
const actual = migration.slice(migration.indexOf('create or replace function public.create_booking_atomic('), migration.indexOf('\n-- Cashfree holds'));
assert.equal(actual.trim(), expected.trim(), 'Preserve complete latest create implementation except reviewed reservation/payment changes');
const helper = migration.slice(0, migration.indexOf('create or replace function public.create_booking_atomic('));
assert.match(helper, /pg_advisory_xact_lock/);
assert.match(helper, /status = 'cancelled', payment_status = 'rejected'/);
assert.match(helper, /status in \('pending', 'pending_payment'\)/);
assert.match(helper, /payment_status = 'awaiting_payment'/);
assert.match(helper, /created_at <= clock_timestamp\(\) - interval '30 minutes'/);
assert.match(helper, /provider_id = p_provider_id and instructor_id = p_instructor_id/);
const guard = migration.slice(migration.indexOf('create or replace function public.guard_booking_attempt_resource_v1()'), migration.indexOf('-- Keep rescheduling'));
assert.match(guard, /b\.status in \('pending', 'pending_payment', 'confirmed', 'completed'\)/);
assert.match(guard, /expire_legacy_booking_holds_v1\(new.provider_id, new.instructor_id, new.booking_date\)/);
assert.doesNotMatch(guard, /and not \(/, 'Expired holds must transition persistently before slot reuse');
const reschedule = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.reschedule_booking_atomic('));
const providerLock = reschedule.indexOf('FROM public.providers WHERE id = v_provider_id FOR UPDATE');
const expiry = reschedule.indexOf('PERFORM public.expire_legacy_booking_holds_v1');
const rowLock = reschedule.indexOf('FROM public.bookings WHERE id = p_booking_id FOR UPDATE');
assert(providerLock > 0 && providerLock < expiry && expiry < rowLock, 'Provider/resource/booking lock ordering must match creation');
assert.match(reschedule, /SET search_path = pg_catalog, public/);
assert.match(reschedule, /v_booking\.instructor_id IS DISTINCT FROM v_instructor_id/);
console.log('Pending booking overlap/expiry/lock-order migration contract passed (no database accessed).');
