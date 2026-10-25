import { useEffect, useState } from 'react';
import { merchantCommerceService } from '../../services/payments/merchantCommerceService.js';

export default function CommerceOrders({kind}) {
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    const refresh=()=>merchantCommerceService.orders().then(value=>{if(active){setData(value);setError('');}}).catch(failure=>{if(active)setError(failure.message);});
    refresh();
    const timer=setInterval(()=>{if(!document.hidden)refresh();},15000);
    return()=>{active=false;clearInterval(timer);};
  },[]);
  const orders=data?.orders.filter(order=>order.purpose===(kind==='product'?'marketplace':'customer_membership')) || [];
  return <section><h3>Sandbox orders and access</h3><p>Verified financial records only. Product delivery and membership reminders are still being connected.</p>{error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">Loading orders...</p>}{data&&!orders.length&&<p>No orders yet.</p>}{orders.map(order=>{
    const period=data.periods.find(value=>value.order_id===order.id);
    return <article className="commerce-order" key={order.id}><h4>{order.title}</h4><p>{order.id} · {order.maskedPhone}</p><p>{new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(order.amount_paise/100)} · {order.payment_status.replaceAll('_',' ')} · {order.fulfilment_status.replaceAll('_',' ')}</p>{period&&<p>Access: {new Date(period.starts_at).toLocaleString()} – {new Date(period.ends_at).toLocaleString()}</p>}{order.fulfilment_status==='review_required'&&<p>Refer this order to Calup for payment review/refund. No access was granted.</p>}</article>;
  })}</section>;
}
