import { supabase } from '../supabase/supabaseClient.js';
import { getApiBase } from '../../utils/api.js';

async function request(path = '', options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Authentication required.');
  const response = await fetch(`${getApiBase()}/v1/merchant/onboarding${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = result.error;
    const error = new Error(typeof payload === 'string' ? payload : payload?.message || 'Merchant setup request failed.');
    error.code = payload?.code || null;
    error.details = payload?.details || null;
    throw error;
  }
  return result.data;
}

export const onboardingService = {
  load: () => request(),
  saveDraft: (draft, currentStep) => request('/draft', {
    method: 'PUT',
    body: JSON.stringify({ draft, currentStep }),
  }),
  sendEmailVerification: () => request('/email-verification/send', { method: 'POST' }),
  verifyEmail: code => request('/email-verification/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
  sendPhoneVerification: () => request('/phone-verification/send', { method: 'POST' }),
  verifyPhone: code => request('/phone-verification/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
  complete: draft => request('/complete', {
    method: 'POST',
    body: JSON.stringify({ draft }),
  }),
};
