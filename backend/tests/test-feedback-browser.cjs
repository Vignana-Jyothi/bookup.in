// Opt-in: local Vite :5173 and a user-opened Chrome CDP :9222 are required.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const origin = 'http://127.0.0.1:5173';

async function main() {
  const fixture = await (await fetch(origin + '/tests/accessibility-fixture.jsx')).text();
  const dependency = name => fixture.match(new RegExp(`from "([^"]+/${name}\\.js\\?[^"]+)"`))?.[1];
  const reactModule = dependency('react');
  const domModule = dependency('react-dom_client');
  const routerModule = dependency('react-router-dom');
  assert(reactModule && domModule && routerModule, 'Resolve current Vite dependency URLs');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errors = [];
  try {
    await context.addInitScript(() => {
      window.feedback = { mode: 'fail', toasts: [], refreshes: 0, writes: 0, openedSessions: [] };
      window.attempt = { attemptId: 'fixture', paymentStatus: 'pending', attemptStatus: 'hold_active', holdExpiresAt: new Date(Date.now() + 60000).toISOString(), paymentSessionId: 'fixture' };
      window.attempt.retryableFailure = new URLSearchParams(location.search).get('scenario') === 'failed-payment';
      window.feedback.verified = false;
      window.feedback.cancelMode = 'processing';
      window.feedback.pending = ['first', 'second'].map(id => ({attemptId:id,serviceName:id+' appointment',bookingDate:'2026-11-01',startTime:'10:00',amountPaise:10000,currency:'INR',paymentStatus:'pending',attemptStatus:'hold_active'}));
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async () => {
          window.feedback.writes++;
          await new Promise(resolve => setTimeout(resolve, 100));
          if (window.feedback.mode === 'fail') throw new Error('Permission denied');
        },
      } });
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const pathname = url.pathname.replace(/\.jsx?$/, '');
      const js = body => route.fulfill({ contentType: 'application/javascript', body });
      if (pathname === '/tests/feedback-harness') return route.fulfill({ contentType: 'text/html', body: `
        <html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
        <script type="module">import {injectIntoGlobalHook} from '/@react-refresh'; injectIntoGlobalHook(window); window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;</script>
        <script type="module">
        import React from '${reactModule}';
        import ReactDOM from '${domModule}';
        import {MemoryRouter} from '${routerModule}';
        import Availability from '/src/pages/dashboard/Availability.jsx';
        import Sharing from '/src/pages/dashboard/BookingPageMgmt.jsx';
        import Payment from '/src/pages/booking/CashfreePaymentStatus.jsx';
        import PendingPayments from '/src/components/booking/PendingPayments.jsx';
        import '/src/styles/global.css'; import '/src/styles/components.css';
        const Pending=()=>{const [open,setOpen]=React.useState(true);return open?React.createElement(PendingPayments,{slug:'fixture',onClose:()=>{window.feedback.closed=true;setOpen(false)},onOpen:()=>{window.feedback.openedPayment=true}}):React.createElement('p',null,'Pending payments closed')};
        const Page={availability:Availability,sharing:Sharing,payment:Payment,pending:Pending}[new URLSearchParams(location.search).get('surface')];
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(Page)));
        </script></body></html>` });
      if (pathname.endsWith('/src/data/store')) return js(`
        import React from '${reactModule}'; const {useState}=React;
        const days=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
        const state={auth:{isDemoMode:false},provider:{id:'fixture',slug:'fixture'},services:[{isActive:true}],availability:{schedule:Object.fromEntries(days.map(d=>[d,{available:true,start:'09:00',end:'18:00'}])),bufferTime:15,minNotice:2,maxAdvanceBooking:30}};
        export function useStore(){const [,update]=useState(0);return {state,addToast:(...args)=>window.feedback.toasts.push(args),dispatch:action=>{Object.assign(state.availability,action.payload);update(n=>n+1)}};}
      `);
      if (pathname.endsWith('/services/supabase/supabaseClient')) return js('export const isSupabaseConfigured=()=>true;');
      if (pathname.endsWith('/services/supabase/dbService')) return js(`export const dbService={saveAvailability:async()=>{await new Promise(r=>setTimeout(r,100));if(window.feedback.mode==='fail')throw new Error('Offline');return true;}};`);
      if (pathname.endsWith('/services/booking/merchantSchedulingService')) return js('export const merchantSchedulingService={load:async()=>({instructors:[]})};');
      if (pathname.endsWith('/services/payments/publicCommerceService')) return js(`export const publicCommerceService=()=>({
        bookingPayments:async()=>{if(!feedback.verified)throw Object.assign(new Error('Verify your phone'),{status:401});return {maskedPhone:'******0001',attempts:feedback.pending}},
        send:async()=>{feedback.smsRequests=(feedback.smsRequests||0)+1;return {challengeId:'fixture',maskedPhone:'******0001'}},
        verify:async(_id,code)=>{if(code!=='123456')throw Object.assign(new Error('Incorrect verification code'),{status:400});feedback.verified=true},
        openBookingPayment:async id=>{feedback.selected=id},logout:async()=>{feedback.verified=false}
      });`);
      if (pathname.endsWith('/services/payments/cashfreeCheckout')) return js(`export const cashfreeCheckoutService={refreshPayment:async()=>{window.feedback.refreshes++;return window.attempt},getAttempt:async()=>window.attempt,getRestartPath:()=>'/book/fixture',getCheckoutSession:async()=>window.attempt,openHostedPopup:async session=>{window.feedback.modalWasClosed=!document.querySelector('dialog[open]');window.feedback.openedSessions.push(session.paymentSessionId);return {redirect:true}},finishCheckoutReturn:async()=>{if(feedback.cancelMode==='processing')return {paymentStatus:'pending',gatewayReconciling:true};feedback.pending=feedback.pending.filter(item=>item.attemptId!==feedback.selected);return {paymentStatus:'closed_unpaid',attemptStatus:'released'}}};`);
      if (pathname.endsWith('/hooks/usePopupFeedback')) return js(`const clear=()=>{}; export const usePopupFeedback=()=>['',clear];`);
      if (['/components/dashboard/CommerceManager','/components/support/TicketPanel','/components/ui/receipt-printer/BookingReceipt'].some(s=>pathname.endsWith(s))) return js('export default function Stub(){return null;}');
      if (pathname.startsWith('/api/')) throw new Error('Unexpected API request in isolated test');
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    const open = async (surface, scenario = '') => {
      await page.goto(`${origin}/tests/feedback-harness?surface=${surface}&scenario=${scenario}`, { waitUntil: 'networkidle' });
      assert.deepEqual(errors, [], 'Fixture modules load without errors');
    };
    await open('availability');
    await page.locator('#availability-buffer').fill('27');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /edits remain/);
    assert.equal(await page.locator('#availability-buffer').inputValue(), '27');
    assert.equal(await page.evaluate(() => feedback.toasts.length), 0);
    await page.evaluate(() => { feedback.mode = 'success'; });
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.waitForFunction(() => feedback.toasts.length === 1);
    assert.equal(await page.getByRole('alert').count(), 0);
    console.log('PASS browser: failed availability save preserves draft; retry succeeds.');

    await open('sharing');
    for (const label of ['Copy Link', 'Instagram Bio Link']) {
      await page.evaluate(() => { feedback.mode = 'fail'; feedback.toasts = []; });
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(await page.evaluate(() => feedback.toasts.length), 0);
      assert(await page.getByRole('textbox', { name: 'Your booking link' }).evaluate(e => e === document.activeElement && e.selectionEnd === e.value.length));
      await page.evaluate(() => { feedback.mode = 'success'; });
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(() => feedback.toasts.length === 1);
      assert.equal(await page.getByRole('alert').count(), 0);
    }
    console.log('PASS browser: both clipboard failures select the link; retries show one success.');

    await open('pending');
    const pendingDialog = page.getByRole('dialog', { name: 'Pending payments', exact: true });
    await pendingDialog.getByLabel('Phone number', { exact: true }).fill('9000000001');
    assert.equal(await page.evaluate(() => feedback.smsRequests || 0), 0, 'No SMS is sent automatically');
    await pendingDialog.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await pendingDialog.getByLabel('Verification code', { exact: true }).fill('000000');
    await pendingDialog.getByRole('button', { name: 'Verify and find payments', exact: true }).click();
    await pendingDialog.getByRole('alert').waitFor();
    assert.equal(await pendingDialog.getByText('first appointment', { exact: true }).count(), 0);
    await pendingDialog.getByLabel('Verification code', { exact: true }).fill('123456');
    await pendingDialog.getByRole('button', { name: 'Verify and find payments', exact: true }).click();
    await pendingDialog.getByRole('heading', { name: 'first appointment', exact: true }).waitFor();
    assert.equal(await pendingDialog.getByRole('button', { name: 'Retry payment', exact: true }).count(), 2);
    await pendingDialog.getByRole('button', { name: 'Cancel payment', exact: true }).first().click();
    await pendingDialog.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await pendingDialog.getByRole('status').filter({ hasText: 'could not be closed yet' }).waitFor();
    assert.equal(await pendingDialog.getByRole('button', { name: 'Retry payment', exact: true }).count(), 2);
    await page.evaluate(() => { feedback.cancelMode='closed'; });
    await pendingDialog.getByRole('button', { name: 'Cancel payment', exact: true }).first().click();
    await pendingDialog.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await pendingDialog.getByRole('status').filter({ hasText: 'Checkout closed' }).waitFor();
    assert.equal(await pendingDialog.getByRole('heading', { name: 'first appointment', exact: true }).count(), 0);
    await page.setViewportSize({width:320,height:844});
    assert(await pendingDialog.locator('.modal').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    await page.screenshot({path:'guides/project/accessibility-browser-evidence/pending-payments-320.png',fullPage:true});
    await pendingDialog.getByRole('button', { name: 'Retry payment', exact: true }).click();
    await page.waitForFunction(() => feedback.openedPayment === true);
    assert.equal(await page.evaluate(() => feedback.selected), 'second');
    assert.equal(await page.evaluate(() => feedback.openedSessions.length), 1);
    assert.equal(await page.evaluate(() => feedback.modalWasClosed), true, 'Native dialog must close before the gateway mounts outside it');
    console.log('PASS browser: phone/SMS proof, invalid code, unfinished list, pending cancellation retained, confirmed cancellation removed, owned retry and 320px layout.');

    await open('payment', 'failed-payment');
    await page.getByRole('heading', { name: 'Your payment attempt was unsuccessful', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retry payment', exact: true }).click();
    await page.waitForFunction(() => feedback.openedSessions.length === 1);
    assert.deepEqual(await page.evaluate(() => feedback.openedSessions), ['fixture']);
    assert.equal(await page.getByRole('link', { name: 'Restart booking', exact: true }).count(), 0);
    console.log('PASS browser: unsuccessful payment retries immediately through the existing session without another booking/hold.');

    await page.clock.install();
    await open('payment');
    assert.equal(await page.locator('h1').innerText(), 'Confirming your payment');
    await page.evaluate(() => { window.attempt = {...attempt, paymentStatus:'succeeded', fulfilmentStatus:'fulfilled'}; });
    await page.clock.runFor(11000);
    await page.getByRole('heading', { name: 'Your appointment is confirmed' }).waitFor();
    assert(await page.evaluate(() => feedback.refreshes >= 2));
    const count = await page.evaluate(() => feedback.refreshes);
    await page.clock.runFor(30000);
    assert.equal(await page.evaluate(() => feedback.refreshes), count, 'Terminal result stops polling');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS browser: pending payment reconciles automatically, renders paid, and stops polling. No page errors.');
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
