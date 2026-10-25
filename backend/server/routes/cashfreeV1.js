import crypto from 'crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { bookingCreateLimiter, customerTrackingLimiter, tokenRouteLimiter } from '../middleware/rateLimiter.js';
import { serviceRoleClient } from '../middleware/auth.js';
import { amountToPaise, cashfreeClient, cashfreeOrderExpiry, assertCashfreeOrder, assertCashfreeScope, verifiedSuccessfulPayment } from '../services/cashfree.js';
import { wakeGoogleCalendarSyncWorker } from '../services/googleCalendarSync.js';
import { customerRequestIsTrusted, getCustomerAccess, setCustomerAccessCookie } from '../utils/customerAccess.js';
import { decryptToken, encryptToken } from '../utils/crypto.js';
import { reconcileSubscriptionOrder } from './merchantSubscription.js';
import { bookingRefundsEnabled, recordBookingRefundWebhook } from '../services/bookingRefundExecution.js';
import { assertCalendarAvailability } from '../services/calendarAvailability.js';

const ATTEMPT_COOKIE = 'calup_attempt_v1';
const ATTEMPT_REFERENCE_COOKIE = 'calup_attempt_reference_v1';

function requestId(req) {
  return req.headers['x-request-id'] || crypto.randomUUID();
}

function sendData(res, status, data, reqId) {
  return res.status(status).json({ data, meta: { requestId: reqId, serverTime: new Date().toISOString() } });
}

