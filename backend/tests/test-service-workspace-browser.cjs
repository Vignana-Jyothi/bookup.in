// Opt-in: local Vite :5173 and a user-opened, separate Chrome CDP :9222.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const origin = 'http://127.0.0.1:5173';
const output = path.resolve(__dirname, '../../artifacts/service-phase1');

async function main() {
  await fs.mkdir(output, { recursive: true });
  const fixture = await (await fetch(origin + '/tests/accessibility-fixture.jsx')).text();
  const dependency = name => fixture.match(new RegExp(`from "([^"]+/${name}\\.js\\?[^"]+)"`))?.[1];
  const react = dependency('react');
  const dom = dependency('react-dom_client');
  const router = dependency('react-router-dom');
  assert(react && dom && router, 'Vite dependency URLs resolved');
  const browser = await chromium.connectOverCDP(process.env.CALUP_CDP_URL || 'http://127.0.0.1:9222');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  const results = [];
  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const schedule = Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day => [day, {available:weekdays.includes(day),start:'09:00',end:'18:00'}]));
  const provider = { id:'fixture-provider',slug:'fixture',name:'Test merchant',businessName:'Calup test practice',timezone:'Asia/Kolkata',bio:'An isolated local service fixture.',email:'fixture@example.invalid' };
  const services = [
    {id:'online-service',name:'Personal consultation',description:'A thoughtful consultation about your goals.',duration:30,price:1000,isActive:true,instructorId:'instructor',availableWeekdays:weekdays,meetingType:'online'},
    {id:'offline-service',name:'Studio assessment',description:'An in-person assessment at our studio.',duration:60,price:1500,isActive:true,instructorId:'instructor',availableWeekdays:weekdays,meetingType:'in-person',locationAddress:'Test studio'},
    {id:'inactive-service',name:'Paused service',description:'A service temporarily unavailable to clients.',duration:30,price:500,isActive:false,instructorId:'instructor',availableWeekdays:weekdays,meetingType:'online'},
  ];
  await context.addInitScript(data => {
    window.phase1 = {...data, toasts:[],writes:[],mutations:[],clipboardMode:'success',deferSave:false};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async url=>{phase1.writes.push(url);if(phase1.clipboardMode==='fail')throw new Error('Denied');}}});
  }, {provider,services,instructors:[{id:'instructor',name:'Test instructor',active:true,isOwner:true,schedule}],availability:{schedule,bufferTime:15,minNotice:2,maxAdvanceBooking:30},policies:{freeCancellation:true,cancellationWindow:12,refundPercentage:100}});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const modulePath = url.pathname.replace(/\.jsx?$/, '');
    const js = body => route.fulfill({contentType:'application/javascript',body});
    if (modulePath === '/tests/service-phase1-harness') return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div>
      <script type="module">import {injectIntoGlobalHook} from '/@react-refresh';injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;</script>
      <script type="module">import React from '${react}';import ReactDOM from '${dom}';import {MemoryRouter,Routes,Route} from '${router}';import Services from '/src/pages/dashboard/Services.jsx';import Booking from '/src/pages/booking/BookingPage.jsx';import '/src/styles/global.css';import '/src/styles/components.css';
      const query=new URLSearchParams(location.search);const booking=query.get('surface')==='booking';const entry=booking?'/book/fixture?service='+encodeURIComponent(query.get('service')||''):'/dashboard/services';
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:[entry]},React.createElement(Routes,null,React.createElement(Route,{path:booking?'/book/:slug':'*',element:React.createElement(booking?Booking:Services)}))));</script></body></html>`});
    if (modulePath.endsWith('/src/data/store')) return js(`import React from '${react}';const p=window.phase1;const state={auth:{isDemoMode:false},provider:p.provider,services:p.services,bookings:[],availability:p.availability,policies:p.policies};const listeners=new Set();const addToast=(...args)=>p.toasts.push(args);const dispatch=action=>{if(action.type==='SET_SERVICES')state.services=action.payload;if(action.type==='ADD_SERVICE')state.services=[...state.services,action.payload];if(action.type==='UPDATE_SERVICE')state.services=state.services.map(s=>s.id===action.payload.id?{...s,...action.payload}:s);if(action.type==='TOGGLE_SERVICE')state.services=state.services.map(s=>s.id===action.payload?{...s,isActive:!s.isActive}:s);if(action.type==='DELETE_SERVICE')state.services=state.services.filter(s=>s.id!==action.payload);for(const update of listeners)update(n=>n+1)};export const useStore=()=>{const [,update]=React.useState(0);React.useEffect(()=>{listeners.add(update);return()=>listeners.delete(update)},[]);return{state,dispatch,addToast}};export const generateId=()=> 'fixture-id';export const formatCurrency=n=>'INR '+n;export const formatDate=d=>d;export const formatTime=t=>t;`);
    if (modulePath.endsWith('/services/supabase/supabaseClient')) return js('export const isSupabaseConfigured=()=>true;export const supabase={};');
    if (modulePath.endsWith('/services/supabase/dbService')) return js(`export const dbService={getCurrentProvider:async()=>phase1.provider,getServices:async()=>phase1.services,getPublicBookingData:async()=>phase1,getBusySlots:async()=>[]};`);
    if (modulePath.endsWith('/services/booking/merchantSchedulingService')) return js(`export const merchantSchedulingService={load:async()=>({instructors:phase1.instructors}),updateService:async(id,body)=>{phase1.mutations.push({id,body});if(phase1.deferSave)await new Promise(resolve=>phase1.releaseSave=resolve);return{id,...body}},createService:async body=>{phase1.mutations.push(body);return{id:'created-service',...body,isActive:true}},deleteService:async id=>phase1.mutations.push({deleted:id})};`);
    if (modulePath.endsWith('/services/payments/cashfreeCheckout')) return js('export const isCashfreeV1Enabled=()=>false;export const cashfreeCheckoutService={};');
    if (modulePath.endsWith('/services/calendar/RealGoogleCalendarProvider')) return js('export const realGoogleCalendarService={getBusyTimes:async()=>[]};');
    if (modulePath.endsWith('/services/booking/customerBookingService')) return js('export const customerBookingService={getBooking:async()=>null};');
    if (modulePath.endsWith('/hooks/usePopupFeedback')) return js(`import React from '${react}';export const usePopupFeedback=()=>React.useState(null);`);
    if (url.pathname.startsWith('/api/')) throw new Error('Unexpected API request in isolated service test');
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  async function open(surface='services', service='online-service', width=1440) {
    await page.setViewportSize({width,height:1000});
    await page.goto(`${origin}/tests/service-phase1-harness?surface=${surface}&service=${service}`,{waitUntil:'networkidle'});
  }
  async function pass(name) {results.push(name);console.log('PASS:',name);}
  try {
    await open();
    const first = page.getByRole('article',{name:'Personal consultation'});
    await first.getByText('Test instructor',{exact:true}).waitFor();
    assert.equal(await page.locator('.service-list-item').count(),3);
    assert.equal(await page.getByRole('link',{name:/Preview/}).count(),2);
    assert.match(await first.getByRole('link',{name:/Preview/}).getAttribute('href'),/\/book\/fixture\?service=online-service$/);
    assert(await page.getByRole('article',{name:'Paused service'}).getByRole('button',{name:'Preview',exact:true}).isDisabled());
    await first.getByRole('button',{name:/Copy booking link/}).click();
    assert.match(await page.evaluate(()=>phase1.writes[0]),/service=online-service$/);
    await page.evaluate(()=>phase1.clipboardMode='fail');
    await first.getByRole('button',{name:/Copy booking link/}).click();
    const fallback=page.getByLabel('Copy this booking link manually');
    await fallback.waitFor();
    assert(await fallback.evaluate(el=>document.activeElement===el && el.selectionEnd===el.value.length));
    await pass('Active/inactive actions, service URL, clipboard success and focused manual fallback');
    await first.getByRole('button',{name:'Edit Personal consultation',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Service details'});
    assert.equal(await dialog.getByRole('group').filter({has:page.locator('legend')}).count(),3);
    await dialog.getByLabel('Service name',{exact:true}).fill('ab');
    await dialog.getByRole('button',{name:'Save Changes',exact:true}).click();
    assert.equal(await dialog.getByLabel('Service name',{exact:true}).getAttribute('aria-invalid'),'true');
    await dialog.getByLabel('Service name',{exact:true}).fill('Updated consultation');
    await page.evaluate(()=>phase1.deferSave=true);
    await dialog.getByRole('button',{name:'Save Changes',exact:true}).click();
    await page.keyboard.press('Escape');
    assert(await dialog.isVisible(),'Save cannot be dismissed by Escape');
    await page.evaluate(()=>phase1.releaseSave());
    await dialog.waitFor({state:'detached'});
    await page.getByRole('article',{name:'Updated consultation'}).waitFor();
    await pass('Editor groups, contextual validation, saved row and pending-save dismissal guard');
    await page.getByRole('button',{name:/Add Service/}).first().click();
    await dialog.getByLabel('Service name',{exact:true}).fill('New coaching session');
    await dialog.getByLabel('Description',{exact:true}).fill('A clear description of this new coaching session.');
    await dialog.getByRole('button',{name:'Create Service',exact:true}).click();
    await dialog.waitFor({state:'detached'});
    await page.getByRole('article',{name:'New coaching session'}).waitFor();
    await pass('Create service uses the existing scheduling adapter and renders returned service');
    for(const width of [1440,390,320]) {
      await open('services','online-service',width);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No page overflow at ${width}`);
      await page.screenshot({path:path.join(output,`services-${width}.png`),fullPage:true});
      await page.getByRole('button',{name:'Edit Personal consultation',exact:true}).click();
      await dialog.waitFor();
      assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`Dialog fits at ${width}`);
      for(let i=0;i<20;i++){await page.keyboard.press('Tab');assert(await dialog.evaluate(el=>el.contains(document.activeElement)))}
      await page.screenshot({path:path.join(output,`editor-${width}.png`)});
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
    }
    await pass('1440/390/320px layout, editor keyboard containment and Escape');
    for(const id of ['online-service','offline-service','inactive-service','missing-service']) {
      await open('booking',id,390);
      await page.getByRole('heading',{name:'What Would You Like to Book?'}).waitFor();
      const selected=page.locator('.service-select-row[aria-pressed="true"]');
      assert.equal(await selected.count(),['online-service','offline-service'].includes(id)?1:0);
      if(id==='offline-service')assert.match(await selected.innerText(),/Studio assessment/);
      if(['inactive-service','missing-service'].includes(id))await page.getByRole('status').filter({hasText:'This service is no longer available'}).waitFor();
    }
    await pass('Public deep links select active services only; inactive/unknown hints safely fall back');
    assert.deepEqual(errors,[],'No browser runtime errors');
  } finally {
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({results,errors,mode:'Isolated adapters; no live account writes'},null,2));
    await context.close();
    await browser.close();
  }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
