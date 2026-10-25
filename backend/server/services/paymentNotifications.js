import crypto from 'node:crypto';
import { config } from '../config.js';
import { serviceRoleClient } from '../middleware/auth.js';
import { emailService } from './email.js';

let timer; let running = false;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function notificationCalendarDomain() {
  if (config.appDomain) return config.appDomain;
  try { return new URL(config.frontendUrl).hostname; } catch { return 'localhost'; }
}

// A per-delivery facade preserves the SDK abort signal and adds a stable key
// without mutating the shared mailer or retrying another recipient's delivery.
export function idempotentMailer(mail, key) {
  const facade = Object.create(mail);
  facade.getClient = () => {
    const client = mail.getClient();
    return client ? { emails: { send: (payload, options) => client.emails.send(payload, { ...options, idempotencyKey: key }) } } : null;
  };
  return facade;
}

export async function deliverPaymentNotification(context, { mail = emailService, key, supportEmail = config.supportEmail, frontendUrl = config.frontendUrl } = {}) {
  supportEmail = context.supportEmail ?? supportEmail;
  frontendUrl = context.frontendUrl ?? frontendUrl;
  const sender = idempotentMailer(mail, key);
  if (context.fromEmail) Object.defineProperty(sender, 'fromEmail', { value: context.fromEmail });
  const to = context.recipient === 'support' ? supportEmail : context.recipient === 'merchant' ? context.merchantEmail : context.customerEmail;
  if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { success: false, error: 'RECIPIENT_UNAVAILABLE' };
  if (context.resolutionCaseId) {
    const subject = context.recipient === 'support' ? 'Calup payment needs manual review' : 'Calup received your payment; booking needs review';
    const text = `Payment was received for ${context.serviceName || 'your session'}, but the appointment could not be confirmed. Calup must review this payment. No replacement session or refund has been completed automatically. Reference: ${context.resolutionCaseId}.`;
    return sender.sendGenericEmail({ to, subject, text, html: `<p>${escapeHtml(text)}</p>` });
  }
  const payload = { to, customerName: context.customerName, providerName: context.providerName,
    customerEmail: context.customerEmail || '', customerPhone: context.customerPhone || '',
    serviceName: context.serviceName, bookingDate: context.bookingDate, startTime: context.startTime,
    duration: context.duration, meetLink: context.meetLink || '', bookingId: context.bookingReference,
    managementUrl: `${String(frontendUrl || '').replace(/\/+$/, '')}/booking-status`, timeZone: context.timezone };
  payload.issuedAt = context.issuedAt;
  payload.calendarDomain = context.calendarDomain;
  return context.recipient === 'merchant'
    ? sender.sendCoachBookingConfirmedEmail(payload) : sender.sendCustomerConfirmationEmail(payload);
}

export async function runPaymentNotificationCycle({ database = serviceRoleClient, deliver = deliverPaymentNotification,
  environment = config.cashfreeEnvironment, enabled = () => config.cashfreeEnabled } = {}) {
  if (running || !database || !enabled()) return;
  running = true;
  const owner = crypto.randomUUID();
  try {
    const claimed = await database.rpc('claim_payment_notification_jobs_v1', { p_owner: owner, p_limit: 10 });
    if (claimed.error || !Array.isArray(claimed.data)) throw new Error('NOTIFICATION_CLAIM_FAILED');
    for (const job of claimed.data) {
      const finish = (succeeded, error = null, maxAttempts = 8) => database.rpc('complete_outbox_job_v1', {
        p_job_id: job.jobId, p_lease_owner: owner, p_lease_generation: job.generation,
        p_succeeded: succeeded, p_safe_error: error, p_max_attempts: maxAttempts,
      });
      try {
        const loaded = await database.rpc('get_payment_notification_context_v1', {
          p_job_id: job.jobId, p_owner: owner, p_generation: job.generation,
          p_delivery_settings: { environment, supportEmail: config.supportEmail, frontendUrl: config.frontendUrl,
            fromEmail: emailService.fromEmail, calendarDomain: notificationCalendarDomain(),
            mailReady: emailService.isConfigured() && Boolean(emailService.fromEmail) },
        });
        if (loaded.error) throw new Error('NOTIFICATION_CONTEXT_FAILED');
        const context = loaded.data;
        if (!context) continue; // Stale ownership must never send or complete.
        if (context.deliver === false) { await finish(true); continue; }
        if (context.deliver !== true || context.environment !== environment || context.gatewayAccount !== 'calup_primary'
          || context.paymentPath !== 'cashfree' || context.purpose !== 'service_booking') continue;
        if (context.reviewRequired === true) { await finish(false, 'NOTIFICATION_IDEMPOTENCY_WINDOW_EXPIRED', 1); continue; }
        if (context.configurationPending === true) { await finish(false, 'NOTIFICATION_CONFIGURATION_PENDING'); continue; }
        const heartbeat = await database.rpc('heartbeat_outbox_job_v1', {
          p_job_id: job.jobId, p_lease_owner: owner, p_lease_generation: job.generation, p_lease_seconds: 60,
        });
        if (heartbeat.error || heartbeat.data !== true) continue;
        const result = await deliver(context, { key: `calup-payment-email-${job.jobId}` });
        const acknowledged = result?.success === true && typeof result.messageId === 'string' && result.messageId.length > 0;
        await finish(acknowledged, acknowledged ? null : 'NOTIFICATION_DELIVERY_PENDING');
      } catch {
        await finish(false, 'NOTIFICATION_DELIVERY_PENDING');
      }
    }
  } catch {
    console.warn('[PaymentNotifications] Durable delivery remains pending.');
  } finally { running = false; }
}

export function startPaymentNotificationWorker() {
  if (timer || !config.cashfreeEnabled) return;
  timer = setInterval(runPaymentNotificationCycle, 30_000);
  timer.unref?.();
  setImmediate(runPaymentNotificationCycle);
}
export function stopPaymentNotificationWorker() { if (timer) clearInterval(timer); timer = null; }
