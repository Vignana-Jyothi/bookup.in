import crypto from 'node:crypto';
import { config } from '../config.js';
import { serviceRoleClient } from '../middleware/auth.js';
import { cashfreeClient, amountToPaise } from './cashfree.js';

let timer;
let running = false;
export const bookingRefundsEnabled = () => config.cashfreeEnvironment === 'sandbox' && config.isCashfreeConfigured() && process.env.CASHFREE_ADMIN_REFUNDS_ENABLED !== 'false';
const statusMap = { SUCCESS: 'succeeded', PENDING: 'processing', PENDING_APPROVAL: 'processing', ONHOLD: 'processing', ACTIVE: 'processing', CANCELLED: 'failed', REJECTED: 'failed', FAILED: 'failed' };

export function validateBookingRefund(result, context) {
  if (result?.order_id !== context.orderId || result?.refund_id !== context.gatewayRefundId ||
    String(result?.cf_payment_id) !== String(context.providerPaymentId) || result?.refund_currency !== context.currency ||
    amountToPaise(result?.refund_amount) !== Number(context.amountPaise)) throw new Error('REFUND_IDENTITY_MISMATCH');
  const status = statusMap[result.refund_status];
  if (!status) throw new Error('REFUND_STATUS_UNKNOWN');
  return status;
}

export async function processBookingRefund(context, owner, { database = serviceRoleClient, gateway = cashfreeClient } = {}) {
  const finish = async (status, safeError = null) => {
    const { data, error } = await database.rpc('finish_booking_refund_v1', {
      p_id: context.requestId, p_owner: owner, p_generation: context.generation, p_status: status, p_safe_error: safeError,
    });
    if (error) throw new Error('REFUND_PERSISTENCE_FAILED');
    return data;
  };
  if (context.environment !== 'sandbox' || context.gatewayAccount !== 'calup_primary' || gateway.environment !== context.environment || !context.providerPaymentId) {
    return finish('review_required', 'REFUND_ACCOUNT_MISMATCH');
  }
  if (context.currency !== 'INR' || !Number.isSafeInteger(Number(context.amountPaise)) || !Number.isSafeInteger(Number(context.paymentAmountPaise)) ||
    Number(context.amountPaise)<=0 || Number(context.amountPaise)>Number(context.paymentAmountPaise)) return finish('review_required','REFUND_AMOUNT_INVALID');
  let createError;
  let dispatchStarted=Boolean(context.dispatchStarted);
  try {
    if (!context.dispatchStarted) {
      // Verify the original order/payment through the same credentials before submission.
      const order = await gateway.getOrder(context.orderId);
      const payments = await gateway.getOrderPayments(context.orderId);
      const payment = payments.find(item => String(item.cf_payment_id) === String(context.providerPaymentId) && item.payment_status === 'SUCCESS');
      if (order.order_id !== context.orderId || order.order_status !== 'PAID' || order.order_currency !== context.currency ||
        amountToPaise(order.order_amount) !== Number(context.paymentAmountPaise) || !payment ||
        payment.payment_currency !== context.currency || amountToPaise(payment.payment_amount) !== Number(context.paymentAmountPaise)) {
        return finish('review_required', 'PAYMENT_IDENTITY_MISMATCH');
      }
      const dispatch = await database.rpc('begin_booking_refund_dispatch_v1', { p_id: context.requestId, p_owner: owner, p_generation: context.generation });
      if (dispatch.error) throw new Error('STALE_LEASE');
      dispatchStarted=true;
      if (dispatch.data === true) {
        try {
          await gateway.createRefund(context.orderId, { refund_id: context.gatewayRefundId, refund_amount: Number(context.amountPaise) / 100,
            refund_note: 'SUCCESS', refund_speed: 'STANDARD' }, context.refundId);
        } catch (error) { createError = error; }
      }
    }
    // Only a verified GET result establishes refund truth, including after timeout/duplicate POST.
    const refund = await gateway.getRefund(context.orderId, context.gatewayRefundId);
    return finish(validateBookingRefund(refund, context));
  } catch (error) {
    if (error.message === 'STALE_LEASE') return false;
    if (error.message === 'REFUND_IDENTITY_MISMATCH' || error.message === 'REFUND_STATUS_UNKNOWN') return finish('review_required', error.message);
    if (!dispatchStarted) return finish('requested','PAYMENT_LOOKUP_PENDING');
    if (createError?.outcome === 'definitive' && createError.status !== 409 && error.status === 404) return finish('failed', 'REFUND_SUBMISSION_REJECTED');
    return finish('submitted', 'REFUND_LOOKUP_PENDING');
  }
}

export async function runBookingRefundCycle({ database = serviceRoleClient, gateway = cashfreeClient, enabled = bookingRefundsEnabled } = {}) {
  if (running || !enabled() || !database) return;
  running = true;
  const owner = crypto.randomUUID();
  try {
    const { data, error } = await database.rpc('claim_booking_refunds_v1', { p_owner: owner, p_limit: 1 });
    if (error) throw new Error('REFUND_CLAIM_FAILED');
    for (const context of data || []) {
      try { await processBookingRefund(context, owner, { database, gateway }); }
      catch { console.warn('[BookingRefund] Job awaits reconciliation', { requestId: context.requestId }); }
    }
  } catch { console.warn('[BookingRefund] Worker could not read refund jobs.'); }
  finally { running = false; }
}
export function startBookingRefundWorker() {
  if (timer || !bookingRefundsEnabled()) return;
  timer = setInterval(() => runBookingRefundCycle(), 15000);
  timer.unref?.();
  setImmediate(() => runBookingRefundCycle());
}
export function stopBookingRefundWorker() { if (timer) clearInterval(timer); timer = null; }

export async function recordBookingRefundWebhook(payload, rawBody, database = serviceRoleClient) {
  const refund = payload?.data?.refund || payload?.data;
  if (typeof refund?.refund_id !== 'string' || !refund.refund_id || refund.refund_id.length > 100 ||
    typeof refund.order_id !== 'string' || !refund.order_id || refund.order_id.length > 256) return false;
  const { error } = await database.rpc('wake_booking_refund_v1', { p_gateway_id: refund.refund_id, p_order_id: refund.order_id,
    p_payload_hash: crypto.createHash('sha256').update(rawBody).digest('hex') });
  if (error) throw new Error('REFUND_WEBHOOK_STORAGE_FAILED');
  setImmediate(() => runBookingRefundCycle());
  return true;
}
