import crypto from 'node:crypto';
import { serviceRoleClient } from '../middleware/auth.js';

const owner = `whatsapp-${crypto.randomUUID()}`;
let timer;
let running = false;

export function whatsappMeetingConfig() {
  return {
    enabled: process.env.WHATSAPP_MEETING_ENABLED === 'true', token: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '', template: process.env.WHATSAPP_MEETING_TEMPLATE || '',
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en', version: process.env.WHATSAPP_GRAPH_API_VERSION || 'v23.0',
  };
}

export function whatsappMeetingIsConfigured(settings = whatsappMeetingConfig()) {
  return Boolean(settings.enabled && settings.token && /^\d+$/.test(settings.phoneNumberId) &&
    /^[a-z0-9_]+$/.test(settings.template) && /^v\d+\.\d+$/.test(settings.version));
}

export async function sendAppointmentWhatsApp(message, { settings = whatsappMeetingConfig(), fetchImpl = globalThis.fetch } = {}) {
  if (!whatsappMeetingIsConfigured(settings)) return { status: 'failed', error: 'whatsapp_not_configured' };
  const phone = String(message.phone || '').replace(/\D/g, '');
  const recipient = phone.length === 10 ? `91${phone}` : phone;
  let meet;
  try { meet = new URL(message.meetLink); } catch { return { status: 'failed', error: 'meeting_link_invalid' }; }
  if (!/^91[6-9]\d{9}$/.test(recipient) || meet.protocol !== 'https:' || meet.hostname !== 'meet.google.com' || meet.username || meet.password) {
    return { status: 'failed', error: 'recipient_or_meeting_invalid' };
  }
  let when;
  try {
    when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: message.timezone || 'Asia/Kolkata' }).format(new Date(message.startsAt));
  } catch { return { status: 'failed', error: 'appointment_time_invalid' }; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${settings.version}/${settings.phoneNumberId}/messages`, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: recipient, type: 'template', template: {
        name: settings.template, language: { code: settings.language }, components: [{ type: 'body', parameters:
          [message.customerName || 'Customer', message.serviceName || 'Appointment', message.bookingId, when, meet.href]
            .map(value => ({ type: 'text', text: String(value || '') })) }],
      } }),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.messages?.[0]?.id) return { status: 'submitted', messageId: payload.messages[0].id };
    if (response.status === 429) return { status: 'retry_wait', error: 'meta_rate_limited' };
    if (response.status >= 500 || response.ok) return { status: 'review_required', error: 'send_outcome_unknown' };
    const code = Number(payload?.error?.code);
    return { status: 'failed', error: Number.isInteger(code) ? `meta_${code}` : `meta_http_${response.status}` };
  } catch {
    // Meta does not support a send idempotency key; unknown outcomes need review.
    return { status: 'review_required', error: 'send_outcome_unknown' };
  } finally { clearTimeout(timeout); }
}

export async function runAppointmentWhatsAppCycle({ database = serviceRoleClient, settings = whatsappMeetingConfig(), send = sendAppointmentWhatsApp } = {}) {
  if (running || !database || !whatsappMeetingIsConfigured(settings)) return;
  running = true;
  try {
    const { data: jobs, error } = await database.rpc('claim_appointment_whatsapp_v1', { p_owner: owner, p_limit: 10 });
    if (error) throw error;
    for (const job of jobs || []) {
      const { data: message, error: beginError } = await database.rpc('begin_appointment_whatsapp_v1', {
        p_job_id: job.id, p_owner: owner, p_generation: job.lease_generation,
      });
      if (beginError) throw beginError;
      if (!message) continue;
      const outcome = await send(message, { settings });
      const { error: finishError } = await database.rpc('complete_appointment_whatsapp_v1', {
        p_job_id: job.id, p_owner: owner, p_generation: job.lease_generation, p_status: outcome.status,
        p_message_id: outcome.messageId || null, p_error: outcome.error || null,
      });
      if (finishError) throw finishError;
    }
  } catch (error) {
    console.error('[AppointmentWhatsApp] Cycle failed', { code: error?.code || 'unknown' });
  } finally { running = false; }
}

export function startAppointmentWhatsAppWorker() {
  if (timer || !whatsappMeetingIsConfigured()) return;
  timer = setInterval(runAppointmentWhatsAppCycle, 30000);
  timer.unref?.();
  setImmediate(runAppointmentWhatsAppCycle);
}

export function stopAppointmentWhatsAppWorker() {
  clearInterval(timer);
  timer = null;
}
