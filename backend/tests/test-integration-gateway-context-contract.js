import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const sql = read('20261025_zz_integration_gateway_context.sql');
for (const [source, name] of [
  ['20261013_cashfree_v1.sql', 'get_cashfree_reconciliation_context_v1'],
  ['20261015_subscriptions_v1.sql', 'get_subscription_reconciliation_context_v1'],
  ['20261015_subscription_cancellation.sql', 'get_subscription_refund_context_v1'],
]) {
  const historical = read(source);
  const start = historical.indexOf(`create or replace function public.${name}(`);
  const original = historical.slice(start, historical.indexOf('$$;', start) + 3);
  const expected = original.replace('select jsonb_build_object(', "select jsonb_build_object('environment', po.environment, 'gatewayAccount', po.gateway_account,\n    'paymentPath', po.payment_path, 'purpose', po.purpose, ");
  const updatedStart = sql.indexOf(`create or replace function public.${name}(`);
  assert.equal(sql.slice(updatedStart, sql.indexOf('$$;', updatedStart) + 3), expected, 'Preserve original context with additive gateway metadata only');
  assert.ok(sql.includes(`revoke all on function public.${name}(uuid) from public, anon, authenticated;`));
}
assert.match(sql, /base := public\.get_release_readiness_v1\(\)/);
assert.match(sql, /'release','20261025-integration-audit','ready'/);
assert.match(sql, /has_function_privilege\('authenticated',context_oid,'EXECUTE'\)/);
assert.match(sql, /revoke all on function public\.get_integration_release_readiness_v1\(\) from public, anon, authenticated/);
assert.match(sql, /exception when others then/);
assert.match(sql, /public\.begin_cashfree_order_dispatch_v1\(uuid,text\)/);
assert.match(sql, /public\.get_booking_calendar_preflight_v1\(uuid,uuid,text,text\)/);
assert.match(sql, /public\.get_payment_notification_context_v1\(uuid,text,bigint,jsonb\)/);
console.log('Gateway evidence context and integration release source contracts passed.');
