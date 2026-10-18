import { supabase } from '../supabase/supabaseClient.js';
import { getApiBase } from '../../utils/api.js';

async function request(path = '',body,signal) {
  const {data,error} = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error('Sign in to manage your products.');
  const response = await fetch(`${getApiBase()}/v1/merchant/commerce${path}`,{method:body === undefined ? 'GET' : 'POST',
    credentials:'include',cache:'no-store',signal,headers:{Authorization:`Bearer ${data.session.access_token}`,...(body === undefined ? {} : {'Content-Type':'application/json'})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const failure = new Error(result.error || 'Commerce setup could not be loaded.'); failure.status=response.status; throw failure; }
  return result.data || result;
}
export const merchantCommerceService = {
  load:signal => request('',undefined,signal),
  async saveVault(envelope) {
    try {return await request('/vault',envelope);} catch(error) {
      if (error.status !== 409) throw error;
      const existing = (await request()).vault;
      if (!existing || ['salt','version','iterations'].some(key => existing[key] !== envelope[key]) ||
        ['password','recovery'].some(key => existing[key]?.iv !== envelope[key].iv || existing[key]?.data !== envelope[key].data)) throw error;
      return {saved:true};
    }
  },
  saveItem:item => request('/items',item),
  publish:(id,version,publish) => request(`/items/${id}/publication`,{version,publish}),
  accessRequests:() => request('/access-requests'),
  orders:() => request('/orders'),
  decide:(id,body) => request(`/access-requests/${id}/decision`,body),
  async upload(id,ciphertext,envelope) {
    let session;
    try {session = await request(`/products/${id}/upload`,envelope);} catch(error) {
      if (error.status === 409) { await request(`/products/${id}/asset`,envelope); return; }
      throw error;
    }
    const {error} = await supabase.storage.from('calup-private-products').uploadToSignedUrl(session.path,session.token,ciphertext,{contentType:'application/octet-stream',upsert:false});
    if (error) {
      try {await request(`/products/${id}/asset`,envelope);return;} catch {throw new Error('Encrypted upload failed. Keep this window open and retry the same file.');}
    }
    return request(`/products/${id}/asset`,envelope);
  },
  async asset(id) {
    const asset = await request(`/products/${id}/asset`);
    const response = await fetch(asset.url,{cache:'no-store',referrerPolicy:'no-referrer'});
    if (!response.ok) throw new Error('Encrypted download failed. Request a new download link.');
    return {envelope:asset.envelope,ciphertext:await response.arrayBuffer()};
  },
};
