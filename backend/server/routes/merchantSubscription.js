import crypto from 'crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';
import { amountToPaise, cashfreeClient, cashfreeOrderExpiry, verifiedSuccessfulPayment, assertCashfreeOrder } from '../services/cashfree.js';

const router = Router();

function requestId(req) {
  return req.headers['x-request-id'] || crypto.randomUUID();
}

function dataResponse(res, status, data, reqId) {
  return res.status(status).json({ data, meta: { requestId: reqId, serverTime: new Date().toISOString() } });
}

function errorResponse(res, status, code, message, reqId, details) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: reqId } });
}

function rpcValue(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits;
}

function databaseError(res, reqId, error) {
  const message = String(error?.message || '');
  if (message.includes('VERSION_CONFLICT')) return errorResponse(res, 409, 'VERSION_CONFLICT', 'Billing details changed. Reload and try again.', reqId);
  if (message.includes('IDEMPOTENCY_CONFLICT')) return errorResponse(res, 409, 'IDEMPOTENCY_CONFLICT', 'This retry does not match the original request.', reqId);
  if (message.includes('BILLING_PROFILE_REQUIRED')) return errorResponse(res, 422, 'BILLING_PROFILE_REQUIRED', 'Save your billing details before continuing.', reqId);
  if (message.includes('RENEWAL_TOO_EARLY')) return errorResponse(res, 409, 'RENEWAL_TOO_EARLY', 'Renewal opens seven days before expiry.', reqId);
  if (message.includes('PERIOD_NOT_CANCELLABLE')) return errorResponse(res, 409, 'PERIOD_NOT_CANCELLABLE', 'This prepaid period is already active, cancelled, or unavailable.', reqId);
  if (message.includes('PLAN_UNAVAILABLE')) return errorResponse(res, 409, 'PLAN_UNAVAILABLE', 'The selected plan is unavailable.', reqId);
  if (message.includes('INVALID_ACCESS_CODE') || message.includes('ACCESS_CODE_UNAVAILABLE')) {
    return errorResponse(res, 422, 'ACCESS_CODE_UNAVAILABLE', 'This access code is invalid, expired, or unavailable.', reqId);
  }
  if (message.includes('ACCESS_CODE_ALREADY_REDEEMED')) return errorResponse(res, 409, 'ACCESS_CODE_ALREADY_REDEEMED', 'This access code was already redeemed.', reqId);
  console.error('[Subscription] Database operation failed', { requestId: reqId, code: error?.code, message: error?.message });
  return errorResponse(res, 503, 'SERVICE_TEMPORARILY_UNAVAILABLE', 'Subscription information is temporarily unavailable.', reqId);
}

async function subscriptionProjection(providerId) {
  const [subscriptionResult, cancellationResult] = await Promise.all([
    serviceRoleClient.rpc('get_merchant_subscription_v1', { p_provider_id: providerId }),
    serviceRoleClient.rpc('get_subscription_cancellation_v1', { p_provider_id: providerId }),
  ]);
  if (subscriptionResult.error) throw subscriptionResult.error;
  if (cancellationResult.error) throw cancellationResult.error;
  return { ...rpcValue(subscriptionResult.data), cancellation: rpcValue(cancellationResult.data) };
}

function assertSubscriptionCashfreeScope(context, client = cashfreeClient) {
  if (!['sandbox', 'production'].includes(context?.environment) || context.environment !== client.environment
    || context.gatewayAccount !== 'calup_subscription' || context.purpose !== 'subscription' || context.paymentPath !== 'cashfree') {
    throw new Error('SUBSCRIPTION_GATEWAY_SCOPE_MISMATCH');
  }
}

function subscriptionRefundStatus(value) {
  if (value === 'SUCCESS') return 'succeeded';
  if (value === 'PENDING' || value === 'ONHOLD') return 'processing';
  if (value === 'CANCELLED') return 'rejected';
  return 'review_required';
}

