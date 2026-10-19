// Opt-in: local Vite :5173 and the user's connected Chrome CDP :9222.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const origin = 'http://127.0.0.1:5173';

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], results = [];
  const output = 'artifacts/ui-review-fixes';
  fs.mkdirSync(output, { recursive: true });
  page.on('pageerror', error => errors.push(error.message));
  // This is a rendering check: permit local assets and deny external requests/writes.
  await context.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin || !['GET', 'HEAD'].includes(request.method())) return route.abort();
    return route.continue();
  });
  try {
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/', '/subscriptions', '/login', '/signup', '/forgot-password', '/reset-password', '/contact', '/sandbox/booking']) {
        await page.goto(origin + path, { waitUntil: 'networkidle' });
        await page.locator('h1').first().waitFor();
        assert.equal(await page.locator('main').count(), 1, `${path}: one main landmark`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, `${path} fits ${width}px`);
        assert.equal(await page.locator('a a').count(), 0, `${path}: no nested anchors`);
        results.push({ path, width, heading: await page.locator('h1').first().innerText(), overflow });
        if (width === 390 && ['/', '/subscriptions', '/signup'].includes(path)) {
          await page.screenshot({ path: `${output}/${path === '/' ? 'landing' : path.slice(1)}-390.png`, fullPage: true });
        }
      }
    }
    assert.deepEqual(errors, [], 'No lazy-route runtime errors');
    fs.writeFileSync(`${output}/results.json`, JSON.stringify({ results, errors, externalWrites: 'blocked' }, null, 2));
    console.log(`PASS: ${results.length} actual public route/viewport renders, one main landmark, no nested anchors, no horizontal overflow or page errors. No external writes.`);
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
