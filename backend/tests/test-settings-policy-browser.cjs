// Opt-in: local Vite :5173 and connected Chrome CDP :9222. All data adapters are isolated.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const origin = 'http://127.0.0.1:5173';

async function main() {
  const compiled = await (await fetch(origin + '/tests/accessibility-fixture.jsx')).text();
  const dependency = name => compiled.match(new RegExp(`from "([^"]+/${name}\\.js\\?[^"]+)"`))?.[1];
  const react = dependency('react');
  const dom = dependency('react-dom_client');
  const router = dependency('react-router-dom');
  assert(react && dom && router, 'Resolve current Vite dependencies');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = await browser.newContext({ viewport: { width: 320, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await context.addInitScript(() => {
      window.review = { fail: true, toasts: [], writes: 0 };
      window.review.provider = { id: '11111111-1111-4111-8111-111111111111', name: 'Test Merchant', businessName: 'Test Business', email: 'fixture@example.invalid', phone: '9876543210', bio: 'A local fixture merchant biography.', avatar: '/fixture-avatar.png', avatarUrl: '/fixture-avatar.png', qrCodeUrl: '/fixture-qr.png', upiId: 'fixture@upi' };
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const pathname = url.pathname.replace(/\.jsx?$/, '');
      const js = body => route.fulfill({ contentType: 'application/javascript', body });
      if (pathname === '/tests/settings-policy-review') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">import {injectIntoGlobalHook} from '/@react-refresh';injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;</script><script type="module">import React from '${react}';import ReactDOM from '${dom}';import {MemoryRouter} from '${router}';import Settings from '/src/pages/dashboard/Settings.jsx';import Policies from '/src/pages/dashboard/Policies.jsx';import Shell from '/src/layouts/DashboardLayout.jsx';import '/src/layouts/DashboardLayout.css';import '/src/styles/global.css';import '/src/styles/components.css';const Component={policies:Policies,settings:Settings,shell:Shell}[new URLSearchParams(location.search).get('surface')];ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(Component)));</script></html>` });
      if (pathname.endsWith('/src/data/store')) return js(`export const useStore=()=>({state:{provider:review.provider,auth:{isDemoMode:false},services:[],googleCalendar:{isConnected:false}},dispatch:a=>{if(a.type==='UPDATE_PROVIDER')Object.assign(review.provider,a.payload)},addToast:(message,type)=>review.toasts.push({message,type})});`);
      if (pathname.endsWith('/services/supabase/supabaseClient')) return js(`export const isSupabaseConfigured=()=>true;export const supabase={auth:{getUser:async()=>({data:{user:review.noUser?null:{id:'fixture-user'}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>review.fail?{error:new Error('Offline')}:{data:{full_refund_hours:48,partial_refund_hours:4,partial_refund_percent:50}}})})})};`);
      if (pathname.endsWith('/services/supabase/dbService')) return js(`export const dbService={getProviderByUserId:async()=>review.provider,updateProviderProfile:async()=>{review.writes++;if(review.fail)throw new Error('Offline');return true},savePolicy:async()=>{review.writes++;if(review.fail)throw new Error('Offline');return true}};`);
      if (pathname.endsWith('/hooks/useLiveAppointments')) return js('export const useLiveAppointments=()=>({loading:false,error:null});');
      if (pathname.endsWith('/services/payments/subscriptionService')) return js('export const subscriptionService={get:async()=>({})};');
      if (pathname.endsWith('/components/support/SupportWidget')) return js('export default function Stub(){return null;}');
      if (pathname.endsWith('/services/calendar/RealGoogleCalendarProvider')) return js(`export const realGoogleCalendarService={getStatus:async()=>({isConnected:false})};`);
      if (pathname.endsWith('/services/supabase/passwordService')) return js(`export const passwordService={};export const PASSWORD_REQUIREMENTS='Use a strong password';`);
      if (url.pathname.startsWith('/fixture-')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
      return route.continue();
    });
    await page.goto(origin + '/tests/settings-policy-review?surface=policies');
    await page.getByRole('button', { name: 'Retry loading policy' }).waitFor();
    assert.equal(await page.getByRole('spinbutton').count(), 0, 'A failed read exposes no editable defaults');
    await page.evaluate(() => { review.fail = false; });
    await page.getByRole('button', { name: 'Retry loading policy' }).click();
    const full = page.getByRole('spinbutton', { name: '100% Refund Window', exact: true });
    await full.waitFor();
    assert.equal(await full.inputValue(), '48', 'Retry displays persisted values');
    await full.fill('1');
    await page.getByRole('button', { name: 'Save Policy' }).click();
    assert.equal(await full.getAttribute('aria-invalid'), 'true');
    assert(await full.evaluate(input => document.activeElement === input), 'Invalid field receives focus');
    assert(await full.evaluate(input => Boolean(document.getElementById(input.getAttribute('aria-describedby')))));
    await full.fill('72');
    await page.evaluate(() => { review.fail = true; });
    await page.getByRole('button', { name: 'Save Policy' }).click();
    await page.getByRole('alert').filter({ hasText: 'Your changes are still here' }).waitFor();
    assert.equal(await full.inputValue(), '72', 'Failed policy save preserves edits');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Policy fits 320px');
    console.log('PASS: Strict policy read/retry, saved values, labelled validation, preserved edits, 320px reflow');

    await page.goto(origin + '/tests/settings-policy-review?surface=settings');
    const name = page.getByRole('textbox', { name: 'Your name', exact: false });
    await name.waitFor();
    await name.fill('');
    await page.getByRole('button', { name: 'Save Profile' }).click();
    assert.equal(await name.getAttribute('aria-invalid'), 'true');
    assert(await name.evaluate(input => Boolean(document.getElementById(input.getAttribute('aria-describedby')))));
    await name.fill('Updated Fixture');
    await page.evaluate(() => { review.noUser = true; });
    await page.getByRole('button', { name: 'Save Profile' }).click();
    await page.getByRole('alert').filter({ hasText: 'sign-in could not be verified' }).waitFor();
    assert.equal(await page.evaluate(() => review.writes), 0, 'No write or success when sign-in is unavailable');
    await page.evaluate(() => { review.noUser = false; });
    const remove = page.getByRole('button', { name: 'Remove', exact: true });
    await remove.first().click();
    assert.equal(await page.locator('img[src="/fixture-avatar.png"]').count(), 1, 'Failed avatar removal keeps photo');
    await remove.last().click();
    await page.getByRole('alert').filter({ hasText: 'Offline' }).waitFor();
    assert.equal(await page.locator('img[src="/fixture-qr.png"]').count(), 1, 'Failed QR removal keeps QR');
    assert.equal(await page.getByRole('checkbox').count(), 4);
    for (const input of await page.getByRole('checkbox').all()) assert.equal(await input.isDisabled(), true, 'Unavailable reminders are disabled');
    assert.equal(await page.getByRole('button', { name: 'Contact Calup about account deletion' }).count(), 1);
    assert.equal(await page.evaluate(() => review.toasts.some(value => /removed|updated|saved/i.test(value.message) && value.type !== 'error')), false, 'Failure never announces mutation success');
    await page.evaluate(() => { review.fail = false; });
    await page.getByRole('button', { name: 'Save Profile' }).click();
    await page.waitForFunction(() => review.toasts.some(value => value.message === 'Profile updated.'));
    assert.equal(await name.inputValue(), 'Updated Fixture', 'Retry saves the preserved profile edits');
    assert.deepEqual(errors, [], 'No runtime errors');
    console.log('PASS: Settings labels, auth failure, image rollback, unavailable reminders and deletion contact');
    await page.goto(origin + '/tests/settings-policy-review?surface=shell');
    const trigger = page.getByRole('button', { name: 'Open menu', exact: true });
    await trigger.waitFor();
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: 'Merchant navigation', exact: true });
    await drawer.waitFor();
    assert(await drawer.evaluate(dialog => dialog.matches(':modal')), 'Merchant menu is a native modal');
    assert(await drawer.evaluate(dialog => dialog.contains(document.activeElement)), 'Focus enters merchant menu');
    for (let index = 0; index < 18; index++) {
      await page.keyboard.press('Tab');
      assert(await drawer.evaluate(dialog => dialog.contains(document.activeElement)), 'Menu contains keyboard focus');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Drawer fits 320px');
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });
    assert(await trigger.evaluate(element => document.activeElement === element), 'Escape returns focus to trigger');
    const more = page.getByRole('button', { name: 'More', exact: true });
    await more.click();
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
    assert(await more.evaluate(element => document.activeElement === element), 'Close returns focus to More');
    assert.deepEqual(errors, [], 'No runtime errors including merchant menu');
    console.log('PASS: Merchant native drawer focus containment, Escape, both trigger returns and 320px fit');

  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
