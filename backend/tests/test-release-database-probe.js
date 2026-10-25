import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readReleaseSettings, verifyReleaseDatabase, RELEASE_SCHEMA } from '../scripts/verify-release-database.mjs';

const settings = readReleaseSettings('UNRELATED_SECRET=must-not-be-used\r\nSUPABASE_URL=https://fixture.supabase.co\r\nSUPABASE_SERVICE_ROLE_KEY=fixture-private-key=literal\r\n');
assert.deepEqual(settings, { supabaseUrl: 'https://fixture.supabase.co', supabaseServiceRoleKey: 'fixture-private-key=literal' });
let calls = 0;
await verifyReleaseDatabase(settings, { fetchImpl: async (url, options) => {
  calls++;
  assert.equal(url, 'https://fixture.supabase.co/rest/v1/rpc/get_release_readiness_v1');
  assert.equal(options.headers.Authorization, 'Bearer fixture-private-key=literal');
  assert.equal(options.redirect, 'error');
  assert.equal(options.body, '{}');
  return Response.json({ ready: true, release: RELEASE_SCHEMA });
} });
assert.equal(calls, 1);
for (const body of [{ ready: false, release: RELEASE_SCHEMA }, { ready: true, release: 'old' }, {}, null]) {
  await assert.rejects(verifyReleaseDatabase(settings, { fetchImpl: async () => Response.json(body) }), /Database release check failed/);
}
for (const status of [401, 403, 404, 500]) {
  await assert.rejects(verifyReleaseDatabase(settings, { fetchImpl: async () => Response.json({ error: 'untrusted-private-details' }, { status }) }), error => !error.message.includes('untrusted') && /Database release check failed/.test(error.message));
}
await assert.rejects(verifyReleaseDatabase(settings, { timeoutMs: 10, fetchImpl: () => new Promise(() => {}) }), /Database release check failed/);
await assert.rejects(verifyReleaseDatabase(settings, { timeoutMs: 10, fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) }), /Database release check failed/);
let invalidCalls = 0;
await assert.rejects(verifyReleaseDatabase({ ...settings, supabaseUrl: 'https://user:secret@fixture.supabase.co' }, { fetchImpl: async () => { invalidCalls++; } }));
assert.equal(invalidCalls, 0);
const deploy = await readFile('backend/scripts/college-deploy.sh', 'utf8');
assert(deploy.indexOf('verify-release-database.mjs') >= 0);
assert(deploy.indexOf('verify-release-database.mjs') < deploy.indexOf('docker compose -f docker-compose.yml build'), 'Readiness must fail before image build/deployment');
console.log('PASS: deployment requires installed database release marker, rejects errors/stale schemas and bounds headers/body without logging credentials');
