import { supabase } from '../supabase/supabaseClient.js';
import { getApiBase } from '../../utils/api.js';

async function request(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sign in to manage refund requests.');
  const response = await fetch(`${getApiBase()}/v1/merchant/refund-requests${path}`, {
    ...options, headers: { Accept: 'application/json', Authorization: `Bearer ${session.access_token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Refund request failed.');
  return result.data;
}

export const bookingRefundService = {
  get: appointmentId => request(`/${encodeURIComponent(appointmentId)}`),
  create: (appointmentId, reason, key) => request('', {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ appointmentId, reason }),
  }),
};
