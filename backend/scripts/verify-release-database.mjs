import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE_SCHEMA = '20261025-code-audit';

export function readReleaseSettings(text) {
  const value = name => text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1].replace(/\r$/, '');
  return { supabaseUrl: value('SUPABASE_URL'), supabaseServiceRoleKey: value('SUPABASE_SERVICE_ROLE_KEY') };
}

export async function verifyReleaseDatabase(settings, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const failure = 'Database release check failed. Verify connectivity and apply/test the 20261025 audit migrations before deploying.';
  try {
    const base = new URL(settings.supabaseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
      || !['', '/'].includes(base.pathname) || !settings.supabaseServiceRoleKey) throw new Error();
    const controller = new AbortController();
    let timer;
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error(failure)); }, timeoutMs);
      });
      const result = await Promise.race([(async () => {
        const response = await fetchImpl(`${base.origin}/rest/v1/rpc/get_release_readiness_v1`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { apikey: settings.supabaseServiceRoleKey, Authorization: `Bearer ${settings.supabaseServiceRoleKey}`, 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!response.ok) throw new Error();
        return response.json();
      })(), deadline]);
      if (result?.ready !== true || result?.release !== RELEASE_SCHEMA) throw new Error();
    } finally { clearTimeout(timer); }
  } catch { throw new Error(failure); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const settings = readReleaseSettings(await readFile(process.argv[2] || '.env.backend', 'utf8'));
    await verifyReleaseDatabase(settings);
    console.log('PASS: database release prerequisites are installed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
