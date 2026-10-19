import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';

// Execute the page's production async handlers with isolated hooks and services.
// No database, gateway, credentials, or network requests are used.
const source = await readFile(new URL('../../frontend/src/pages/booking/CashfreePaymentStatus.jsx', import.meta.url), 'utf8');
const isolated = source.replace(/^import .*;\r?\n/gm, '')
  .replace('export default function CashfreePaymentStatus()', 'function CashfreePaymentStatus()');
const transformed = await transformWithOxc(isolated, 'CashfreePaymentStatus.jsx', { jsx: { runtime: 'automatic' } });
const code = transformed.code.replace(/import .* from ["']react\/jsx-runtime["'];?/, '')
  .replace(/require\(["']react\/jsx-runtime["']\)/g, 'jsxRuntime')
  .replace(/\/\* Disabled navigation enhancement[\s\S]*?\*\//g, '');
const runtime = await import('react/jsx-runtime');
const mount = new Function('env', `with (env) { ${code}; return CashfreePaymentStatus; }`);

function pageHarness() {
  const slots = [];
  let cursor = 0;
  const effects = [];
  const notifications = [];
  const accessError = Object.assign(new Error('Secure browser access required'), { status: 401 });
  let result = accessError;
  const timers = new Map();
  let refreshes = 0;
  const respond = async () => { if (result instanceof Error) throw result; return result; };
  const env = {
    ...runtime,
    jsxRuntime: runtime,
    window: { setTimeout(callback) { timers.set('poll', callback); return 'poll'; }, clearTimeout(key) { timers.delete(key); } },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { return env.useState(() => ({ current: initial }))[0]; },
    useCallback(callback) { return callback; },
    useEffect(callback) { effects.push(callback); },
    useLocation: () => ({ state: { notice: 'Your slot remains protected.' }, key: 'test' }),
    useStore: () => ({ addToast: message => notifications.push(message) }),
    usePopupFeedback: () => ['', message => { if (message) notifications.push(message); }],
    cashfreeCheckoutService: {
      refreshPayment: async () => { refreshes++; return respond(); }, getAttempt: respond, finishCheckoutReturn: respond,
      getCheckoutSession: respond, getRestartPath: () => '/',
    },
    BrandLogo: () => null, TicketPanel: () => null, BookingReceipt: () => null,
    Link: ({ children }) => React.createElement('a', null, children),
  };
  const Page = mount(env);
  const render = () => { cursor = 0; effects.length = 0; return Page(); };
  const text = () => renderToStaticMarkup(render());
  const button = (label, node = render()) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'button' && node.props.children === label) return node;
    return React.Children.toArray(node.props?.children).map(child => button(label, child)).find(Boolean);
  };
  return {
    text, notifications, accessError,
    setResult(value) { result = value; },
    get refreshes() { return refreshes; },
    startPoll() { render(); return effects.at(-1)(); },
    async poll() { assert(timers.has('poll'), 'Unresolved state schedules reconciliation'); timers.get('poll')(); await new Promise(resolve => setImmediate(resolve)); },
    async load() {
      render();
      effects[0]();
      // The effect launches its async loader without returning its promise.
      await new Promise(resolve => setImmediate(resolve));
    },
    async click(label) { const target = button(label); assert(target, `Missing ${label} action`); await target.props.onClick(); },
  };
}

const page = pageHarness();
assert.match(page.text(), /Loading your payment session/);
assert.doesNotMatch(page.text(), /Confirming your payment|slot.*protected/);
await page.load();
assert.match(page.text(), /We couldn’t access your payment session/);
assert.match(page.text(), /browser where you started checkout/);
assert.match(page.text(), /Find your booking/);
assert.doesNotMatch(page.text(), /Confirming your payment|slot.*protected|Continue payment|Cancel payment/);
assert.deepEqual(page.notifications, []);

const pending = { attemptId: 'test', paymentStatus: 'pending', attemptStatus: 'hold_active', holdExpiresAt: new Date(Date.now() + 60000).toISOString(), paymentSessionId: 'test-session' };
page.setResult(pending);
await page.click('Try again');
assert.match(page.text(), /Confirming your payment/);
assert.match(page.text(), /temporarily protected until/);
page.setResult(page.accessError);
await page.click('Continue payment');
assert.match(page.text(), /We couldn’t access your payment session/);
assert.doesNotMatch(page.text(), /Time remaining|Continue payment|slot.*protected/);

for (const action of ['Check again', 'Close checkout and check status']) {
  const lostAccessPage = pageHarness();
  lostAccessPage.setResult(pending);
  await lostAccessPage.load();
  lostAccessPage.setResult(lostAccessPage.accessError);
  await lostAccessPage.click(action);
  assert.match(lostAccessPage.text(), /We couldn’t access your payment session/);
  assert.doesNotMatch(lostAccessPage.text(), /Time remaining|Continue payment|slot.*protected/);
}
const forbiddenPage = pageHarness();
forbiddenPage.setResult(Object.assign(new Error('Session forbidden'), { status: 403 }));
await forbiddenPage.load();
assert.match(forbiddenPage.text(), /We couldn’t access your payment session/);

for (const result of [null, new Error('Network unavailable')]) {
  page.setResult(result);
  await page.click('Try again');
  assert.match(page.text(), /Payment status is unavailable/);
  assert.doesNotMatch(page.text(), /Confirming your payment|slot.*protected/);
}
for (const hold of [{ holdExpiresAt: null }, { holdExpiresAt: new Date(0).toISOString() }, { attemptStatus: 'manual_review' }]) {
  page.setResult({ ...pending, ...hold });
  await page.click(page.text().includes('Try again') ? 'Try again' : 'Check again');
  assert.match(page.text(), hold.attemptStatus === 'manual_review' ? /Your payment needs review/ : /No active slot hold is confirmed/);
  assert.doesNotMatch(page.text(), /temporarily protected|Time remaining/);
}
for (const [result, title] of [
  [{ paymentStatus: 'succeeded', fulfilmentStatus: 'fulfilled' }, 'Your appointment is confirmed'],
  [{ paymentStatus: 'succeeded', fulfilmentStatus: 'unfulfilled' }, 'confirmation needs review'],
  [{ paymentStatus: 'closed_unpaid' }, 'Payment failed'],
]) {
  const terminalPage = pageHarness();
  terminalPage.setResult(result);
  await terminalPage.load();
  assert(terminalPage.text().includes(title));
}
for (const result of [
  { ...pending, holdExpiresAt: new Date(0).toISOString() },
  { ...pending, attemptStatus: 'released' },
]) {
  const expiredPage = pageHarness(); expiredPage.setResult(result); await expiredPage.load();
  assert.match(expiredPage.text(), /slot hold has expired/);
  assert.doesNotMatch(expiredPage.text(), /Payment failed|Restart booking|Continue payment/);
}
for (const result of [{ paymentStatus: 'creation_unknown' }, { paymentStatus: 'unexpected' }]) {
  const unknownPage = pageHarness(); unknownPage.setResult(result); await unknownPage.load();
  assert.match(unknownPage.text(), /Payment outcome is unknown/);
  assert.doesNotMatch(unknownPage.text(), /slot.*protected|Continue payment|Restart booking/);
}
const pollingPage = pageHarness(); pollingPage.setResult(pending); await pollingPage.load();
const stopPoll = pollingPage.startPoll();
pollingPage.setResult({ paymentStatus: 'succeeded', fulfilmentStatus: 'fulfilled' });
const before = pollingPage.refreshes;
await pollingPage.poll();
assert.equal(pollingPage.refreshes, before + 1, 'Timer reconciles on the server');
assert.match(pollingPage.text(), /Your appointment is confirmed/);
stopPoll();
assert.equal(pollingPage.startPoll(), undefined, 'Final state stops polling');
console.log('PASS: payment session recovery, retry, lost access, unavailable data, hold deadlines and terminal states.');
