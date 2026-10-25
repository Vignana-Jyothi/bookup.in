import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

/** Public dependency liveness: never return credentials, records, or error details. */
export function createHealthHandler({ settings = config, clientFactory = createClient, timeoutMs = 2000 } = {}) {
  return async (_req, res) => {
    let status = 'unconfigured';
    const key = settings.supabaseServiceRoleKey || settings.supabaseKey;
    if (settings.supabaseUrl && key) {
      const controller = new AbortController();
      let timer;
      try {
        const deadline = new Promise(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve({ error: true }); }, timeoutMs);
        });
        const client = clientFactory(settings.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const result = await Promise.race([
          client.from('services').select('id').limit(1).abortSignal(controller.signal),
          deadline,
        ]);
        status = result?.error ? 'error' : 'connected';
      } catch {
        status = 'error';
      } finally {
        clearTimeout(timer);
      }
    }
    res.set('Cache-Control', 'no-store');
    return res.json({ status: 'ok', service: 'Calup Backend', supabase: { status }, timestamp: new Date().toISOString() });
  };
}
