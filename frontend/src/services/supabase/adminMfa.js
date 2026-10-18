import { getApiBase } from '../../utils/api.js';

export const isCalupAdmin = user => user?.app_metadata?.role === 'calup_admin';

async function adminRequest(client, path, { method = 'GET', body } = {}, request = fetch) {
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error('Sign in to Calup again.');
  const response = await request(`${getApiBase()}/v1/admin/auth${path}`, {
    method, headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, credentials: 'include', cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Administrator verification is unavailable.');
  return result;
}

export function startAdminPhoneChallenge(client, request) {
  return adminRequest(client, '/sms/send', { method: 'POST', body: {} }, request);
}
export function verifyAdminPhoneChallenge(client, challengeId, code, request) {
  return adminRequest(client, '/sms/verify', { method: 'POST', body: { challengeId, code } }, request);
}
export function verifyAdminAccess(client, request) {
  return adminRequest(client, '/session', {}, request);
}
export function endAdminVerification(client, request) {
  return adminRequest(client, '/session', { method: 'DELETE' }, request);
}
