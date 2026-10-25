import assert from 'node:assert/strict';
import { verifiedBookingContact } from '../server/services/bookingPhoneVerification.js';
import { currentBookingPhoneVerification, normalizedBookingPhone } from '../../frontend/src/services/payments/bookingPhoneVerification.js';
import { createCashfreeV1Router } from '../server/routes/cashfreeV1.js';
import { config } from '../server/config.js';
import { cashfreeClient } from '../server/services/cashfree.js';

const now = Date.now();
const token = 'a'.repeat(64);
const provider = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const phone = '9876543210';
let calls = 0;
let session = { contact_id: contactId, expires_at: new Date(now + 60000).toISOString() };
let contact = { id: contactId, provider_id: provider, phone };
let failure = false;
const db = { from(table) {
  calls++;
  const filters = {};
  return { select() { return this; }, eq(key, value) { filters[key] = value; return this; }, gt() { return this; },
    async maybeSingle() {
      if (failure) return { error: { message: 'Fixture storage unavailable' } };
      if (table === 'commerce_customer_sessions') return { data: session };
      assert.equal(filters.provider_id, provider); assert.equal(filters.phone, phone);
      assert.equal(filters.id, contactId);
      return { data: contact };
    } };
} };
for (const cookie of ['', 'calup_commerce_access=bad', 'calup_commerce_access=%ZZ']) {
  assert.equal(await verifiedBookingContact({ headers: { cookie } }, db, provider, phone, now), null);
}
assert.equal(calls, 0);
const req = { headers: { cookie: `calup_commerce_access=${token}` } };
assert.equal(await verifiedBookingContact(req, db, provider, phone, now), contactId);
contact = { ...contact, phone: '9876543211' };
assert.equal(await verifiedBookingContact(req, db, provider, phone, now), null);
contact = { id: contactId, provider_id: 'other-provider', phone };
assert.equal(await verifiedBookingContact(req, db, provider, phone, now), null);
session.expires_at = new Date(now).toISOString();
assert.equal(await verifiedBookingContact(req, db, provider, phone, now), null);
failure = true;
await assert.rejects(verifiedBookingContact(req, db, provider, phone, now), /PHONE_VERIFICATION_STORAGE/);

assert.equal(normalizedBookingPhone('+91 98765 43210'), phone);
const proof = { slug: 'fixture', phone, expiresAt: now + 1000 };
assert(currentBookingPhoneVerification(proof, 'fixture', '+91 98765 43210', now));
for (const [slug, number, clock] of [['other', phone, now], ['fixture', '9876543211', now], ['fixture', phone, now + 1000]]) {
  assert.equal(currentBookingPhoneVerification(proof, slug, number, clock), false);
}
assert.equal(currentBookingPhoneVerification(null, 'fixture', phone, now), false);

// A browser-supplied UUID alone previously bypassed the phone gate. Exercise the handler.
const old = { enabled: config.cashfreeEnabled, bypass: config.cashfreeAllowUnverifiedContact, configured: config.isCashfreeConfigured, gateway: cashfreeClient.isConfigured };
try {
  config.cashfreeEnabled = true; config.cashfreeAllowUnverifiedContact = false;
  config.isCashfreeConfigured = () => true; cashfreeClient.isConfigured = () => true;
  const handler = createCashfreeV1Router().stack.find(layer => layer.route?.path === '/booking-attempts').route.stack.at(-1).handle;
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ headers: { 'idempotency-key': 'fixture-phone-check-20261025' }, body: {
    providerId: provider, serviceId: contactId, bookingDate: '2030-01-01', startTime: '09:00', customerName: 'Fixture customer',
    customerPhone: phone, verificationGrantId: contactId,
  } }, response);
  assert.equal(response.code, 401); assert.equal(response.body.error.code, 'OTP_REQUIRED');
} finally {
  config.cashfreeEnabled = old.enabled; config.cashfreeAllowUnverifiedContact = old.bypass;
  config.isCashfreeConfigured = old.configured; cashfreeClient.isConfigured = old.gateway;
}
console.log('PASS: verified SMS session requires matching merchant/phone, expiry and storage; forged grant UUID denied; frontend proof scope/expiry checked. No SMS sent.');
