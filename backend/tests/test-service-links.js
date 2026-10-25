import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';

process.env.VITE_APP_URL = 'https://calup.example';
const { getServiceBookingUrl, getBookingUrl } = await import('../../frontend/src/utils/url.js');
const serviceId = 'session/with spaces?&=தமிழ்';
const link = new URL(getServiceBookingUrl('merchant/name', serviceId));
assert.equal(link.origin, 'https://calup.example');
assert.equal(link.pathname, '/book/merchant%2Fname');
assert.equal(link.searchParams.get('service'), serviceId);
assert.equal([...link.searchParams].length, 1, 'Service IDs cannot inject extra query parameters');
assert.equal(getBookingUrl('merchant'), 'https://calup.example/book/merchant', 'Existing merchant links stay compatible');
for (const [slug, id] of [[null, 'service'], ['', 'service'], ['merchant', null], ['merchant', '']]) {
  assert.equal(getServiceBookingUrl(slug, id), '', 'Missing identity must not create a misleading booking link');
}

const source = await readFile(new URL('../../frontend/src/pages/dashboard/Services.jsx', import.meta.url), 'utf8');
const transformed = (await transformWithOxc(source, 'Services.jsx', { jsx: { runtime: 'automatic' } })).code;
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function renderServices(slug) {
  const state = { auth: { isDemoMode: true }, provider: { slug }, services: [
    { id: 'active-service', name: 'Active consultation', duration: 30, price: 100, isActive: true },
    { id: 'inactive-service', name: 'Inactive consultation', duration: 60, price: 200, isActive: false },
  ] };
  const modules = {
    '../../data/store': `export const useStore=()=>({state:${JSON.stringify(state)},dispatch:()=>{},addToast:()=>{}});export const generateId=()=>'';export const formatCurrency=n=>'INR '+n;`,
    '../../data/actions': 'export const ACTIONS={};',
    '../../services/supabase/supabaseClient': 'export const isSupabaseConfigured=()=>false;',
    '../../services/supabase/dbService': 'export const dbService={};',
    '../../services/booking/merchantSchedulingService': 'export const merchantSchedulingService={};',
    '../../components/ui/PillButton': `import React from ${JSON.stringify(import.meta.resolve('react'))};export default function Button(p){return React.createElement('button',{type:'button'},p.children);}`,
    '../../components/ui/AccessibleModal.jsx': 'export default function Modal(){return null;}',
    '../../components/dashboard/InstructorPanel.jsx': 'export default function Panel(){return null;}',
    '../../hooks/usePopupFeedback.js': 'export const usePopupFeedback=()=>[null,()=>{}];',
    '../../utils/url.js': `export {getServiceBookingUrl} from ${JSON.stringify(new URL('../../frontend/src/utils/url.js', import.meta.url).href)};`,
  };
  const code = transformed.replace(/\/\*[\s\S]*?\*\//g, '').replace(/import ['"]\.\/Services\.css['"];?/g, '')
    .replace(/from (['"])([^'"]+)\1/g, (_match, _quote, specifier) => {
      if (specifier.startsWith('react')) return `from ${JSON.stringify(import.meta.resolve(specifier))}`;
      assert(modules[specifier], `Unexpected Services dependency: ${specifier}`);
      return `from ${JSON.stringify(moduleUrl(modules[specifier]))}`;
    });
  const Component = (await import(moduleUrl(code))).default;
  return renderToStaticMarkup(React.createElement(Component));
}
const html = await renderServices('merchant');
const articles = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g);
assert.equal(articles.length, 2);
assert.match(articles[0], /href="https:\/\/calup.example\/book\/merchant\?service=active-service"/);
assert.match(articles[0], /target="_blank" rel="noopener noreferrer"/);
assert(!articles[1].includes('<a '), 'Inactive services must not have public preview links');
assert.match(articles[1], /disabled=""[^>]*>Preview/);
assert.match(articles[1], /Activate this service to preview or share/);
const missingSlug = await renderServices('');
assert(!missingSlug.includes('<a '), 'Missing merchant slug disables preview for every service');
assert.match(missingSlug, /Your booking page address is not available yet/);
console.log('PASS: service URL encoding, compatibility, missing identity, active-only previews, inactive guidance, and safe new-tab links');
