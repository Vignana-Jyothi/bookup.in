import { supabase } from '../supabase/supabaseClient.js';
import { getApiBase, getAdminApiBase, getPublicSessionApiBase } from '../../utils/api.js';

export function createTicketService(scope = 'customer', context = 'booking') {
  const segment = scope === 'customer' ? 'public' : scope;
  async function request(path = '', options = {}) {
    const headers = { Accept: 'application/json', 'X-Support-Context': context, ...options.headers };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (scope !== 'customer') {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sign in to access support.');
      headers.Authorization = `Bearer ${session.access_token}`;
    }
    const apiBase = scope === 'admin' ? getAdminApiBase()
      : scope === 'customer' && context === 'payment' ? getPublicSessionApiBase() : getApiBase();
    const response = await fetch(`${apiBase}/v1/${segment}/support/tickets${path}`, { ...options, credentials: 'include', headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error?.message || result.error || 'Support is temporarily unavailable.');
      error.status = response.status;
      throw error;
    }
    return result.data;
  }
  return {
    list: offset => request(`?offset=${offset || 0}`),
    get: id => request(`/${encodeURIComponent(id)}`),
    create: (payload, key) => request('', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) }),
    act: (id, action, payload, key) => request(`/${encodeURIComponent(id)}/${action}`, {
      method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload),
    }),
  };
}
