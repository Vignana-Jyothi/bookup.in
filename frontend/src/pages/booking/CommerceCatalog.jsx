import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import BrandLogo from '../../components/ui/BrandLogo';
import { publicCommerceService } from '../../services/payments/publicCommerceService.js';
import { cashfreeCheckoutService } from '../../services/payments/cashfreeCheckout.js';
import './CommerceCatalog.css';

const price=value=>value===0?'Free':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(value/100);
export default function CommerceCatalog({kind}) {
  const {slug}=useParams();
  return <MerchantCommerceCatalog key={slug} slug={slug} kind={kind} />;
}

function MerchantCommerceCatalog({slug,kind}) {
  const api=useMemo(()=>publicCommerceService(slug),[slug]);
  const [catalog,setCatalog]=useState(null);
  const [catalogError,setCatalogError]=useState('');
  const [session,setSession]=useState(null);
  const [phone,setPhone]=useState('');
  const [bookingId,setBookingId]=useState('');
  const [challenge,setChallenge]=useState(null);
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [purchases,setPurchases]=useState({orders:[],periods:[]});
  const [sandboxAccepted,setSandboxAccepted]=useState(false);
  const verified=Boolean(session);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    const refresh=()=>api.catalog(controller.signal).then(value=>{if(active){setCatalog(value);setCatalogError('');}}).catch(failure=>{if(active&&failure.name!=='AbortError')setCatalogError(failure.message);});
    const refreshVisible=()=>{if(!document.hidden)refresh();};
    refresh();
    const timer=setInterval(refreshVisible,15000);
    window.addEventListener('focus',refreshVisible);
    api.session().then(value=>{if(active)setSession(value);}).catch(()=>{});
    return()=>{active=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',refreshVisible);};
  },[api]);
  useEffect(()=>{
    if(!verified)return undefined;
    let active=true;
    const refresh=()=>Promise.all([api.session(),api.orders()]).then(([value,orders])=>{if(active){setSession(value);setPurchases(orders);}}).catch(failure=>{if(active&&failure.status===401){setSession(null);setPurchases({orders:[],periods:[]});}});
    refresh();
    const timer=setInterval(()=>{if(!document.hidden)refresh();},15000);
    return()=>{active=false;clearInterval(timer);};
  },[api,verified]);
  const act=async action=>{
    setBusy(true);setError('');setMessage('');
    try {await action();}catch(failure){setError(failure.message);}finally{setBusy(false);}
  };
  const send=event=>{event.preventDefault();act(async()=>{setChallenge(await api.send(phone,kind==='product'?bookingId.trim().toUpperCase():''));setCode('');setMessage('SMS code sent. It expires within 10 minutes.');});};
  const verify=event=>{event.preventDefault();act(async()=>{await api.verify(challenge.challengeId,code);setSession(await api.session());setCode('');setChallenge(null);setMessage('Phone verified. You can continue.');});};
  const request=id=>act(async()=>{await api.requestAccess(id);setSession(await api.session());setMessage('Request saved. Your merchant will review attendance and eligibility.');});
  const openPayment=async order=>{
    let popupError;
    if(order.paymentSessionId){
      try {await cashfreeCheckoutService.openHostedPopup(order);}catch(failure){popupError=failure;}
    }
    const result=order.amountPaise===0?order:await api.refreshOrder(order.id);
    setPurchases(await api.orders());
    if(result.paymentStatus==='succeeded'||result.paymentStatus==='not_required') {
      setMessage(result.fulfilmentStatus==='fulfilled'?'Payment verified. Membership access is active or scheduled after your current period.':result.fulfilmentStatus==='review_required'?'Payment received, but access could not be granted. Calup must review the payment for resolution or refund.':'Claim confirmed. Encrypted product delivery is pending; this sandbox purchase does not yet provide a download.');
    } else if(result.checkoutState==='rejected') throw new Error('Cashfree could not start this checkout. No access was granted. You can start a new purchase.');
    else if(popupError) throw popupError;
    else setMessage('Payment is not confirmed. Check its status below before starting another purchase. Closing checkout does not prove that payment failed.');
  };
  const purchase=item=>act(async()=>{
    const keyName=`calup-commerce-order:${slug}:${item.id}`;
    let key=window.sessionStorage.getItem(keyName);
    if(!key){key=crypto.randomUUID();window.sessionStorage.setItem(keyName,key);}
    const order=await api.checkout(item.id,item.version,key);
    // Keep the key across uncertain HTTP failures; a completed response can be resumed by order ID.
    window.sessionStorage.removeItem(keyName);
    await openPayment(order);
  });
  const items=catalog?.items.filter(item=>item.kind===kind) || [];
  return <main className="commerce-catalog">
    <header><BrandLogo size="md" /><Link to={`/book/${encodeURIComponent(slug)}`}>Back to booking page</Link></header>
    <nav aria-label="Merchant offerings"><Link aria-current={kind==='product'?'page':undefined} to={`/book/${slug}/marketplace`}>Marketplace</Link><Link aria-current={kind==='membership'?'page':undefined} to={`/book/${slug}/memberships`}>Customer memberships</Link></nav>
    <section className="commerce-catalog-intro"><p>{catalog?.merchant.name || 'Merchant catalog'}</p><h1>{kind==='product'?'Resources for your next step':'Keep making progress'}</h1><p>{kind==='product'?'Explore free and paid products. Verify your booking and phone, then request access from your merchant.':'Fixed-period memberships with a choice to renew. No automatic charges or appointment reservations.'}</p></section>
    {(error||catalogError)&&<p className="commerce-catalog-alert" role="alert">{error||catalogError}</p>}{message&&<p role="status" className="commerce-catalog-notice">{message}</p>}
    {!catalog&&!catalogError&&<p role="status">Loading catalog...</p>}
    {catalog&&<>
      {import.meta.env.DEV&&typeof catalog.checkoutEnabled!=='object'&&<p className="commerce-catalog-alert" role="alert">The development backend is running an older checkout version. Stop npm run dev and start it again from the repository root. This page checks for the update automatically.</p>}
      {catalog.merchant.available===false&&<p className="commerce-catalog-notice">New purchases are paused for this merchant. Verify your phone to view existing orders and access periods; use Customer memberships if you do not have a booking ID.</p>}
      {session?<section className="commerce-catalog-verification"><h2>Phone verified</h2><p>{session.maskedPhone} · {session.bookingVerified?'Booking verified':'Membership access verified; products require an eligible booking'}</p><button type="button" disabled={busy} onClick={()=>act(async()=>{await api.logout();setSession(null);setPurchases({orders:[],periods:[]});setMessage('Signed out.');})}>Use another booking or phone</button></section>:<section className="commerce-catalog-verification"><h2>{kind==='product'?'Verify your event booking':'Verify your phone'}</h2><p>{kind==='product'?'Use an ended, paid booking with this merchant. Your merchant will confirm attendance.':'An SMS code protects your membership and payment records. No booking is required.'}</p>
        {!challenge?<form onSubmit={send}>{kind==='product'&&<label>Booking ID<input required pattern="M[0-9]{9}" maxLength={10} placeholder="M123456789" value={bookingId} onChange={event=>setBookingId(event.target.value.toUpperCase())} /></label>}<label>Phone number<input required type="tel" autoComplete="tel" value={phone} onChange={event=>setPhone(event.target.value)} /></label><button disabled={busy}>Send verification SMS</button></form>:<form onSubmit={verify}><p>Enter the code sent to {challenge.maskedPhone}.</p><label>SMS code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,8}" maxLength={8} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} /></label><button disabled={busy}>Verify phone</button><button type="button" disabled={busy} onClick={()=>{setChallenge(null);setCode('');}}>Change details or request another code</button></form>}
      </section>}
      <div className="commerce-catalog-notice"><strong>Sandbox testing only</strong><p>{kind==='product'?'Approved customers can test free claims and Cashfree payments. Encrypted customer delivery is still being connected; orders will show awaiting delivery.':'Verified payments grant fixed-period access. Early renewal extends the same plan after its current expiry. No automatic charges, reserved slots or renewal reminders yet.'}</p><label className="commerce-sandbox-consent"><input type="checkbox" checked={sandboxAccepted} onChange={event=>setSandboxAccepted(event.target.checked)} />I understand this is a sandbox test, not a live purchase.</label></div>
      {!items.length&&<p>No published {kind==='product'?'products':'membership plans'} yet.</p>}
      <div className="commerce-catalog-grid">{items.map(item=>{
        const access=session?.requests.find(value=>value.product_id===item.id);
        return <article key={item.id}><p className="commerce-catalog-price">{price(item.price_paise)}</p><h2>{item.title}</h2><p>{item.description}</p><p>{kind==='product'?`Up to ${item.purchase_limit} purchases or free claims per verified customer`:`${item.duration_days} days of access`}</p>
          {kind==='product'&&(access?<div><strong>Access {access.status}</strong>{access.reason&&<p>{access.reason}</p>}<p>{access.status==='approved'?'Your merchant approved purchase eligibility.':access.status==='pending'?'Waiting for your merchant to review attendance.':'Contact your merchant if you need help with this decision.'}</p></div>:<button type="button" disabled={busy||!session?.bookingVerified} onClick={()=>request(item.id)}>Request access</button>)}
          {(kind==='membership'||access?.status==='approved')&&<button type="button" disabled={busy||!verified||!sandboxAccepted||(item.price_paise>0&&!catalog.checkoutEnabled?.[kind==='product'?'marketplace':'customer_membership'])} onClick={()=>purchase(item)}>{item.price_paise===0?'Test free claim':`Pay ${price(item.price_paise)} in sandbox`}</button>}
          {(kind==='membership'||access?.status==='approved')&&(!verified?<p>Verify your phone above to enable payment.</p>:!sandboxAccepted?<p>Confirm the sandbox testing checkbox above to continue.</p>:null)}
          {item.price_paise>0&&!catalog.checkoutEnabled?.[kind==='product'?'marketplace':'customer_membership']&&<p>Sandbox payments are awaiting merchant configuration.</p>}
        </article>;
      })}</div>
      {session&&<section className="commerce-catalog-verification"><h2>Your orders and access</h2>{!purchases.orders.length&&<p>No orders yet.</p>}{purchases.orders.filter(order=>order.purpose===(kind==='product'?'marketplace':'customer_membership')).map(order=>{
        const period=purchases.periods.find(value=>value.order_id===order.id);
        return <article className="commerce-order" key={order.id}><h3>{order.title}</h3><p>Order {order.id}</p><p>{price(order.amountPaise)} · Payment: {order.paymentStatus.replaceAll('_',' ')} · Access: {order.fulfilmentStatus.replaceAll('_',' ')}</p>{period&&<p>{new Date(period.starts_at)>new Date()?'Scheduled':'Access period'}: {new Date(period.starts_at).toLocaleString()} – {new Date(period.ends_at).toLocaleString()}</p>}{order.fulfilmentStatus==='review_required'&&<p>Payment needs Calup review. Contact support@calup.app with your order ID.</p>}{order.paymentStatus==='pending'&&<div className="commerce-order-actions"><button type="button" disabled={busy} onClick={()=>act(async()=>{await api.refreshOrder(order.id);setPurchases(await api.orders());setMessage('Status checked with the payment provider.');})}>Check payment status</button>{new Date(order.expiresAt)>new Date()&&!['rejected','expired'].includes(order.checkoutState)&&<button type="button" disabled={busy||!sandboxAccepted} onClick={()=>act(async()=>openPayment(await api.openOrder(order.id)))}>Resume checkout</button>}</div>}</article>;
      })}</section>}
    </>}
  </main>;
}
