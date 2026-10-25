import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EmailService } from '../server/services/email.js';
const originalFetch = globalThis.fetch;
const originalError = console.error;
const input = { to: 'customer@example.invalid', subject: 'Fixture receipt', text: 'Fixture body' };
try {
  console.error = () => {};
  for (const stage of ['headers', 'body']) {
    let calls = 0;
    let capturedSignal;
    const service = new EmailService({ apiKey: 'fixture-not-real', fromEmail: 'Calup <fixture@example.invalid>', timeoutMs: 15 });
    globalThis.fetch = async (input, options) => {
      assert.equal(new URL(input).href, 'https://api.resend.com/emails', 'Only the mocked email request is permitted; no booking/database writes occur');
      calls++; capturedSignal = options.signal;
      assert.ok(capturedSignal instanceof AbortSignal, 'Installed SDK must forward send options.signal');
      if (stage === 'headers') return new Promise(() => {});
      return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } });
    };
    const start = performance.now();
    const result = await service.sendGenericEmail(input);
    assert.equal(result.success, false);
    assert.match(result.error, /timed out/);
    assert.equal(capturedSignal.aborted, true);
    assert.equal(calls, 1, 'Unknown delivery outcome must never trigger automatic retries');
    assert.ok(performance.now() - start < 500);
  }
  let calls = 0;
  let signal;
  const hanging = new EmailService({ apiKey: 'fixture-key', fromEmail: 'fixture@example.invalid', timeoutMs: 15,
    client: { emails: { send: (_payload, options) => { calls++; signal = options.signal; return new Promise(() => {}); } } } });
  await assert.rejects(hanging.sendEmail(hanging.getClient(), input), error => error.name === 'TimeoutError');
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  globalThis.fetch = async () => Response.json({ id: 'fixture-email-id' });
  const success = await new EmailService({ apiKey: 'fixture-key', fromEmail: 'fixture@example.invalid', timeoutMs: 100 }).sendGenericEmail(input);
  assert.deepEqual(success, { success: true, messageId: 'fixture-email-id' });
  const source = readFileSync('backend/server/services/email.js', 'utf8');
  assert.equal((source.match(/await this\.sendEmail\(client,/g) || []).length, 11, 'Every notification path uses the bounded wrapper');
  assert.equal((source.match(/client\.emails\.send\(/g) || []).length, 1, 'Only the shared wrapper calls the SDK directly');
  const { config } = await import('../server/config.js');
  const { handleCreateBooking } = await import('../server/routes/publicBookings.js');
  const { emailService } = await import('../server/services/email.js');
  const { googleCalendarService } = await import('../server/services/googleCalendar.js');
  const { richAutomateService } = await import('../server/services/richAutomate.js');
  const { refundService } = await import('../server/services/refundService.js');
  const originals = { config: { ...config }, key: emailService._apiKey, from: emailService._fromEmail, timeout: emailService.timeoutMs,
    client: emailService._client, busy: googleCalendarService.getBusyIntervals, create: googleCalendarService.createEvent,
    customer: richAutomateService.sendCustomerConfirmation, provider: richAutomateService.sendProviderNotification, audit: refundService.logAudit };
  try {
    const providerId = '11111111-1111-4111-8111-111111111111';
    const serviceId = '22222222-2222-4222-8222-222222222222';
    const bookingId = '33333333-3333-4333-8333-333333333333';
    const updates = [];
    let inserts = 0;
    let emailAttempts = 0;
    Object.assign(config, { supabaseUrl: 'https://fixture.supabase.co', supabaseServiceRoleKey: 'fixture-key', tokenEncryptionKey: '0'.repeat(64), frontendUrl: 'https://calup.example' });
    emailService._apiKey = 'fixture-key'; emailService._fromEmail = 'fixture@example.invalid'; emailService._client = null; emailService.timeoutMs = 15;
    googleCalendarService.getBusyIntervals = async () => ({ connected: false, busyTimes: [] });
    googleCalendarService.createEvent = async () => ({ success: true, eventId: 'fixture-event' });
    richAutomateService.sendCustomerConfirmation = async () => ({ skipped: true });
    richAutomateService.sendProviderNotification = async () => ({ skipped: true });
    refundService.logAudit = async () => {};
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.origin === 'https://api.resend.com') { emailAttempts++; return new Promise(() => {}); }
      assert.equal(url.origin, 'https://fixture.supabase.co');
      const table = url.pathname.replace('/rest/v1/', '');
      const method = options.method || 'GET';
      if (table === 'rpc/is_generated_booking_slot_v1') return Response.json(true);
      if (table === 'rpc/create_booking_atomic') { inserts++; return Response.json({ success: true, bookingId, endTime: '10:00' }); }
      if (table === 'services') return Response.json({ id: serviceId, provider_id: providerId, name: 'Fixture session', price: 0, duration: 60, active: true });
      if (table === 'providers') return Response.json({ id: providerId, name: 'Fixture merchant', email: 'merchant@example.invalid', timezone: 'Asia/Kolkata' });
      if (table === 'customers') return Response.json([{ id: 'fixture-customer' }]);
      if (table === 'cancellation_policies') return Response.json([]);
      assert.equal(table, 'bookings');
      if (method === 'GET') return Response.json(url.searchParams.get('select') === 'booking_reference' ? [{ booking_reference: 'M123456789' }] : []);
      assert.equal(method, 'PATCH', 'Notification timeout must not delete or recreate the persisted booking');
      updates.push(JSON.parse(options.body));
      return Response.json(null);
    };
    const res = { statusCode: 200, headersSent: false, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; this.headersSent = true; return this; } };
    await handleCreateBooking({ body: { providerId, serviceId, customerName: 'Fixture customer', customerEmail: 'customer@example.invalid', customerPhone: '9876543210', bookingDate: '2030-01-07', startTime: '09:00', managementToken: 'fixture-token-not-real' } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(inserts, 1);
    assert.equal(emailAttempts, 2, 'Customer and merchant each get one bounded email attempt');
    assert.equal(res.body.email.customerSent, false);
    assert.equal(res.body.email.providerSent, false);
    assert.match(res.body.email.customerError, /timed out/);
    assert.match(res.body.email.providerError, /timed out/);
    assert.ok(!updates.some(update => update.status === 'cancelled'));
  } finally {
    Object.assign(config, originals.config);
    emailService._apiKey = originals.key; emailService._fromEmail = originals.from; emailService.timeoutMs = originals.timeout; emailService._client = originals.client;
    googleCalendarService.getBusyIntervals = originals.busy; googleCalendarService.createEvent = originals.create;
    richAutomateService.sendCustomerConfirmation = originals.customer; richAutomateService.sendProviderNotification = originals.provider; refundService.logAudit = originals.audit;
  }
  console.log('PASS: installed Resend SDK forwards abort; email header/body and injected-client hangs fail within deadline without retries or rolling back a created booking.');
} finally { globalThis.fetch = originalFetch; console.error = originalError; }
