import assert from 'node:assert/strict';

const original = { fetch: globalThis.fetch, url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY };
process.env.VITE_SUPABASE_URL = 'https://provider-read-fixture.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'fixture-public-key';
const { dbService } = await import('../../frontend/src/services/supabase/dbService.js');
let result = 'failure';
let writes = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.origin, 'https://provider-read-fixture.supabase.co');
  assert.equal(url.pathname, '/rest/v1/providers');
  if (options.method && options.method !== 'GET') writes++;
  assert.equal(url.searchParams.get('user_id'), 'eq.fixture-user');
  return result === 'failure'
    ? Response.json({ code: '42501', message: 'Private database details' }, { status: 403 })
    : Response.json(result === 'missing' ? null : { id: 'fixture-provider', user_id: 'fixture-user', name: 'Fixture provider' });
};
try {
  await assert.rejects(dbService.getProviderByUserId('fixture-user'), /Unable to load your merchant profile/);
  result = 'missing';
  assert.equal(await dbService.getProviderByUserId('fixture-user'), null, 'Only a successful empty read means no profile');
  result = 'found';
  assert.equal((await dbService.getProviderByUserId('fixture-user')).id, 'fixture-provider');
  assert.equal(writes, 0);
  console.log('PASS: provider read failure is distinct from missing profile and cannot silently trigger provisioning');
} finally {
  globalThis.fetch = original.fetch;
  for (const [name, value] of [['VITE_SUPABASE_URL', original.url], ['VITE_SUPABASE_PUBLISHABLE_KEY', original.key]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
