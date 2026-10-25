import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/20261025_legacy_booking_rpc_access.sql', import.meta.url), 'utf8');
assert.match(migration, /p\.proname in \('create_booking_atomic', 'reschedule_booking_atomic'\)/);
assert.match(migration, /p\.oid::regprocedure as signature/);
assert.match(migration, /n\.nspname = 'public'/);
assert.match(migration, /revoke all on function %s from public, anon, authenticated/);
assert.match(migration, /grant execute on function %s to service_role/);
assert.doesNotMatch(migration, /get_provider_busy_slots/, 'Public read-only availability remains public');
console.log('Legacy booking RPC access migration contract passed (no database accessed).');
