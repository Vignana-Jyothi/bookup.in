import { spawn } from 'node:child_process';
import { randomUUID, randomInt } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const auditMigrations = [
  '20261025_booking_table_access.sql', '20261025_legacy_booking_rpc_access.sql',
  '20261025_pending_booking_overlap.sql', '20261025_subscription_refund_terminal.sql',
  '20261025_release_readiness.sql', '20261025_zz_integration_gateway_context.sql',
  '20261025_zza_booking_calendar_preflight.sql', '20261025_zzb_cashfree_dispatch.sql',
  '20261025_zzz_payment_notifications.sql',
  '20261025171102_deployment_permission_hardening.sql',
];
export const auditAssertions = [
  'deployment-permission-invariants.sql',
  'legacy-booking-rpc-access-invariants.sql', 'booking-table-access-invariants.sql',
  'pending-booking-overlap-invariants.sql', 'pending-booking-expiry-scenarios.sql',
  'subscription-refund-terminal-invariants.sql', 'release-readiness-invariants.sql',
  'booking-calendar-preflight-invariants.sql', 'cashfree-dispatch-invariants.sql', 'payment-notification-invariants.sql', 'integration-gateway-context-invariants.sql',
];

function execute(command, args, { env, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    // Do not echo psql diagnostics: connection errors can disclose configuration.
    child.stderr.on('data', () => {});
    const deadline = setTimeout(() => child.kill(), 30_000);
    deadline.unref?.();
    child.on('error', () => reject(new Error('psql could not start. Install the PostgreSQL client.')));
    child.on('close', code => {
      clearTimeout(deadline);
      if (code === 0) resolve(stdout);
      else reject(new Error('Disposable database SQL check failed.'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function verifyAuditDatabase({ env = process.env, args = process.argv.slice(2), run = execute, log = console.log } = {}) {
  // Validate before any subprocess, file application or SQL connection.
  if (env.CALUP_AUDIT_DISPOSABLE_DB !== 'true') throw new Error('Set CALUP_AUDIT_DISPOSABLE_DB=true only for an empty disposable test environment.');
  if (!env.AUDIT_DATABASE_URL || !/^postgres(?:ql)?:\/\//i.test(env.AUDIT_DATABASE_URL)) throw new Error('AUDIT_DATABASE_URL must identify the disposable PostgreSQL database.');
  if (args.some(arg => arg !== '--apply-audit')) throw new Error('Only --apply-audit is supported.');
  const childEnv = { ...env, PGDATABASE: env.AUDIT_DATABASE_URL,
    PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=5000', PGCONNECT_TIMEOUT: '5' };
  delete childEnv.AUDIT_DATABASE_URL;
  const fixture = Object.fromEntries(['user_a', 'user_b', 'provider_a', 'provider_b', 'instructor_a', 'instructor_b', 'service_a', 'service_b'].map(name => [name, randomUUID()]));
  fixture.booking_date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  fixture.phone_a = `9${String(randomInt(100_000_000)).padStart(8, '0')}0`;
  fixture.phone_b = `8${String(randomInt(100_000_000)).padStart(8, '0')}0`;
  fixture.phone_expired = `7${String(randomInt(100_000_000)).padStart(8, '0')}0`;
  const variables = Object.entries(fixture).flatMap(([name, value]) => ['--set', `${name}=${value}`]);
  const baseArgs = ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1'];
  const file = async (relative, withFixture = false) => {
    try {
      return await run('psql', [...baseArgs, ...(withFixture ? variables : []), '--file', path.join(root, relative)], { env: childEnv });
    } catch {
      throw new Error(`Disposable database check failed: ${path.basename(relative)}. Check PostgreSQL client installation and disposable schema prerequisites.`);
    }
  };
  const sql = input => run('psql', [...baseArgs, ...variables], { env: childEnv, input });
  const markers = output => String(output).split(/\r?\n/).filter(line => line.startsWith('__CALUP_RESULT__')).map(line => line.slice('__CALUP_RESULT__'.length));
  const assertRace = outputs => {
    const results = outputs.flatMap(markers).sort();
    if (JSON.stringify(results) !== JSON.stringify(['false', 'true'])) throw new Error('Competing database reservations violated the one-winner contract.');
  };
  const race = async (phase, operations) => {
    const results = await Promise.allSettled(operations);
    if (results.some(result => result.status === 'rejected')) throw new Error(`Disposable database ${phase} race failed; both connections have settled.`);
    try { assertRace(results.map(result => result.value)); }
    catch { throw new Error(`Disposable database ${phase} race violated the one-winner contract.`); }
  };
  await file('backend/tests/audit-database-prerequisites.sql');
  if (args.includes('--apply-audit')) {
    for (const migration of auditMigrations) await file(`backend/supabase/${migration}`);
  }
  for (const assertion of auditAssertions) await file(`backend/tests/${assertion}`);
  let seeded = false; let originalFailure;
  try {
    // Seed commits only isolated synthetic identities so both connections see them.
    seeded = true;
    await file('backend/tests/audit-database-seed.sql', true);
    await file('backend/tests/audit-database-tenant-rls.sql', true);
    const allocate = (time, label, phoneSuffix) => `begin;
select '__CALUP_RESULT__' || (public.create_booking_atomic(:'provider_a'::uuid,:'service_a'::uuid,
'audit-${label}-' || :'provider_a','',left(:'phone_a',9) || '${phoneSuffix}',:'phone_a',
:'booking_date'::date,'${time}')->>'success');
select pg_sleep(0.2);
commit;`;
    await race('same-slot', [sql(allocate('11:00', 'race-a', '1')), sql(allocate('11:00', 'race-b', '2'))]);
    const staleMark = `begin;
with changed as (update public.bookings set payment_status='verification_pending'
where provider_id=:'provider_a'::uuid and customer_name='audit-expired-' || :'provider_a'
and status='pending_payment' and payment_status='awaiting_payment' returning id)
select '__CALUP_RESULT__' || ((select count(*) from changed)=1)::text;
commit;`;
    await race('expiry', [sql(allocate('13:00', 'replacement', '3')), sql(staleMark)]);
    const reschedule = sourceTime => `begin;
select '__CALUP_RESULT__' || (public.reschedule_booking_atomic(
(select id from public.bookings where provider_id=:'provider_a'::uuid
and booking_date=:'booking_date'::date and start_time='${sourceTime}'
and status in ('pending','pending_payment','confirmed') and payment_status<>'rejected' limit 1),
:'booking_date'::date,'15:00')->>'success');
select pg_sleep(0.2);
commit;`;
    await race('reschedule', [sql(reschedule('11:00')), sql(reschedule('13:00'))]);
    await file('backend/tests/audit-database-race-results.sql', true);
  } catch (error) {
    originalFailure = error;
  } finally {
    if (seeded) {
      try { await file('backend/tests/audit-database-cleanup.sql', true); }
      catch {
        originalFailure = new Error(originalFailure
          ? 'Audit checks failed and fixture cleanup also failed. Discard the disposable database.'
          : 'Fixture cleanup failed. Discard the disposable database.');
      }
    }
  }
  if (originalFailure) throw originalFailure;
  log('PASS: disposable database grants, SQL scenarios, two-tenant RLS and two-connection booking/expiry/reschedule races.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyAuditDatabase().catch(error => { console.error(error.message); process.exitCode = 1; });
}
