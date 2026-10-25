import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.TOKEN_STORE_MEMORY_ONLY = 'true';
const { config } = await import('../server/config.js');
Object.assign(config, { supabaseUrl: 'https://calendar-fixture.invalid', supabaseServiceRoleKey: 'fixture-key' });
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-key';
let googleReply = () => Response.json({ calendars: { primary: { busy: [] } } });
let stored = null;
const requests = [];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'calendar-fixture.invalid') {
    if (url.pathname.endsWith('/providers')) return Response.json({ email: 'host@example.com' });
    const method = options.method || 'GET';
    const version = url.searchParams.get('encrypted_access_token')?.slice(3);
    if (method === 'GET') return Response.json(stored);
    if (method === 'POST') { stored = JSON.parse(options.body); return new Response(null, { status: 201 }); }
    const matches = stored && (!version || stored.encrypted_access_token === version);
    if (method === 'PATCH' && matches) stored = { ...stored, ...JSON.parse(options.body) };
    if (method === 'DELETE' && matches) stored = null;
    return Response.json(matches ? (method === 'PATCH' ? { provider_id: 'host' } : [{ provider_id: 'host' }]) : (method === 'PATCH' ? null : []));
  }
  requests.push({ url, body: options.body && JSON.parse(options.body instanceof URLSearchParams ? '{}' : options.body) });
  return googleReply(url, options);
};
const { tokenStore } = await import('../server/services/tokenStore.js');
const { googleCalendarService: calendar, REQUIRED_GOOGLE_SCOPES } = await import('../server/services/googleCalendar.js');
const credentials = accessToken => ({ email: 'host@example.com', accessToken, refreshToken: 'refresh', expiresAt: Date.now() + 3600000, scope: REQUIRED_GOOGLE_SCOPES.join(' ') });
for (const memory of [true, false]) {
  process.env.TOKEN_STORE_MEMORY_ONLY = String(memory);
  await tokenStore.saveTokens('host', credentials('old'));
  const old = await tokenStore.getDecryptedTokens('host');
  await tokenStore.saveTokens('host', credentials('new'));
  assert.equal(await tokenStore.updateAccessToken('host', 'stale', Date.now(), old.credentialVersion), false);
  assert.equal(await tokenStore.deleteTokens('host', old.credentialVersion), false);
  assert.equal((await tokenStore.getDecryptedTokens('host')).accessToken, 'new');
  await tokenStore.saveTokens('host', { ...credentials('same-account-new-access'), email: ' HOST@EXAMPLE.COM ', refreshToken: undefined });
  assert.equal((await tokenStore.getDecryptedTokens('host')).refreshToken, 'refresh', 'Same normalized account preserves its refresh token');
  const beforeAccountChange = await tokenStore.getDecryptedTokens('host');
  await assert.rejects(tokenStore.saveTokens('host', { ...credentials('other-account-access'), email: 'other@example.com', refreshToken: undefined }), /new refresh token/);
  assert.deepEqual(await tokenStore.getDecryptedTokens('host'), beforeAccountChange, 'Rejected account change leaves access/refresh/email/version unchanged');
  await tokenStore.saveTokens('host', { ...credentials('other-account-access'), email: 'other@example.com', refreshToken: 'other-account-refresh' });
  const changed = await tokenStore.getDecryptedTokens('host');
  assert.equal(changed.email, 'other@example.com');
  assert.equal(changed.accessToken, 'other-account-access');
  assert.equal(changed.refreshToken, 'other-account-refresh');
  if (!memory) {
    stored = null;
    assert.equal((await tokenStore.getStatus('host')).isConnected, false, 'Other process disconnect bypasses local cache');
  }
}
process.env.TOKEN_STORE_MEMORY_ONLY = 'true';
for (const invalid of [false, true]) {
  await tokenStore.saveTokens('host', { ...credentials('old'), expiresAt: 1 });
  let respond;
  const entered = new Promise(resolve => {
    googleReply = () => { resolve(); return new Promise(done => { respond = done; }); };
  });
  const pending = calendar.getValidTokenDetails('host');
  await entered;
  await tokenStore.saveTokens('host', credentials('reconnected'));
  respond(invalid ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({ access_token: 'stale', expires_in: 3600 }));
  assert.equal((await pending).accessToken, 'reconnected');
  assert.equal((await tokenStore.getDecryptedTokens('host')).accessToken, 'reconnected');
}
await tokenStore.saveTokens('host', { ...credentials('old'), expiresAt: 1 });
let finishRefresh;
let startRefresh;
const started = new Promise(resolve => { startRefresh = resolve; });
googleReply = () => { startRefresh(); return new Promise(resolve => { finishRefresh = resolve; }); };
const disconnectedRefresh = calendar.getValidTokenDetails('host');
await started;
await tokenStore.deleteTokens('host');
finishRefresh(Response.json({ access_token: 'stale-after-disconnect' }));
assert.equal((await disconnectedRefresh).success, false);
assert.equal(await tokenStore.getDecryptedTokens('host'), null);
await tokenStore.saveTokens('host', { ...credentials('expired'), expiresAt: 1 });
googleReply = () => Response.json({}, { status: 503 });
await assert.rejects(calendar.getBusyIntervals('host', '2030-01-01'), /credentials/);
await tokenStore.saveTokens('host', { ...credentials('old'), expiresAt: 1 });
googleReply = () => Response.json({ access_token: 'rotated', refresh_token: 'rotated-refresh', expires_in: 3600 });
assert.equal((await calendar.getValidTokenDetails('host')).accessToken, 'rotated');
assert.equal((await tokenStore.getDecryptedTokens('host')).refreshToken, 'rotated-refresh');
for (const reply of [() => Response.json({}, { status: 503 }), () => Response.json({ calendars: { primary: { errors: [{ reason: 'forbidden' }] } } }), () => Response.json({}), () => { throw new Error('offline'); }]) {
  googleReply = reply;
  await assert.rejects(calendar.getBusyIntervals('host', '2030-03-10', 'America/New_York'), /availability/);
}
googleReply = () => Response.json({ calendars: { primary: { busy: [] } } });
await calendar.getBusyIntervals('host', '2030-03-10', 'America/New_York');
assert.equal(Date.parse(requests.at(-1).body.timeMax) - Date.parse(requests.at(-1).body.timeMin), 23 * 3600000);
googleReply = () => Response.json({ id: 'event' });
const booking = { id: 'booking', date: '2030-03-10', startTime: '01:30:00', endTime: '03:30:00', meetingType: 'in-person' };
assert.equal((await calendar.createEvent('host', booking, 'America/New_York')).success, true);
assert.equal(Date.parse(requests.at(-1).body.end.dateTime) - Date.parse(requests.at(-1).body.start.dateTime), 3600000);
await calendar.updateEvent('host', 'event', { ...booking, startTime: '23:30:00', endTime: '00:00:00' }, 'America/New_York');
assert.equal(Date.parse(requests.at(-1).body.end.dateTime) - Date.parse(requests.at(-1).body.start.dateTime), 1800000);
await tokenStore.deleteTokens('host');
assert.deepEqual(await calendar.getBusyIntervals('host', '2030-01-01'), { connected: false, busyTimes: [] });
const originalDelete = tokenStore.deleteTokens;
let emptyDisconnectDeletes = 0;
try {
  tokenStore.deleteTokens = async (...args) => { emptyDisconnectDeletes++; return originalDelete.apply(tokenStore, args); };
  await calendar.disconnect('host');
  assert.equal(emptyDisconnectDeletes, 0, 'An absent connection must not issue an unfenced delete that could race a new OAuth save');
} finally { tokenStore.deleteTokens = originalDelete; }
console.log('PASS: Calendar failure isolation, DST timestamps, refresh races, credential CAS, rotation and cross-process reads.');
