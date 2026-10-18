import { config } from '../config.js';
import { serviceRoleClient } from '../middleware/auth.js';
import { reconcileSubscriptionOrder, reconcileSubscriptionRefund } from '../routes/merchantSubscription.js';

let timer = null;
let running = false;

export async function runSubscriptionLifecycleCycle() {
  if (running || !serviceRoleClient) return;
  running = true;
  try {
    await serviceRoleClient.rpc('transition_subscription_lifecycle_v1', { p_provider_id: null });
    await serviceRoleClient.rpc('transition_subscription_periods_v1');
    await serviceRoleClient.rpc('expire_subscription_orders_v1', { p_limit: 200 });
    if (!config.isCashfreeConfigured()) return;
    const { data, error } = await serviceRoleClient.rpc('claim_subscription_reconciliation_v1', { p_limit: 25 });
    if (error) throw error;
    for (const orderId of data || []) {
      try {
        await reconcileSubscriptionOrder(orderId);
      } catch (error_) {
        console.warn('[SubscriptionLifecycle] Order remains pending', {
          orderId,
          error: error_?.code || error_?.message || 'unknown',
        });
      }
    }
    const { data: refundIds, error: refundClaimError } = await serviceRoleClient.rpc('claim_subscription_refunds_v1', { p_limit: 20 });
    if (refundClaimError) throw refundClaimError;
    for (const refundId of refundIds || []) {
      try {
        await reconcileSubscriptionRefund(refundId);
      } catch (error_) {
        console.warn('[SubscriptionLifecycle] Refund remains pending', {
          refundId,
          error: error_?.code || error_?.message || 'unknown',
        });
      }
    }
  } catch (error) {
    console.error('[SubscriptionLifecycle] Cycle failed:', error?.message || error);
  } finally {
    running = false;
  }
}

export function startSubscriptionLifecycleWorker() {
  if (timer) return;
  timer = setInterval(runSubscriptionLifecycleCycle, 30000);
  timer.unref?.();
  setImmediate(runSubscriptionLifecycleCycle);
}

export function stopSubscriptionLifecycleWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
