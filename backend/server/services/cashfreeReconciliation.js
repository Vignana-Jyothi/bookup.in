import { config } from '../config.js';
import { serviceRoleClient } from '../middleware/auth.js';
import { reconcileAttempt } from '../routes/cashfreeV1.js';

let timer = null;
let running = false;

async function runCycle() {
  if (running || !config.isCashfreeConfigured() || !serviceRoleClient) return;
  running = true;
  try {
    await serviceRoleClient.rpc('expire_booking_holds_v1', { p_limit: 200 });
    const { data, error } = await serviceRoleClient.rpc('claim_cashfree_reconciliation_v1', { p_limit: 25 });
    if (error) throw error;
    for (const attemptId of data || []) {
      try {
        await reconcileAttempt(attemptId);
      } catch (error_) {
        console.warn('[CashfreeReconciliation] Attempt remains pending:', {
          attemptId,
          error: error_?.code || error_?.message || 'unknown',
        });
      }
    }
  } catch (error) {
    console.error('[CashfreeReconciliation] Cycle failed:', error?.message || error);
  } finally {
    running = false;
  }
}

export function startCashfreeReconciliationWorker() {
  if (timer || !config.cashfreeEnabled) return;
  timer = setInterval(runCycle, 30000);
  timer.unref?.();
  setImmediate(runCycle);
}

export function stopCashfreeReconciliationWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
