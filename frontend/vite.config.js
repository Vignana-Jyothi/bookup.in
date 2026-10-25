import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));

function sourceVersion() {
  const hash = createHash('sha256');
  function addDirectory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) addDirectory(filename);
      else hash.update(path.relative(frontendRoot, filename)).update(readFileSync(filename));
    }
  }
  addDirectory(path.join(frontendRoot, 'src'));
  addDirectory(path.join(frontendRoot, 'public'));
  hash.update(readFileSync(path.join(frontendRoot, 'index.html')));
  return hash.digest('hex').slice(0, 16);
}

function frontendVersionPlugin() {
  let buildVersion;
  let buildMode = false;
  return {
    name: 'calup-frontend-version',
    configResolved(config) { buildMode = config.command === 'build'; },
    buildStart() { buildVersion = sourceVersion(); },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'calup-version', content: buildMode ? buildVersion : sourceVersion() }, injectTo: 'head' }];
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'calup-version.json', source: JSON.stringify({ mode: 'build', version: buildVersion }) });
    },
    configureServer(server) {
      server.middlewares.use('/calup-version.json', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ mode: 'development', version: sourceVersion() }));
      });
    },
  };
}

function frontendEnvironmentPlugin() {
  return {
    name: 'calup-frontend-environment',
    configResolved(config) {
      if (config.command !== 'build') return;
      const url = (config.env.VITE_SUPABASE_URL || '').trim();
      const key = (config.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
      const missing = [];
      let validUrl = false;
      try {
        const parsed = new URL(url);
        validUrl = !/placeholder|your-project/i.test(parsed.hostname) && !parsed.username && !parsed.password &&
          (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)));
      } catch { /* Report the variable name, never its supplied value. */ }
      if (!validUrl) missing.push('VITE_SUPABASE_URL');
      if (!key || /placeholder|your[-_]/i.test(key)) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
      let role;
      try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role; } catch { /* New publishable keys are not JWTs. */ }
      if (key.startsWith('sb_secret_') || role === 'service_role') {
        throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must be a browser-safe publishable/anon key. Never put a Supabase secret or service-role key in frontend variables.');
      }
      if (missing.length) {
        throw new Error(`Frontend Supabase configuration is missing or invalid: ${missing.join(', ')}. Set these in Vercel Project Settings > Environment Variables for the deployment environment, then rebuild. A local .env file is not uploaded through Git.`);
      }
    },
  };
}

const backendTarget = process.env.VITE_BACKEND_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;

function createApiProxy() {
  return {
    target: backendTarget,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq, req) => {
        // Same-origin browser requests are already routed through this frontend.
        // Preserve cross-origin headers so the backend can still reject them.
        const origin = req.headers.origin;
        if (origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`) {
          proxyReq.removeHeader('origin');
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react(), frontendVersionPlugin(), frontendEnvironmentPlugin()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
    proxy: {
      '/api': createApiProxy(),
    },
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PREVIEW_PORT || '4173', 10),
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
    proxy: {
      '/api': createApiProxy(),
    },
  },
})
