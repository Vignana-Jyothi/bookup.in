import { supabase } from '../supabase/supabaseClient.js';
import { getApiBase } from '../../utils/api.js';

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
