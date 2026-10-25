import crypto from 'crypto';
import { config } from '../config.js';

const SANDBOX_BASE_URL = 'https://sandbox.cashfree.com/pg';
const PRODUCTION_BASE_URL = 'https://api.cashfree.com/pg';

export class CashfreeError extends Error {
  constructor(message, { status = 0, code = 'CASHFREE_ERROR', outcome = 'unknown', details = null } = {}) {
    super(message);
    this.name = 'CashfreeError';
    this.status = status;
    this.code = code;
    this.outcome = outcome;
    this.details = details;
  }
}

function safeJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export class CashfreeClient {
  constructor({
    clientId = config.cashfreeClientId,
    clientSecret = config.cashfreeClientSecret,
    environment = config.cashfreeEnvironment,
    apiVersion = config.cashfreeApiVersion,
    fetchImpl = globalThis.fetch,
    timeoutMs = 10000,
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.environment = environment;
    this.apiVersion = apiVersion;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.baseUrl = environment === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret && this.fetchImpl);
  }

  async request(path, { method = 'GET', body, idempotencyKey } = {}) {
    if (!this.isConfigured()) {
      throw new CashfreeError('Cashfree is not configured', { code: 'CASHFREE_NOT_CONFIGURED', outcome: 'definitive' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-version': this.apiVersion,
          'x-client-id': this.clientId,
          'x-client-secret': this.clientSecret,
          ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      const payload = safeJson(raw);
      if (!response.ok) {
        const outcome = response.status >= 500 || response.status === 408 || response.status === 429
          ? 'unknown'
          : 'definitive';
        throw new CashfreeError('Cashfree request was not accepted', {
          status: response.status,
          code: typeof payload.code === 'string' ? payload.code : 'CASHFREE_REJECTED',
          outcome,
          details: {
            type: typeof payload.type === 'string' ? payload.type : null,
            message: typeof payload.message === 'string' ? payload.message : null,
          },
        });
      }
      if (!payload || typeof payload !== 'object') {
        throw new CashfreeError('Cashfree returned an invalid response', { outcome: 'unknown' });
      }
      return payload;
    } catch (error) {
      if (error instanceof CashfreeError) throw error;
      const message = error?.name === 'AbortError' ? 'Cashfree request timed out' : 'Cashfree request failed';
      throw new CashfreeError(message, { code: 'CASHFREE_UNREACHABLE', outcome: 'unknown' });
    } finally {
      clearTimeout(timer);
    }
  }

  async createOrder(input, idempotencyKey) {
    const data = await this.request('/orders', { method: 'POST', body: input, idempotencyKey });
    if (typeof data.order_id !== 'string' || typeof data.payment_session_id !== 'string') {
      throw new CashfreeError('Cashfree order response is incomplete', { outcome: 'unknown' });
    }
    return data;
  }

  async getOrder(orderId) {
    return this.request(`/orders/${encodeURIComponent(orderId)}`);
  }

  async getOrderPayments(orderId) {
    const data = await this.request(`/orders/${encodeURIComponent(orderId)}/payments`);
    if (!Array.isArray(data)) {
      throw new CashfreeError('Cashfree payments response is invalid', { outcome: 'unknown' });
    }
    return data;
  }

  async createRefund(orderId, input, idempotencyKey = input.refund_id) {
    return this.request(`/orders/${encodeURIComponent(orderId)}/refunds`, {
      method: 'POST',
      body: input,
      idempotencyKey,
    });
  }

  async getRefund(orderId, refundId) {
    return this.request(`/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`);
  }

  verifyWebhookSignature({ rawBody, timestamp, signature }) {
    if (!Buffer.isBuffer(rawBody) || !timestamp || !signature || !this.clientSecret) return false;
    const expected = crypto
      .createHmac('sha256', this.clientSecret)
      .update(`${timestamp}${rawBody.toString('utf8')}`)
      .digest('base64');
    const actualBuffer = Buffer.from(String(signature));
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  }
}

export function amountToPaise(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

export function toCashfreeTimestamp(value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new TypeError('Invalid Cashfree timestamp');
  // Cashfree's order API examples use UTC ISO-8601 seconds. PostgreSQL may
  // return six fractional digits and an offset, which the gateway rejects.
  return timestamp.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function cashfreeOrderExpiry(holdExpiresAt, {
  now = Date.now(),
  gatewayWindowMs = 30 * 60 * 1000,
} = {}) {
  const holdExpiryMs = new Date(holdExpiresAt).getTime();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(holdExpiryMs) || !Number.isFinite(nowMs) || gatewayWindowMs <= 0) {
    throw new TypeError('Invalid Cashfree order expiry input');
  }

  // Cashfree validates expiry against the time at which its gateway receives
  // the request. Keep this provider deadline independent from Calup's strict
  // 15-minute allocation deadline so network latency cannot cross the gateway
  // validation boundary.
  return toCashfreeTimestamp(Math.max(holdExpiryMs, nowMs + gatewayWindowMs));
}

export function findSuccessfulPayment(payments) {
  if (!Array.isArray(payments)) return null;
  return payments
    .filter(payment => payment && payment.payment_status === 'SUCCESS')
    .sort((a, b) => String(a.payment_time || '').localeCompare(String(b.payment_time || '')))[0] || null;
}

export const cashfreeClient = new CashfreeClient();
