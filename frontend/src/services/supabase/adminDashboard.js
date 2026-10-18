import { supabase } from './supabaseClient.js';
import { getApiBase } from '../../utils/api.js';

export async function loadAdminDashboard({ section, period, search, filter, offset, signal }, { client = supabase, request = fetch } = {}) {
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token) { const denied = new Error('Sign in to Calup again.'); denied.status = 401; throw denied; }
  const query = new URLSearchParams({ period, search, filter, offset: String(offset) });
  const response = await request(`${getApiBase()}/v1/admin/dashboard/${encodeURIComponent(section)}?${query}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` }, credentials: 'include', cache: 'no-store', signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const failure = new Error(result.error || 'Administrator data is unavailable.'); failure.status = response.status; throw failure; }
  return result;
}

export async function adminRefundRequest(id, { action, body, key, signal } = {}, { client = supabase, request = fetch } = {}) {
  const { data,error } = await client.auth.getSession();
  if(error || !data?.session?.access_token) throw new Error('Sign in again before reviewing refunds.');
  const response = await request(`${getApiBase()}/v1/admin/refund-requests/${encodeURIComponent(id)}${action ? `/${action}` : ''}`, {
    method: action ? 'POST' : 'GET', headers: { Authorization:`Bearer ${data.session.access_token}`, ...(action ? {'Content-Type':'application/json'} : {}), ...(key ? {'Idempotency-Key':key} : {}) },
    ...(action ? {body:JSON.stringify(body || {})} : {}), credentials:'include',cache:'no-store',signal,
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok) { const failure=new Error(result.error || 'Refund request failed. Refresh the request before retrying.'); failure.code=result.code; failure.status=response.status; throw failure; }
  return result;
}
