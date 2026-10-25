// Read-only deployed smoke checks in a user-signed-in sandbox browser profile.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const origin = 'https://calup-in.vercel.app';
const out = path.resolve(__dirname, '../../guides/project/deployed-smoke-evidence');

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  const result = { origin, checkedAt: new Date().toISOString(), checks: [], pageErrors: [], failedResponses: [] };
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) {
      const url = new URL(response.url());
      result.failedResponses.push({ host: url.host, path: url.pathname, status: response.status() });
    }
  });
  async function go(route) {
    await page.goto(origin + route, { waitUntil: 'networkidle', timeout: 30000 });
  }
  try {
    await go('/dashboard');
    result.version = await page.locator('meta[name="calup-version"]').getAttribute('content');
    result.checks.push({ name: 'Sandbox sign-in and durable dashboard session', passed: new URL(page.url()).pathname === '/dashboard' });
    if (new URL(page.url()).pathname !== '/dashboard') throw new Error('Sandbox sign-in did not persist to dashboard');
    await go('/dashboard/services');
    await page.getByRole('button', { name: /Add Service/ }).first().click();
    result.nativeServiceDialog = await page.locator('dialog[open]').count();
    result.serviceLabelLinked = await page.getByLabel('Service name', { exact: true }).count() === 1;
    if (result.nativeServiceDialog) {
      const dialog = page.locator('dialog[open]').first();
      let contained = true;
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press('Tab');
        contained &&= await dialog.evaluate(element => element.contains(document.activeElement));
      }
      result.serviceKeyboardContained = contained;
      await page.keyboard.press('Escape');
    } else {
      const close = page.locator('.modal-close').last();
      if (await close.count()) await close.click();
    }
    result.checks.push({ name: 'Deployed service dialog and labels', passed: Boolean(result.nativeServiceDialog && result.serviceLabelLinked && result.serviceKeyboardContained) });

    await go('/dashboard/booking-page');
    result.publicBookingUrl = await page.locator('a[href*="/book/"]').evaluateAll(elements => elements.map(element => element.href).find(href => !href.includes('/marketplace') && !href.includes('/memberships')) || null);
    if (!result.publicBookingUrl) {
      result.publicBookingUrl = await page.locator('body').evaluate(element => {
        const match = element.innerText.match(/https?:\/\/[^\s]+\/book\/[A-Za-z0-9._~-]+/);
        return match?.[0] || null;
      });
    }
    await go('/dashboard/appointments');
    result.checks.push({ name: 'Authenticated appointments route loads', passed: new URL(page.url()).pathname === '/dashboard/appointments' && await page.locator('h1').count() > 0 });
    await go('/dashboard/analytics');
    result.chartTableControls = await page.getByText(/View (appointment|paid booking value) data table/).count();
    result.checks.push({ name: 'Deployed chart alternatives present', passed: result.chartTableControls === 2 });
    if (result.publicBookingUrl) {
      const bookingUrl = new URL(result.publicBookingUrl);
      if (bookingUrl.origin !== origin) throw new Error('Booking URL uses a different host; recorded without navigating');
      await page.goto(bookingUrl.href, { waitUntil: 'networkidle', timeout: 30000 });
      result.bookingHeadings = await page.locator('h1,h2,h3').allTextContents();
      result.serviceChoices = await page.locator('.service-select-row').count();
      const choices = page.locator('.service-select-row');
      if (await choices.count()) {
        await choices.first().click();
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        result.availableDates = await page.locator('.cal-strip-day-btn:not([disabled])').count();
        const enabled = page.locator('.cal-strip-day-btn:not([disabled])');
        if (await enabled.count()) {
          // Prefer a later date to avoid same-day minimum-notice effects.
          await enabled.nth(Math.min(2, (await enabled.count()) - 1)).click();
          const slots = page.locator('.timeslot-row:not([disabled])');
          await slots.first().waitFor({ timeout: 15000 }).catch(() => {});
          result.availableTimes = await slots.count();
          if (result.availableTimes) {
            await slots.first().click();
            await page.getByRole('button', { name: 'Continue', exact: true }).click();
            result.bookingDetailsReached = await page.getByLabel('Full Name *', { exact: true }).count() === 1;
          }
        }
      }
      result.checks.push({ name: 'Public booking service/time/details smoke without submission', passed: Boolean(result.bookingDetailsReached) });
    }
    const recoveryContext = await browser.newContext();
    const recovery = await recoveryContext.newPage();
    const recoveryResponses = [];
    recovery.on('response', response => {
      if (response.url().includes('/checkout-sessions/current')) {
        recoveryResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
      }
    });
    try {
      await recovery.goto(origin + '/payment-status', { waitUntil: 'networkidle', timeout: 30000 });
      result.paymentRecovery = {
        scenario: 'Fresh isolated browser context with no checkout cookie or payment attempt',
        headings: await recovery.locator('h1').allTextContents(),
        copy: await recovery.locator('.payment-status-copy').allTextContents(),
        alerts: await recovery.getByRole('alert').allTextContents(),
        responses: recoveryResponses,
      };
      const copy = result.paymentRecovery.copy.join(' ');
      result.checks.push({ name: 'Missing checkout session gives accurate recovery state', passed: !copy.includes('Your slot remains protected') && !result.paymentRecovery.headings.includes('Confirming your payment') });
      await recovery.screenshot({ path: path.join(out, 'payment-without-session.png'), fullPage: true });
    } finally { await recoveryContext.close(); }
  } catch (error) {
    result.failure = error.message;
  } finally {
    await fs.writeFile(path.join(out, 'authenticated-smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (result.failure || result.checks.some(check => !check.passed) || result.pageErrors.length) process.exitCode = 1;
    await page.close();
    await browser.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
