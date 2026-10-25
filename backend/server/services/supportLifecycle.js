import { serviceRoleClient } from '../middleware/auth.js';

let timer;
let running = false;

export async function runSupportLifecycleCycle(client = serviceRoleClient) {
  if (running || !client) return;
  running = true;
  try {
    const { error } = await client.rpc('process_support_lifecycle_v1');
    if (error) throw error;
  } catch (error) {
    console.error('[SupportLifecycle] Processing failed', { code: error?.code || 'unknown' });
  } finally {
    running = false;
  }
}

export function startSupportLifecycleWorker() {
  if (timer) return;
  timer = setInterval(runSupportLifecycleCycle, 60000);
  timer.unref?.();
  setImmediate(runSupportLifecycleCycle);
}

export function stopSupportLifecycleWorker() {
  clearInterval(timer);
  timer = null;
}
