import assert from 'node:assert/strict';
import path from 'node:path';
import { verifyAuditDatabase, auditMigrations, auditAssertions } from '../scripts/verify-audit-database.mjs';
let calls = [];
const connection = 'postgresql://fixture:do-not-log@localhost/disposable';
const env = { CALUP_AUDIT_DISPOSABLE_DB: 'true', AUDIT_DATABASE_URL: connection };
const invoke = async (command, args, options) => {
  calls.push({ command, args, options });
  assert.equal(command, 'psql');
  assert.equal(options.env.PGDATABASE, connection);
  assert.equal(options.env.AUDIT_DATABASE_URL, undefined);
  assert.match(options.env.PGOPTIONS, /lock_timeout=5000/);
  assert.match(options.env.PGOPTIONS, /statement_timeout=15000/);
  assert(!JSON.stringify(args).includes(connection), 'Credentials must not appear in process arguments');
  if (options.input) return options.input.includes('audit-race-b-') || options.input.includes('with changed') || options.input.includes("and start_time='13:00'") ? '__CALUP_RESULT__false\n' : '__CALUP_RESULT__true\n';
  return '';
};
for (const invalid of [{}, { AUDIT_DATABASE_URL: connection }, { CALUP_AUDIT_DISPOSABLE_DB: 'true' }, { ...env, CALUP_AUDIT_DISPOSABLE_DB: 'TRUE' }]) {
  await assert.rejects(verifyAuditDatabase({ env: invalid, args: [], run: invoke, log: () => {} }));
}
assert.equal(calls.length, 0, 'Missing opt-in or URL must never spawn a process');
await assert.rejects(verifyAuditDatabase({ env, args: ['--unknown'], run: invoke }));
assert.equal(calls.length, 0);
await assert.rejects(verifyAuditDatabase({ env, args: [], run: async () => {
  throw new Error(`Connection refused: ${connection}`);
}, log: () => {} }), error => error.message.includes('audit-database-prerequisites.sql') && !error.message.includes(connection));
let logs = [];
await verifyAuditDatabase({ env, args: ['--apply-audit'], run: invoke, log: value => logs.push(value) });
const files = calls.filter(call => call.args.includes('--file')).map(call => path.basename(call.args.at(-1)));
assert.deepEqual(files.slice(1, 6), auditMigrations, 'Apply only audit migrations with readiness last');
assert.deepEqual(files.slice(6, 6 + auditAssertions.length), auditAssertions);
assert.equal(files.at(-1), 'audit-database-cleanup.sql');
assert.equal(calls.filter(call => call.options.input).length, 6, 'Run all three real two-connection race pairs');
assert(!logs.join('').includes(connection));
calls = [];
await verifyAuditDatabase({ env, args: [], run: invoke, log: () => {} });
assert(!calls.some(call => call.args.some(arg => /20261025_.*\.sql$/.test(arg))), 'No migrations without --apply-audit');
calls = [];
await assert.rejects(verifyAuditDatabase({ env, args: [], run: async (...args) => {
  if (args[2].input) throw new Error('Fixture SQL failure');
  return invoke(...args);
}, log: () => {} }));
assert.equal(path.basename(calls.at(-1).args.at(-1)), 'audit-database-cleanup.sql', 'Cleanup runs after race failure');
let raceCalls = 0; let pendingSettled = false;
await assert.rejects(verifyAuditDatabase({ env, args: [], log: () => {}, run: async (command, args, options) => {
  if (options.input) {
    raceCalls++;
    if (raceCalls === 1) throw new Error('Fixture first connection failed');
    await new Promise(resolve => setTimeout(resolve, 2));
    pendingSettled = true;
    return '__CALUP_RESULT__false\n';
  }
  if (args.some(arg => arg.endsWith('audit-database-cleanup.sql'))) assert(pendingSettled, 'Cleanup must wait for both racing sessions');
  return invoke(command, args, options);
} }));
console.log('Disposable database runner safety, ordering, race orchestration and cleanup tests passed (no subprocess/database).');
