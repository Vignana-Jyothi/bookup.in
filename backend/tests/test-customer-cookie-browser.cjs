// Opt-in Chrome test of real HTTP cookie persistence through the production bridge.
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const { createCustomerProxy } = await import('../../frontend/server/customerProxy.mjs');
  const observations = [];
  const handler = createCustomerProxy({ target: () => 'https://fixture-backend.example/api', fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    const cookie = options.headers.cookie || '';
    const hasCheckout = cookie.includes('calup_attempt_v1=fixture-checkout') && cookie.includes('calup_attempt_reference_v1=fixture-reference');
    const hasPhoneProof = cookie.includes('calup_commerce_access=fixture-verified-phone');
    observations.push({ path, hasCheckout, hasPhoneProof });
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const restore = () => {
      headers.append('Set-Cookie', 'calup_attempt_v1=fixture-checkout; Path=/api/v1/public; HttpOnly; SameSite=Lax');
      headers.append('Set-Cookie', 'calup_attempt_reference_v1=fixture-reference; Path=/api/v1/public; HttpOnly; SameSite=Lax');
    };
    if (path.endsWith('/otp/verify')) {
      headers.append('Set-Cookie', 'calup_commerce_access=fixture-verified-phone; Path=/api/v1/public/commerce; HttpOnly; SameSite=Lax');
      headers.append('Set-Cookie', 'calup_commerce_challenge=; Path=/api/v1/public/commerce; HttpOnly; Max-Age=0');
      return new Response('{"data":{"verified":true}}', { headers });
    }
    if (path.endsWith('/booking-payments')) return new Response(JSON.stringify(hasPhoneProof ? { data: { attempts: [{ attemptId: 'fixture', paymentStatus: 'pending' }] } } : { error: 'Verify phone' }), { status: hasPhoneProof ? 200 : 401, headers });
    if (path.endsWith('/booking-payments/fixture/open')) {
      if (!hasPhoneProof) return new Response('{}', { status: 401 });
      restore(); return new Response('{"data":{"opened":true}}', { headers });
    }
    if (path.endsWith('/booking-attempts')) { restore(); return new Response('{"data":{"attemptId":"fixture"}}', { status: 201, headers }); }
    return new Response(JSON.stringify(hasCheckout ? { data: { paymentStatus: 'pending' } } : { error: 'Checkout access required' }), { status: hasCheckout ? 200 : 401, headers });
  } });
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) void handler(req, res);
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Calup cookie test</title><p>Isolated first-party cookie test</p>'); }
  });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const results = await page.evaluate(async () => {
        const get = path => fetch('/api/v1/public/' + path, { credentials: 'include' });
        const post = path => fetch('/api/v1/public/' + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'fixture-key' }, body: '{}' });
        const beforeProof = (await get('commerce/merchant/booking-payments')).status;
        const created = (await post('booking-attempts')).status;
        const retry = (await post('checkout-sessions/current/open')).status;
        const refresh = (await post('checkout-sessions/current/refresh')).status;
        await post('commerce/merchant/otp/verify');
        const found = (await get('commerce/merchant/booking-payments')).status;
        const restored = (await post('commerce/merchant/booking-payments/fixture/open')).status;
        const retryRestored = (await post('checkout-sessions/current/open')).status;
        return { beforeProof, created, retry, refresh, found, restored, retryRestored, scriptCannotReadProof: document.cookie === '' };
      });
      assert.deepEqual(results, { beforeProof: 401, created: 201, retry: 200, refresh: 200, found: 200, restored: 200, retryRestored: 200, scriptCannotReadProof: true });
      assert(observations.filter(item => item.path.includes('/checkout-sessions')).every(item => item.hasCheckout));
      console.log('PASS Chrome: real first-party HttpOnly cookies persist across create, retry, refresh, verified phone lookup, restore and retry again. No external requests/SMS/payments.');
    } finally { await context.close(); }
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
