import assert from 'node:assert/strict';
import { openApiDocument, swaggerPage } from '../server/openapi.js';

const requiredOperations = {
  '/api/v1/public/commerce/{slug}/orders': ['get'],
  '/api/v1/public/commerce/{slug}/items/{id}/checkout': ['post'],
  '/api/v1/public/commerce/{slug}/orders/{id}/open': ['post'],
  '/api/v1/public/commerce/{slug}/orders/{id}/refresh': ['post'],
  '/api/v1/merchant/commerce/orders': ['get'],
  '/api/v1/webhooks/cashfree/commerce/{purpose}': ['post'],
  '/api/v1/public/commerce/{slug}/catalog': ['get'],
  '/api/v1/public/commerce/{slug}/otp/send': ['post'],
  '/api/v1/public/commerce/{slug}/otp/verify': ['post'],
  '/api/v1/public/commerce/{slug}/session': ['get'],
  '/api/v1/public/commerce/{slug}/items/{id}/access': ['post'],
  '/api/v1/merchant/commerce/items/{id}/publication': ['post'],
  '/api/v1/merchant/commerce/access-requests': ['get'],
  '/api/v1/merchant/commerce/access-requests/{id}/decision': ['post'],
  '/api/v1/merchant/commerce': ['get'],
  '/api/v1/merchant/commerce/vault': ['post'],
  '/api/v1/merchant/commerce/items': ['post'],
  '/api/v1/merchant/commerce/products/{id}/upload': ['post'],
  '/api/v1/merchant/commerce/products/{id}/asset': ['get', 'post'],
  '/health': ['get'],
  '/api/health': ['get'],
  '/api/v1/public/booking-attempts': ['post'],
  '/api/v1/public/checkout-sessions/current': ['get'],
  '/api/v1/public/checkout-sessions/current/open': ['post'],
  '/api/v1/public/checkout-sessions/current/refresh': ['post'],
  '/api/v1/public/checkout-sessions/current/complete': ['post'],
  '/api/v1/webhooks/cashfree/payments': ['post'],
  '/api/v1/public/customer-bookings/track': ['post'],
  '/api/v1/public/customer-bookings/current': ['get'],
  '/api/v1/public/bookings/access-session': ['post'],
  '/api/v1/public/bookings/current': ['get'],
  '/api/v1/public/bookings/current/reschedule': ['post'],
  '/api/v1/public/bookings/current/cancel': ['post'],
  '/api/v1/public/bookings/current/mark-paid': ['post'],
  '/api/v1/merchant/appointments': ['get'],
  '/api/v1/merchant/scheduling': ['get'],
  '/api/v1/merchant/onboarding/email-verification/send': ['post'],
  '/api/v1/merchant/onboarding/email-verification/verify': ['post'],
  '/api/policies': ['get', 'put'],
  '/api/calendar/busy': ['get'],
  '/api/calendar/events': ['post'],
  '/api/auth/google/url': ['get'],
  '/api/auth/google/callback': ['get'],
  '/api/auth/google/status': ['get'],
  '/api/auth/google/disconnect': ['post'],
  '/api/internal/notifications/process-reminders': ['get', 'post'],
};

assert.equal(openApiDocument.openapi, '3.0.3');
assert.equal(openApiDocument.info.title, 'Calup API');

for (const [path, methods] of Object.entries(requiredOperations)) {
  assert.ok(openApiDocument.paths[path], `OpenAPI path missing: ${path}`);
  for (const method of methods) {
    const operation = openApiDocument.paths[path][method];
    assert.ok(operation, `OpenAPI operation missing: ${method.toUpperCase()} ${path}`);
    assert.ok(operation.summary, `Summary missing: ${method.toUpperCase()} ${path}`);
    assert.ok(operation.responses, `Responses missing: ${method.toUpperCase()} ${path}`);
  }
}

for (const path of Object.keys(openApiDocument.paths)) {
  assert.equal(/bookup/i.test(path), false, `Internal codename exposed in API path: ${path}`);
}

const html = swaggerPage();
assert.match(html, /SwaggerUIBundle/);
assert.match(html, /\/api\/openapi\.json/);
assert.match(html, /credentials='include'/);

console.log(`PASS: OpenAPI contract covers ${Object.keys(openApiDocument.paths).length} documented paths.`);
