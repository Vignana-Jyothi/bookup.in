import { CashfreeClient, amountToPaise, toCashfreeTimestamp } from './cashfree.js';
import { config } from '../config.js';

// Independent configuration and CP/CM namespaces; sandbox testing may explicitly reuse one account.
export function commerceGatewaySettings(purpose,env = process.env) {
  if (!['marketplace','customer_membership'].includes(purpose)) throw new Error('INVALID_COMMERCE_PURPOSE');
  const prefix = purpose === 'marketplace' ? 'CASHFREE_MARKETPLACE' : 'CASHFREE_CUSTOMER_MEMBERSHIPS';
  let notifyUrl;
  try {
    const backend=new URL(env.BACKEND_PUBLIC_URL || config.backendPublicUrl);
    if(backend.protocol==='https:'&&!backend.username&&!backend.password) notifyUrl=new URL(`/api/v1/webhooks/cashfree/commerce/${purpose}`,backend.origin).href;
  } catch { /* Without a public tunnel, durable polling still verifies sandbox payments. */ }
  return {enabled:env[`${prefix}_ENABLED`] === 'true',environment:'sandbox',clientId:env[`${prefix}_CLIENT_ID`] || '',clientSecret:env[`${prefix}_CLIENT_SECRET`] || '',apiVersion:config.cashfreeApiVersion,notifyUrl};
}
export function createCommercePayments(purpose,{settings = commerceGatewaySettings(purpose),gateway = new CashfreeClient(settings)} = {}) {
  if (!['marketplace','customer_membership'].includes(purpose)) throw new Error('INVALID_COMMERCE_PURPOSE');
  const prefix = purpose === 'marketplace' ? 'CP' : 'CM';
  function validate(order) {
    if (!settings.enabled || !gateway.isConfigured() || settings.environment !== 'sandbox' || gateway.environment !== 'sandbox') throw new Error('COMMERCE_CHECKOUT_DISABLED');
    if (order.purpose !== purpose || order.currency !== 'INR' || !Number.isSafeInteger(order.amountPaise) || order.amountPaise < 100 ||
      !/^[0-9a-f-]{36}$/i.test(order.id) || !/^[0-9a-f-]{36}$/i.test(order.customerId || '') || order.providerOrderId !== `${prefix}${order.id.replaceAll('-','')}` || order.phoneVerified !== true || !/^[6-9]\d{9}$/.test(order.phone)) throw new Error('INVALID_COMMERCE_ORDER');
  }
  return {
    isEnabled: () => settings.enabled && gateway.isConfigured() && settings.environment === 'sandbox' && gateway.environment === 'sandbox',
    verifyWebhook: input => settings.enabled && settings.environment === 'sandbox' && gateway.environment === 'sandbox' && gateway.verifyWebhookSignature(input),
    async create(order) {
      validate(order);
      // Caller must persist an immutable price/customer/purpose snapshot before dispatch.
      const expires = new Date(order.expiresAt);
      if (!Number.isFinite(expires.getTime()) || expires.getTime() < Date.now()+16*60000 || expires.getTime()>Date.now()+3600000) throw new Error('INVALID_COMMERCE_EXPIRY');
      const result = await gateway.createOrder({order_id:order.providerOrderId,order_amount:order.amountPaise/100,order_currency:'INR',order_expiry_time:toCashfreeTimestamp(expires),
        customer_details:{customer_id:order.customerId,customer_phone:order.phone},...(settings.notifyUrl?{order_meta:{notify_url:settings.notifyUrl}}:{})},order.id);
      if (result.order_id !== order.providerOrderId || result.order_currency !== 'INR' || amountToPaise(result.order_amount) !== order.amountPaise) throw new Error('COMMERCE_PAYMENT_MISMATCH');
      return result;
    },
    async verify(order) {
      validate(order);
      const result = await gateway.getOrder(order.providerOrderId);
      if (result.order_id !== order.providerOrderId || result.order_currency !== 'INR' || amountToPaise(result.order_amount) !== order.amountPaise || result.customer_details?.customer_id !== order.customerId) throw new Error('COMMERCE_PAYMENT_MISMATCH');
      const payments = await gateway.getOrderPayments(order.providerOrderId);
      const paid = payments.find(item => item.payment_status === 'SUCCESS' && item.payment_currency === 'INR' && amountToPaise(item.payment_amount) === order.amountPaise && item.cf_payment_id);
      return {paid:result.order_status === 'PAID' && Boolean(paid),paymentId:paid ? String(paid.cf_payment_id) : null,
        paymentSessionId:result.order_status === 'ACTIVE' && typeof result.payment_session_id === 'string' ? result.payment_session_id : null};
    },
  };
}