export async function reconcileSubscriptionRefund(refundId, { database = serviceRoleClient, client = cashfreeClient } = {}) {
  const { data, error } = await database.rpc('get_subscription_refund_context_v1', { p_refund_id: refundId });
  if (error || !data) throw error || new Error('Subscription refund context missing');
  const context = rpcValue(data);
  assertSubscriptionCashfreeScope(context, client);
  if (!context.providerOrderId) throw new Error('Cashfree order reference missing');
  if (context.status === 'succeeded') return context.providerId;
  const gatewayRefundId = context.providerRefundId || `subref_${String(refundId).replace(/-/g, '')}`;
  const mark = async (status, safeError = null) => {
    const { error: markError } = await database.rpc('mark_subscription_refund_v1', {
      p_refund_id: refundId, p_status: status, p_provider_refund_id: gatewayRefundId, p_safe_error: safeError,
    });
    if (markError) throw markError;
  };
  if (!Number.isSafeInteger(Number(context.amountPaise)) || Number(context.amountPaise) <= 0) {
    await mark('review_required', 'REFUND_AMOUNT_INVALID');
    throw new Error('Subscription refund amount is invalid');
  }
  let createError;
  if (context.status === 'requested') {
    try {
      await client.createRefund(context.providerOrderId, {
        refund_amount: Number(context.amountPaise) / 100,
        refund_id: gatewayRefundId,
        refund_note: 'Unused prepaid Calup subscription period cancelled',
        refund_speed: 'STANDARD',
      });
    } catch (gatewayError) { createError = gatewayError; }
  }
  let refund;
  try {
    // A POST timeout/duplicate/acknowledgement never establishes financial truth.
    refund = await client.getRefund(context.providerOrderId, gatewayRefundId);
  } catch (gatewayError) {
    const rejected = createError?.outcome === 'definitive' && createError.status !== 409 && gatewayError.status === 404;
    await mark(rejected ? 'failed' : 'submitted', gatewayError?.code || 'CASHFREE_REFUND_UNKNOWN');
    throw gatewayError;
  }
  // Subscription prices and invoices are constrained to INR by schema.
  if (refund?.order_id !== context.providerOrderId || refund?.refund_id !== gatewayRefundId || refund?.refund_currency !== 'INR'
    || amountToPaise(refund?.refund_amount) !== Number(context.amountPaise)) {
    await mark('review_required', 'REFUND_IDENTITY_MISMATCH');
    throw new Error('Subscription refund identity mismatch');
  }
  await mark(subscriptionRefundStatus(refund.refund_status));
  return context.providerId;
}

export async function reconcileSubscriptionOrder(orderId, { database = serviceRoleClient, client = cashfreeClient, project = subscriptionProjection } = {}) {
  const { data: contextData, error: contextError } = await database.rpc('get_subscription_reconciliation_context_v1', {
    p_subscription_order_id: orderId,
  });
  if (contextError || !contextData) throw contextError || new Error('Subscription reconciliation context missing');
  const context = rpcValue(contextData);
  assertSubscriptionCashfreeScope(context, client);
  if (!context.providerOrderId) return project(context.providerId);

  // A 404 can race an in-flight create; keep unknown creation recoverable.
  const order = await client.getOrder(context.providerOrderId);
  assertCashfreeOrder(context, order);
  if (context.paymentStatus === 'creation_unknown' && order.payment_session_id) {
    const { error } = await database.rpc('mark_subscription_cashfree_order_created_v1', {
      p_subscription_order_id: orderId,
      p_provider_order_id: context.providerOrderId,
      p_payment_session_id: order.payment_session_id,
    });
    if (error) throw error;
  }
  if (order.order_status !== 'PAID') return project(context.providerId);

  const payments = await client.getOrderPayments(context.providerOrderId);
  const payment = verifiedSuccessfulPayment(context, order, payments);
  if (!payment) return project(context.providerId);
  const paidPaise = amountToPaise(payment.payment_amount);
  const { data, error } = await database.rpc('finalize_subscription_payment_v1', {
    p_subscription_order_id: orderId,
    p_provider_order_id: context.providerOrderId,
    p_provider_payment_id: String(payment.cf_payment_id),
    p_paid_amount_paise: paidPaise,
    p_currency: order.order_currency,
    p_paid_at: payment.payment_time || new Date().toISOString(),
    p_source: 'cashfree_lookup',
  });
  if (error) throw error;
  return rpcValue(data);
}

router.use(requireProviderAuth);

router.get('/', async (req, res) => {
  const reqId = requestId(req);
  res.set('Cache-Control', 'private, no-store');
  if (!serviceRoleClient) return errorResponse(res, 503, 'SERVICE_TEMPORARILY_UNAVAILABLE', 'Subscription storage is unavailable.', reqId);
  try {
    return dataResponse(res, 200, await subscriptionProjection(req.providerId), reqId);
  } catch (error) {
    return databaseError(res, reqId, error);
  }
});

