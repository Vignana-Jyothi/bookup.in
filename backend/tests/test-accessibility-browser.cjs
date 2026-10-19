// Opt-in: a local Vite server and a user-opened Chrome CDP test browser are required.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'guides/project/accessibility-browser-evidence');
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
  try {
    await open('modal');
    const opener = page.getByRole('button', { name: 'Open test dialog', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    await assertModalFocus(page.getByRole('dialog', { name: 'Keyboard verification' }), opener);
    await pass('Native dialog: Enter, Tab/Shift+Tab containment, Escape, focus return, scroll restoration');
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Keyboard verification' });
    await dialog.getByLabel('Operation pending').check();
    await page.keyboard.press('Escape');
    assert(await dialog.isVisible(), 'Pending guard prevents Escape dismissal');
    await dialog.getByLabel('Operation pending').uncheck();
    await page.mouse.click(2, 2);
    await dialog.waitFor({ state: 'detached' });
    await pass('Native dialog: pending-operation guard and backdrop dismissal');

    await open('services');
    const addService = page.getByRole('button', { name: /Add Service/ }).first();
    await addService.click();
    let serviceDialog = page.getByRole('dialog', { name: 'Service details' });
    assert(await serviceDialog.getByLabel('Service name', { exact: true }).isVisible());
    assert(await serviceDialog.getByLabel('Description', { exact: true }).isVisible());
    await serviceDialog.getByLabel('Service name', { exact: true }).fill('ab');
    await serviceDialog.getByRole('button', { name: 'Create Service', exact: true }).click();
    assert.equal(await serviceDialog.getByLabel('Service name', { exact: true }).getAttribute('aria-invalid'), 'true');
    await page.waitForFunction(() => document.activeElement?.id === 'service-field-1');
    assert(await serviceDialog.locator('#service-name-error').isVisible());
    await page.screenshot({ path: path.join(output, 'service-validation-desktop.png') });
    await assertModalFocus(serviceDialog, addService);
    await pass('Real service editor: labels, inline error relationship, first-invalid focus and native modal behavior');

    await open('calendar', 390);
    const selected = page.getByRole('button', { pressed: true });
    assert((await selected.getAttribute('aria-label')).includes('October'));
    await page.getByRole('button', { name: /October 20, 2026/ }).click();
    assert((await page.getByRole('button', { pressed: true }).getAttribute('aria-label')).includes('20'));
    await page.getByRole('button', { name: 'Next month', exact: true }).click();
    assert(await page.getByText('November 2026', { exact: true }).isVisible());
    await pass('Calendar: named dates, pressed selection, keyboard-accessible month navigation');

    await open('analytics');
    await page.getByText('View appointment data table', { exact: true }).click();
    await page.getByText('View paid booking value data table', { exact: true }).click();
    assert.equal(await page.getByRole('table').count(), 2);
    assert.equal(await page.getByRole('img').count(), 2);
    await page.screenshot({ path: path.join(output, 'analytics-desktop.png') });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const widths = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert(widths.content <= widths.viewport + 1, 'Analytics does not overflow at ' + width);
      await page.screenshot({ path: path.join(output, `analytics-${width}.png`), fullPage: true });
    }
    await pass('Analytics: named canvases, real expandable tables, 320/390px document reflow');

    for (const width of [1366, 390, 320]) {
      await open('shell', width);
      const header = page.locator('.janjiyuk-topbar');
      assert.equal(await header.locator('input').count(), 0, 'Header has no inert search');
      assert.equal(await header.getByRole('button', { name: /Notifications|Filter/i }).count(), 0);
      if (width < 768) {
        await header.getByRole('button', { name: 'Open menu', exact: true }).click();
        assert(await page.locator('.drawer-nav-list').getByRole('link', { name: 'Appointments', exact: true }).isVisible());
        await page.getByRole('button', { name: 'Close menu', exact: true }).click();
      }
      assert(await page.getByRole('link', { name: width < 768 ? 'Bookings' : 'Appointments', exact: true }).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await pass('Merchant header: no inert search/filter or notification shortcut; existing mobile/desktop navigation works');

    await open('appointments', 1366, 'operations');
    const view = page.getByRole('combobox', { name: 'Appointment view', exact: true });
    assert.equal(await page.getByRole('combobox').count(), 1, 'Only the main view selector is initially visible');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search appointments', exact: true }).fill('Client 00');
    assert.match(await page.getByRole('status').innerText(), /1 appointment matches/);
    assert(await page.getByRole('button', { name: 'Previous page', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await view.selectOption('late-cancellation');
    assert.match(await page.getByRole('status').innerText(), /1 appointment matches/);
    await view.selectOption('confirmed');
    assert.match(await page.getByRole('status').innerText(), /15 appointments match/);
    await page.getByText('More filters', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Service', exact: true }).selectOption('other-service');
    assert.match(await page.getByRole('status').innerText(), /0 appointments match/);
    await page.getByRole('combobox', { name: 'Service', exact: true }).selectOption('fixture-service');
    assert.match(await page.getByRole('status').innerText(), /15 appointments match/);
    await page.getByRole('combobox', { name: 'Sort appointments', exact: true }).selectOption('customer-desc');
    assert.match(await page.locator('.appointments-desktop-table tbody tr').first().innerText(), /Client 14/);
    await page.getByRole('combobox', { name: 'Appointment dates', exact: true }).selectOption('past');
    assert.match(await page.getByRole('status').innerText(), /0 appointments match/);
    await page.getByRole('searchbox', { name: 'Search appointments', exact: true }).fill('no match');
    await page.getByRole('button', { name: 'Review payments', exact: true }).click();
    assert.equal(await view.inputValue(), 'payment-pending');
    assert.equal(await page.getByRole('searchbox', { name: 'Search appointments', exact: true }).inputValue(), '');
    assert.match(await page.getByRole('status').innerText(), /1 appointment matches/);
    await page.getByRole('button', { name: 'Actions', exact: true }).click();
    assert(await page.getByRole('button', { name: /Accept Payment$/ }).isVisible());
    assert(await page.getByRole('button', { name: /Reject Payment$/ }).isVisible());
    await view.selectOption('refunds-due');
    assert.equal(await page.getByRole('searchbox').count(), 0, 'Appointment filters do not imply they filter the refund ledger');
    assert.equal(await page.locator('.appointment-more-filters').count(), 0);
    assert(await page.getByRole('heading', { name: 'Refunds Due & Ledger', exact: true }).isVisible());
    await pass('Appointment filtering: single view, preserved statuses, combined dates/search, pagination reset, payment-review shortcut and separate ledger');
    for (const width of [390, 320]) {
      await open('appointments', width, 'operations');
      await page.getByText('More filters', { exact: true }).click();
      for (const name of ['Appointment view', 'Service', 'Appointment dates', 'Sort appointments']) assert(await page.getByRole('combobox', { name, exact: true }).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(output, `appointment-filters-${width}.png`), fullPage: true });
    }
    await pass('Appointment filters: 320/390px layout, labelled fields and accessible disclosure');

    await open('appointments');
    const newAppointment = page.getByRole('button', { name: /New Appointment/ });
    await newAppointment.click();
    await assertModalFocus(page.getByRole('dialog', { name: 'Create appointment', exact: true }), newAppointment);
    await pass('Real manual appointment dialog: keyboard containment, Escape and focus return');
    for (const [action, name] of [['Reschedule', 'Reschedule appointment'], ['Mark as completed', 'Complete appointment'], ['Cancel appointment', 'Cancel appointment'], ['Delete', 'Delete appointment']]) {
      const trigger = page.getByRole('button', { name: 'Actions', exact: true });
      await trigger.click();
      await page.getByRole('button', { name: new RegExp(`${action}$`, 'i') }).click();
      await assertModalFocus(page.getByRole('dialog', { name, exact: true }), trigger);
      await pass(`Real appointment ${action}: keyboard containment, Escape and action-trigger focus return`);
    }

    await open('booking');
    await page.getByRole('button', { name: /Test consultation/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const bookingDate = page.locator('.cal-strip-day-btn:not([disabled])').filter({ hasText: String(date.getDate()) }).first();
    await bookingDate.click();
    await page.locator('.timeslot-row:not([disabled])').first().click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    for (const name of ['Full Name *', 'WhatsApp / Phone *', 'Email address (for calendar invite)', 'Notes (optional)']) {
      assert(await page.getByLabel(name, { exact: true }).isVisible(), `Booking field named: ${name}`);
    }
    await page.getByLabel('Full Name *', { exact: true }).fill('a');
    await page.getByLabel('WhatsApp / Phone *', { exact: true }).focus();
    assert.equal(await page.getByLabel('Full Name *', { exact: true }).getAttribute('aria-invalid'), 'true');
    const errorId = await page.getByLabel('Full Name *', { exact: true }).getAttribute('aria-describedby');
    assert(await page.locator(`#${errorId}`).isVisible());
    await page.screenshot({ path: path.join(output, 'booking-form-desktop.png') });
    await pass('Real customer booking: service/date/time selection, associated labels and inline error description');

    await open('customer');
    const reschedule = page.getByRole('button', { name: 'Reschedule Appointment', exact: true });
    await reschedule.click();
    await assertModalFocus(page.getByRole('dialog', { name: 'Reschedule your session', exact: true }), reschedule);
    const cancelBooking = page.getByRole('button', { name: 'Cancel Appointment', exact: true });
    await cancelBooking.click();
    await assertModalFocus(page.getByRole('dialog', { name: 'Cancel your booking', exact: true }), cancelBooking);
    await pass('Real customer reschedule/cancel dialogs: keyboard containment, Escape and focus return');

    await open('appointments', 1366, 'past');
    let actionTrigger = page.getByRole('button', { name: 'Actions', exact: true });
    await actionTrigger.click();
    await page.getByRole('button', { name: /Mark.*[Nn]o.show/ }).click();
    await assertModalFocus(page.getByRole('dialog', { name: 'Mark appointment as no-show', exact: true }), actionTrigger);
    await pass('Real no-show dialog: keyboard behavior and return to action trigger');

    await open('appointments', 1366, 'payment');
    actionTrigger = page.getByRole('button', { name: 'Actions', exact: true });
    await actionTrigger.click();
    await page.getByRole('button', { name: /Reject Payment$/ }).click();
    await assertModalFocus(page.getByRole('dialog', { name: 'Reject payment', exact: true }), actionTrigger);
    await actionTrigger.click();
    await page.getByRole('button', { name: /View details$/i }).click();
    const proof = page.getByRole('button', { name: 'View Full Proof', exact: true });
    await proof.click();
    await assertModalFocus(page.getByRole('dialog', { name: 'Payment screenshot', exact: true }), proof);
    await pass('Real payment rejection and proof dialogs: keyboard behavior and focus return without submitting');

    await open('appointments', 1366, 'refund');
    await page.getByRole('combobox', { name: 'Appointment view', exact: true }).selectOption('refunds-due');
    const refund = page.getByRole('button', { name: 'Mark Refunded', exact: true });
    await refund.click();
    await assertModalFocus(page.getByRole('dialog', { name: 'Record refund', exact: true }), refund);
    await pass('Real refund-recording dialog: keyboard behavior without financial submission');

    await open('customer', 1366, 'dispute');
    const dispute = page.getByRole('button', { name: /Dispute.*No.Show/i });
    await dispute.click();
    await assertModalFocus(page.getByRole('dialog', { name: 'Report a booking issue', exact: true }), dispute);
    await pass('Real customer dispute dialog: keyboard behavior and focus return without submission');

    for (const width of [320, 390]) {
      await open('services', width);
      await page.getByRole('button', { name: /Add Service/ }).first().click();
      const mobileDialog = page.getByRole('dialog', { name: 'Service details' });
      const metrics = await mobileDialog.locator('.modal').evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }));
      assert(metrics.content <= metrics.width + 1 && metrics.left >= 0 && metrics.right <= width, `Service dialog fits ${width}px`);
      await mobileDialog.getByRole('button', { name: 'Create Service', exact: true }).scrollIntoViewIfNeeded();
      assert(await mobileDialog.getByRole('button', { name: 'Create Service', exact: true }).isVisible());
      await page.screenshot({ path: path.join(output, `service-dialog-${width}.png`) });
      await page.keyboard.press('Escape');
      await open('customer', width);
      await page.getByRole('button', { name: 'Reschedule Appointment', exact: true }).click();
      const customerDialog = page.getByRole('dialog', { name: 'Reschedule your session', exact: true });
      const bounds = await customerDialog.locator('.modal').evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
      await page.screenshot({ path: path.join(output, `customer-reschedule-${width}.png`) });
      assert(bounds.content <= bounds.width + 1, `Customer dialog content fits ${width}px: ${JSON.stringify(bounds)}`);
      await page.keyboard.press('Escape');
    }
    await pass('Service and customer reschedule dialogs: 320/390px content reflow and reachable footer');

    for (const surface of ['appointments', 'availability', 'booking', 'customer']) {
      await open(surface);
      await page.screenshot({ path: path.join(output, `${surface}-desktop.png`), fullPage: true });
      await pass(`${surface}: isolated production page renders without JS errors`);
      if (process.env.CALUP_A11Y_PROBE) console.log(surface, (await page.locator('body').innerText()).slice(-6000));
    }
  } finally {
    await fs.writeFile(path.join(output, 'component-results.json'), JSON.stringify({ results, pageErrors, futureDate, mode: 'Real production components with mocked data adapters; no real account or financial operations' }, null, 2));
    await context.close();
    await browser.close();
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
