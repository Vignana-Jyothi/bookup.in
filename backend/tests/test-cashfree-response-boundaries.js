import assert from 'node:assert/strict';
import { CashfreeClient } from '../server/services/cashfree.js';

const client = options => new CashfreeClient({ clientId: 'fixture-id', clientSecret: 'fixture-secret', timeoutMs: 15, ...options });
for (const raw of ['', '<html>gateway unavailable</html>', 'null', 'true', '123', '"not an order"']) {
  await assert.rejects(client({ fetchImpl: async () => ({ ok: true, text: async () => raw }) }).getOrder('fixture-order'), error => error.outcome === 'unknown');
}
for (const stage of ['headers', 'body']) {
  let calls = 0;
  let signal;
  const gateway = client({ fetchImpl: async (_url, options) => {
    calls++; signal = options.signal;
    if (stage === 'headers') return new Promise(() => {});
    return { ok: true, text: () => new Promise(() => {}) };
  } });
  const started = performance.now();
  await gateway.getOrder('fixture-order').then(() => assert.fail('Stalled gateway must reject'), error => {
    assert.equal(error.outcome, 'unknown');
    assert.equal(error.code, 'CASHFREE_UNREACHABLE');
  });
  assert(performance.now() - started < 500);
  assert.equal(calls, 1, 'Uncertain gateway operations must never automatically retry');
  assert.equal(signal.aborted, true);
}
for (const [status, outcome] of [[400, 'definitive'], [401, 'definitive'], [404, 'definitive'], [408, 'unknown'], [429, 'unknown'], [503, 'unknown']]) {
  await assert.rejects(client({ fetchImpl: async () => ({ ok: false, status, text: async () => '<html>upstream error</html>' }) }).getOrder('fixture-order'), error => error.outcome === outcome && error.status === status);
}
console.log('PASS: Cashfree invalid JSON and header/body deadlines remain unknown, preserve HTTP outcomes and never retry');
