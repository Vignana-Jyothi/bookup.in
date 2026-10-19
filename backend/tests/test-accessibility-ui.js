import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';

// Render isolated production components without auth, a database, or browser globals.
async function loadComponent(file) {
  const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
  const transformed = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' } });
  const code = transformed.code.replace(/from (['"])(react(?:\/jsx-runtime)?)\1/g,
    (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
}

const CalendarWidget = await loadComponent('frontend/src/components/ui/CalendarWidget.jsx');
const MonthlyDataTable = await loadComponent('frontend/src/components/ui/MonthlyDataTable.jsx');
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

for (const selectedDate of ['2026-10-19', '2024-02-29', '2026-12-31']) {
  const html = render(CalendarWidget, { selectedDate });
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g);
  const dateName = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const selected = buttons.filter(button => button.includes('aria-pressed="true"'));
  assert.equal(selected.length, 1, `Exactly one selected date for ${selectedDate}`);
  assert(selected[0].includes(`aria-label="${dateName}"`), 'Selected date exposes full date');
  assert.match(html, /aria-label="Previous month"/);
  assert.match(html, /aria-label="Next month"/);
  assert(buttons.filter(button => !button.includes('disabled=""')).every(button => /aria-label="[^"]+"/.test(button)), 'Every enabled calendar control is named');
}

const rows = [
  { month: 'Sep 2026', appointments: 0, revenue: 0 },
  { month: 'Oct 2026', appointments: 7, revenue: 12500.5 },
];
const appointments = render(MonthlyDataTable, { rows, field: 'appointments', caption: 'Active appointments' });
assert.match(appointments, /<caption[^>]*>Active appointments<\/caption>/);
assert.match(appointments, /scope="row"[^>]*>Sep 2026<\/th><td[^>]*>0<\/td>/);
assert.match(appointments, /scope="row"[^>]*>Oct 2026<\/th><td[^>]*>7<\/td>/);
assert.match(appointments, /<summary[^>]*>View appointment data table<\/summary>/);
const revenue = render(MonthlyDataTable, { rows, field: 'revenue', caption: 'Verified value', stale: true });
assert(revenue.includes('₹12,500.5'), 'Actual paid value remains readable without canvas');
assert(revenue.includes('last loaded snapshot; updates unavailable'), 'Stale data is identified');
for (const [props, message] of [
  [{ ready: false }, 'Loading chart data...'],
  [{ ready: false, error: true }, 'Chart data is unavailable.'],
  [{ rows: [] }, 'No monthly data available.'],
]) {
  const html = render(MonthlyDataTable, { ...props, field: 'appointments', caption: 'Appointments' });
  assert(html.includes(message));
  assert(!html.includes('<table'), 'Unknown/empty data must not masquerade as real zero values');
}

function contrast(first, second) {
  const luminance = color => {
    const channels = color.replace('#', '').match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
const tokens = await readFile(new URL('../../frontend/src/styles/variables.css', import.meta.url), 'utf8');
const authCss = await readFile(new URL('../../frontend/src/pages/Auth.css', import.meta.url), 'utf8');
const token = name => tokens.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))[1];
const placeholder = authCss.match(/input::placeholder\s*\{[^}]*color:\s*(#[0-9a-f]{6})/i)[1];
assert(contrast(placeholder, '#ffffff') >= 4.5, 'Auth placeholders meet normal-text contrast');
assert(contrast(token('--color-success-600'), '#ffffff') >= 4.5, 'Success hints meet normal-text contrast');
assert(contrast(token('--theme-focus-ring'), '#ffffff') >= 3, 'Focus indicator contrasts with light surfaces');
assert(contrast(token('--theme-focus-ring'), token('--color-lime')) >= 3, 'Focus indicator contrasts with lime controls');

console.log('PASS: accessible calendar date names/selections, chart data and recovery states, and declared color contrast. Native dialog keyboard/focus behavior is covered separately by the opt-in browser suite.');
