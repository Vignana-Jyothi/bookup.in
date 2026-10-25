import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { config } from '../server/config.js';
import { serviceRoleClient } from '../server/middleware/auth.js';
import { emailService } from '../server/services/email.js';
import { startPaymentNotificationWorker, stopPaymentNotificationWorker } from '../server/services/paymentNotifications.js';

const original = { rpc: serviceRoleClient.rpc, enabled: config.cashfreeEnabled,
  configured: emailService.isConfigured, client: emailService.getClient, from: emailService._fromEmail };
let claims = 0; let deliveries = 0; let completed = 0; let ready = false;
try {
  config.cashfreeEnabled = true;
  emailService.isConfigured = () => true;
  emailService._fromEmail = 'Calup <fixture@example.invalid>';
  emailService.getClient = () => ({ emails: { async send() { deliveries++; return { data: { id: 'fixture-message' }, error: null }; } } });
  serviceRoleClient.rpc = async name => {
    if (name === 'claim_payment_notification_jobs_v1') {
      claims++;
      if (!ready) return { data: [] };
      ready = false;
      return { data: [{ jobId: 'fixture-job', generation: 1 }] };
    }
    if (name === 'get_payment_notification_context_v1') return { data: {
      deliver: true, environment: 'sandbox', gatewayAccount: 'calup_primary', paymentPath: 'cashfree', purpose: 'service_booking',
      recipient: 'customer', customerEmail: 'customer@example.invalid', customerName: 'Fixture customer', providerName: 'Fixture merchant',
      serviceName: 'Fixture service', bookingReference: 'M123456789', bookingDate: '2030-01-01', startTime: '09:00', duration: 60,
      timezone: 'UTC', frontendUrl: 'https://fixture.example.invalid', issuedAt: new Date().toISOString(), calendarDomain: 'example.invalid',
    } };
    if (name === 'heartbeat_outbox_job_v1') return { data: true };
    if (name === 'complete_outbox_job_v1') { completed++; return { data: true }; }
    throw new Error('Unexpected worker operation');
  };
  startPaymentNotificationWorker();
  // First immediate cycle has no work. Only the real interval can see the new job.
  const started = Date.now();
  while (!claims && Date.now() - started < 2000) await wait(20);
  assert.equal(claims, 1);
  assert.equal(deliveries, 0);
  ready = true;
  while (!completed && Date.now() - started < 35000) await wait(100);
  assert(claims >= 2, 'The recurring worker must run after its startup cycle');
  assert.equal(deliveries, 1);
  assert.equal(completed, 1);
  console.log('PASS: actual 30-second notification timer discovers later work and completes delivery without a manual cycle. Fixture DB/mailer only.');
} finally {
  stopPaymentNotificationWorker();
  serviceRoleClient.rpc = original.rpc; config.cashfreeEnabled = original.enabled;
  emailService.isConfigured = original.configured; emailService.getClient = original.client; emailService._fromEmail = original.from;
}
