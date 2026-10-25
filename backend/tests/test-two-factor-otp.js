import assert from 'node:assert/strict';
import { TwoFactorOtpError, TwoFactorOtpService, normalizeIndianMobile } from '../server/services/twoFactorOtp.js';

const response = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  text: async () => JSON.stringify(payload),
});

assert.equal(normalizeIndianMobile('+91 98765 43210'), '9876543210');
assert.throws(() => normalizeIndianMobile('12345'), error => error instanceof TwoFactorOtpError && error.code === 'PHONE_INVALID');

let request;
const service = new TwoFactorOtpService({
  apiKey: 'server-secret',
  templateName: 'CALUP_OTP',
  fetchImpl: async (url, options) => {
    request = { url, options };
    return response({ Status: 'Success', Details: 'session-123' });
  },
});
assert.deepEqual(await service.sendOtp('9876543210'), { sessionId: 'session-123' });
assert.match(request.url, /\/SMS\/9876543210\/AUTOGEN\/CALUP_OTP$/);
assert.equal(request.options.method, 'POST');

const verified = new TwoFactorOtpService({
  apiKey: 'server-secret',
  fetchImpl: async () => response({ Status: 'Success', Details: 'OTP Matched' }),
});
assert.deepEqual(await verified.verifyOtp('session-123', '4499'), { verified: true });

const invalid = new TwoFactorOtpService({
  apiKey: 'server-secret',
  fetchImpl: async () => response({ Status: 'Error', Details: 'OTP Mismatch' }),
});
assert.deepEqual(await invalid.verifyOtp('session-123', '0000'), { verified: false, reason: 'invalid_code' });

const expired = new TwoFactorOtpService({
  apiKey: 'server-secret',
  fetchImpl: async () => response({ Status: 'Error', Details: 'OTP Session Expired' }),
});
assert.deepEqual(await expired.verifyOtp('session-123', '4499'), { verified: false, reason: 'expired' });

const unavailable = new TwoFactorOtpService({
  apiKey: 'do-not-leak-this-key',
  fetchImpl: async () => { throw new Error('network down'); },
});
await assert.rejects(
  unavailable.sendOtp('9876543210'),
  error => error.code === 'OTP_PROVIDER_UNAVAILABLE' && !error.message.includes('do-not-leak-this-key'),
);

console.log('2Factor OTP service tests passed.');
