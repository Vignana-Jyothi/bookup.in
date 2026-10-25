import crypto from 'node:crypto';
import { config } from '../config.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';

export function createMerchantPhoneVerification({ client, otp,
  encryptionReady = () => /^(?!0{64}$)[a-f0-9]{64}$/i.test(config.tokenEncryptionKey),
} = {}) {
  const operate = async (providerId, phone, action, extra = {}) => {
    const { data, error } = await client.rpc('merchant_phone_operation_v2', {
      p_provider_id: providerId, p_phone: phone, p_action: action, ...extra,
    });
    if (error || !data) throw new Error('PHONE_VERIFICATION_STORAGE');
    return Array.isArray(data) ? data[0] : data;
  };
  const requireEncryption = () => {
    if (!encryptionReady()) throw new Error('PHONE_ENCRYPTION_UNAVAILABLE');
  };
  return {
    async send(providerId, phone) {
      requireEncryption();
      const requestId = crypto.randomUUID();
      const started = await operate(providerId, phone, 'begin_send', { p_request_id: requestId });
      if (!started.started) return started;
      try {
        const sent = await otp.sendOtp(phone);
        if (typeof sent.sessionId !== 'string' || !sent.sessionId || sent.sessionId.length > 512) throw new Error('PHONE_PROVIDER_RESPONSE');
        const result = await operate(providerId, phone, 'finish_send', {
          p_request_id: requestId, p_ciphertext: encryptToken(sent.sessionId),
        });
        if (!result.sent) throw new Error('PHONE_CHALLENGE_CHANGED');
        return result;
      } catch (error) {
        try { await operate(providerId, phone, 'cancel', { p_request_id: requestId }); } catch { /* Challenge expires without granting access. */ }
        throw error;
      }
    },
    async verify(providerId, phone, code) {
      requireEncryption();
      const leaseId = crypto.randomUUID();
      const reserved = await operate(providerId, phone, 'reserve_verify', { p_lease_id: leaseId });
      if (!reserved.reserved) return reserved;
      let outcome;
      try {
        // Legacy challenges remain usable until their existing ten-minute expiry.
        const session = reserved.ciphertext ? decryptToken(reserved.ciphertext) : reserved.legacySession;
        if (!session) throw new Error('PHONE_CHALLENGE_INVALID');
        outcome = await otp.verifyOtp(session, code);
      } catch (error) {
        try { await operate(providerId, phone, 'finish_verify', {
          p_request_id: reserved.requestId, p_lease_id: leaseId, p_verified: false,
        }); } catch { /* Lease expires; its consumed attempt is not restored. */ }
        throw error;
      }
      return operate(providerId, phone, 'finish_verify', {
        p_request_id: reserved.requestId, p_lease_id: leaseId,
        p_verified: outcome.verified === true, p_expired: outcome.reason === 'expired',
      });
    },
  };
}