router.put('/billing-profile', async (req, res) => {
  const reqId = requestId(req);
  res.set('Cache-Control', 'private, no-store');
  const body = req.body || {};
  const legalName = String(body.legalName || '').trim();
  const addressLine1 = String(body.addressLine1 || '').trim();
  const addressLine2 = String(body.addressLine2 || '').trim();
  const city = String(body.city || '').trim();
  const state = String(body.state || '').trim();
  const postalCode = String(body.postalCode || '').trim();
  const gstin = String(body.gstin || '').trim().toUpperCase();
  if (legalName.length < 2 || addressLine1.length < 5 || city.length < 2 || state.length < 2 || !/^[1-9]\d{5}$/.test(postalCode)) {
    return errorResponse(res, 422, 'VALIDATION_FAILED', 'Enter complete legal billing details and a valid six-digit postal code.', reqId);
  }
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return errorResponse(res, 422, 'VALIDATION_FAILED', 'Enter a valid GSTIN or leave it blank.', reqId);
  }
  const expectedVersion = body.version === null || body.version === undefined ? null : Number(body.version);
  const { data, error } = await serviceRoleClient.rpc('update_merchant_billing_profile_v1', {
    p_provider_id: req.providerId,
    p_expected_version: Number.isSafeInteger(expectedVersion) ? expectedVersion : null,
    p_legal_name: legalName,
    p_address_line1: addressLine1,
    p_address_line2: addressLine2,
    p_city: city,
    p_state: state,
    p_postal_code: postalCode,
    p_gstin: gstin,
  });
  if (error) return databaseError(res, reqId, error);
  return dataResponse(res, 200, rpcValue(data), reqId);
});

