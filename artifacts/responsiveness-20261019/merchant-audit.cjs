// Opt-in: a local Vite server and a user-opened Chrome CDP test browser are required.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = process.cwd();
const output = path.join(root, 'artifacts/responsiveness-20261019');
const origin = 'http://127.0.0.1:5173';
const results = [];
const date = new Date();
date.setDate(date.getDate() + 2);
const futureDate = date.toISOString().slice(0, 10);
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const schedule = Object.fromEntries(weekdays.map(day => [day, { available: true, start: '00:00', end: '23:30' }]));
const provider = { id: 'fixture-provider', name: 'Test Merchant', businessName: 'Accessibility fixture', slug: 'a11y-fixture', email: 'fixture@example.invalid', phone: '9876543210', timezone: 'Asia/Kolkata', bio: 'A local accessibility test fixture with no real account.' };
const service = { id: 'fixture-service', name: 'Test consultation', description: 'A local test consultation for accessibility verification.', price: 0, duration: 30, instructorId: 'fixture-instructor', isActive: true, availableWeekdays: weekdays, meetingType: 'online' };
const booking = { id: 'fixture-appointment', bookingId: 'M123456789', providerId: provider.id, serviceId: service.id, serviceName: service.name, customerName: 'Test Customer', customerPhone: '9876543210', customerEmail: 'fixture@example.invalid', date: futureDate, startTime: '15:00', endTime: '15:30', duration: 30, price: 0, depositAmount: 0, depositStatus: 'na', status: 'confirmed', paymentStatus: 'not_required', managementToken: 'fixture-only', meetingType: 'online', createdAt: new Date().toISOString() };
const data = { provider, service, services: [service], booking, bookings: [booking], availability: { schedule, bufferTime: 0, minNotice: 0, maxAdvanceBooking: 30 }, policies: { freeCancellation: true, cancellationWindow: 12, refundPercentage: 100 }, instructors: [{ id: 'fixture-instructor', name: provider.name, isOwner: true, active: true, schedule }] };
const state = { auth: { isAuthenticated: true, isDemoMode: false, loading: false, user: { id: 'fixture-user', email: provider.email } }, provider, services: data.services, bookings: data.bookings, availability: data.availability, policies: data.policies, customers: [], toasts: [], onboarding: { completed: true, currentStep: 8 }, googleCalendar: { isConnected: false } };

