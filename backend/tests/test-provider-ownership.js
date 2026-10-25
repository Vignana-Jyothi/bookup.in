import assert from 'node:assert/strict';

// Configure before loading auth.js so every client uses fixture-only networking.
process.env.SUPABASE_URL = 'https://ownership-fixture.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-key';
process.env.SUPABASE_ANON_KEY = 'fixture-anon-key';
const { requireProviderAuth } = await import('../server/middleware/auth.js');
const originalFetch = globalThis.fetch;
let existingOwner;
let failProvision;
let failLookup;
let writes;
let emailLookups;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.origin, 'https://ownership-fixture.supabase.co', 'No external network access');
  if (url.pathname === '/auth/v1/user') return Response.json({ id: 'caller-user', email: 'contact@example.invalid' });
  assert.equal(url.pathname, '/rest/v1/providers');
  const method = options.method || 'GET';
  if (method === 'GET') {
    if (failLookup) return Response.json({ code: '42501', message: 'Fixture lookup denied' }, { status: 403 });
    if (url.searchParams.has('email')) {
      emailLookups++;
      return Response.json({ id: 'victim-provider', user_id: 'victim-user', email: 'contact@example.invalid' });
    }
    return Response.json(existingOwner ? { id: 'owned-provider', user_id: 'caller-user' } : null);
  }
  const body = JSON.parse(options.body);
  writes.push({ method, body });
  if (failProvision) return Response.json({ code: '42501', message: 'Fixture insert denied' }, { status: 403 });
  return Response.json({ ...body, id: 'new-provider' });
};

async function authorize({ owned = false, denied = false, lookupDenied = false } = {}) {
  existingOwner = owned; failProvision = denied; failLookup = lookupDenied; writes = []; emailLookups = 0;
  let nextCalled = false;
  const req = { headers: { authorization: 'Bearer fixture-token' } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await requireProviderAuth(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

try {
  const owner = await authorize({ owned: true });
  assert.equal(owner.nextCalled, true);
  assert.equal(owner.req.providerId, 'owned-provider');
  assert.equal(writes.length, 0);
  const collision = await authorize();
  assert.equal(collision.nextCalled, true);
  assert.equal(collision.req.providerId, 'new-provider');
  assert.equal(emailLookups, 0, 'Editable contact email must never resolve ownership');
  assert.ok(writes.every(write => write.method === 'POST' && write.body.user_id === 'caller-user'), 'Never reassign another provider');
  const failed = await authorize({ denied: true });
  assert.equal(failed.nextCalled, false, 'Failed persistence must never authorize an in-memory owner');
  assert.equal(failed.req.providerId, undefined);
  assert.equal(failed.res.statusCode, 403);
  const unreadable = await authorize({ lookupDenied: true });
  assert.equal(unreadable.res.statusCode, 503);
  assert.equal(unreadable.nextCalled, false);
  assert.equal(writes.length, 0, 'A failed profile read must never imply a missing account');
  console.log('Provider ownership fixture tests passed.');
} finally {
  globalThis.fetch = originalFetch;
}
