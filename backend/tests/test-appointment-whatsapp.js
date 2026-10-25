import assert from 'node:assert/strict';
import { sendAppointmentWhatsApp, runAppointmentWhatsAppCycle } from '../server/services/appointmentWhatsApp.js';

const settings = { enabled: true, token: 'test-token', phoneNumberId: '123456', template: 'calup_meeting', language: 'en', version: 'v23.0' };
const message = { phone: '9876543210', customerName: 'Customer', serviceName: 'Consultation', bookingId: 'M123456789', startsAt: '2026-11-01T06:30:00Z', timezone: 'Asia/Kolkata', meetLink: 'https://meet.google.com/abc-defg-hij' };
let requests = 0;
const fetchImpl = async (url, options) => {
  requests++;
  assert.equal(url, 'https://graph.facebook.com/v23.0/123456/messages');
  assert.equal(options.headers.Authorization, 'Bearer test-token');
  const body = JSON.parse(options.body);
  assert.equal(body.to, '919876543210');
  assert.equal(body.template.components[0].parameters.length, 5);
  assert.equal(body.template.components[0].parameters[4].text, message.meetLink);
  return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.test' }] }) };
};
assert.deepEqual(await sendAppointmentWhatsApp(message, { settings, fetchImpl }), { status: 'submitted', messageId: 'wamid.test' });
await sendAppointmentWhatsApp(message, { settings: { ...settings, enabled: false }, fetchImpl });
await sendAppointmentWhatsApp({ ...message, meetLink: 'https://attacker.example/meeting' }, { settings, fetchImpl });
assert.equal(requests, 1, 'Missing configuration and invalid links never send messages');
for (const [status, expected] of [[429, 'retry_wait'], [500, 'review_required'], [401, 'failed']]) {
  const result = await sendAppointmentWhatsApp(message, { settings, fetchImpl: async () => ({ ok: false, status, json: async () => ({ error: { code: 190, message: 'secret must not escape' } }) }) });
  assert.equal(result.status, expected);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
}
assert.equal((await sendAppointmentWhatsApp(message, { settings, fetchImpl: async () => { throw new Error('private provider payload'); } })).status, 'review_required');
const calls = [];
let sent = 0;
const database = { async rpc(name, args) {
  calls.push({ name, args });
  if (name === 'claim_appointment_whatsapp_v1') return { data: [{ id: 'job-1', lease_generation: 3 }, { id: 'stale-job', lease_generation: 1 }] };
  if (name === 'begin_appointment_whatsapp_v1') return { data: args.p_job_id === 'job-1' ? message : null };
  return { data: true };
} };
await runAppointmentWhatsAppCycle({ database, settings, send: async () => { sent++; return { status: 'submitted', messageId: 'wamid.test' }; } });
assert.equal(sent, 1, 'A stale/cancelled lease cannot send');
const completed = calls.find(call => call.name === 'complete_appointment_whatsapp_v1');
assert.equal(completed.args.p_generation, 3);
assert.equal(completed.args.p_status, 'submitted');
assert.equal(completed.args.p_message_id, 'wamid.test');
console.log('PASS: Meta template request, configuration gating, safe outcomes, and fenced worker dispatch.');
