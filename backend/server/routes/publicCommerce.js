import crypto from 'node:crypto';
import { Router } from 'express';
import { serviceRoleClient } from '../middleware/auth.js';
import { customerTrackingLimiter, tokenRouteLimiter } from '../middleware/rateLimiter.js';
import { twoFactorOtpService, normalizeIndianMobile } from '../services/twoFactorOtp.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';
import { customerRequestIsTrusted } from '../utils/customerAccess.js';
import { config } from '../config.js';
import { commerceOrderPayments } from '../services/commerceOrderPayments.js';
import { setRecoveredAttemptCookie } from './cashfreeV1.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const errors={AUTH_REQUIRED:[401,'Verify your phone to continue.'],ACCESS_UNAVAILABLE:[404,'This merchant or item is not available.'],BOOKING_NOT_ELIGIBLE:[422,'Use the phone number from an ended, paid booking with this merchant. Cancelled and no-show bookings are not eligible.'],OTP_RATE_LIMIT:[429,'Wait at least a minute before requesting another code. Hourly SMS limits also apply.'],OTP_EXPIRED:[400,'The verification code expired. Request a new code.'],OTP_BUSY:[409,'A code verification is already in progress.'],OTP_INVALID:[400,'The code is invalid, already used, or has reached its attempt limit.']};
Object.assign(errors,{COMMERCE_CHECKOUT_DISABLED:[503,'Sandbox payments are not configured for this offering yet.'],NOT_FOUND:[404,'Order not found.'],VERSION_CONFLICT:[409,'The listing changed. Refresh and review the new price before paying.'],IDEMPOTENCY_CONFLICT:[409,'This retry belongs to another purchase. Check your orders.'],ORDER_ACTIVE:[409,'A payment is already open for this item. Resume it or check its status below.'],ORDER_RATE_LIMIT:[429,'Too many orders. Please wait before trying again.'],PURCHASE_LIMIT:[409,'Your purchase allowance for this product has been reached.'],APPROVAL_REQUIRED:[403,'Your merchant must approve product access before purchase.']});
errors.RESERVATION_EXPIRED=[409,'This purchase reservation expired. Start a new checkout after checking your orders.'];
export function commerceError(res,error) {
  const [status,message]=errors[error?.message] || [503,'This service is temporarily unavailable. Please retry.'];
  return res.status(status).json({error:message});
}
function cookie(req,name) {
  const pair=String(req.headers.cookie || '').split(';').find(value=>value.trim().startsWith(`${name}=`));
  try {return pair ? decodeURIComponent(pair.trim().slice(name.length+1)) : '';} catch {return '';}
}
function setCookie(res,name,value,seconds) {
  res.append('Set-Cookie',`${name}=${encodeURIComponent(value)}; Path=/api/v1/public/commerce; HttpOnly; Max-Age=${seconds}; SameSite=${process.env.NODE_ENV==='production' ? 'None; Secure' : 'Lax'}`);
}
const check=result=>{if(result.error) throw result.error;return result.data;};
export function createPublicCommerceRouter({client=serviceRoleClient,otp=twoFactorOtpService,trusted=customerRequestIsTrusted,payments=commerceOrderPayments}={}) {
  const router=Router();
  router.use(tokenRouteLimiter);
  router.use('/:slug',(req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    if(!/^[a-z0-9][a-z0-9-]{0,99}$/i.test(req.params.slug)) return res.status(404).json({error:'Merchant not found.'});
    if(!client) return res.status(503).json({error:'Commerce storage is unavailable.'});
    if(req.method!=='GET' && !trusted(req)) return res.status(403).json({error:'Open this page from the Calup website.'});
    next();
  });
  const session=async req=>{
    const token=cookie(req,'calup_commerce_access');
    if(!/^[a-f0-9]{64}$/.test(token)) throw new Error('AUTH_REQUIRED');
    const value=check(await client.rpc('commerce_session_v1',{p_hash:hash(token),p_slug:req.params.slug}));
    if(!value) throw new Error('AUTH_REQUIRED');
    return {...value,hash:hash(token)};
  };
  router.get('/:slug/catalog',async(req,res,next)=>{
    try {
      const merchant=check(await client.from('providers').select('id,name,business_name,slug').eq('slug',req.params.slug).maybeSingle());
      if(!merchant) throw new Error('ACCESS_UNAVAILABLE');
      const available=Boolean(check(await client.rpc('commerce_merchant_active_v1',{p_provider:merchant.id})));
      const items=available?check(await client.from('merchant_commerce_catalog').select('id,kind,title,description,price_paise,currency,purchase_limit,duration_days,version').eq('provider_id',merchant.id).eq('status','published').order('created_at',{ascending:false}).limit(100)):[];
      res.json({data:{merchant:{name:merchant.business_name || merchant.name,slug:merchant.slug,available},items,checkoutEnabled:{marketplace:available&&payments.enabled('marketplace'),customer_membership:available&&payments.enabled('customer_membership')},cashfreeMode:'sandbox'}});
    } catch(error) {next(error);}
  });
  router.post('/:slug/otp/send',customerTrackingLimiter,async(req,res,next)=>{
    const body=req.body || {};
    if(Object.keys(body).some(key=>!['phone','bookingId'].includes(key)) || typeof body.phone!=='string' || (body.bookingId!==undefined && !/^M\d{9}$/.test(body.bookingId))) return res.status(422).json({error:'Enter a valid phone number and booking ID.'});
    let id;
    try {
      const phone=normalizeIndianMobile(body.phone);
      const ipHash=crypto.createHmac('sha256',config.tokenEncryptionKey).update(`commerce-ip:${req.ip}`).digest('hex');
      id=check(await client.rpc('begin_commerce_otp_v1',{p_slug:req.params.slug,p_phone:phone,p_booking_reference:body.bookingId || null,p_ip_hash:ipHash}));
      const result=await otp.sendOtp(phone);
      check(await client.rpc('operate_commerce_otp_v1',{p_id:id,p_action:'sent',p_session:encryptToken(result.sessionId)}));
      setCookie(res,'calup_commerce_challenge',encryptToken(JSON.stringify({id,slug:req.params.slug,expires:Date.now()+600000})),600);
      res.json({data:{challengeId:id,maskedPhone:`******${phone.slice(-4)}`,retryAfter:60}});
    } catch(error) {
      if(id) {try {await client.rpc('operate_commerce_otp_v1',{p_id:id,p_action:'failed'});} catch { /* Reservation expires without granting access. */ }}
      if(error?.code==='PHONE_INVALID') return res.status(422).json({error:'Enter a valid Indian mobile number.'});
      next(error);
    }
  });
  router.post('/:slug/otp/verify',customerTrackingLimiter,async(req,res,next)=>{
    const {challengeId,code}=req.body || {};
    if(!uuid.test(challengeId || '') || typeof code!=='string' || !/^\d{4,8}$/.test(code) || Object.keys(req.body).some(key=>!['challengeId','code'].includes(key))) return res.status(422).json({error:'Enter the SMS verification code.'});
    let challenge;
    try {challenge=JSON.parse(decryptToken(cookie(req,'calup_commerce_challenge')));} catch {return res.status(401).json({error:'Request a new verification code in this browser.'});}
    if(challenge.id!==challengeId || challenge.slug!==req.params.slug || challenge.expires<Date.now()) return res.status(401).json({error:'Request a new verification code in this browser.'});
    const owner=crypto.randomUUID();
    try {
      const reserved=check(await client.rpc('operate_commerce_otp_v1',{p_id:challengeId,p_action:'reserve_verify',p_owner:owner}));
      let verified;
      try {verified=Boolean((await otp.verifyOtp(decryptToken(reserved.encryptedSession),code)).verified);} catch(error) {
        await client.rpc('operate_commerce_otp_v1',{p_id:challengeId,p_action:'finish_verify',p_owner:owner,p_verified:false});throw error;
      }
      const token=crypto.randomBytes(32).toString('hex');
      const result=check(await client.rpc('operate_commerce_otp_v1',{p_id:challengeId,p_action:'finish_verify',p_owner:owner,p_verified:verified,p_token_hash:verified ? hash(token) : null}));
      if(!result.verified) throw new Error('OTP_INVALID');
      setCookie(res,'calup_commerce_access',token,1800);
      setCookie(res,'calup_commerce_challenge','',0);
      res.json({data:{verified:true}});
    } catch(error) {next(error);}
  });
  router.get('/:slug/session',async(req,res,next)=>{
    try {
      const current=await session(req);
      const requests=check(await client.from('commerce_access_requests').select('id,product_id,status,version,reason,created_at').eq('contact_id',current.contactId).order('created_at',{ascending:false}).limit(100));
      res.json({data:{maskedPhone:current.maskedPhone,bookingVerified:Boolean(current.bookingId),requests}});
    } catch(error) {next(error);}
  });
  router.get('/:slug/booking-payments',async(req,res,next)=>{
    try {
      const current=await session(req);
      const attempts=check(await client.rpc('get_verified_booking_payments_v1',{p_hash:current.hash,p_slug:req.params.slug}));
      res.json({data:{maskedPhone:current.maskedPhone,attempts}});
    } catch(error) {next(error);}
  });
  router.post('/:slug/booking-payments/:id/open',async(req,res,next)=>{
    if(!uuid.test(req.params.id) || Object.keys(req.body || {}).length) return res.status(422).json({error:'Select a payment. No phone or payment evidence is accepted here.'});
    try {
      const current=await session(req);
      const owned=check(await client.rpc('get_verified_booking_payments_v1',{p_hash:current.hash,p_slug:req.params.slug,p_attempt_id:req.params.id}));
      setRecoveredAttemptCookie(res,owned);
      res.json({data:{opened:true}});
    } catch(error) {next(error);}
  });
  router.post('/:slug/items/:id/access',async(req,res,next)=>{
    if(!uuid.test(req.params.id) || Object.keys(req.body || {}).length) return res.status(422).json({error:'Select a valid product. No customer identity fields are accepted.'});
    try {
      const current=await session(req);
      const result=check(await client.rpc('request_commerce_access_v1',{p_hash:current.hash,p_slug:req.params.slug,p_product:req.params.id}));
      res.json({data:result});
    } catch(error) {next(error);}
  });
  router.post('/:slug/logout',async(req,res,next)=>{
    try {
      const token=cookie(req,'calup_commerce_access');
      if(/^[a-f0-9]{64}$/.test(token)) check(await client.from('commerce_customer_sessions').delete().eq('token_hash',hash(token)));
      setCookie(res,'calup_commerce_access','',0);res.json({data:{signedOut:true}});
    } catch(error) {next(error);}
  });
  router.get('/:slug/orders',async(req,res,next)=>{
    try {
      const current=await session(req);
      const orders=check(await client.from('commerce_orders').select('*').eq('contact_id',current.contactId).order('created_at',{ascending:false}).limit(50));
      const periods=check(await client.from('commerce_membership_periods').select('order_id,plan_id,starts_at,ends_at').eq('contact_id',current.contactId).order('ends_at',{ascending:false}).limit(100));
      res.json({data:{orders:orders.map(payments.publicOrder),periods}});
    } catch(error) {next(error);}
  });
  router.post('/:slug/items/:id/checkout',async(req,res,next)=>{
    const body=req.body || {};
    if(!uuid.test(req.params.id) || !Number.isInteger(body.version) || body.version<1 || typeof body.requestKey!=='string' || !/^[A-Za-z0-9_-]{16,128}$/.test(body.requestKey) || body.sandboxAcknowledged!==true || Object.keys(body).some(key=>!['version','requestKey','sandboxAcknowledged'].includes(key))) return res.status(422).json({error:'Review the listing and acknowledge sandbox testing before continuing.'});
    try {
      const current=await session(req);
      const item=check(await client.from('merchant_commerce_catalog').select('kind,price_paise').eq('id',req.params.id).eq('provider_id',current.providerId).maybeSingle());
      if(!item) throw new Error('ACCESS_UNAVAILABLE');
      if(item.price_paise>0 && !payments.enabled(item.kind==='product'?'marketplace':'customer_membership')) throw new Error('COMMERCE_CHECKOUT_DISABLED');
      const order=check(await client.rpc('begin_commerce_order_v1',{p_hash:current.hash,p_slug:req.params.slug,p_item:req.params.id,p_version:body.version,p_key:body.requestKey}));
      res.json({data:order.amount_paise===0?payments.publicOrder(order):await payments.checkout(order.id,current.contactId)});
    } catch(error) {next(error);}
  });
  router.post('/:slug/orders/:id/:action',async(req,res,next)=>{
    if(!uuid.test(req.params.id) || !['open','refresh'].includes(req.params.action) || Object.keys(req.body || {}).length) return res.status(422).json({error:'Select a valid order action. No payment evidence is accepted from the browser.'});
    try {
      const current=await session(req);
      let order=await payments.owned(req.params.id,current.contactId);
      if(req.params.action==='open' && order.amount_paise>0) return res.json({data:await payments.checkout(order.id,current.contactId)});
      if(order.payment_status==='pending') await payments.reconcile(order.id);
      order=await payments.owned(req.params.id,current.contactId);
      res.json({data:payments.publicOrder(order)});
    } catch(error) {next(error);}
  });
  router.use((error,_req,res,_next)=>commerceError(res,error));
  return router;
}

