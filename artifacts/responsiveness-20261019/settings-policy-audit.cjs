const fs=require('node:fs');
const path=require('node:path');
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
  const errors = []; const results=[]; const output='artifacts/responsiveness-20261019';
  page.on('pageerror', error => errors.push(error.message));
  try {
    await context.addInitScript(() => {
      window.review = { fail: false, toasts: [], writes: 0 };
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
for(const surface of ['settings','policies']){for(const size of [{width:320,height:740},{width:390,height:844},{width:600,height:900},{width:768,height:1024},{width:820,height:1180},{width:1024,height:768},{width:1440,height:900},{width:844,height:390}]){await page.setViewportSize(size);await page.goto(origin+'/tests/settings-policy-review?surface='+surface,{waitUntil:'networkidle'});await measure(surface,size);}}
}finally{fs.writeFileSync(output+'/settings-policy-results.json',JSON.stringify({results,errors,mode:'Isolated production components; no writes'},null,2));await context.close();await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
