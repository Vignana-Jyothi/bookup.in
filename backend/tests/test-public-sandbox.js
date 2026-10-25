import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { LANDING_CONTENT, DEMO_SLUG } from '../../frontend/src/data/landingContent.js';

// Execute the production simulator with isolated local hooks. No backend or gateway.
const source = await readFile(new URL('../../frontend/src/pages/SandboxBooking.jsx', import.meta.url), 'utf8');
const imports = [...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(match => match[1]);
assert.deepEqual(imports, ['react', 'react-router-dom'], 'The sandbox must not import real booking, payment or storage services');
assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon)\b/);
const isolated = source.replace(/^import .*;\r?\n/gm, '').replace('export default function SandboxBooking()', 'function SandboxBooking()');
const transformed = await transformWithOxc(isolated, 'SandboxBooking.jsx', { jsx: { runtime: 'automatic' } });
const code = transformed.code.replace(/import .* from ['"]react\/jsx-runtime['"];?/, '')
  .replace(/require\(['"]react\/jsx-runtime['"]\)/g, 'jsxRuntime');
const runtime = await import('react/jsx-runtime');
const slots = [];
let cursor = 0;
const env = {
  ...runtime, jsxRuntime: runtime, useEffect() {},
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  },
  useRef(initial) { return env.useState(() => ({ current: initial }))[0]; },
  Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
};
const Page = new Function('env', `with (env) { ${code}; return SandboxBooking; }`)(env);
const render = () => { cursor = 0; return Page(); };
const html = () => renderToStaticMarkup(render());
function find(predicate, node = render()) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  return React.Children.toArray(node.props?.children).map(child => find(predicate, child)).find(Boolean);
}
function click(label) {
  const button = find(node => node.type === 'button' && node.props.children === label);
  assert(button, `Expected action: ${label}`);
  button.props.onClick();
}

assert.match(html(), /Sandbox.*example data only/);
assert.doesNotMatch(html(), /type="(?:tel|email|password)"/);
find(node => node.type === 'input' && node.props.value === 'advisory').props.onChange();
find(node => node.type === 'input' && node.props.value === '2:30 PM').props.onChange();
find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
assert.match(html(), /Quick advisory call/);
assert.match(html(), /2:30 PM IST/);
assert.match(html(), /₹0.*simulation only/);
click('Simulate failed payment');
assert.match(html(), /Example payment failure/);
click('Retry simulated payment');
assert.match(html(), /Simulate a payment/);
assert.match(html(), /Quick advisory call/);
assert.match(html(), /2:30 PM IST/);
click('Cancel example checkout');
assert.match(html(), /Example checkout cancelled/);
click('Start another example');
assert.match(html(), /Try booking a session/);
find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
click('Simulate successful payment');
assert.match(html(), /Demo completed/);
assert.match(html(), /No real booking, payment, calendar event, or meeting link was created/);

const demoPath = DEMO_SLUG ? `/book/${DEMO_SLUG}` : '/book/demo';
assert.equal(LANDING_CONTENT.hero.demoUrl, demoPath);
assert.equal(LANDING_CONTENT.liveDemo.demoUrl, demoPath);
assert.match(LANDING_CONTENT.hero.badges, /selected merchants.*299/i);
assert.match(LANDING_CONTENT.faq.items.find(item => item.question === 'What does it cost?').answer, /selected merchants.*299.*tax/i);
for (const name of ['LandingDesktop', 'LandingMobile']) {
  const layout = await readFile(new URL(`../../frontend/src/pages/${name}.jsx`, import.meta.url), 'utf8');
  assert.match(layout, /<main id="landing-main"/);
  assert.match(layout, /<details key=\{item.question\}/);
  assert.doesNotMatch(layout, /toggleFaq|openFaqIndex|Free during early access|onClick=\{\(\) => navigate/);
}
const app = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
assert.match(app, /path="\/sandbox\/booking"/);
assert.match(app, /path="\/book\/:slug"/);
const css = await readFile(new URL('../../frontend/src/pages/Landing.css', import.meta.url), 'utf8');
assert.match(css, /\.reveal-on-scroll\s*\{\s*opacity: 1;/);
console.log('PASS: isolated sandbox selection, failure, immediate retry, cancellation, reset and success; zero real service dependencies; restored configured demo links, selected-access pricing, native FAQs and visible-default content.');