export function createCommerceWebhookRouter({client=serviceRoleClient,payments=commerceOrderPayments}={}) {
  const router=Router();
  router.post('/:purpose',async(req,res)=>{
    const purpose=req.params.purpose;
    const gateway=payments.gateways[purpose];
    const timestamp=String(req.headers['x-webhook-timestamp'] || '');
    if(!/^\d{13}$/.test(timestamp) || Math.abs(Date.now()-Number(timestamp))>300000 || !gateway?.verifyWebhook({rawBody:req.body,timestamp,signature:req.headers['x-webhook-signature']})) return res.status(401).json({error:'Invalid webhook signature.'});
    try {
      const input=JSON.parse(req.body.toString('utf8'));
      const id=input?.data?.order?.order_id;
      if(typeof id!=='string' || !/^(CP|CM)[a-f0-9]{32}$/i.test(id)) return res.status(422).json({error:'Invalid order reference.'});
      const order=check(await client.from('commerce_orders').select('id').eq('provider_order_id',id).eq('purpose',purpose).maybeSingle());
      if(order) await payments.reconcile(order.id);
      // The callback is only a wake-up signal; server API evidence is authoritative.
      res.json({received:true});
    } catch {res.status(503).json({error:'Webhook verification will retry.'});}
  });
  return router;
}
