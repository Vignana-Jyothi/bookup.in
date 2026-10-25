// Opt-in: Vite :5173 and a user-started separate Chrome debugging profile :9222.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
const origin='http://127.0.0.1:5173';
const output=path.resolve(__dirname,'../../artifacts/onboarding-phase2');

async function main(){
  await fs.mkdir(output,{recursive:true});
  const fixture=await(await fetch(origin+'/tests/accessibility-fixture.jsx')).text();
  const dep=name=>fixture.match(new RegExp(`from "([^"]+/${name}\\.js\\?[^"]+)"`))?.[1];
  const react=dep('react'),dom=dep('react-dom_client'),router=dep('react-router-dom');
  assert(react&&dom&&router);
  const browser=await chromium.connectOverCDP(process.env.CALUP_CDP_URL||'http://127.0.0.1:9222');
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const errors=[],results=[];
  await context.addInitScript(()=>{
    const query=new URLSearchParams(location.search);
    const availability=Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day=>[day,{available:day!=='sunday',start:'09:00',end:'18:00'}]));
    window.phase2={key:location.search,saves:[],billingSaves:[],completed:0,toasts:[],feedback:[],loads:0,failLoad:query.has('failLoad'),failSave:false,deferSave:false,
      currentStep:Number(query.get('step')||0),identity:{emailVerified:query.has('verified'),phoneVerified:query.has('verified')},
      draft:{businessName:'Test practice',providerName:'Test merchant',merchantEmail:'fixture@example.invalid',phone:'9876543210',bio:query.has('noBio')?'':'A clear introduction to our professional practice.',service:{name:'Consultation',description:'A helpful session to discuss your goals.',price:1000,duration:60,meetingType:query.get('mode')||'online',locationAddress:'Test studio'},availability,bookingRules:{minNotice:2,maxAdvanceBooking:30,bufferTime:15,cancellationWindow:12}},
      billing:query.has('noBilling')?null:{legalName:'Test merchant',addressLine1:'123 Test Street',addressLine2:'',city:'Test City',state:'Test State',postalCode:'560001',gstin:'',version:1}};
  });
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    const modulePath=url.pathname.replace(/\.jsx?$/,'');
    const js=body=>route.fulfill({contentType:'application/javascript',body});
    if(modulePath==='/tests/onboarding-phase2-harness')return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import {injectIntoGlobalHook} from '/@react-refresh';injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;</script>
    <script type="module">import React from '${react}';import ReactDOM from '${dom}';import {MemoryRouter} from '${router}';import Onboarding from '/src/pages/Onboarding.jsx';import '/src/styles/global.css';import '/src/styles/components.css';import '/src/pages/Auth.css';const entry='/onboarding'+(new URLSearchParams(location.search).has('calendar')?'?calendar=connected':'');ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:[entry]},React.createElement(Onboarding)));</script></body></html>`});
    if(modulePath.endsWith('/src/data/store'))return js(`const store={state:{provider:{id:'fixture',slug:'fixture',name:'Test merchant'},auth:{isDemoMode:false}},dispatch:()=>{},addToast:(...args)=>phase2.toasts.push(args)};export const useStore=()=>store;export const formatCurrency=n=>'INR '+n;`);
    if(modulePath.endsWith('/services/supabase/supabaseClient'))return js(`export const isSupabaseConfigured=()=>true;export const supabase={auth:{getUser:async()=>({data:{user:{email:'fixture@example.invalid'}}})}};`);
    if(modulePath.endsWith('/services/supabase/dbService'))return js('export const dbService={};');
    if(modulePath.endsWith('/services/payments/subscriptionService'))return js(`export const subscriptionService={get:async()=>({billingProfile:JSON.parse(sessionStorage.getItem(phase2.key+'billing')||'null')||phase2.billing}),saveBillingProfile:async billing=>{phase2.billingSaves.push(billing);phase2.billing={...billing,version:2};sessionStorage.setItem(phase2.key+'billing',JSON.stringify(phase2.billing));return phase2.billing}};`);
    if(modulePath.endsWith('/services/merchant/onboardingService'))return js(`const p=window.phase2;export const onboardingService={load:async()=>{p.loads++;if(p.failLoad&&p.loads===1)throw new Error('Fixture load failure');const saved=JSON.parse(sessionStorage.getItem(p.key+'draft')||'null');return {draft:saved?.draft||p.draft,currentStep:saved?.currentStep??p.currentStep,identity:p.identity,google:{ready:false},entitlement:{active:false}}},saveDraft:async(draft,currentStep)=>{p.saves.push({draft,currentStep});if(p.failSave)throw new Error('Fixture save failure');if(p.deferSave)await new Promise(resolve=>p.releaseSave=resolve);sessionStorage.setItem(p.key+'draft',JSON.stringify({draft,currentStep}));return{saved:true}},complete:async draft=>{p.completed++;p.completeDraft=draft;return{completed:true,publishReady:false,missing:['google_calendar','calup_access'],identity:p.identity}},sendEmailVerification:async()=>({verified:false}),sendPhoneVerification:async()=>({verified:false}),verifyEmail:async code=>{if(code!=='123456')throw new Error('Incorrect code');p.identity.emailVerified=true},verifyPhone:async code=>{if(code!=='123456')throw new Error('Incorrect code');p.identity.phoneVerified=true}};`);
    if(modulePath.endsWith('/services/calendar/RealGoogleCalendarProvider'))return js('export const realGoogleCalendarService={getStatus:async()=>({hostAccessReady:false,isConnected:false})};');
    if(modulePath.endsWith('/hooks/usePopupFeedback'))return js(`import React from '${react}';export const usePopupFeedback=()=>{const [value,set]=React.useState('');const update=React.useCallback(v=>{phase2.feedback.push(v);set(v)},[]);return[value,update]};`);
    if(url.pathname.startsWith('/api/'))throw new Error('Unexpected API request in isolated onboarding test');
    return route.continue();
  });
  let page;
  async function open(params='',width=1440){
    if(page)await page.close();page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize({width,height:width<500?844:1000});
    await page.goto(origin+'/tests/onboarding-phase2-harness?'+params,{waitUntil:'networkidle'});
    return page;
  }
  const next=()=>page.getByRole('button',{name:'Next step',exact:false}).click();
  async function pass(name){results.push(name);console.log('PASS:',name)}
  try{
    await open('step=2&noBilling=1&noBio=1');
    await page.getByLabel('Your Bio',{exact:true}).waitFor();
    await next();
    assert(await page.getByLabel('Your Bio',{exact:true}).evaluate(el=>el===document.activeElement),'Merged-profile validation focuses the missing bio');
    await page.getByLabel('Business or studio name').fill('Updated test practice');
    await page.getByLabel('Your Bio',{exact:true}).fill('Updated introduction with enough characters.');
    await page.getByText('Preview your customer page',{exact:false}).click();
    const preview=page.getByRole('region',{name:'Draft customer page'});
    assert(await preview.isVisible());
    assert.match(await preview.innerText(),/Updated test practice/);
    assert.match(await preview.innerText(),/Not published/);
    assert.equal(await preview.getByRole('button').count(),0);
    assert.equal(await preview.getByRole('link').count(),0);
    await page.getByText('Preview your customer page',{exact:false}).click();
    await page.evaluate(()=>phase2.failSave=true);
    await next();
    assert(await page.getByLabel('Your Bio',{exact:true}).isVisible(),'Failed save keeps profile');
    assert.equal(await page.getByLabel('Business or studio name').inputValue(),'Updated test practice');
    await page.evaluate(()=>{phase2.failSave=false;phase2.deferSave=true});
    await next();
    assert(await page.getByRole('button',{name:'Saving...',exact:false}).isDisabled());
    await page.evaluate(()=>phase2.releaseSave());
    await page.getByRole('heading',{name:'Your billing details.'}).waitFor();
    await page.reload({waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Your billing details.'}).waitFor();
    await page.getByRole('button',{name:/Previous step/}).click();
    assert.equal(await page.getByLabel('Business or studio name').inputValue(),'Updated test practice');
    await pass('Legacy bio resume, merged profile, live non-bookable draft preview, save failure, pending guard and reload recovery');
    await open('step=1&noBilling=1');
    await page.getByLabel('Legal name',{exact:true}).waitFor();
    for(const [label,value] of [['Legal name','Test legal name'],['Address line 1','123 Test Street'],['City','Test City'],['State / Union territory','Test State'],['PIN code','560001']])await page.getByLabel(label,{exact:true}).fill(value);
    await next();
    await page.getByRole('heading',{name:'Create your first service'}).last().waitFor();
    assert.equal(await page.evaluate(()=>phase2.billingSaves.length),1);
    await next();
    await page.getByRole('heading',{name:'Set your availability'}).waitFor();
    assert(!await page.getByLabel('Minimum scheduling notice').isVisible(),'Rules hidden before expansion');
    await page.getByText('Edit booking rules',{exact:true}).click();
    await page.getByLabel('Minimum scheduling notice').fill('4');
    await page.getByLabel('Buffer time between appointments').fill('241');
    await next();
    assert(await page.getByRole('heading',{name:'Set your availability'}).isVisible());
    await page.getByLabel('Buffer time between appointments').fill('20');
    await next();
    await page.getByRole('heading',{name:'Verify your business'}).waitFor();
    assert(!/Cashfree Payments|Zoom|Webex|WhatsApp notifications/.test(await page.locator('.integration-sheet').innerText()));
    await next();assert.equal(await page.evaluate(()=>phase2.completed),0);
    const emailRow=page.locator('.integration-row').filter({has:page.getByRole('heading',{name:/Email verification/})});
    await emailRow.getByRole('button',{name:'Send code',exact:true}).click();
    await page.getByLabel('Six-digit email verification code').fill('123456');
    await page.getByRole('button',{name:'Confirm email',exact:true}).click();
    const phoneRow=page.locator('.integration-row').filter({has:page.getByRole('heading',{name:/SMS verification/})});
    await phoneRow.getByRole('button',{name:'Send code',exact:true}).click();
    await page.getByLabel('SMS verification code',{exact:true}).fill('123456');
    await page.getByRole('button',{name:'Confirm code',exact:true}).click();
    await next();
    await page.getByRole('heading',{name:'Review your setup'}).waitFor();
    await page.getByRole('button',{name:'Finish setup',exact:false}).click();
    await page.getByRole('heading',{name:'Your setup is saved'}).waitFor();
    assert(await page.getByRole('button',{name:'Open Booking Page',exact:true}).isDisabled());
    assert.equal(await page.evaluate(()=>phase2.completed),1);
    await pass('Billing save, service, combined rules validation, identity gates and server-owned private completion');
    await open('step=5&verified=1');
    await page.getByLabel('Minimum scheduling notice').waitFor();
    await pass('Legacy booking-rule step restores the merged hours screen with controls expanded');
    await open('step=3&calendar=1&verified=1');
    await page.getByRole('heading',{name:'Verify your business'}).waitFor();
    await pass('Calendar-return context survives query cleanup and restores verification');
    await open('step=6&mode=in-person&verified=1');
    await page.getByRole('heading',{name:'Verify your business'}).waitFor();
    assert.equal(await page.locator('.integration-row').count(),2);
    assert.equal(await page.getByRole('button',{name:'Connect Calendar & Meet',exact:true}).count(),0);
    await pass('In-person setup shows identity checks without requiring a calendar connection');
    await open('step=4&failLoad=1');
    await page.getByRole('button',{name:'Retry loading setup',exact:true}).click();
    await page.getByRole('heading',{name:'Set your availability'}).waitFor();
    assert.equal(await page.evaluate(()=>phase2.saves.length),0);
    await pass('Load failure blocks editing and retry restores saved progress without writes');
    for(const width of [1440,390,320])for(const step of [0,4,6,7]){
      await open(`step=${step}&verified=1&width=${width}${step===0?'&noBio=1':''}`,width);
      await page.getByRole('list',{name:'Setup stages'}).waitFor();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Page fits ${width}px step ${step}`);
      assert(await page.locator('.setup-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`Content fits ${width}px step ${step}`);
      assert(await page.getByRole('button',{name:step===7?'Finish setup':'Next step',exact:false}).isVisible());
      await page.screenshot({path:path.join(output,`onboarding-${step}-${width}.png`),fullPage:true});
    }
    assert.deepEqual(errors,[]);
    await pass('1440/390/320px profile, hours, verification and review layouts without runtime errors');
  }finally{
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({results,errors,mode:'Production components with isolated adapters; no real account changes'},null,2));
    await context.close();await browser.close();
  }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