router.post('/orders', async (req, res) => {
  const reqId = requestId(req);
  res.set('Cache-Control', 'private, no-store');
  if (!config.isCashfreeConfigured()) return errorResponse(res, 503, 'PAYMENTS_UNAVAILABLE', 'Subscription payments are temporarily unavailable.', reqId);
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  const planId = String(req.body?.planId || '').trim();
  if (!/^[A-Za-z0-9._~-]{8,128}$/.test(idempotencyKey) || !/^[0-9a-f-]{36}$/i.test(planId)) {
    return errorResponse(res, 422, 'VALIDATION_FAILED', 'A valid plan and idempotency key are required.', reqId);
  }
  const requestHash = sha256(JSON.stringify({ planId }));
  const { data, error } = await serviceRoleClient.rpc('create_subscription_order_v1', {
    p_provider_id: req.providerId,
    p_plan_id: planId,
    p_environment: config.cashfreeEnvironment,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
  });
  if (error) return databaseError(res, reqId, error);
  let localOrder = rpcValue(data);
  let context;
  try {
    const contextResult = await serviceRoleClient.rpc('get_subscription_reconciliation_context_v1', {
      p_subscription_order_id: localOrder.orderId,
    });
    if (contextResult.error) return databaseError(res, reqId, contextResult.error);
    context = rpcValue(contextResult.data);
    assertSubscriptionCashfreeScope(context);
    if (context.providerId !== req.providerId) throw new Error('SUBSCRIPTION_GATEWAY_SCOPE_MISMATCH');
  } catch {
    return errorResponse(res, 503, 'CHECKOUT_UNAVAILABLE', 'This payment configuration needs verification. Check payment status before retrying.', reqId);
  }
  const checkoutExpired = () => {
    const deadline = Date.parse(context.expiresAt);
    return !Number.isFinite(deadline) || deadline <= Date.now();
  };
  const expiredResponse = () => errorResponse(res, 410, 'HOLD_EXPIRED', 'This payment checkout has expired. Check payment status before starting a new checkout.', reqId);
  if (localOrder.paymentSessionId || context.providerOrderId) {
    // A resumed checkout needs a current provider session, not a cached handoff token.
    try {
      if (!context.providerOrderId) {
        return errorResponse(res, 503, 'CHECKOUT_UNAVAILABLE', 'Could not restore this payment. Check payment status before retrying.', reqId);
      }
      const gatewayOrder = await cashfreeClient.getOrder(context.providerOrderId);
      assertCashfreeOrder({ ...localOrder, providerOrderId: context.providerOrderId }, gatewayOrder);
      if (gatewayOrder.order_status !== 'ACTIVE' || !gatewayOrder.payment_session_id) {
        await reconcileSubscriptionOrder(localOrder.orderId);
        return dataResponse(res, 202, { ...localOrder, paymentSessionId: null, gatewayReconciling: true, cashfreeMode: config.cashfreeEnvironment }, reqId);
      }
      if (checkoutExpired()) return expiredResponse();
      return dataResponse(res, 200, { ...localOrder, paymentSessionId: gatewayOrder.payment_session_id, cashfreeMode: config.cashfreeEnvironment }, reqId);
    } catch (error) {
      console.error('[Subscription] Checkout restore failed', { requestId: reqId, status: error?.status, code: error?.code });
      return errorResponse(res, 503, 'CHECKOUT_UNAVAILABLE', 'Cashfree checkout could not be restored. Check payment status and try again.', reqId);
    }
  }

  if (checkoutExpired()) return expiredResponse();
  const phone = normalizedPhone(req.provider.phone || req.user?.phone || req.user?.user_metadata?.phone);
  const email = String(req.provider.email || req.user?.email || '').trim().toLowerCase();
  if (!/^[6-9]\d{9}$/.test(phone) || !email) {
    return errorResponse(res, 422, 'MERCHANT_CONTACT_REQUIRED', 'Add a valid merchant phone number and email in Settings before payment.', reqId);
  }

  const providerOrderId = `calup_sub_${String(localOrder.paymentOrderId).replace(/-/g, '')}`;
  const dispatch = await serviceRoleClient.rpc('begin_cashfree_order_dispatch_v1', {
    p_payment_order_id: localOrder.paymentOrderId, p_provider_order_id: providerOrderId,
  });
  if (dispatch.error) return databaseError(res, reqId, dispatch.error);
  if (dispatch.data !== true) {
    try { await reconcileSubscriptionOrder(localOrder.orderId); } catch { /* Another dispatcher may still be creating the order. */ }
    return dataResponse(res, 202, { ...localOrder, paymentSessionId: null, gatewayReconciling: true, cashfreeMode: config.cashfreeEnvironment }, reqId);
  }
  try {
    const cashfreeOrder = await cashfreeClient.createOrder({
      order_id: providerOrderId,
      order_amount: localOrder.amountPaise / 100,
      order_currency: localOrder.currency,
      customer_details: {
        customer_id: `merchant_${String(req.providerId).replace(/-/g, '')}`,
        customer_name: req.provider.name || 'Calup merchant',
        customer_email: email,
        customer_phone: phone,
      },
      order_expiry_time: cashfreeOrderExpiry(localOrder.expiresAt),
      order_meta: { notify_url: `${config.backendPublicUrl}/api/v1/webhooks/cashfree/payments` },
      order_note: 'Calup 30-day subscription',
      order_tags: { purpose: 'subscription', subscription_order_id: localOrder.orderId },
    }, `subscription:${localOrder.paymentOrderId}`);
    assertCashfreeOrder({ ...localOrder, providerOrderId }, cashfreeOrder);
    const { data: marked, error: markError } = await serviceRoleClient.rpc('mark_subscription_cashfree_order_created_v1', {
      p_subscription_order_id: localOrder.orderId,
      p_provider_order_id: cashfreeOrder.order_id,
      p_payment_session_id: cashfreeOrder.payment_session_id,
    });
    if (markError) throw markError;
    localOrder = rpcValue(marked);
    if (checkoutExpired()) return expiredResponse();
    return dataResponse(res, 201, { ...localOrder, cashfreeMode: config.cashfreeEnvironment }, reqId);
  } catch (gatewayError) {
    const rejected = gatewayError?.outcome === 'definitive' && gatewayError.status >= 400
      && gatewayError.status < 500 && gatewayError.status !== 409;
    if (!rejected) {
      // The committed dispatch reference survives timeouts and post-create DB failures.
      return dataResponse(res, 202, { ...localOrder, paymentSessionId: null, paymentStatus: 'creation_unknown', gatewayReconciling: true, cashfreeMode: config.cashfreeEnvironment }, reqId);
    }
    await serviceRoleClient.rpc('fail_subscription_order_creation_v1', {
      p_subscription_order_id: localOrder.orderId,
      p_safe_error_code: gatewayError?.code || 'ORDER_CREATION_FAILED',
    });
    console.error('[Subscription] Cashfree create order failed', { requestId: reqId, status: gatewayError?.status, code: gatewayError?.code });
    return errorResponse(res, 503, 'PAYMENTS_UNAVAILABLE', 'Cashfree could not start this subscription payment. Please try again.', reqId);
  }
});

