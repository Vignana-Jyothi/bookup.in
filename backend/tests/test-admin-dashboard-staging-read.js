// Optional read-only staging acceptance. Never creates users, bookings or payments.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { serviceRoleClient } from '../server/middleware/auth.js';
import { config } from '../server/config.js';

const forbidden = /^(payment_session_id|attempt_token_hash|management_token_hash|management_token_encrypted|code_hash|token_hash|provider_ciphertext|encrypted_access_token|encrypted_refresh_token|billing_snapshot|safe_metadata|session_id)$/i;
function safeKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.test(key),false,`Sensitive field ${key}`); safeKeys(child); }
}
let firstPage;
for (const section of ['overview','merchants','bookings','refunds','support','subscriptions','integrations','audit']) {
  const {data,error}=await serviceRoleClient.rpc('read_calup_admin_dashboard_v1',{p_section:section,p_period:'all'});
  assert.equal(error,null,`Staging read failed for ${section}`);
  assert.ok(Array.isArray(data.records));
  assert.ok(data.records.length<=50);
  assert.ok(data.total>=data.records.length);
  safeKeys(data);
  if (section==='merchants') firstPage=data;
}
const second=await serviceRoleClient.rpc('read_calup_admin_dashboard_v1',{p_section:'merchants',p_period:'all',p_offset:50});
assert.equal(second.error,null);
const ids=new Set(firstPage.records.map(record=>record.id));
assert.equal(second.data.records.some(record=>ids.has(record.id)),false,'Pagination overlaps');
const anon=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const denied=await anon.rpc('read_calup_admin_dashboard_v1',{p_section:'merchants'});
assert.equal(denied.error?.code,'42501','Public client must not execute staff projection');
const deniedView=await anon.from('calup_admin_records_v1').select('id').limit(1);
assert.equal(deniedView.error?.code,'42501','Public client must not read staff view');
console.log('PASS: All eight staging projections, pagination, safe fields and public permission denial. No external writes.');
