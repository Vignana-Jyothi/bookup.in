// Opt-in local Chrome verification. Every subscription adapter is stubbed; no API writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const origin = 'http://127.0.0.1:5173';
async function main() {
  const compiled = await (await fetch(origin + '/tests/accessibility-fixture.jsx')).text();
  const dependency = name => compiled.match(new RegExp(`from "([^"]+/${name}\\.js\\?[^"]+)"`))?.[1];
  const react = dependency('react'), dom = dependency('react-dom_client'), router = dependency('react-router-dom');
  assert(react && dom && router);
  const source = fs.readFileSync('frontend/src/services/payments/subscriptionService.js', 'utf8');
  const helpers = source.slice(source.indexOf('export function isSubscriptionOrderApplied'), source.indexOf('async function request'));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors=[]; page.on('pageerror', error=>{errors.push(error.message);console.error('Fixture runtime:',error.message);});
  const output = 'artifacts/subscription-review'; fs.mkdirSync(output,{recursive:true});
  try {
    await context.addInitScript(()=>{
      window.review={fail:true,refreshes:0,cancellations:0,toasts:[]};
      review.projection={serverTime:'2026-10-19T10:00:00Z',entitlement:{status:'active',source:'paid',expiresAt:'2026-11-19T10:00:00Z'},plan:{id:'fixture-plan',name:'Calup 30-Day Plan',durationDays:30,baseAmountPaise:29900,taxAmountPaise:5382,totalAmountPaise:35282,taxRateBps:1800},allowedActions:{renew:true},billingProfile:{legalName:'Original Merchant',addressLine1:'Original street address',city:'Chennai',state:'Tamil Nadu',postalCode:'600001',version:1},openOrder:{id:'renewal',paymentStatus:'pending',expiresAt:'2026-10-19T10:30:00Z'},documents:[{id:'invoice',type:'invoice',number:'CALUP-FIXTURE',amountPaise:35282,issuedAt:'2026-10-19T10:00:00Z'}],cancellation:{periods:[{id:'future-period',status:'scheduled',startsAt:'2026-11-19T10:00:00Z',endsAt:'2026-12-19T10:00:00Z',amountPaise:35282,invoiceNumber:'FUTURE-FIXTURE',accessEndsAtAfterCancellation:'2026-11-19T10:00:00Z'}]}};
    });
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url()); if(url.origin!==origin)return route.abort();
      const path=url.pathname.replace(/\.jsx?$/,'');
      const js=body=>route.fulfill({contentType:'application/javascript',body});
      if(path==='/tests/subscription-review')return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">import {injectIntoGlobalHook} from '/@react-refresh';injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;</script><script type="module">import React from '${react}';import ReactDOM from '${dom}';import {MemoryRouter} from '${router}';import Subscription from '/src/pages/dashboard/Subscription.jsx';import '/src/styles/global.css';import '/src/styles/components.css';ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(Subscription)));</script></html>`});
      if(path.endsWith('/services/payments/subscriptionService'))return js(helpers+`export const subscriptionService={get:async()=>{if(review.fail)throw new Error('Fixture offline');return structuredClone(review.projection);},refreshOrder:async id=>{review.refreshes++;return {data:{...structuredClone(review.projection),requestedOrder:{orderId:id,paymentStatus:'creation_failed',applicationStatus:'not_ready'}}}},getDocument:async id=>({id,number:'CALUP-FIXTURE',subscriptionOrderId:'old-order'}),cancelPeriod:async()=>{review.cancellations++;return new Promise((resolve,reject)=>{review.rejectCancellation=()=>reject(new Error('Fixture refund unavailable'));});}};`);
      if(path.endsWith('/components/ui/receipt-printer/SubscriptionReceipt'))return js(`import React from '${react}';export default function Receipt(){return React.createElement('p',null,'Isolated receipt presentation');}`);
      if(path.endsWith('/hooks/usePopupFeedback'))return js(`import React from '${react}';const {useCallback}=React;export const usePopupFeedback=()=>[null,useCallback(value=>{if(value)review.toasts.push(value)},[])];`);
      if(path.endsWith('/services/payments/cashfreeCheckout'))return js('export const cashfreeCheckoutService={};');
      return route.continue();
    });
    await page.goto(origin+'/tests/subscription-review');
    await page.getByRole('heading',{name:'Subscription information unavailable'}).waitFor();
    assert.equal(await page.locator('.price-total').count(),0,'Unknown load never shows zero pricing');
    assert.equal(await page.getByText('Access required',{exact:true}).count(),0,'Unknown load never claims inactive access');
    await page.screenshot({path:output+'/unavailable.png',fullPage:true});
    await page.evaluate(()=>{review.fail=false;});
    await page.getByRole('button',{name:'Try loading again'}).click();
    const name=page.getByRole('textbox',{name:'Legal name',exact:true});await name.waitFor();
    assert.equal(await name.inputValue(),'Original Merchant');
    await name.fill('Unsaved Merchant');
    await page.getByText('Unsaved changes',{exact:true}).waitFor();
    assert.equal(await page.getByText('Saved',{exact:true}).count(),0,'Dirty billing cannot retain saved badge');
    await page.getByRole('button',{name:'Check payment status',exact:true}).click();
    await page.waitForFunction(()=>review.refreshes===1&&review.toasts.some(value=>/not applied/.test(value.text||'')));
    assert.equal(await name.inputValue(),'Unsaved Merchant','Refresh preserves billing draft');
    assert.equal(await page.evaluate(()=>review.toasts.some(value=>value.type==='success')),false,'Old paid entitlement cannot confirm failed renewal');
    await page.screenshot({path:output+'/dirty-billing.png',fullPage:true});
    const cancel=page.getByRole('button',{name:'Cancel',exact:true});await cancel.click();
    let dialog=page.getByRole('dialog',{name:'Cancel future subscription period',exact:true});await dialog.waitFor();
    assert(await dialog.evaluate(el=>el.matches(':modal')&&el.contains(document.activeElement)));
    for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert(await dialog.evaluate(el=>el.contains(document.activeElement)));}
    await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
    assert(await cancel.evaluate(el=>document.activeElement===el),'Cancel escape restores opener');
    await cancel.click();dialog=page.getByRole('dialog',{name:'Cancel future subscription period',exact:true});
    await dialog.getByRole('button',{name:'Cancel period and refund'}).click();
    await page.waitForFunction(()=>review.cancellations===1);
    await page.keyboard.press('Escape');assert.equal(await dialog.count(),1,'Busy refund modal cannot dismiss with Escape');
    await page.screenshot({path:output+'/cancellation-busy.png',fullPage:true});
    await page.evaluate(()=>review.rejectCancellation());
    await dialog.getByRole('button',{name:'Keep period'}).waitFor();
    await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
    assert(await cancel.evaluate(el=>document.activeElement===el));
    const receipt=page.getByRole('button').filter({hasText:'CALUP-FIXTURE'});await receipt.click();
    const receiptDialog=page.getByRole('dialog',{name:'Subscription receipt',exact:true});await receiptDialog.waitFor();
    assert(await receiptDialog.evaluate(el=>el.matches(':modal')&&el.contains(document.activeElement)));
    for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert(await receiptDialog.evaluate(el=>el.contains(document.activeElement)));}
    await page.screenshot({path:output+'/receipt.png',fullPage:true});
    await page.keyboard.press('Escape');await receiptDialog.waitFor({state:'detached'});
    assert(await receipt.evaluate(el=>document.activeElement===el),'Receipt escape restores opener');
    assert.deepEqual(errors,[]);
    console.log('PASS: Subscription unavailable/retry, no inferred zero/access, dirty draft retained after failed-renewal refresh, saved badge accuracy, native receipt/cancellation focus and Escape, busy cancellation guard. All adapters isolated. Screenshots: '+output);
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
