import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import * as runtime from 'react/jsx-runtime';
import { transformWithOxc } from 'vite';

// Execute production handlers with local hooks and deferred service boundaries.
async function harness(file, component, overrides = {}) {
  const source = (await readFile(new URL(`../../frontend/src/pages/dashboard/${file}`, import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(`export default function ${component}`, `function ${component}`);
  const transformed = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' } });
  const code = transformed.code.replace(/import .* from ["']react\/jsx-runtime["'];?/, '')
    .replace(/require\(["']react\/jsx-runtime["']\)/g, 'jsxRuntime');
  const slots = []; let cursor = 0;
  const toasts = []; const writes = [];
  let operation = async () => true;
  const state = { auth: { isDemoMode: false }, provider: { id: 'test-provider', slug: 'test' }, services: [{ isActive: true }], availability: { schedule: {}, bufferTime: 15 } };
  const env = {
    ...runtime, jsxRuntime: runtime,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { return env.useState(() => ({ current: initial }))[0]; },
    useEffect() {}, useNavigate: () => () => {},
    useStore: () => ({ state, dispatch() {}, addToast: (...args) => toasts.push(args) }),
    DAYS_OF_WEEK: [], DAY_FULL_LABELS: {}, ACTIONS: { UPDATE_AVAILABILITY: 'update' },
    isSupabaseConfigured: () => true,
    dbService: { saveAvailability: (...args) => { writes.push(args); return operation(); } },
    getBookingUrl: () => 'https://example.invalid/book/test',
    navigator: { clipboard: { writeText: (...args) => { writes.push(args); return operation(); } } },
    Link: 'a', PillButton: 'button', CalendarRange: 'i', LockKeyhole: 'i', ShoppingBag: 'i',
    ...overrides,
  };
  const Component = new Function('env', `with (env) { ${code}; return ${component}; }`)(env);
  const render = () => { cursor = 0; return Component(); };
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    return React.Children.toArray(node.props?.children).map(child => find(child, predicate)).find(Boolean);
  }
  return {
    state, toasts, writes, env,
    operation(fn) { operation = fn; },
    button(label) { return find(render(), node => node.type === 'button' && React.Children.toArray(node.props.children).join('').includes(label)); },
    alert() { return find(render(), node => node.props.role === 'alert')?.props.children || ''; },
    click(label) { const button = this.button(label); assert(button, `Missing ${label}`); return button.props.onClick(); },
  };
}

function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// Execute the customer page's actual inline copy callbacks at the clipboard boundary.
const customerSource = await readFile(new URL('../../frontend/src/pages/booking/CustomerBooking.jsx', import.meta.url), 'utf8');
for (const value of ['fullTrackingUrl', 'providerUpiId']) {
  const position = customerSource.indexOf(`await navigator.clipboard.writeText(${value})`);
  const start = customerSource.lastIndexOf('onClick={', position) + 'onClick={'.length;
  const end = customerSource.indexOf('style={{', position);
  const callback = customerSource.slice(start, end).trim().slice(0, -1);
  let clipboardOperation = deferred();
  const notices = [], copied = [];
  const env = {
    fullTrackingUrl: 'https://example.invalid/booking-status', providerUpiId: 'fixture@example',
    navigator: { clipboard: { writeText: () => clipboardOperation.promise } },
    setCopiedTracking: state => copied.push(state), setTimeout() {},
    addToast: (...args) => notices.push(args),
  };
  const copy = new Function('env', `with(env){return (${callback});}`)(env);
  const failed = copy();
  assert.equal(notices.length, 0, 'No copy success before permission resolves');
  clipboardOperation.reject(new Error('Clipboard denied')); await failed;
  assert.equal(notices[0][1], 'error');
  assert(!copied.includes(true), 'Rejected copy cannot set copied badge');
  clipboardOperation = deferred();
  const retried = copy();
  assert.equal(notices.length, 1);
  clipboardOperation.resolve(); await retried;
  assert.match(notices[1][0], /copied/);
}

const availability = await harness('Availability.jsx', 'Availability');
const save = deferred(); availability.operation(() => save.promise);
const firstSave = availability.click('Save Changes');
assert.equal(availability.toasts.length, 0, 'No success before persistence resolves');
assert(availability.button('Saving').props.disabled);
await availability.click('Saving');
assert.equal(availability.writes.length, 1, 'Duplicate saves suppressed');
save.reject(new Error('Offline')); await firstSave;
assert.match(availability.alert(), /could not save all.*edits remain/);
assert.equal(availability.toasts.length, 0);
assert.equal(availability.state.availability.bufferTime, 15, 'Draft survives failure');
availability.operation(async () => false); await availability.click('Save Changes');
assert.equal(availability.toasts.length, 0, 'Skipped persistence is not success');
availability.operation(async () => true); await availability.click('Save Changes');
assert.equal(availability.alert(), '');
assert.deepEqual(availability.toasts, [['Availability saved.']]);
availability.state.auth.isDemoMode = true;
await availability.click('Save Changes');
assert.match(availability.toasts.at(-1)[0], /Demo.*Live booking hours were not changed/);

for (const label of ['Copy Link', 'Instagram Bio Link']) {
  const copy = await harness('BookingPageMgmt.jsx', 'BookingPageManagement');
  const write = deferred(); copy.operation(() => write.promise);
  const copying = copy.click(label);
  assert.equal(copy.toasts.length, 0, 'No success before clipboard resolves');
  assert(copy.button('Copying').props.disabled);
  await copy.click('Instagram Bio Link');
  assert.equal(copy.writes.length, 1, 'Duplicate clipboard writes suppressed');
  write.reject(new Error('Permission denied')); await copying;
  assert.match(copy.alert(), /copy it manually/);
  assert.equal(copy.toasts.length, 0);
  copy.operation(async () => {}); await copy.click(label);
  assert.equal(copy.alert(), '');
  assert.equal(copy.toasts.length, 1, 'One success per completed copy');
  assert.equal(copy.writes.at(-1)[0], 'https://example.invalid/book/test');
  if (label === 'Instagram Bio Link') assert.match(copy.toasts[0][0], /Instagram bio/);
}
const unsupported = await harness('BookingPageMgmt.jsx', 'BookingPageManagement', { navigator: {} });
await unsupported.click('Copy Link');
assert.match(unsupported.alert(), /copy it manually/);
assert.equal(unsupported.toasts.length, 0);
console.log('PASS: deferred save/copy, failures, retry, draft preservation, demo, unsupported clipboard and duplicate guards.');
