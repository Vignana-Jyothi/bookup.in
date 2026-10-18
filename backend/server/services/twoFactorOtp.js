import { config } from '../config.js';

const API_ORIGIN = 'https://2factor.in';
const REQUEST_TIMEOUT_MS = 10000;

export class TwoFactorOtpError extends Error {
  constructor(code, message, { retryable = false, providerReason = null } = {}) {
    super(message);
    this.name = 'TwoFactorOtpError';
    this.code = code;
    this.retryable = retryable;
    this.providerReason = providerReason;
  }
}

export function normalizeIndianMobile(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(national)) {
    throw new TwoFactorOtpError('PHONE_INVALID', 'Enter a valid 10-digit Indian mobile number.');
  }
  return national;
}

function providerStatus(payload) {
  return String(payload?.Status ?? payload?.status ?? '').trim().toLowerCase();
}

function providerDetails(payload) {
  const value = payload?.Details ?? payload?.details ?? payload?.message ?? '';
  return typeof value === 'string' ? value.trim() : '';
}

function verificationFailure(details) {
  const reason = details.toLowerCase();
  if (/expir|session.*(invalid|not found|does not exist)/.test(reason)) return 'expired';
  if (/(otp|code).*(mismatch|invalid|incorrect|wrong)|invalid.*(otp|code)/.test(reason)) return 'invalid_code';
  return null;
}

export class TwoFactorOtpService {
  constructor({
    apiKey = config.twoFactorApiKey,
    templateName = config.twoFactorTemplateName,
    fetchImpl = globalThis.fetch,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = {}) {
    this.apiKey = apiKey;
    this.templateName = templateName;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.fetch);
  }

  async request(pathParts) {
    if (!this.isConfigured()) {
      throw new TwoFactorOtpError('OTP_PROVIDER_NOT_CONFIGURED', 'SMS verification is temporarily unavailable.');
    }
    const path = pathParts.map(part => encodeURIComponent(String(part))).join('/');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(`${API_ORIGIN}/API/V1/${encodeURIComponent(this.apiKey)}/${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      const code = error?.name === 'AbortError' ? 'OTP_PROVIDER_TIMEOUT' : 'OTP_PROVIDER_UNAVAILABLE';
      throw new TwoFactorOtpError(code, 'SMS verification is temporarily unavailable.', { retryable: true });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new TwoFactorOtpError('OTP_PROVIDER_INVALID_RESPONSE', 'SMS verification is temporarily unavailable.', { retryable: true });
    }
    return { response, payload, status: providerStatus(payload), details: providerDetails(payload) };
  }

  async sendOtp(phone) {
    const nationalPhone = normalizeIndianMobile(phone);
    const parts = ['SMS', nationalPhone, 'AUTOGEN'];
    if (this.templateName) parts.push(this.templateName);
    const result = await this.request(parts);
    if (!result.response.ok || result.status !== 'success' || !result.details) {
      throw new TwoFactorOtpError('OTP_SEND_REJECTED', 'The SMS code could not be sent. Please try again.', {
        retryable: result.response.status >= 500,
        providerReason: result.details || null,
      });
    }
    return { sessionId: result.details };
  }

  async verifyOtp(sessionId, code) {
    if (!sessionId || !/^\d{4,8}$/.test(String(code))) {
      throw new TwoFactorOtpError('OTP_VERIFICATION_INVALID', 'Enter a valid SMS verification code.');
    }
    const result = await this.request(['SMS', 'VERIFY', sessionId, code]);
    if (result.response.ok && result.status === 'success') return { verified: true };

    const reason = verificationFailure(result.details);
    if (reason) return { verified: false, reason };
    throw new TwoFactorOtpError('OTP_VERIFY_REJECTED', 'The SMS code could not be verified. Please try again.', {
      retryable: result.response.status >= 500,
      providerReason: result.details || null,
    });
  }
}

export const twoFactorOtpService = new TwoFactorOtpService();
