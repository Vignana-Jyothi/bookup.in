import { supabase } from '../supabase/supabaseClient.js';
import { getApiBase } from '../../utils/api.js';

/** Account entitlement alone cannot prove that the requested renewal succeeded. */
export function isSubscriptionOrderApplied(projection, orderId) {
  const order = projection?.requestedOrder;
  return Boolean(orderId && order?.orderId === orderId && order.paymentStatus === 'succeeded' && order.applicationStatus === 'applied');
}

export function subscriptionOrderNotice(projection, orderId) {
  if (isSubscriptionOrderApplied(projection, orderId)) return { type: 'success', text: 'Payment verified. This renewal has been applied. Check your updated access dates below.' };
  const order = projection?.requestedOrder;
  if (order?.orderId === orderId) {
    if (['review_required', 'refund_required'].includes(order.applicationStatus) || order.paymentStatus === 'succeeded') return { type: 'info', text: 'This payment needs review before access can be confirmed. Do not pay again; contact Calup support.' };
    if (['creation_failed', 'closed_unpaid', 'failed'].includes(order.paymentStatus)) return { type: 'info', text: 'This renewal was not applied. If you were charged, contact Calup support before paying again.' };
  }
  return { type: 'info', text: 'This renewal is not confirmed yet. Check its payment status before trying another payment.' };
}

export async function findSubscriptionReceipt(projection, orderId, readDocument) {
  if (!orderId) return null;
  for (const invoice of projection?.documents || []) {
    if (invoice.type !== 'invoice') continue;
    const document = await readDocument(invoice.id);
    if (document.subscriptionOrderId === orderId) return document;
  }
  return null;
}

async function request(path = '', options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Authentication required.');
  const response = await fetch(`${getApiBase()}/v1/merchant/subscription${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) {
    const error = new Error(result?.error?.message || 'Subscription request failed.');
    error.code = result?.error?.code;
    error.status = response.status;
    error.details = result?.error?.details || null;
    throw error;
  }
  return { data: result.data, status: response.status };
}

export const subscriptionService = {
  get: async () => (await request()).data,
  saveBillingProfile: async values => (await request('/billing-profile', {
    method: 'PUT',
    body: JSON.stringify(values),
  })).data,
  createOrder: async (planId, idempotencyKey) => request('/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ planId }),
  }),
  refreshOrder: async orderId => request(`/orders/${encodeURIComponent(orderId)}/refresh`, {
    method: 'POST',
    body: '{}',
  }),
  finishCheckout: async orderId => request(`/orders/${encodeURIComponent(orderId)}/checkout-ended`, {
    method: 'POST',
    body: '{}',
  }),
  redeemCode: async code => (await request('/access-code-redemptions', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })).data,
  cancelPeriod: async periodId => (await request(`/periods/${encodeURIComponent(periodId)}/cancellation`, {
    method: 'POST',
    body: '{}',
  })).data,
  getDocument: async id => (await request(`/documents/${encodeURIComponent(id)}`)).data,
};
