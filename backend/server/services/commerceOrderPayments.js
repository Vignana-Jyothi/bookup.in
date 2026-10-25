import crypto from 'node:crypto';
import { serviceRoleClient } from '../middleware/auth.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';
import { createCommercePayments } from './commerceCashfree.js';

const check = result => { if (result.error) throw result.error; return result.data; };
export function createCommerceOrderPayments({client = serviceRoleClient, gateways = {
  marketplace: createCommercePayments('marketplace'), customer_membership: createCommercePayments('customer_membership'),
}} = {}) {
  const enabled = purpose => Boolean(gateways[purpose]?.isEnabled());
  const publicOrder = order => ({id:order.id,itemId:order.item_id,title:order.title,purpose:order.purpose,
    amountPaise:order.amount_paise,currency:order.currency,checkoutState:order.checkout_state,paymentStatus:order.payment_status,
    fulfilmentStatus:order.fulfilment_status,expiresAt:order.expires_at,createdAt:order.created_at});
  async function reconcile(id) {
    const owner = crypto.randomUUID();
    const claim = check(await client.rpc('operate_commerce_order_v1',{p_id:id,p_action:'claim',p_owner:owner}));
    if (!claim) return;
    const gateway = gateways[claim.purpose];
    const finish = (action, extra = {}) => client.rpc('operate_commerce_order_v1',{
      p_id:id,p_action:action,p_owner:owner,p_generation:claim.generation,...extra,
    }).then(check);
    try {
      if (!enabled(claim.purpose)) {await finish('pending');return;}
      const contact = check(await client.from('commerce_contacts').select('phone').eq('id',claim.contact_id).single());
      const snapshot = {id:claim.id,purpose:claim.purpose,currency:claim.currency,amountPaise:Number(claim.amount_paise),
        customerId:claim.contact_id,phone:contact.phone,phoneVerified:true,providerOrderId:claim.provider_order_id,expiresAt:claim.gateway_expires_at};
      if (claim.dispatch) {
        let result;
        try {result = await gateway.create(snapshot);} catch (error) {
          // Only a definitive provider HTTP rejection releases immediately. Timeouts are lookup-only.
          await finish(error.outcome === 'definitive' && error.status >= 400 && error.status < 500 && error.status !== 409 ? 'rejected' : 'pending');
          return;
        }
        await finish('ready',{p_session:encryptToken(result.payment_session_id)});
      } else {
        const result = await gateway.verify(snapshot);
        if (result.paid) await finish('success',{p_payment:result.paymentId});
        else if (result.paymentSessionId && new Date(claim.expires_at).getTime() > Date.now() && claim.checkout_state !== 'rejected') {
          await finish('ready',{p_session:encryptToken(result.paymentSessionId)});
        } else await finish('pending');
      }
    } catch {
      // Includes GET-404 after an unknown creation, database/network errors and mismatched evidence.
      // Never replay an uncertain create or trust a popup's claim of success.
      try {await finish('pending');} catch { /* Expired leases are reclaimed by the worker. */ }
    }
  }
  async function owned(id, contactId) {
    const order = check(await client.from('commerce_orders').select('*').eq('id',id).eq('contact_id',contactId).maybeSingle());
    if (!order) throw new Error('NOT_FOUND');
    return order;
  }
  async function checkout(id, contactId) {
    let order = await owned(id,contactId);
    if (!enabled(order.purpose)) throw new Error('COMMERCE_CHECKOUT_DISABLED');
    if (order.payment_status === 'pending') await reconcile(id);
    order = await owned(id,contactId);
    const data = publicOrder(order);
    if (order.checkout_state === 'ready' && order.payment_status === 'pending' && new Date(order.expires_at).getTime() > Date.now()) {
      data.paymentSessionId = decryptToken(order.encrypted_session);
      data.cashfreeMode = 'sandbox';
    }
    return data;
  }
  async function cycle() {
    if (!client || !Object.keys(gateways).some(enabled)) return;
    const orders = check(await client.from('commerce_orders').select('id,purpose').eq('payment_status','pending')
      .in('purpose',Object.keys(gateways).filter(enabled)).lte('next_check_at',new Date().toISOString()).order('next_check_at').limit(25));
    for (const order of orders || []) if (enabled(order.purpose)) await reconcile(order.id);
  }
  return {enabled,publicOrder,reconcile,owned,checkout,cycle,gateways};
}

export const commerceOrderPayments = createCommerceOrderPayments();
let timer;
export function startCommercePaymentWorker() {
  if (timer || !['marketplace','customer_membership'].some(commerceOrderPayments.enabled)) return;
  let running = false;
  const cycle = async () => {
    if (running) return;
    running = true;
    try {await commerceOrderPayments.cycle();} catch {console.warn('[CommercePayments] Reconciliation will retry.');}
    finally {running = false;}
  };
  timer = setInterval(cycle,30000); timer.unref?.(); setImmediate(cycle);
}