function sendError(res, status, code, message, reqId, details) {
  return res.status(status).json({
    error: { code, message, ...(details ? { details } : {}), requestId: reqId },
  });
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function withAppointmentMeeting(value) {
  const result = rpcValue(value);
  if (!result?.appointmentId || !serviceRoleClient) return result;
  const { data } = await serviceRoleClient.rpc('get_appointment_meeting_v1', {
    p_appointment_id: result.appointmentId,
  });
  const meeting = rpcValue(data);
  if (!meeting) return result;
  return {
    ...result,
    meetLink: meeting.meetLink || null,
    calendarSyncStatus: meeting.calendarSyncStatus || null,
    receipt: result.receipt ? { ...result.receipt, meetLink: meeting.meetLink || null } : result.receipt,
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function attemptTokenFor(providerId, idempotencyKey) {
  const key = Buffer.from(config.tokenEncryptionKey, 'hex');
  return crypto.createHmac('sha256', key).update(`cashfree-v1:${providerId}:${idempotencyKey}`).digest('base64url');
}

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((all, pair) => {
    const index = pair.indexOf('=');
    if (index > 0) all[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
    return all;
  }, {});
}

function setAttemptCookie(res, token, attemptId) {
  const security = process.env.NODE_ENV === 'production' ? '; Secure; SameSite=None' : '; SameSite=Lax';
  res.append('Set-Cookie', `${ATTEMPT_COOKIE}=${encodeURIComponent(token)}; Path=/api/v1/public; HttpOnly; Max-Age=900${security}`);
  res.append('Set-Cookie', `${ATTEMPT_REFERENCE_COOKIE}=${encodeURIComponent(encryptToken(String(attemptId)))}; Path=/api/v1/public; HttpOnly; Max-Age=900${security}`);
}

export function setRecoveredAttemptCookie(res, context) {
  if (!context?.providerId || !context?.attemptId || typeof context.idempotencyKey !== 'string'
    || !/^[a-f0-9]{64}$/i.test(context.attemptTokenHash || '')) throw new Error('RECOVERY_UNAVAILABLE');
  const token = attemptTokenFor(context.providerId, context.idempotencyKey);
  if (!crypto.timingSafeEqual(Buffer.from(sha256(token), 'hex'), Buffer.from(context.attemptTokenHash, 'hex'))) {
    throw new Error('RECOVERY_UNAVAILABLE');
  }
  setAttemptCookie(res, token, context.attemptId);
}

function attemptIdFromRequest(req) {
  const routeId = String(req.params?.id || '').trim();
  if (routeId && routeId !== 'current') return routeId;
  try {
    return decryptToken(parseCookies(req)[ATTEMPT_REFERENCE_COOKIE] || '');
  } catch {
    return '';
  }
}

function requireDatabase(res, reqId) {
  if (serviceRoleClient) return true;
  sendError(res, 503, 'SERVICE_TEMPORARILY_UNAVAILABLE', 'Payment storage is unavailable.', reqId);
  return false;
}

function requireCashfree(res, reqId) {
  if (config.isCashfreeConfigured()) return true;
  sendError(res, 503, 'PAYMENTS_UNAVAILABLE', 'Online payments are temporarily unavailable.', reqId);
  return false;
}

function rpcValue(data) {
  return typeof data === 'string' ? JSON.parse(data) : data;
}

function mapDatabaseError(error, res, reqId) {
  const message = String(error?.message || '');
  if (message.includes('SLOT_UNAVAILABLE')) {
    return sendError(res, 409, 'SLOT_UNAVAILABLE', 'That time is no longer available.', reqId);
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return sendError(res, 409, 'IDEMPOTENCY_CONFLICT', 'This retry does not match the original request.', reqId);
  }
  if (message.includes('ACTIVE_HOLD_EXISTS')) {
    return sendError(res, 409, 'ACTIVE_HOLD_EXISTS', 'This customer already has an active payment hold.', reqId);
  }
  if (message.includes('SUBSCRIPTION_REQUIRED')) {
    return sendError(res, 403, 'MERCHANT_UNAVAILABLE', 'This merchant is not accepting new bookings right now.', reqId);
  }
  if (message.includes('INVALID_TIMEZONE') || message.includes('INVALID_SLOT')) {
    return sendError(res, 422, 'VALIDATION_FAILED', 'The selected date or time is invalid.', reqId);
  }
  console.error('[CashfreeV1] Database operation failed:', { code: error?.code, message: error?.message });
  return sendError(res, 503, 'SERVICE_TEMPORARILY_UNAVAILABLE', 'Payment storage is temporarily unavailable.', reqId);
}

async function getActiveHoldDetails(req, providerId, contactHash) {
  const rawToken = parseCookies(req)[ATTEMPT_COOKIE];
  const { data, error } = await serviceRoleClient.rpc('get_active_hold_conflict_v1', {
    p_provider_id: providerId,
    p_customer_contact_hash: contactHash,
    p_attempt_token_hash: rawToken ? sha256(rawToken) : null,
  });
  if (error || !data) return null;
  return withAppointmentMeeting(data);
}

async function authorizeAttempt(req, res, reqId) {
  const rawToken = parseCookies(req)[ATTEMPT_COOKIE];
  if (!rawToken) {
    sendError(res, 401, 'AUTH_REQUIRED', 'This payment attempt requires secure browser access.', reqId);
    return null;
  }
  const tokenHash = sha256(rawToken);
  let attemptId = attemptIdFromRequest(req);
  if (!attemptId) {
    const { data: recoveredId } = await serviceRoleClient.rpc('find_booking_attempt_by_token_v1', {
      p_attempt_token_hash: tokenHash,
    });
    attemptId = recoveredId || '';
  }
  if (!attemptId) {
    sendError(res, 401, 'AUTH_REQUIRED', 'This payment attempt requires secure browser access.', reqId);
    return null;
  }
  const { data, error } = await serviceRoleClient.rpc('get_booking_attempt_v1', {
    p_attempt_id: attemptId,
    p_attempt_token_hash: tokenHash,
  });
  if (error || !data) {
    sendError(res, 404, 'NOT_FOUND', 'Payment attempt was not found.', reqId);
    return null;
  }
  const attempt = rpcValue(data);
  if (attempt?.appointmentId && attempt?.fulfilmentStatus === 'fulfilled') wakeGoogleCalendarSyncWorker();
  return withAppointmentMeeting(attempt);
}

export async function reconcileAttempt(attemptId, { database = serviceRoleClient, client = cashfreeClient } = {}) {
  const { data: contextData, error: contextError } = await database.rpc('get_cashfree_reconciliation_context_v1', {
    p_attempt_id: attemptId,
  });
  if (contextError || !contextData) throw contextError || new Error('Reconciliation context missing');
  let context = rpcValue(contextData);
  assertCashfreeScope(context, client);
  if (!context.providerOrderId) return context;

  let order;
  try {
    order = await client.getOrder(context.providerOrderId);
  } catch (error) {
    // A GET 404 may race a still-processing, previously timed-out order POST.
    // Keep its durable reference and reconciliation instead of declaring no payment.
    throw error;
  }
  assertCashfreeOrder(context, order);
  if (context.paymentStatus === 'creation_unknown' && order.payment_session_id) {
    const { data: marked, error: markError } = await database.rpc('mark_cashfree_order_created_v1', {
      p_payment_order_id: context.paymentOrderId,
      p_provider_order_id: context.providerOrderId,
      p_payment_session_id: order.payment_session_id,
    });
    if (markError) throw markError;
    context = { ...context, ...rpcValue(marked) };
  }
  // Preserve terminal local state. A closed-unpaid order must not look active
  // merely because Cashfree still reports its hosted order as ACTIVE.
  if (order.order_status !== 'PAID') {
    // A failed transaction does not close an ACTIVE Cashfree order. Reuse that
    // checkout for retry instead of creating a second order/15-minute hold.
    if (context.paymentStatus !== 'pending') return context;
    if (!['ACTIVE', 'EXPIRED', 'TERMINATED'].includes(order.order_status)) return { ...context, gatewayPaymentInProgress: true };
    if (amountToPaise(order.order_amount) !== context.amountPaise || order.order_currency !== context.currency) {
      throw new Error('Authoritative Cashfree amount or currency mismatch');
    }
    const payments = await client.getOrderPayments(context.providerOrderId);
    const retryableFailure = order.order_status === 'ACTIVE' && context.attemptStatus === 'hold_active'
      && Number.isFinite(Date.parse(context.holdExpiresAt)) && Date.parse(context.holdExpiresAt) > Date.now()
      && payments.length > 0
      && payments.every(payment => ['FAILED', 'USER_DROPPED'].includes(payment.payment_status));
    return { ...context, retryableFailure,
      gatewayPaymentInProgress: payments.some(payment => !['FAILED', 'USER_DROPPED'].includes(payment.payment_status)),
    };
  }

  const payments = await client.getOrderPayments(context.providerOrderId);
  const payment = verifiedSuccessfulPayment(context, order, payments);
  if (!payment) return { ...context, gatewayPaymentInProgress: true };

  const paidPaise = amountToPaise(payment.payment_amount);
  if (paidPaise !== context.amountPaise || order.order_currency !== context.currency) {
    throw new Error('Authoritative Cashfree amount or currency mismatch');
  }

  const { data, error } = await database.rpc('finalize_verified_payment_v1', {
    p_payment_order_id: context.paymentOrderId,
    p_provider_order_id: context.providerOrderId,
    p_provider_payment_id: String(payment.cf_payment_id),
    p_paid_amount_paise: paidPaise,
    p_currency: order.order_currency,
    p_paid_at: payment.payment_time || new Date().toISOString(),
    p_source: 'cashfree_lookup',
  });
  if (error) throw error;
  const finalized = rpcValue(data);
  if (finalized?.appointmentId && finalized?.fulfilmentStatus === 'fulfilled') wakeGoogleCalendarSyncWorker();
  return withAppointmentMeeting(finalized);
}

export async function restoreBookingCheckout(attempt, { database = serviceRoleClient, client = cashfreeClient, reconcile = reconcileAttempt } = {}) {
  const holdEndsAt = Date.parse(attempt.holdExpiresAt);
  const assertActiveHold = () => {
    if (!Number.isFinite(holdEndsAt) || holdEndsAt <= Date.now()) {
      const error = new Error('This payment hold has expired.');
      error.code = 'HOLD_EXPIRED';
      throw error;
    }
  };
  assertActiveHold();
  const { data, error } = await database.rpc('get_cashfree_reconciliation_context_v1', { p_attempt_id: attempt.attemptId });
  if (error) throw error;
  const context = rpcValue(data);
  if (!context?.providerOrderId || context.attemptId !== attempt.attemptId) throw new Error('Checkout context unavailable');
  assertCashfreeScope(context, client);
  const order = await client.getOrder(context.providerOrderId);
  assertCashfreeOrder(context, order);
  assertActiveHold();
  if (order.order_status !== 'ACTIVE' || !order.payment_session_id) {
    return { ...await reconcile(attempt.attemptId), paymentSessionId: null, gatewayReconciling: true };
  }
  return { ...attempt, paymentSessionId: order.payment_session_id, cashfreeMode: config.cashfreeEnvironment };
}

export async function finishBookingCheckout(attempt, tokenHash, {
  database = serviceRoleClient, reconcile = reconcileAttempt,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  let reconciled;
  try {
    for (let lookup = 0; lookup < 3; lookup++) {
      if (lookup) await wait(lookup * 350);
      reconciled = await reconcile(attempt.attemptId);
      if (reconciled?.paymentStatus !== 'pending') break;
    }
  } catch {
    return { ...attempt, gatewayReconciling: true };
  }
  if (reconciled?.paymentStatus === 'succeeded') return reconciled;
  if (!reconciled || reconciled.gatewayPaymentInProgress || reconciled.attemptStatus === 'manual_review') return { ...(reconciled || attempt), gatewayReconciling: true };
  const { data, error } = await database.rpc('abandon_cashfree_checkout_v1', {
    p_attempt_id: attempt.attemptId, p_attempt_token_hash: tokenHash,
  });
  if (error) throw error;
  return rpcValue(data);
}

export function createCashfreeV1Router() {
  const router = Router();
  const sendRestoredCheckout = async (attempt, res, reqId) => {
    try {
      const restored = await restoreBookingCheckout(attempt);
      return sendData(res, restored.gatewayReconciling ? 202 : 200, restored, reqId);
    } catch (error) {
      if (error.code === 'HOLD_EXPIRED') return sendError(res, 410, 'HOLD_EXPIRED', error.message, reqId);
      console.warn('[CashfreeV1] Checkout restore failed', { requestId: reqId, code: error?.code || 'CHECKOUT_UNAVAILABLE' });
      return sendError(res, 503, 'CHECKOUT_UNAVAILABLE', 'Cashfree checkout could not be restored. Check payment status before retrying.', reqId);
    }
  };

  router.post('/customer-bookings/track', customerTrackingLimiter, async (req, res) => {
    const reqId = requestId(req);
    res.set('Cache-Control', 'private, no-store');
    if (!requireDatabase(res, reqId)) return;

    const bookingId = String(req.body?.bookingId || '').trim().toUpperCase();
    const phone = normalizedPhone(req.body?.customerPhone);
    if (!/^M\d{9}$/.test(bookingId) || !/^[6-9]\d{9}$/.test(phone)) {
      return sendError(res, 422, 'VALIDATION_FAILED', 'Enter a valid booking ID and Indian mobile number.', reqId);
    }

    const { data, error } = await serviceRoleClient.rpc('get_customer_booking_by_reference_v1', {
      p_booking_reference: bookingId,
      p_customer_phone: phone,
    });
    if (error) {
      console.error('[CashfreeV1] Customer booking tracking failed', { requestId: reqId, code: error.code });
      return sendError(res, 503, 'SERVICE_TEMPORARILY_UNAVAILABLE', 'Booking status is temporarily unavailable.', reqId);
    }
    if (!data) {
      return sendError(res, 404, 'NOT_FOUND', 'The booking ID or mobile number does not match our records.', reqId);
    }

    setCustomerAccessCookie(res, { kind: 'reference', bookingId, phone });
    return sendData(res, 200, rpcValue(data), reqId);
  });

  router.get('/customer-bookings/current', customerTrackingLimiter, async (req, res) => {
    const reqId = requestId(req);
    res.set('Cache-Control', 'private, no-store');
    if (!requireDatabase(res, reqId)) return;

    const access = getCustomerAccess(req);
    if (access?.kind !== 'reference') {
      return sendError(res, 401, 'AUTH_REQUIRED', 'Verify your booking ID and mobile number to continue.', reqId);
    }

    const { data, error } = await serviceRoleClient.rpc('get_customer_booking_by_reference_v1', {
      p_booking_reference: access.bookingId,
      p_customer_phone: access.phone,
    });
    if (error) {
      console.error('[CashfreeV1] Current customer booking failed', { requestId: reqId, code: error.code });
      return sendError(res, 503, 'SERVICE_TEMPORARILY_UNAVAILABLE', 'Booking status is temporarily unavailable.', reqId);
    }
    if (!data) return sendError(res, 404, 'NOT_FOUND', 'Booking access is no longer available.', reqId);
    return sendData(res, 200, rpcValue(data), reqId);
  });

  router.post('/booking-attempts', bookingCreateLimiter, async (req, res) => {
    const reqId = requestId(req);
    if (!config.cashfreeEnabled) return sendError(res, 404, 'NOT_FOUND', 'Payment route is disabled.', reqId);
    if (!requireDatabase(res, reqId) || !requireCashfree(res, reqId)) return;

    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      return sendError(res, 422, 'VALIDATION_FAILED', 'A valid Idempotency-Key is required.', reqId);
    }

    const input = req.body || {};
    const phone = normalizedPhone(input.customerPhone);
    if (
      !/^[0-9a-f-]{36}$/i.test(String(input.providerId || '')) ||
      !/^[0-9a-f-]{36}$/i.test(String(input.serviceId || '')) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(input.bookingDate || '')) ||
      !/^\d{2}:\d{2}$/.test(String(input.startTime || '')) ||
      String(input.customerName || '').trim().length < 2 ||
      !/^[6-9]\d{9}$/.test(phone)
    ) {
      return sendError(res, 422, 'VALIDATION_FAILED', 'Valid service, slot, name, and Indian mobile number are required.', reqId);
    }
    if (input.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.customerEmail))) {
      return sendError(res, 422, 'VALIDATION_FAILED', 'Email address is invalid.', reqId);
    }
    if (input.verificationGrantId && !/^[0-9a-f-]{36}$/i.test(String(input.verificationGrantId))) {
      return sendError(res, 422, 'VALIDATION_FAILED', 'Verification grant is invalid.', reqId);
    }
    if (!input.verificationGrantId && !config.cashfreeAllowUnverifiedContact) {
      return sendError(res, 401, 'OTP_REQUIRED', 'Phone verification is required before payment.', reqId);
    }

    const canonicalInput = {
      providerId: input.providerId,
      serviceId: input.serviceId,
      bookingDate: input.bookingDate,
      startTime: input.startTime,
      customerName: String(input.customerName).trim(),
      customerPhone: phone,
      customerEmail: String(input.customerEmail || '').trim().toLowerCase(),
      meetingType: input.meetingType === 'in-person' ? 'in-person' : 'online',
      policyAcceptedAt: input.policyAcceptedAt || null,
    };
    const requestHash = sha256(stableStringify(canonicalInput));
    const attemptToken = attemptTokenFor(input.providerId, idempotencyKey);
    const tokenHash = sha256(attemptToken);
    const contactHash = crypto.createHmac('sha256', Buffer.from(config.tokenEncryptionKey, 'hex')).update(phone).digest('hex');

    // Check new holds against the owner Calendar before reserving or charging.
    // Existing idempotent attempts must remain recoverable after their own event exists.
    const preflight = await serviceRoleClient.rpc('get_booking_calendar_preflight_v1', {
      p_provider_id: input.providerId, p_service_id: input.serviceId,
      p_idempotency_key: idempotencyKey, p_request_hash: requestHash,
    });
    if (preflight.error) return mapDatabaseError(preflight.error, res, reqId);
    const calendarContext = rpcValue(preflight.data);
    if (typeof calendarContext?.existingAttempt !== 'boolean') return sendError(res, 503, 'AVAILABILITY_UNAVAILABLE', 'Booking availability could not be verified.', reqId);
    if (!calendarContext.existingAttempt) {
      try {
        await assertCalendarAvailability({ database: serviceRoleClient, providerId: input.providerId,
          service: calendarContext.service, provider: calendarContext.provider, date: input.bookingDate, startTime: input.startTime });
      } catch (calendarError) {
        return sendError(res, calendarError.status || 503, calendarError.status === 409 ? 'SLOT_UNAVAILABLE' : 'AVAILABILITY_UNAVAILABLE', calendarError.message, reqId);
      }
    }

    const { data, error } = await serviceRoleClient.rpc('acquire_booking_hold_v1', {
      p_provider_id: input.providerId,
      p_service_id: input.serviceId,
      p_booking_date: input.bookingDate,
      p_start_time: input.startTime,
      p_customer_name: canonicalInput.customerName,
      p_customer_phone: phone,
      p_customer_email: canonicalInput.customerEmail || null,
      p_customer_contact_hash: contactHash,
      p_attempt_token_hash: tokenHash,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
      p_environment: config.cashfreeEnvironment,
      p_verification_grant_id: input.verificationGrantId || null,
      p_policy_accepted_at: input.policyAcceptedAt || null,
      p_meeting_type: canonicalInput.meetingType,
    });
    if (error) {
      if (String(error.message || '').includes('ACTIVE_HOLD_EXISTS')) {
        const details = await getActiveHoldDetails(req, input.providerId, contactHash).catch(() => null);
        return sendError(
          res,
          409,
          'ACTIVE_HOLD_EXISTS',
          details?.canResume
            ? 'You already have a payment in progress. Continue or cancel that payment before starting again.'
            : 'This mobile number already has an active payment hold with this merchant.',
          reqId,
          details,
        );
      }
      return mapDatabaseError(error, res, reqId);
    }

    const attempt = rpcValue(data);
    let gatewayContext;
    try {
      const contextResult = await serviceRoleClient.rpc('get_cashfree_reconciliation_context_v1', { p_attempt_id: attempt.attemptId });
      if (contextResult.error) throw contextResult.error;
      gatewayContext = rpcValue(contextResult.data);
      assertCashfreeScope(gatewayContext, cashfreeClient);
    } catch {
      return sendError(res, 503, 'PAYMENT_SCOPE_MISMATCH', 'This payment belongs to another gateway configuration. Please contact support.', reqId);
    }
    setAttemptCookie(res, attemptToken, attempt.attemptId);
    if (attempt.paymentStatus === 'succeeded') {
      return sendData(res, 200, { ...attempt, paymentSessionId: null, cashfreeMode: config.cashfreeEnvironment }, reqId);
    }
    if (attempt.paymentSessionId && attempt.paymentStatus === 'pending') {
      return sendRestoredCheckout(attempt, res, reqId);
    }
    if (['creation_failed', 'closed_unpaid'].includes(attempt.paymentStatus)) {
      return sendError(res, 409, 'ATTEMPT_TERMINAL', 'This payment attempt has ended. Start a new checkout.', reqId);
    }
    if (attempt.paymentStatus === 'creation_unknown' || gatewayContext.providerOrderId) {
      return sendRestoredCheckout(attempt, res, reqId);
    }
    if (!Number.isFinite(Date.parse(attempt.holdExpiresAt)) || Date.parse(attempt.holdExpiresAt) <= Date.now()) {
      return sendError(res, 410, 'HOLD_EXPIRED', 'This payment hold has expired. Please select a new slot.', reqId);
    }

    const providerOrderId = `calup_${String(attempt.paymentOrderId).replace(/-/g, '')}`;
    const dispatch = await serviceRoleClient.rpc('begin_cashfree_order_dispatch_v1', {
      p_payment_order_id: attempt.paymentOrderId, p_provider_order_id: providerOrderId,
    });
    if (dispatch.error) return mapDatabaseError(dispatch.error, res, reqId);
    if (dispatch.data !== true) return sendData(res, 202, { ...attempt, paymentSessionId: null, paymentStatus: 'creation_unknown', gatewayReconciling: true }, reqId);
    try {
      const cashfreeOrder = await cashfreeClient.createOrder({
        order_id: providerOrderId,
        order_amount: attempt.amountPaise / 100,
        order_currency: attempt.currency,
        customer_details: {
          customer_id: `cust_${String(attempt.attemptId).replace(/-/g, '')}`,
          customer_name: canonicalInput.customerName,
          customer_email: canonicalInput.customerEmail || undefined,
          customer_phone: phone,
        },
        order_expiry_time: cashfreeOrderExpiry(attempt.holdExpiresAt),
        order_meta: {
          notify_url: `${config.backendPublicUrl}/api/v1/webhooks/cashfree/payments`,
        },
        order_note: 'Calup service booking',
        order_tags: { purpose: 'service_booking', attempt_id: attempt.attemptId },
      }, `create:${attempt.paymentOrderId}`);
      assertCashfreeOrder({ providerOrderId, amountPaise: attempt.amountPaise, currency: attempt.currency }, cashfreeOrder);

      const { data: marked, error: markError } = await serviceRoleClient.rpc('mark_cashfree_order_created_v1', {
        p_payment_order_id: attempt.paymentOrderId,
        p_provider_order_id: cashfreeOrder.order_id,
        p_payment_session_id: cashfreeOrder.payment_session_id,
      });
      if (markError) throw markError;
      if (Date.parse(attempt.holdExpiresAt) <= Date.now()) return sendData(res, 202, { ...rpcValue(marked), paymentSessionId: null, gatewayReconciling: true }, reqId);
      return sendData(res, 201, { ...rpcValue(marked), cashfreeMode: config.cashfreeEnvironment }, reqId);
    } catch (error_) {
      console.error('[CashfreeV1] Create order failed', {
        requestId: reqId,
        status: error_?.status || 0,
        code: error_?.code || 'CASHFREE_ERROR',
        outcome: error_?.outcome || 'unknown',
      });
      const unknown = error_?.outcome !== 'definitive' || error_?.status === 409;
      if (!unknown) {
        await serviceRoleClient.rpc('mark_cashfree_order_creation_failed_v1', {
          p_payment_order_id: attempt.paymentOrderId,
          p_safe_error_code: error_?.code || 'CASHFREE_ERROR',
        });
      }
      if (unknown) {
        return sendData(res, 202, { ...attempt, paymentStatus: 'creation_unknown', gatewayReconciling: true }, reqId);
      }
      return sendError(res, 503, 'PAYMENTS_UNAVAILABLE', 'Cashfree could not start this payment. The slot has been released.', reqId);
    }
  });

  router.get(['/checkout-sessions/current', '/booking-attempts/:id', '/booking-attempts/:id/status'], tokenRouteLimiter, async (req, res) => {
    const reqId = requestId(req);
    res.set('Cache-Control', 'private, no-store');
    if (!config.cashfreeEnabled) return sendError(res, 404, 'NOT_FOUND', 'Payment route is disabled.', reqId);
    if (!requireDatabase(res, reqId)) return;
    const attempt = await authorizeAttempt(req, res, reqId);
    if (!attempt) return;
    return sendData(res, 200, attempt, reqId);
  });

  router.post(['/checkout-sessions/current/open', '/booking-attempts/:id/checkout-session'], tokenRouteLimiter, async (req, res) => {
    if (!req.params.id && !customerRequestIsTrusted(req)) return sendError(res, 403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.', requestId(req));
    const reqId = requestId(req);
    if (!config.cashfreeEnabled) return sendError(res, 404, 'NOT_FOUND', 'Payment route is disabled.', reqId);
    if (!requireDatabase(res, reqId) || !requireCashfree(res, reqId)) return;
    let attempt = await authorizeAttempt(req, res, reqId);
    if (!attempt) return;
    if (attempt.remainingSeconds <= 0 || ['expired', 'released'].includes(attempt.attemptStatus)) {
      return sendError(res, 410, 'HOLD_EXPIRED', 'This payment hold has expired.', reqId);
    }
    if (attempt.paymentStatus === 'creation_unknown') {
      try {
        attempt = await reconcileAttempt(attempt.attemptId);
      } catch {
        return sendData(res, 202, { ...attempt, gatewayReconciling: true }, reqId);
      }
    }
    if (attempt.paymentStatus !== 'pending' || !attempt.paymentSessionId) {
      return sendError(res, 409, 'STATE_CONFLICT', 'Checkout is not available in the current payment state.', reqId);
    }
    return sendRestoredCheckout(attempt, res, reqId);
  });

  router.post(['/checkout-sessions/current/refresh', '/booking-attempts/:id/payment-refresh'], tokenRouteLimiter, async (req, res) => {
    if (!req.params.id && !customerRequestIsTrusted(req)) return sendError(res, 403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.', requestId(req));
    const reqId = requestId(req);
    if (!config.cashfreeEnabled) return sendError(res, 404, 'NOT_FOUND', 'Payment route is disabled.', reqId);
    if (!requireDatabase(res, reqId) || !requireCashfree(res, reqId)) return;
    const attempt = await authorizeAttempt(req, res, reqId);
    if (!attempt) return;
    try {
      const result = await reconcileAttempt(attempt.attemptId);
      return sendData(res, 200, result, reqId);
    } catch (error) {
      console.error('[CashfreeV1] Payment refresh failed:', error?.message);
      return sendError(res, 202, 'PAYMENT_RECONCILING', 'Payment confirmation is still being reconciled.', reqId);
    }
  });

  router.post(['/checkout-sessions/current/complete', '/booking-attempts/:id/checkout-ended'], tokenRouteLimiter, async (req, res) => {
    if (!req.params.id && !customerRequestIsTrusted(req)) return sendError(res, 403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.', requestId(req));
    const reqId = requestId(req);
    if (!config.cashfreeEnabled) return sendError(res, 404, 'NOT_FOUND', 'Payment route is disabled.', reqId);
    if (!requireDatabase(res, reqId) || !requireCashfree(res, reqId)) return;
    const attempt = await authorizeAttempt(req, res, reqId);
    if (!attempt) return;

    try {
      const result = await finishBookingCheckout(attempt, sha256(parseCookies(req)[ATTEMPT_COOKIE]));
      if (!result) return sendError(res, 404, 'NOT_FOUND', 'Payment attempt was not found.', reqId);
      return sendData(res, result.gatewayReconciling ? 202 : 200, result, reqId);
    } catch (error) { return mapDatabaseError(error, res, reqId); }
  });

  return router;
}

export function createCashfreeWebhookRouter() {
  const router = Router();
  router.post('/', async (req, res) => {
    if (!config.cashfreeEnabled || !serviceRoleClient || !config.isCashfreeConfigured()) return res.sendStatus(404);
    const rawBody = req.body;
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    if (!cashfreeClient.verifyWebhookSignature({ rawBody, timestamp, signature })) return res.sendStatus(401);

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }

    if (payload?.data?.refund || String(payload?.type || '').startsWith('REFUND')) {
      if (!bookingRefundsEnabled()) return res.sendStatus(404);
      try { return res.sendStatus(await recordBookingRefundWebhook(payload,rawBody) ? 200 : 400); }
      catch { return res.sendStatus(503); }
    }
    const providerOrderId = payload?.data?.order?.order_id;
    const providerPaymentId = payload?.data?.payment?.cf_payment_id;
    const eventType = String(payload?.type || 'UNKNOWN');
    if (!providerOrderId) return res.sendStatus(400);
    const payloadHash = sha256(rawBody);
    const eventKey = String(providerPaymentId ? `${eventType}:${providerPaymentId}` : `${eventType}:${payloadHash}`);
    const isSubscription = providerOrderId.startsWith('calup_sub_');
    const { data, error } = await serviceRoleClient.rpc('record_cashfree_event_v1', {
      p_event_key: eventKey,
      p_event_type: eventType,
      p_provider_order_id: providerOrderId,
      p_provider_payment_id: providerPaymentId ? String(providerPaymentId) : null,
      p_payload_hash: payloadHash,
      p_webhook_timestamp: String(timestamp),
      p_environment: config.cashfreeEnvironment,
      p_gateway_account: isSubscription ? 'calup_subscription' : 'calup_primary',
    });
    if (error) {
      console.error('[CashfreeV1] Webhook persistence failed:', error.message);
      return res.sendStatus(503);
    }
    res.sendStatus(200);

    const persisted = rpcValue(data);
    if (persisted?.alreadyProcessed) return;
    setImmediate(async () => {
      try {
        if (isSubscription) {
          const { data: orderId } = await serviceRoleClient.rpc('find_subscription_by_provider_order_v1', {
            p_provider_order_id: providerOrderId,
          });
          if (!orderId) throw new Error('Unknown Cashfree subscription order');
          await reconcileSubscriptionOrder(orderId);
        } else {
          const { data: attemptId } = await serviceRoleClient.rpc('find_attempt_by_provider_order_v1', {
            p_provider_order_id: providerOrderId,
          });
          if (!attemptId) throw new Error('Unknown Cashfree booking order');
          await reconcileAttempt(attemptId);
        }
        await serviceRoleClient.rpc('finish_cashfree_event_scoped_v1', { p_event_key: eventKey, p_environment: config.cashfreeEnvironment,
          p_gateway_account: isSubscription ? 'calup_subscription' : 'calup_primary', p_status: 'processed', p_safe_error: null });
      } catch (processingError) {
        console.error('[CashfreeV1] Webhook reconciliation failed:', processingError?.message);
        await serviceRoleClient.rpc('finish_cashfree_event_scoped_v1', {
          p_event_key: eventKey,
          p_environment: config.cashfreeEnvironment,
          p_gateway_account: isSubscription ? 'calup_subscription' : 'calup_primary',
          p_status: 'review_required',
          p_safe_error: 'RECONCILIATION_FAILED',
        });
      }
    });
  });
  return router;
}
