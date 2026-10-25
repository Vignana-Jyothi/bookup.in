import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cashfreeCheckoutService } from '../../frontend/src/services/payments/cashfreeCheckout.js';
import { installCheckoutRecovery, safeRecoveryPath } from '../../frontend/src/services/payments/checkoutRecovery.js';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
let failLoad = true;
let appended = 0;
let removed = 0;
let sdkResult = {};
globalThis.window = {};
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ remove() { removed += 1; } }),
  head: {
    appendChild(script) {
      appended += 1;
      queueMicrotask(() => {
        if (failLoad) script.onerror();
        else {
          window.Cashfree = ({ mode }) => ({
            async checkout(options) {
              assert.equal(mode, 'sandbox');
              assert.equal(options.redirectTarget, '_modal');
              assert.equal(options.paymentSessionId, 'private-session-token');
              if (sdkResult instanceof Error) throw sdkResult;
              return sdkResult;
            },
          });
          script.onload();
        }
      });
    },
  },
};

try {
  await assert.rejects(cashfreeCheckoutService.openHostedPopup({ paymentSessionId: 'private-session-token' }), /could not be completed/);
  failLoad = false;
  await cashfreeCheckoutService.openHostedPopup({ paymentSessionId: 'private-session-token' });
  assert.equal(appended, 2, 'A failed SDK load must be retryable without refreshing');
  assert.equal(removed, 1, 'Failed script elements are removed');

  sdkResult = { error: { message: 'Something went wrong: private-session-token' } };
  await assert.rejects(cashfreeCheckoutService.openHostedPopup({ paymentSessionId: 'private-session-token' }), error => {
    assert.equal(error.code, 'CASHFREE_CHECKOUT_FAILED');
    assert.ok(!error.message.includes('private-session-token'), 'Provider errors must not expose session tokens');
    return true;
  });
  sdkResult = new Error('private-session-token');
  await assert.rejects(cashfreeCheckoutService.openHostedPopup({ paymentSessionId: 'private-session-token' }), error => {
    assert.equal(error.code, 'CASHFREE_CHECKOUT_FAILED');
    assert.ok(!error.message.includes('private-session-token'));
    return true;
  });
  sdkResult = { paymentDetails: 'presentation only' };
  assert.deepEqual(await cashfreeCheckoutService.openHostedPopup({ paymentSessionId: 'private-session-token' }), sdkResult);
  sdkResult = { redirect: true };
  assert.deepEqual(await cashfreeCheckoutService.openHostedPopup({ paymentSessionId: 'private-session-token' }), sdkResult);
  await assert.rejects(cashfreeCheckoutService.openHostedPopup({ paymentSessionId: 'private-session-token', cashfreeMode: 'invalid' }), /environment is invalid/);
  let finish;
  window.Cashfree = () => ({ checkout: () => new Promise(resolve => { finish = resolve; }) });
  const active = cashfreeCheckoutService.openHostedPopup({ paymentSessionId: 'private-session-token' });
  await Promise.resolve();
  await assert.rejects(cashfreeCheckoutService.openHostedPopup({ paymentSessionId: 'another-private-session' }), { code: 'CASHFREE_CHECKOUT_ACTIVE' });
  finish({ paymentDetails: 'not proof' });
  await active;

  // Recovery neither settles the SDK promise nor sends any API mutation.
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const nodes = [];
  let showRecovery;
  let cleared = false;
  let navigated;
  try {
    globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 60000); showRecovery = callback; return 7; };
    globalThis.clearTimeout = id => { assert.equal(id, 7); cleared = true; };
    document.createElement = tag => {
      const node = { tag, style: {}, setAttribute() {}, append(...children) { this.children = children; },
        addEventListener(_event, callback) { this.click = callback; }, remove() { this.removed = true; } };
      nodes.push(node);
      return node;
    };
    document.body = { appendChild(node) { assert.equal(node.tag, 'aside'); } };
    window.location = { assign(path) { navigated = path; } };
    const dispose = installCheckoutRecovery('/dashboard/subscription');
    assert.equal(nodes.length, 0, 'Help must not cover an ordinary checkout immediately');
    showRecovery();
    nodes.find(node => node.tag === 'button').click();
    assert.equal(navigated, '/dashboard/subscription');
    dispose();
    assert.ok(cleared && nodes[0].removed, 'SDK completion removes the timer and help');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
  for (const path of ['https://evil.example', '//evil.example', '/payment-status?token=secret', '/book/name/memberships#secret']) {
    assert.equal(safeRecoveryPath(path), '/payment-status');
  }
  assert.equal(safeRecoveryPath('/book/merchant-name/marketplace'), '/book/merchant-name/marketplace');
  for (const file of ['BookingPage.jsx', 'CashfreePaymentStatus.jsx']) {
    const source = fs.readFileSync(`frontend/src/pages/booking/${file}`, 'utf8');
    assert.match(source, /popupResult\?\.redirect/);
    assert.match(source, /CASHFREE_CHECKOUT_ACTIVE/);
  }
  console.log('PASS: SDK retries, safe errors, redirect preservation, environment checks, concurrent checkout protection and delayed safe recovery.');
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