async function main() {
  await fs.mkdir(output, { recursive: true });
  const storeSource = await fs.readFile(path.join(root, 'frontend/src/data/store.jsx'), 'utf8');
  const utilityExports = storeSource.slice(storeSource.indexOf('export function generateId('));
  const storeMock = `
const state = globalThis.__CALUP_A11Y_FIXTURE__.state;
const store = { state, dispatch: () => {}, addToast: () => 'fixture-toast', refreshFromSupabase: async () => {} };
export const useStore = () => store;
export const useAuth = () => state.auth;
export const useProvider = () => state.provider;
export const useServices = () => state.services;
export const useActiveServices = () => state.services.filter(service => service.isActive);
export const useBookings = () => state.bookings;
export const StoreProvider = ({children}) => children;
${utilityExports}`;
  const dbMock = `const data = globalThis.__CALUP_A11Y_FIXTURE__.data;
export const dbService = new Proxy({}, { get: (_, name) => async () => {
  if (name === 'getPublicBookingData') return data;
  if (name === 'getCurrentProvider') return data.provider;
  if (name === 'getServices') return data.services;
  if (name === 'getAvailability') return data.availability.schedule;
  if (name === 'getPolicy') return data.policies;
  if (['getBusySlots', 'getRefundsDue', 'getBookings'].includes(name)) return [];
  throw new Error('Unexpected data adapter call in isolated fixture: ' + name);
} });`;
  const browser = await chromium.connectOverCDP(process.env.CALUP_CDP_URL || 'http://127.0.0.1:9222');
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
  const pageErrors = [];
  await context.addInitScript(({ state, data }) => {
    const scenario = new URLSearchParams(location.search).get('scenario');
    for (const item of [state.bookings[0], data.booking, data.bookings[0]]) {
      if (scenario === 'past' || scenario === 'dispute') {
        const past = new Date(); past.setDate(past.getDate() - 2);
        item.date = past.toISOString().slice(0, 10);
      }
      if (scenario === 'payment') {
        item.paymentStatus = 'verification_pending';
        item.status = 'pending_payment';
        item.price = 500;
        item.paymentScreenshotUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yP9sAAAAASUVORK5CYII=';
      }
      if (scenario === 'refund') Object.assign(item, { status: 'cancelled', paymentStatus: 'confirmed', price: 500, refundStatus: 'refund_due', refundAmount: 500 });
      if (scenario === 'dispute') Object.assign(item, { status: 'no-show', customerNoShowAt: new Date().toISOString() });
    }
    globalThis.__CALUP_A11Y_FIXTURE__ = { state, data };
    if (scenario === 'checkout-retry') {
      for (const service of [...data.services, ...state.services, data.service]) service.price = 500;
    }
    if (scenario === 'operations') {
      state.services.push({ ...data.service, id: 'other-service', name: 'Other consultation' });
      state.bookings = Array.from({ length: 15 }, (_, index) => ({ ...data.booking, id: 'operation-' + index, bookingId: 'M' + String(123456780 + index), customerName: 'Client ' + String(index).padStart(2, '0') }));
      state.bookings.push(
        { ...data.booking, id: 'completed-fixture', customerName: 'Completed Client', status: 'completed' },
        { ...data.booking, id: 'late-fixture', customerName: 'Late Client', status: 'late-cancellation', refundStatus: 'refund_due' },
        { ...data.booking, id: 'pending-fixture', customerName: 'Pending Client', status: 'pending_payment', paymentStatus: 'verification_pending' },
      );
    }
  }, { state, data });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const pathname = url.pathname;
    const modulePath = pathname.replace(/\.jsx?$/, '');
    const js = body => route.fulfill({ contentType: 'application/javascript', body });
    if (/\/src\/data\/store(?:\.jsx)?$/.test(pathname)) return js(storeMock);
    if (modulePath.endsWith('/services/supabase/dbService')) return js(dbMock);
    if (modulePath.endsWith('/services/supabase/supabaseClient')) return js(`export const isSupabaseConfigured=()=>true; export const supabase={auth:{getUser:async()=>({data:{user:{id:'fixture-user'}}}),getSession:async()=>({data:{session:null}})}};`);
    if (modulePath.endsWith('/components/support/SupportWidget')) return js('export default function SupportStub(){return null;}');
    if (modulePath.endsWith('/services/payments/subscriptionService')) return js('export const subscriptionService={get:async()=>({})};');
    if (modulePath.endsWith('/services/payments/cashfreeCheckout')) return js(`
      export const isCashfreeV1Enabled=()=>true;
      const fixture=globalThis.__CALUP_A11Y_FIXTURE__;
      export const cashfreeCheckoutService={
        getAttempt:async()=>new URLSearchParams(location.search).get('scenario')==='existing-checkout'
          ? {attemptId:'fixture-attempt',providerSlug:'a11y-fixture',attemptStatus:'hold_active',paymentStatus:'pending',holdExpiresAt:new Date(Date.now()+60000).toISOString()}:null,
        createBookingAttempt:async(input,key)=>{
          fixture.checkoutCalls ||= []; fixture.checkoutCalls.push({input,key});
          if(fixture.checkoutCalls.length===1)throw new TypeError('Network response lost');
          return {attemptId:'fixture-attempt',paymentSessionId:'fixture-session'};
        },
        rememberRestartPath:()=>{},
        openHostedPopup:async()=>{fixture.openedCheckout=true;return {redirect:true};}
      };
    `);
    if (modulePath.endsWith('/services/merchant/merchantSchedulingService')) return js(`export const merchantSchedulingService={load:async()=>({instructors:globalThis.__CALUP_A11Y_FIXTURE__.data.instructors})};`);
    if (modulePath.endsWith('/services/booking/customerBookingService')) return js(`export const customerBookingService={getBooking:async()=>globalThis.__CALUP_A11Y_FIXTURE__.data,getTrackingStatus:async()=>globalThis.__CALUP_A11Y_FIXTURE__.data};`);
    if (modulePath.endsWith('/services/calendar/RealGoogleCalendarProvider')) return js(`export const realGoogleCalendarService={getBusyTimes:async()=>[]};`);
    if (pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { tickets: [], refunds: [] } }) });
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  async function open(surface, width = 1366, scenario = '') {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/tests/accessibility.html?surface=${surface}&scenario=${scenario}`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('vite-error-overlay').count(), 0, 'No Vite error overlay');
    assert.equal(pageErrors.length, 0, `No JS errors: ${pageErrors.join('; ')}`);
  }
  async function pass(name, details = {}) { results.push({ name, status: 'passed', ...details }); console.log('PASS:', name); }
  async function assertModalFocus(dialog, opener) {
    assert(await dialog.isVisible(), 'Dialog visible');
    assert(await dialog.evaluate(element => element.open && element.contains(document.activeElement)), 'Focus enters native dialog');
    assert.equal(await page.locator('body').evaluate(element => element.style.overflow), 'hidden');
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Tab remains inside dialog');
    }
    await page.keyboard.press('Shift+Tab');
    assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Shift+Tab remains inside dialog');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    if (opener) assert(await opener.evaluate(element => element === document.activeElement), 'Focus returns to opener');
    assert.notEqual(await page.locator('body').evaluate(element => element.style.overflow), 'hidden');
  }

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
  const sizes=[{width:320,height:740},{width:390,height:844},{width:600,height:900},{width:768,height:1024},{width:820,height:1180},{width:1024,height:768},{width:1440,height:900},{width:844,height:390}];
  try {
    for(const surface of ['shell','appointments','services','availability','analytics','booking','customer']) {
      for(const size of sizes){await open(surface,size.width,surface==='appointments'?'operations':'');await page.setViewportSize(size);await measure(surface,size);}
    }
  } finally {
    await fs.writeFile(path.join(output,'merchant-results.json'),JSON.stringify({results,pageErrors,mode:'Isolated real production components; no real writes'},null,2));
    await context.close();await browser.close();
  }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