async function refreshOrder(req, res) {
  const reqId = requestId(req);
  res.set('Cache-Control', 'private, no-store');
  const orderId = String(req.params.id || '');
  const { data: contextData, error: contextError } = await serviceRoleClient.rpc('get_subscription_reconciliation_context_v1', {
    p_subscription_order_id: orderId,
  });
  const context = rpcValue(contextData);
  if (contextError || !context || context.providerId !== req.providerId) {
    return errorResponse(res, 404, 'NOT_FOUND', 'Subscription order was not found.', reqId);
  }
  try {
    const projection = await reconcileSubscriptionOrder(orderId);
    const latest = await serviceRoleClient.rpc('get_subscription_reconciliation_context_v1', { p_subscription_order_id: orderId });
    if (latest.error) throw latest.error;
    const requested = rpcValue(latest.data);
    if (!requested || requested.providerId !== req.providerId) throw new Error('Subscription order ownership unavailable');
    return dataResponse(res, 200, { ...projection, requestedOrder: {
      orderId, paymentStatus: requested.paymentStatus, applicationStatus: requested.applicationStatus,
    } }, reqId);
  } catch (error) {
    console.error('[Subscription] Reconciliation failed', { requestId: reqId, orderId, error: error?.code || error?.message });
    return dataResponse(res, 202, { ...(await subscriptionProjection(req.providerId)), gatewayReconciling: true }, reqId);
  }
}

router.post('/orders/:id/refresh', refreshOrder);
router.post('/orders/:id/checkout-ended', refreshOrder);

router.post('/access-code-redemptions', async (req, res) => {
  const reqId = requestId(req);
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{8,64}$/.test(code)) return errorResponse(res, 422, 'VALIDATION_FAILED', 'Enter a valid Calup access code.', reqId);
  const { data, error } = await serviceRoleClient.rpc('redeem_access_code_v1', { p_provider_id: req.providerId, p_code: code });
  if (error) return databaseError(res, reqId, error);
  return dataResponse(res, 200, rpcValue(data), reqId);
});

router.post('/periods/:periodId/cancellation', async (req, res) => {
  const reqId = requestId(req);
  res.set('Cache-Control', 'private, no-store');
  const periodId = String(req.params.periodId || '');
  if (!/^[0-9a-f-]{36}$/i.test(periodId)) return errorResponse(res, 422, 'VALIDATION_FAILED', 'A valid subscription period is required.', reqId);
  const { data, error } = await serviceRoleClient.rpc('cancel_subscription_period_v1', {
    p_provider_id: req.providerId,
    p_period_id: periodId,
  });
  if (error) return databaseError(res, reqId, error);
  const cancellation = rpcValue(data);
  let refundPending = false;
  try {
    await reconcileSubscriptionRefund(cancellation.refundId);
  } catch (refundError) {
    refundPending = true;
    console.warn('[Subscription] Refund remains under reconciliation', {
      requestId: reqId,
      refundId: cancellation.refundId,
      error: refundError?.code || refundError?.message,
    });
  }
  return dataResponse(res, refundPending ? 202 : 200, {
    ...(await subscriptionProjection(req.providerId)),
    cancellationResult: { accessEndsAt: cancellation.accessEndsAt, refundPending },
  }, reqId);
});

router.get('/documents/:id', async (req, res) => {
  const reqId = requestId(req);
  res.set('Cache-Control', 'private, no-store');
  const { data, error } = await serviceRoleClient.rpc('get_subscription_document_v1', {
    p_provider_id: req.providerId,
    p_document_id: req.params.id,
  });
  if (error) return databaseError(res, reqId, error);
  if (!data) return errorResponse(res, 404, 'NOT_FOUND', 'Billing document was not found.', reqId);
  return dataResponse(res, 200, rpcValue(data), reqId);
});

export default router;
