import assert from 'node:assert/strict';
import express from 'express';
import { config } from '../server/config.js';
import notifications from '../server/routes/internalNotifications.js';

const original = { fetch: globalThis.fetch, config: { ...config }, nodeEnv: process.env.NODE_ENV };
let databaseCalls = 0;
Object.assign(config, { supabaseUrl: 'https://notification-fixture.supabase.co', supabaseServiceRoleKey: 'fixture-key' });
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === '127.0.0.1') return original.fetch(input, options);
  assert.equal(url.origin, 'https://notification-fixture.supabase.co', 'No real external network');
  assert.equal(url.pathname, '/rest/v1/bookings');
  assert.equal(options.method || 'GET', 'GET', 'No production or fixture row mutations');
  databaseCalls++;
  return Response.json([]);
};
const app = express();
app.use(express.json());
app.use('/api/internal/notifications', notifications);
const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
const base = `http://127.0.0.1:${server.address().port}/api/internal/notifications`;
try {
  for (const environment of ['production', 'development']) {
    process.env.NODE_ENV = environment;
    for (const secret of ['', '   ']) {
      config.internalCronSecret = secret;
      for (const method of ['GET', 'POST']) assert.equal((await fetch(`${base}/process-reminders`, { method })).status, 503);
    }
  }
  config.internalCronSecret = 'fixture-cron-secret';
  for (const headers of [{}, { 'x-internal-secret': 'wrong' }, { authorization: 'Bearer wrong' }]) {
    assert.equal((await fetch(`${base}/process-reminders`, { method: 'POST', headers })).status, 401);
  }
  assert.equal(databaseCalls, 0, 'Missing or invalid secret must not reach storage');
  for (const headers of [{ 'x-internal-secret': 'fixture-cron-secret' }, { authorization: 'Bearer fixture-cron-secret' }]) {
    const response = await fetch(`${base}/process-reminders`, { method: 'POST', headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).totalCandidates, 0);
  }
  assert.equal(databaseCalls, 2);
  assert.equal((await fetch(`${base}/cleanup-duplicate-services`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'fixture-cron-secret' },
    body: JSON.stringify({ providerId: 'fixture-provider' }),
  })).status, 404, 'Destructive unused maintenance route must not exist');
  assert.equal(databaseCalls, 2);
  console.log('Internal notification HTTP authorization tests passed.');
} finally {
  await new Promise(resolve => server.close(resolve));
  globalThis.fetch = original.fetch;
  Object.assign(config, original.config);
  if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original.nodeEnv;
}
