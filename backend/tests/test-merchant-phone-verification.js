import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { encryptToken, decryptToken } from '../server/utils/crypto.js';
import { createMerchantPhoneVerification } from '../server/services/merchantPhoneVerification.js';

const oldKey = config.tokenEncryptionKey;
config.tokenEncryptionKey = 'a2'.repeat(32);
let calls = [];
let sends = 0;
let verifies = 0;
let reserved = { reserved: true, requestId: 'request-1', ciphertext: encryptToken('private-provider-session') };
let completed = { verified: true };
let providerError = false;
let providerOutcome = { verified: true };
let waiting;
let failFinishSend = false;
let busy = false;
const client = { async rpc(_name, args) {
  assert.equal(_name, 'merchant_phone_operation_v2');
  assert.equal(args.p_provider_id, 'merchant-1');
  assert.equal(args.p_phone, '9000000001');
  calls.push(args);
  if (args.p_action === 'begin_send') return { data: { started: true } };
  if (args.p_action === 'finish_send') return failFinishSend ? { error: new Error('storage') } : { data: { sent: true } };
  if (args.p_action === 'cancel') return { data: { cancelled: true } };
  if (args.p_action === 'reserve_verify') {
    if (busy) return { data: { reason: 'busy' } };
    busy = reserved.reserved === true;
    return { data: reserved };
  }
  if (args.p_action === 'finish_verify') { busy = false; return { data: completed }; }
  throw new Error('Unexpected RPC');
} };
const otp = {
  async sendOtp() { sends++; return { sessionId: 'private-provider-session' }; },
  async verifyOtp(session, code) {
    verifies++;
    assert.equal(session, 'private-provider-session');
    assert.equal(code, '123456');
    if (providerError) throw new Error('private provider failure');
    if (waiting) await waiting;
    return providerOutcome;
  },
};
const service = createMerchantPhoneVerification({ client, otp });
try {
  assert.deepEqual(await service.send('merchant-1', '9000000001'), { sent: true });
  assert.equal(sends, 1);
  const sent = calls.find(call => call.p_action === 'finish_send');
  assert.equal(decryptToken(sent.p_ciphertext), 'private-provider-session');
  assert.ok(!JSON.stringify(calls).includes('private-provider-session'), 'No plaintext reference sent to storage');

  calls = [];
  const result = await service.verify('merchant-1', '9000000001', '123456');
  assert.equal(result.verified, true);
  assert.deepEqual(calls.map(call => call.p_action), ['reserve_verify', 'finish_verify']);
  assert.equal(calls[1].p_lease_id, calls[0].p_lease_id);
  assert.equal(calls[1].p_request_id, 'request-1');

  for (const reason of ['busy', 'expired', 'not_requested', 'attempts_exceeded']) {
    reserved = { reason };
    const previous = verifies;
    assert.equal((await service.verify('merchant-1', '9000000001', '123456')).reason, reason);
    assert.equal(verifies, previous, 'Rejected reservation must not contact provider');
  }
  reserved = { reserved: true, requestId: 'request-1', ciphertext: encryptToken('private-provider-session') };
  let unblock;
  waiting = new Promise(resolve => { unblock = resolve; });
  const active = service.verify('merchant-1', '9000000001', '123456');
  await Promise.resolve();
  assert.equal((await service.verify('merchant-1', '9000000001', '123456')).reason, 'busy');
  unblock();
  await active;
  waiting = null;

  providerError = true;
  await assert.rejects(service.verify('merchant-1', '9000000001', '123456'));
  assert.equal(calls.at(-1).p_verified, false, 'Provider failure must finish the consumed attempt');
  providerError = false;
  providerOutcome = { verified: 'truthy-invalid-value' };
  completed = { verified: false, reason: 'invalid_code' };
  await service.verify('merchant-1', '9000000001', '123456');
  assert.equal(calls.at(-1).p_verified, false, 'Only boolean true may grant verification');
  providerOutcome = { verified: false, reason: 'expired' };
  await service.verify('merchant-1', '9000000001', '123456');
  assert.equal(calls.at(-1).p_expired, true);

  reserved = { reserved: true, requestId: 'legacy-1', legacySession: 'private-provider-session' };
  providerOutcome = { verified: true };
  completed = { verified: false, reason: 'stale' };
  assert.equal((await service.verify('merchant-1', '9000000001', '123456')).reason, 'stale', 'Provider success cannot override database lease fencing');
  failFinishSend = true;
  await assert.rejects(service.send('merchant-1', '9000000001'));
  assert.equal(calls.at(-1).p_action, 'cancel');

  const before = calls.length;
  const disabled = createMerchantPhoneVerification({ client, otp, encryptionReady: () => false });
  await assert.rejects(disabled.send('merchant-1', '9000000001'));
  await assert.rejects(disabled.verify('merchant-1', '9000000001', '123456'));
  assert.equal(calls.length, before, 'Invalid encryption config must fail before SMS or storage');
  console.log('PASS: encrypted merchant OTP references, reservation-first verification, duplicate blocking, fenced results, legacy challenges and safe provider failure cleanup. No SMS sent.');
} finally { config.tokenEncryptionKey = oldKey; }
