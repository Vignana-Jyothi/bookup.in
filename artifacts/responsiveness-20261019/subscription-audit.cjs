const path=require('node:path');
﻿// Opt-in local Chrome verification. Every subscription adapter is stubbed; no API writes.
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
  const results=[];const output = 'artifacts/responsiveness-20261019'; fs.mkdirSync(output,{recursive:true});
  try {
    await context.addInitScript(()=>{
      window.review={fail:false,refreshes:0,cancellations:0,toasts:[]};
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

  async function measure(label, viewport, mode='normal') {
    const metrics=await page.evaluate(()=>{
      const name=el=>({tag:el.tagName,cls:typeof el.className==='string'?el.className.slice(0,110):'',text:(el.getAttribute('aria-label')||el.innerText||el.getAttribute('placeholder')||'').trim().slice(0,100)});
      const seen=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
      const scrollParent=el=>{for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(['auto','scroll'].includes(s.overflowX)&&p.scrollWidth>p.clientWidth+2)return p.className||p.tagName;}return null;};
      const candidates=[...document.querySelectorAll('h1,h2,h3,p,label,button,a,input,select,textarea,table')].filter(seen);
      const outside=candidates.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left< -2||r.right>innerWidth+2);}).map(el=>({...name(el),left:Math.round(el.getBoundingClientRect().left),right:Math.round(el.getBoundingClientRect().right),scrollParent:scrollParent(el)}));
      const clipped=candidates.filter(el=>!['INPUT','TEXTAREA','TABLE'].includes(el.tagName)&&el.clientWidth>0&&el.scrollWidth>el.clientWidth+3&&['hidden','clip'].includes(getComputedStyle(el).overflowX)).map(name);
      const controls=[...document.querySelectorAll('button,a,input:not([type=hidden]),select,summary')].filter(seen);
      const small=controls.filter(el=>{const r=el.getBoundingClientRect();return r.width<44||r.height<44;}).map(el=>({...name(el),width:Math.round(el.getBoundingClientRect().width),height:Math.round(el.getBoundingClientRect().height)}));
      return {documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,outside:outside.slice(0,25),clipped:clipped.slice(0,20),smallTargets:small.slice(0,30),controlCount:controls.length};
    });
    results.push({label,viewport,mode,...metrics});
    if(metrics.overflow||metrics.clipped.length||viewport.width===390||viewport.height===390)await page.screenshot({path:path.join(output,`${label.replace(/[^a-z0-9]/gi,'-')}-${viewport.width}x${viewport.height}-${mode}.png`),fullPage:true});
    console.log(label,viewport.width+'x'+viewport.height,mode,JSON.stringify({overflow:metrics.overflow,outside:metrics.outside.length,clipped:metrics.clipped.length,small:metrics.smallTargets.length}));
  }
for(const size of [{width:320,height:740},{width:390,height:844},{width:600,height:900},{width:768,height:1024},{width:820,height:1180},{width:1024,height:768},{width:1440,height:900},{width:844,height:390}]){await page.setViewportSize(size);await page.goto(origin+'/tests/subscription-review',{waitUntil:'networkidle'});await measure('merchant-subscription',size);await page.getByRole('button',{name:'Cancel',exact:true}).click();await measure('subscription-cancel-dialog',size);await page.keyboard.press('Escape');}
}finally{fs.writeFileSync(output+'/subscription-results.json',JSON.stringify({results,errors,mode:'Isolated production components; no writes'},null,2));await context.close();await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
