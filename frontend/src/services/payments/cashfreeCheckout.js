import { getApiBase } from '../../utils/api.js';
import { installCheckoutRecovery } from './checkoutRecovery.js';

const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';
const RESTART_KEY_PREFIX = 'calup_cashfree_restart:';
const CURRENT_RESTART_KEY = 'calup_cashfree_restart:current';
let sdkPromise;
let checkoutActive = false;

export const isCashfreeV1Enabled = () => import.meta.env.VITE_CASHFREE_V1_ENABLED === 'true';

function apiError(result, fallback, status) {
  const error = new Error(result?.error?.message || fallback);
  error.code = result?.error?.code;
  error.status = status;
  error.details = result?.error?.details || null;
  return error;
}

function loadSdk() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Cashfree checkout requires a browser'));
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SDK_URL}"]`);
    const script = existing || document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    const timeout = setTimeout(() => fail('Cashfree checkout took too long to load. Check your connection and try again.'), 15000);
    const fail = message => {
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
      reject(new Error(message));
    };
    script.onload = () => {
      clearTimeout(timeout);
      if (window.Cashfree) resolve(window.Cashfree);
      else fail('Cashfree SDK did not initialize. Please try again.');
    };
    script.onerror = () => fail('Cashfree checkout could not be loaded. Check your connection or browser blocking settings, then try again.');
    if (!existing) document.head.appendChild(script);
  }).catch(error => {
    sdkPromise = undefined;
    throw error;
  });
  return sdkPromise;
}

export const cashfreeCheckoutService = {
  rememberRestartPath(attemptId, path) {
    if (typeof window === 'undefined' || !attemptId || !/^\/book\/[A-Za-z0-9._~-]+$/.test(path)) return;
    window.sessionStorage.setItem(`${RESTART_KEY_PREFIX}${attemptId}`, path);
    window.sessionStorage.setItem(CURRENT_RESTART_KEY, path);
  },

  getRestartPath(attemptId) {
    if (typeof window === 'undefined') return '/';
    const path = (attemptId ? window.sessionStorage.getItem(`${RESTART_KEY_PREFIX}${attemptId}`) : '')
      || window.sessionStorage.getItem(CURRENT_RESTART_KEY)
      || '';
    return /^\/book\/[A-Za-z0-9._~-]+$/.test(path) ? path : '/';
  },

  async createBookingAttempt(payload, idempotencyKey) {
    const response = await fetch(`${getApiBase()}/v1/public/booking-attempts`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) throw apiError(result, 'Payment could not be started.', response.status);
    return result.data;
  },

  async openHostedPopup({ paymentSessionId, cashfreeMode = 'sandbox', recoveryPath = '/payment-status' }) {
    if (!paymentSessionId) throw new Error('Payment session is still being prepared.');
    if (!['sandbox', 'production'].includes(cashfreeMode)) throw new Error('Payment environment is invalid. Please contact support.');
    if (checkoutActive) {
      const error = new Error('A payment window is already open. Finish or close it before continuing.');
      error.code = 'CASHFREE_CHECKOUT_ACTIVE';
      throw error;
    }
    checkoutActive = true;
    let disposeRecovery;
    // Popup output is presentation-only. The server performs the authoritative lookup.
    let result;
    try {
      const Cashfree = await loadSdk();
      const cashfree = Cashfree({ mode: cashfreeMode });
      disposeRecovery = installCheckoutRecovery(recoveryPath);
      result = await cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' });
    } catch {
      const error = new Error('Cashfree checkout could not be completed. Check payment status before retrying.');
      error.code = 'CASHFREE_CHECKOUT_FAILED';
      throw error;
    } finally {
      disposeRecovery?.();
      checkoutActive = false;
    }
    if (result?.error) {
      // Do not expose provider messages which can contain the checkout session token.
      const error = new Error('Cashfree could not open or complete checkout. Check payment status before retrying. If it persists, verify the website domain in the Cashfree dashboard.');
      error.code = 'CASHFREE_CHECKOUT_FAILED';
      const providerCode = String(result.error.code || '');
      if (/^[A-Za-z0-9_]{1,48}$/.test(providerCode) && !/session|token|secret/i.test(providerCode)) {
        error.providerCode = providerCode;
        error.message += ` Code: ${providerCode}.`;
      }
      console.warn('[CashfreeCheckout]', { code: error.code, providerCode: error.providerCode || 'UNAVAILABLE', mode: cashfreeMode, origin: window.location?.origin });
      throw error;
    }
    return result;
  },

  async getAttempt() {
    const response = await fetch(`${getApiBase()}/v1/public/checkout-sessions/current`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(result, 'Payment status is unavailable.', response.status);
    return result.data;
  },

  async getCheckoutSession() {
    const response = await fetch(`${getApiBase()}/v1/public/checkout-sessions/current/open`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) throw apiError(result, 'Checkout is unavailable.', response.status);
    return result.data;
  },

  async refreshPayment() {
    const response = await fetch(`${getApiBase()}/v1/public/checkout-sessions/current/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) throw apiError(result, 'Payment verification is unavailable.', response.status);
    return result.data || null;
  },

  async finishCheckoutReturn() {
    const response = await fetch(`${getApiBase()}/v1/public/checkout-sessions/current/complete`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) throw apiError(result, 'Payment result could not be finalized.', response.status);
    return result.data || null;
  },
};
