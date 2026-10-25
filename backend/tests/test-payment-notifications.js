import assert from 'node:assert/strict';
import { runPaymentNotificationCycle, idempotentMailer, deliverPaymentNotification } from '../server/services/paymentNotifications.js';
import { EmailService } from '../server/services/email.js';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Real network/email access is forbidden'); };
let completed = new Set(); let attempts = []; let finishes = []; let heartbeatAllowed = true; let contextMode = 'eligible';
let merchantFailures = 1;
const jobs = [
  { jobId: 'fixture-customer-job', generation: 1, recipient: 'customer' },
  { jobId: 'fixture-merchant-job', generation: 1, recipient: 'merchant' },
];
const database = { async rpc(name, payload) {
  if (name === 'claim_payment_notification_jobs_v1') return { data: jobs.filter(job => !completed.has(job.jobId)), error: null };
  if (name === 'get_payment_notification_context_v1') {
    const job = jobs.find(value => value.jobId === payload.p_job_id);
    return { data: contextMode === 'stale' ? null : contextMode === 'cancelled' ? { deliver: false } : {
      deliver: true, environment: contextMode === 'wrong-scope' ? 'production' : 'sandbox',
      gatewayAccount: 'calup_primary', paymentPath: 'cashfree', purpose: 'service_booking', recipient: job.recipient,
      configurationPending: contextMode === 'configuration-pending', reviewRequired: contextMode === 'review-required',
    }, error: null };
  }
  if (name === 'heartbeat_outbox_job_v1') return { data: heartbeatAllowed, error: null };
  assert.equal(name, 'complete_outbox_job_v1');
  finishes.push(payload);
  if (payload.p_succeeded) completed.add(payload.p_job_id);
  return { data: true, error: null };
} };
const deliver = async (context, options) => {
  attempts.push({ recipient: context.recipient, key: options.key });
  if (context.recipient === 'merchant' && merchantFailures-- > 0) throw new Error('Fixture ambiguous send timeout');
  return { success: true, messageId: 'fixture-provider-ack' };
};
const cycle = () => runPaymentNotificationCycle({ database, deliver, enabled: () => true, environment: 'sandbox' });
try {
  await cycle();
  assert(completed.has('fixture-customer-job'));
  assert(!completed.has('fixture-merchant-job'));
  await cycle();
  assert.equal(attempts.filter(value => value.recipient === 'customer').length, 1, 'Never resend a completed recipient when another fails');
  assert.equal(attempts[1].key, attempts[2].key, 'Ambiguous retries retain provider idempotency across claims');
  assert(completed.has('fixture-merchant-job'));
  for (const mode of ['stale', 'cancelled', 'wrong-scope', 'lost-heartbeat', 'configuration-pending', 'review-required']) {
    completed = new Set(); attempts = []; finishes = [];
    contextMode = mode === 'lost-heartbeat' ? 'eligible' : mode; heartbeatAllowed = mode !== 'lost-heartbeat';
    await cycle();
    assert.equal(attempts.length, 0, mode);
    if (mode === 'stale' || mode === 'lost-heartbeat') assert.equal(finishes.length, 0, 'A stale owner cannot send or complete');
    if (mode === 'cancelled') assert(finishes.every(value => value.p_succeeded), 'Current cancellation suppresses delivery');
    if (mode === 'wrong-scope') assert.equal(finishes.length, 0, 'Wrong environment/account must preserve delivery state');
    if (mode === 'configuration-pending') assert(finishes.every(value => !value.p_succeeded));
    if (mode === 'review-required') assert(finishes.every(value => !value.p_succeeded && value.p_max_attempts === 1));
  }
  completed = new Set(); finishes = []; contextMode = 'eligible'; heartbeatAllowed = true;
  await runPaymentNotificationCycle({ database, deliver: async () => ({ success: true }), enabled: () => true, environment: 'sandbox' });
  assert(finishes.every(value => !value.p_succeeded), 'An absent provider message ID must never complete delivery');
  let options;
  const signal = new AbortController().signal;
  const mail = { getClient: () => ({ emails: { send: async (_payload, input) => { options = input; return { data: { id: 'fixture-id' } }; } } }) };
  await idempotentMailer(mail, 'stable-job-key').getClient().emails.send({}, { signal });
  assert.equal(options.signal, signal);
  assert.equal(options.idempotencyKey, 'stable-job-key');
  let generic;
  const genericMail = { getClient: mail.getClient, async sendGenericEmail(payload) { generic = payload; return { success: true }; } };
  const result = await deliverPaymentNotification({ recipient: 'support', resolutionCaseId: 'fixture-case', serviceName: '<Session>' }, {
    mail: genericMail, key: 'fixture-key', supportEmail: 'support@example.invalid',
  });
  assert.equal(result.success, true);
  assert.match(generic.text, /No replacement session or refund has been completed automatically/);
  assert.doesNotMatch(generic.html, /<Session>/);
  assert.deepEqual(await deliverPaymentNotification({ recipient: 'customer' }, { mail: genericMail, key: 'fixture-key' }), { success: false, error: 'RECIPIENT_UNAVAILABLE' });
  const emitted = [];
  const actualMail = new EmailService({ apiKey: 'fixture-api-key', fromEmail: 'changed@example.invalid', client: {
    emails: { send: async (payload, sendOptions) => { emitted.push({ payload, options: sendOptions }); return { data: { id: 'fixture-message' }, error: null }; } },
  } });
  const frozen = { recipient: 'customer', customerEmail: 'customer@example.invalid', fromEmail: 'frozen@example.invalid',
    customerName: 'Fixture customer', providerName: 'Fixture merchant', serviceName: 'Fixture service',
    bookingDate: '2090-01-02', startTime: '09:00', duration: 60, bookingReference: 'M123456789', timezone: 'UTC',
    issuedAt: '2026-10-25T01:02:03Z', calendarDomain: 'frozen.example.invalid', frontendUrl: 'https://frozen.example.invalid' };
  for (let retry = 0; retry < 2; retry++) {
    const delivered = await deliverPaymentNotification(frozen, { mail: actualMail, key: 'frozen-sdk-key' });
    assert.equal(delivered.success, true, 'Actual EmailService getter/template/SDK chain must deliver');
  }
  assert.equal(emitted[0].payload.from, 'frozen@example.invalid', 'Frozen sender overrides a getter-only inherited property safely');
  assert.equal(actualMail.fromEmail, 'changed@example.invalid', 'Shared mail service remains unchanged');
  assert.deepEqual(emitted[0].payload, emitted[1].payload, 'The complete SDK payload including ICS bytes must remain stable');
  assert.match(emitted[0].payload.attachments[0].content.toString(), /DTSTAMP:20261025T010203Z/);
  assert.match(emitted[0].payload.attachments[0].content.toString(), /M123456789@frozen.example.invalid/);
  for (const request of emitted) {
    assert.equal(request.options.idempotencyKey, 'frozen-sdk-key');
    assert(request.options.signal instanceof AbortSignal);
  }
  for (let retry = 0; retry < 2; retry++) {
    const delivered = await deliverPaymentNotification({ ...frozen, recipient: 'merchant', merchantEmail: 'merchant@example.invalid' }, {
      mail: actualMail, key: 'frozen-merchant-key',
    });
    assert.equal(delivered.success, true);
  }
  assert.deepEqual(emitted[2].payload, emitted[3].payload, 'Merchant template retries also emit stable SDK payloads');
  assert.equal(emitted[2].options.idempotencyKey, 'frozen-merchant-key');
  console.log('Payment email worker recipient isolation, idempotency, state/lease guards and review fixtures passed.');
} finally { globalThis.fetch = originalFetch; }
