import { getPublicSessionApiBase as getApiBase } from '../../utils/api.js';

export function publicCommerceService(slug) {
  async function request(path,body,signal) {
    const response=await fetch(`${getApiBase()}/v1/public/commerce/${encodeURIComponent(slug)}${path}`,{
      method:body===undefined?'GET':'POST',credentials:'include',cache:'no-store',signal,
      headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error((typeof result.error==='string' ? result.error : result.error?.message) || 'This service is temporarily unavailable. Please try again.');error.status=response.status;throw error;}
    return result.data;
  }
  return {catalog:signal=>request('/catalog',undefined,signal),session:()=>request('/session'),
    send:(phone,bookingId)=>request('/otp/send',{phone,...(bookingId?{bookingId}:{})}),
    verify:(challengeId,code)=>request('/otp/verify',{challengeId,code}),
    requestAccess:id=>request(`/items/${id}/access`,{}),logout:()=>request('/logout',{}),
    orders:()=>request('/orders'),
    bookingPayments:()=>request('/booking-payments'),
    openBookingPayment:id=>request(`/booking-payments/${encodeURIComponent(id)}/open`,{}),
    checkout:(id,version,requestKey)=>request(`/items/${id}/checkout`,{version,requestKey,sandboxAcknowledged:true}),
    openOrder:id=>request(`/orders/${id}/open`,{}),refreshOrder:id=>request(`/orders/${id}/refresh`,{})};
}
