import assert from 'node:assert/strict';
import express from 'express';
import { createAdminDashboardRouter, adminSections, adminIntegrationReadiness } from '../server/routes/adminDashboard.js';
import { loadAdminDashboard } from '../../frontend/src/services/supabase/adminDashboard.js';
import { openApiDocument } from '../server/openapi.js';

process.env.DISABLE_RATE_LIMIT = 'true';
const calls = [];
let failure = null;
const client = { async rpc(name, args) {
  calls.push({ name, args });
  return { error: failure, data: { records: [], total: args.p_period === 'all' ? 2 : 0, metrics: { verifiedBookings: args.p_period === 'all' ? 12 : 3 }, asOf: '2026-10-16T00:00:00Z' } };
} };
const app = express();
app.use('/guarded', createAdminDashboardRouter({ client }));
app.use('/dashboard', createAdminDashboardRouter({ client, authorize: (_req,_res,next) => next(), readiness: () => [] }));
const server = app.listen(0,'127.0.0.1');
await new Promise(resolve => server.once('listening',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  assert.equal((await fetch(`${base}/guarded/overview`)).status,401,'Production middleware rejects unauthenticated reads');
  assert.equal(calls.length,0);
  for (const section of adminSections) {
    const response = await fetch(`${base}/dashboard/${section}?period=all&offset=50&search=Studio`);
    assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal(calls.at(-1).name,'read_calup_admin_dashboard_v1');
    assert.equal(calls.at(-1).args.p_section,section);
    assert.equal(calls.at(-1).args.p_offset,50);
  }
  for (const section of adminSections) {
    const response = await fetch(`${base}/dashboard/${section}`);
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).args.p_period, 'all', 'Unfiltered workspaces include historical records');
    assert.equal((await response.json()).total, 2);
  }
  let response = await fetch(`${base}/dashboard/overview?period=today`);
  const snapshot = await response.json();
  assert.equal(snapshot.total,2,'Old unresolved work stays in the overview backlog');
  assert.equal(snapshot.metrics.verifiedBookings,3,'Metrics still honor the selected period');
  for (const query of ['offset=-1','offset=100001','providerId=attacker','period=bad','filter=bad','search=x&search=y']) {
    assert.equal((await fetch(`${base}/dashboard/merchants?${query}`)).status,422);
  }
  assert.equal((await fetch(`${base}/dashboard/not-a-section`)).status,404);
  failure={ message:'private SQL details' };
  response=await fetch(`${base}/dashboard/refunds`);
  assert.equal(response.status,503);
  assert.doesNotMatch(await response.text(),/private SQL/);
  assert.equal((await fetch(`${base}/dashboard/refunds`,{ method:'POST' })).status,404,'No financial mutations are exposed');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
for (const readiness of adminIntegrationReadiness()) {
  assert.deepEqual(Object.keys(readiness).sort(),['configured','name','note','short']);
  assert.equal(typeof readiness.configured,'boolean');
}
const clientAuth={auth:{getSession:async()=>({data:{session:{access_token:'test-only'}}})}};
const result=await loadAdminDashboard({section:'refunds',period:'all',search:'RF test',filter:'all',offset:0}, {
  client:clientAuth,request:async(url,options)=>{
    assert.match(url,/\/admin\/dashboard\/refunds\?/);
    assert.match(url,/search=RF\+test/);
    assert.equal(options.headers.Authorization,'Bearer test-only');
    assert.equal(options.credentials,'include');
    assert.equal(options.cache,'no-store');
    return {ok:true,json:async()=>({records:[]})};
  },
});
assert.deepEqual(result.records,[]);
assert.ok(openApiDocument.paths['/api/v1/admin/dashboard/{section}']);
console.log('PASS: Protected admin reads, eight sections, backlog/date semantics, strict filters, pagination, privacy and credentialed frontend requests.');
