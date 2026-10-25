import assert from 'node:assert/strict';

export async function verifyDocker(origin = 'http://127.0.0.1:4242') {
  const get = path => fetch(new URL(path, origin), { signal: AbortSignal.timeout(10000) });
  assert.equal((await get('/healthz')).status, 200);
  const health = await get('/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  for (const path of ['/', '/login', '/dashboard/appointments', '/book/fixture']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/, path);
    assert.match(response.headers.get('cache-control'), /no-store/, path);
  }
  for (const path of ['/assets/absent.js', '/src/main.jsx', '/missing.json', '/.env']) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.headers.get('cache-control') || '', /immutable/, path);
  }
  const missingApi = await get('/api/__deployment_probe');
  assert.equal(missingApi.status, 404);
  assert(!/id="root"/.test(await missingApi.text()), 'Unknown API route must not return the SPA');
  const html = await (await get('/')).text();
  const asset = html.match(/src="([^"\s]+\.js)"/)?.[1];
  assert(asset, 'Built entry asset is referenced');
  const module = await get(asset);
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /javascript/);
  assert.match(module.headers.get('cache-control'), /immutable/);
  const version = await get('/calup-version.json');
  assert.equal(version.status, 200);
  assert.match(version.headers.get('cache-control'), /no-store/);
  assert((await version.json()).version);
  console.log('PASS: Docker frontend/API health, SPA routes, absent assets, API isolation, JS MIME/cache and version JSON');
}

await verifyDocker(process.argv[2]);
