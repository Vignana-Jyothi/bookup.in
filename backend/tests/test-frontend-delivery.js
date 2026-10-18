import assert from 'node:assert/strict';
import { createServer, resolveConfig } from 'vite';
import { createServer as createHttpServer } from 'node:http';

const options = {
  root: 'frontend', configLoader: 'native', logLevel: 'silent',
  optimizeDeps: { noDiscovery: true, include: [] },
};
const config = await resolveConfig(options, 'serve');
assert.equal(config.server.port, 5173);
assert.equal(config.server.strictPort, true);
assert.equal(config.preview.port, Number(process.env.PREVIEW_PORT || 4173));
assert.notEqual(config.preview.port, config.server.port, 'Preview must not replace the live development server');

const backend = createHttpServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ origin: req.headers.origin || null }));
});
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
const backendTarget = `http://127.0.0.1:${backend.address().port}`;
const server = await createServer({ ...options, server: {
  host: '127.0.0.1', port: 0, hmr: false,
  proxy: { '/api': { target: backendTarget } },
} });
let competing;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const versionResponse = await fetch(`${origin}/calup-version.json`);
  assert.equal(versionResponse.headers.get('cache-control'), 'no-store');
  const version = await versionResponse.json();
  assert.equal(version.mode, 'development');
  assert.match(version.version, /^[a-f0-9]{16}$/);
  const htmlResponse = await fetch(`${origin}/onboarding`);
  assert.match(htmlResponse.headers.get('cache-control'), /no-store/);
  const html = await htmlResponse.text();
  assert(html.includes('/@vite/client'));
  assert(html.includes(version.version), 'HTML and diagnostics must identify the same source');

  const sameOrigin = await (await fetch(`${origin}/api/probe`, { headers: { Origin: origin } })).json();
  assert.equal(sameOrigin.origin, null, 'Same-origin proxy requests must not fail the backend LAN-origin check');
  const crossOrigin = await (await fetch(`${origin}/api/probe`, { headers: { Origin: 'https://untrusted.example' } })).json();
  assert.equal(crossOrigin.origin, 'https://untrusted.example', 'Cross-origin requests must retain backend CORS enforcement');

  competing = await createServer({ ...options, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await assert.rejects(competing.listen(), /already in use/, 'An occupied port must fail instead of silently serving elsewhere');
  console.log('Frontend delivery checks passed: version, cache policy, SPA entry, and occupied-port rejection.');
} finally {
  backend.closeAllConnections();
  server.httpServer?.closeAllConnections();
  competing?.httpServer?.closeAllConnections();
  await competing?.close();
  await server.close();
  await new Promise(resolve => backend.close(resolve));
}
