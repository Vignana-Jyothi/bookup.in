import assert from 'node:assert/strict';
import { createServer, preview, resolveConfig } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hosting=JSON.parse(await readFile(new URL('../../frontend/vercel.json',import.meta.url),'utf8'));
const filesystemIndex=hosting.routes.findIndex(rule=>rule.handle==='filesystem');
assert(filesystemIndex>=0,'Existing compiled assets must be served before fallback rules');
function routeMissing(path){
  return hosting.routes.slice(filesystemIndex+1).find(rule=>new RegExp(`^${rule.src}$`).test(path));
}
for(const route of ['/','/login','/signup','/book/test-merchant/memberships','/dashboard/appointments']) {
  assert.equal(routeMissing(route)?.dest,'/index.html',`Application route must receive the SPA: ${route}`);
}
for(const resource of ['/assets/index-old.js','/assets/passwordStrength-missing.js','/src/main.jsx','/api/health','/calup-version.json','/missing-module.js']) {
  assert.equal(routeMissing(resource)?.status,404,`Missing resource must not become HTML: ${resource}`);
}
assert(hosting.routes[0].headers['Cache-Control'].includes('no-store'));
assert(hosting.routes[1].headers['Cache-Control'].includes('immutable'));
assert(hosting.routes.slice(0,filesystemIndex).filter(rule=>rule.headers).every(rule=>rule.continue),'Header rules must continue to filesystem resolution');
const adminRoute=hosting.routes.find(rule=>rule.src==='/api/v1/admin/(.*)');
assert.equal(adminRoute?.dest,'/api/admin-proxy?__calup_admin_path=$1','Admin API needs an explicit function route before the resource 404');
assert(hosting.routes.indexOf(adminRoute)<filesystemIndex);
assert((await stat(new URL('../../frontend/api/admin-proxy.mjs',import.meta.url))).isFile());
const workflow=await readFile(new URL('../../.github/workflows/vercel.yml',import.meta.url),'utf8');
assert.equal((workflow.match(/--local-config=frontend\/vercel\.json/g)||[]).length,6,'Both environments must use the frontend config in pull, build and deploy');

const options = {
  root: 'frontend', configLoader: 'native', logLevel: 'silent',
  optimizeDeps: { noDiscovery: true, include: [] },
};
const config = await resolveConfig(options, 'serve');
assert.equal(config.server.port, 5173);
assert.equal(config.server.strictPort, true);
assert.equal(config.preview.port, Number(process.env.PREVIEW_PORT || 4173));
assert.notEqual(config.preview.port, config.server.port, 'Preview must not replace the live development server');

