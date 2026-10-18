import assert from 'node:assert/strict';
import { cashfreeCheckoutService } from '../../frontend/src/services/payments/cashfreeCheckout.js';

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
  await assert.rejects(cashfreeCheckoutService.openHostedPopup({ paymentSessionId: 'private-session-token' }), /could not be loaded/);
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
  console.log('PASS: Cashfree SDK load retries, popup errors, and session-safe messages.');
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