// Resolve builds without local env files, reproducing a hosted build with missing variables.
const envNames = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
try {
  process.env.VITE_SUPABASE_URL = '';
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = '';
  const buildOptions = { ...options, envFile: false, mode: 'production' };
  await assert.rejects(resolveConfig(buildOptions, 'build'), /VITE_SUPABASE_URL.*VITE_SUPABASE_PUBLISHABLE_KEY/);
  process.env.VITE_SUPABASE_URL = 'https://test-project.supabase.co';
  await assert.rejects(resolveConfig(buildOptions, 'build'), /missing or invalid: VITE_SUPABASE_PUBLISHABLE_KEY/);
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_secret_test_only';
  await assert.rejects(resolveConfig(buildOptions, 'build'), /browser-safe publishable\/anon key/);
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = `test.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.test`;
  await assert.rejects(resolveConfig(buildOptions, 'build'), /browser-safe publishable\/anon key/);
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_only';
  await resolveConfig(buildOptions, 'build');
  process.env.VITE_SUPABASE_URL = 'https://placeholder-project.supabase.co';
  await assert.rejects(resolveConfig(buildOptions, 'build'), /missing or invalid: VITE_SUPABASE_URL/);
} finally {
  for (const name of envNames) {
    if (previousEnv[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[name];
  }
}

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
  console.log('Frontend delivery checks passed: production SPA/resource routing, no-store HTML, build-time Supabase configuration/secret-key rejection, version, proxy and occupied-port rejection. No database calls.');
} finally {
  backend.closeAllConnections();
  server.httpServer?.closeAllConnections();
  competing?.httpServer?.closeAllConnections();
  await competing?.close();
  await server.close();
  await new Promise(resolve => backend.close(resolve));
}

// Optional real-build verification; normal isolated tests do not require generated output.
if (process.argv.includes('--built')) {
  const output=fileURLToPath(new URL('../../frontend/dist/',import.meta.url));
  const manifest=JSON.parse(await readFile(path.join(output,'.vite/manifest.json'),'utf8'));
  const assets=new Set();
  const addAsset=value=>{
    const url=new URL(value,'http://build.invalid/');
    if(url.origin!=='http://build.invalid')return;
    const relative=decodeURIComponent(url.pathname).replace(/^\//,'');
    const filename=path.resolve(output,relative);
    assert(filename.startsWith(path.resolve(output)+path.sep),'Asset must stay in the build directory');
    assets.add(relative);
  };
  for(const [name,entry] of Object.entries(manifest)) {
    for(const dependency of [...(entry.imports||[]),...(entry.dynamicImports||[])]) assert(manifest[dependency],`Missing manifest dependency ${dependency} in ${name}`);
    for(const file of [entry.file,...(entry.css||[]),...(entry.assets||[])])addAsset(file);
  }
  const html=await readFile(path.join(output,'index.html'),'utf8');
  assert(!html.includes('/src/main.jsx'),'Production HTML must reference compiled modules');
  for(const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g))addAsset(match[1]);
  for(const file of assets) {
    if(file.endsWith('.css')) {
      const css=await readFile(path.join(output,file),'utf8');
      for(const match of css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
        if(!match[1].startsWith('#'))addAsset(new URL(match[1],`http://build.invalid/${file}`).href);
      }
    }
    if(!file.endsWith('.js'))continue;
    const code=await readFile(path.join(output,file),'utf8');
    // Check generated static and literal dynamic imports relative to their actual importer.
    for(const match of code.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["'`]([^"'`]+)["'`]/g)) {
      if(!/^(?:\.\.?\/|\/)/.test(match[1])||!/\.(?:m?js|css)$/.test(match[1])||match[1].includes('${'))continue;
      addAsset(new URL(match[1],`http://build.invalid/${file}`).href);
    }
    for(const match of code.matchAll(/["'`](assets\/[^"'`]+\.(?:js|css))["'`]/g))addAsset(match[1]);
  }
  for(const file of assets)assert((await stat(path.join(output,file))).isFile(),`Referenced build asset is missing: ${file}`);
  const production=await preview({...options,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:false,open:false}});
  try {
    const origin=`http://127.0.0.1:${production.httpServer.address().port}`;
    for(const file of assets) {
      const response=await fetch(`${origin}/${file}`);
      assert.equal(response.status,200,file);
      const mime=response.headers.get('content-type')||'';
      assert(!mime.includes('text/html'),`${file} returned HTML`);
      if(/\.m?js$/.test(file))assert(/(?:javascript|ecmascript)/.test(mime),`${file} has invalid JS MIME ${mime}`);
      if(file.endsWith('.css'))assert(mime.includes('text/css'),`${file} has invalid CSS MIME ${mime}`);
      await response.arrayBuffer();
    }
    for(const route of ['/','/login','/dashboard/appointments','/book/test-merchant/memberships']) {
      const response=await fetch(origin+route);
      assert.equal(response.status,200,route);
      assert.equal(await response.text(),html,`${route} must serve the compiled SPA`);
    }
    console.log(`PASS: ${assets.size} real production assets exist and serve correct non-HTML MIME; static/dynamic imports, preload dependencies and four nested SPA routes verified. No browser auth or DB calls.`);
  } finally {
    production.httpServer.closeAllConnections();
    await new Promise(resolve=>production.httpServer.close(resolve));
  }
}
