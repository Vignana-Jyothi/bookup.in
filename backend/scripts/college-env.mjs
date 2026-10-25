import { writeFile, rename, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const publicNames = [
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_APP_URL',
  'VITE_API_URL', 'VITE_SUPPORT_EMAIL', 'VITE_DEMO_SLUG', 'VITE_CASHFREE_V1_ENABLED',
  'VITE_LEGAL_NAME', 'VITE_BUSINESS_ADDRESS', 'VITE_GRIEVANCE_CONTACT_NAME', 'VITE_GRIEVANCE_EMAIL',
];
const privateNames = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'TOKEN_ENCRYPTION_KEY',
  'FRONTEND_URL', 'BACKEND_PUBLIC_URL', 'CORS_ORIGIN', 'TRUST_PROXY', 'BACKGROUND_WORKERS_ENABLED',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'RESEND_API_KEY',
  'RESEND_FROM_EMAIL', 'TWO_FACTOR_API_KEY', 'TWO_FACTOR_TEMPLATE_NAME', 'SUPPORT_EMAIL', 'APP_DOMAIN',
  'INTERNAL_CRON_SECRET', 'RICH_AUTOMATE_API_KEY', 'RICH_AUTOMATE_TEMPLATE_CONFIRMATION_CUSTOMER',
  'RICH_AUTOMATE_TEMPLATE_CONFIRMATION_PROVIDER', 'RICH_AUTOMATE_TEMPLATE_REMINDER_CUSTOMER',
  'WHATSAPP_MEETING_ENABLED', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_MEETING_TEMPLATE', 'WHATSAPP_TEMPLATE_LANGUAGE', 'WHATSAPP_GRAPH_API_VERSION',
  'CASHFREE_V1_ENABLED', 'CASHFREE_ENVIRONMENT', 'CASHFREE_ADMIN_REFUNDS_ENABLED',
  'CASHFREE_CLIENT_ID', 'CASHFREE_CLIENT_SECRET', 'CASHFREE_API_VERSION',
  'CASHFREE_SANDBOX_ALLOW_UNVERIFIED_CONTACT', 'CASHFREE_MARKETPLACE_ENABLED',
  'CASHFREE_MARKETPLACE_CLIENT_ID', 'CASHFREE_MARKETPLACE_CLIENT_SECRET',
  'CASHFREE_CUSTOMER_MEMBERSHIPS_ENABLED', 'CASHFREE_CUSTOMER_MEMBERSHIPS_CLIENT_ID',
  'CASHFREE_CUSTOMER_MEMBERSHIPS_CLIENT_SECRET',
];

function httpsUrl(value, name, originOnly = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${name}`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (originOnly && !['', '/'].includes(url.pathname)) || /placeholder|your-project/i.test(url.hostname)) {
    throw new Error(`Invalid ${name}`);
  }
  return url;
}

// Only declared application settings leave the workflow environment. Never log values.
export function prepareCollegeEnvironment({ secrets = {}, variables = {}, fixture = false } = {}) {
  const input = { ...variables, ...Object.fromEntries(Object.entries(secrets).filter(([, value]) => value !== '')) };
  const values = {};
  for (const name of [...publicNames, ...privateNames]) {
    const value = input[name] ?? '';
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error(`Invalid single-line setting: ${name}`);
    values[name] = value;
  }
  values.VITE_SUPABASE_URL ||= input.NEXT_PUBLIC_SUPABASE_URL || values.SUPABASE_URL;
  values.SUPABASE_URL ||= values.VITE_SUPABASE_URL;
  values.VITE_APP_URL ||= 'https://calup.app';
  values.FRONTEND_URL ||= values.VITE_APP_URL;
  values.BACKEND_PUBLIC_URL ||= values.VITE_APP_URL;
  values.VITE_API_URL = '/api';
  values.VITE_SUPPORT_EMAIL ||= 'support@calup.app';
  values.SUPPORT_EMAIL ||= values.VITE_SUPPORT_EMAIL;
  values.APP_DOMAIN ||= new URL(values.VITE_APP_URL).hostname;
  values.VITE_LEGAL_NAME ||= 'Calup';
  values.TRUST_PROXY ||= '1';
  values.BACKGROUND_WORKERS_ENABLED ||= 'false';
  values.CASHFREE_ENVIRONMENT ||= 'sandbox';
  values.CASHFREE_API_VERSION ||= '2023-08-01';
  values.WHATSAPP_TEMPLATE_LANGUAGE ||= 'en';
  values.WHATSAPP_GRAPH_API_VERSION ||= 'v23.0';
  for (const name of Object.keys(values).filter(name => name.endsWith('_ENABLED') || name === 'CASHFREE_SANDBOX_ALLOW_UNVERIFIED_CONTACT')) {
    values[name] ||= 'false';
    if (!['true', 'false'].includes(values[name])) throw new Error(`Invalid boolean: ${name}`);
  }
  for (const name of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'VITE_APP_URL', 'FRONTEND_URL', 'BACKEND_PUBLIC_URL']) {
    httpsUrl(values[name], name, true);
  }
  // This writer is specifically for the college main deployment, not Render/Vercel.
  // Reject stale hosted secrets instead of silently generating off-site links/webhooks.
  for (const name of ['VITE_APP_URL', 'FRONTEND_URL', 'BACKEND_PUBLIC_URL']) {
    if (new URL(values[name]).origin !== 'https://calup.app') throw new Error(`${name} must be https://calup.app for the college deployment`);
    values[name] = 'https://calup.app';
  }
  const googleCallback = `${values.BACKEND_PUBLIC_URL}/api/auth/google/callback`;
  values.GOOGLE_REDIRECT_URI ||= googleCallback;
  if (values.GOOGLE_REDIRECT_URI !== googleCallback) throw new Error(`GOOGLE_REDIRECT_URI must be ${googleCallback}`);
  if (new URL(values.SUPABASE_URL).origin !== new URL(values.VITE_SUPABASE_URL).origin) throw new Error('Frontend and backend Supabase projects differ');
  if (new URL(values.VITE_APP_URL).origin !== new URL(values.FRONTEND_URL).origin) throw new Error('Frontend origins differ');
  if (!/^\d+$/.test(values.TRUST_PROXY)) throw new Error('Invalid TRUST_PROXY');
  for (const name of ['VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TOKEN_ENCRYPTION_KEY']) {
    if (!values[name] || /placeholder|your[-_]/i.test(values[name])) throw new Error(`Missing ${name}`);
  }
  let role;
  try { role = JSON.parse(Buffer.from(values.VITE_SUPABASE_PUBLISHABLE_KEY.split('.')[1], 'base64url').toString()).role; } catch { /* Publishable keys need not be JWTs. */ }
  if (values.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_secret_') || role === 'service_role'
    || values.VITE_SUPABASE_PUBLISHABLE_KEY === values.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Privileged frontend key rejected');
  if (!/^[a-f0-9]{64}$/i.test(values.TOKEN_ENCRYPTION_KEY) || (!fixture && /^0+$/.test(values.TOKEN_ENCRYPTION_KEY))) throw new Error('Invalid TOKEN_ENCRYPTION_KEY');
  const requireNames = names => {
    for (const name of names) if (!values[name]) throw new Error(`Missing ${name}`);
  };
  if (values.GOOGLE_CLIENT_ID || values.GOOGLE_CLIENT_SECRET) {
    requireNames(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']);
    httpsUrl(values.GOOGLE_REDIRECT_URI, 'GOOGLE_REDIRECT_URI');
  }
  if (values.RESEND_API_KEY) requireNames(['RESEND_FROM_EMAIL']);
  if (values.TWO_FACTOR_TEMPLATE_NAME) requireNames(['TWO_FACTOR_API_KEY']);
  if (!['sandbox', 'production'].includes(values.CASHFREE_ENVIRONMENT)) throw new Error('Invalid CASHFREE_ENVIRONMENT');
  if (values.CASHFREE_V1_ENABLED === 'true') requireNames(['CASHFREE_CLIENT_ID', 'CASHFREE_CLIENT_SECRET']);
  if (values.CASHFREE_ENVIRONMENT === 'production' && values.CASHFREE_SANDBOX_ALLOW_UNVERIFIED_CONTACT === 'true') throw new Error('Unverified production payments rejected');
  for (const prefix of ['CASHFREE_MARKETPLACE', 'CASHFREE_CUSTOMER_MEMBERSHIPS']) {
    if (values[`${prefix}_ENABLED`] === 'true') requireNames([`${prefix}_CLIENT_ID`, `${prefix}_CLIENT_SECRET`]);
  }
  if (values.WHATSAPP_MEETING_ENABLED === 'true') requireNames(['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_MEETING_TEMPLATE']);
  for (const [name, value] of Object.entries(values)) {
    if (/[\r\n\0]/.test(value)) throw new Error(`Invalid single-line setting: ${name}`);
  }
  return {
    frontend: Object.fromEntries(publicNames.map(name => [name, values[name]])),
    backend: { ...Object.fromEntries(privateNames.map(name => [name, values[name]])), NODE_ENV: 'production', PORT: '5252', ENABLE_TEST_ROUTES: 'false', DEBUG_ROUTES: 'false' },
  };
}

export const fixtureSettings = {
  VITE_SUPABASE_URL: 'https://fixture.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ci_fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'ci-fixture-server-key', TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
};

export async function writeCollegeEnvironment(settings, directory = '.') {
  const compose = { ...settings.frontend, BACKGROUND_WORKERS_ENABLED: settings.backend.BACKGROUND_WORKERS_ENABLED };
  // Compose single quotes prevent interpolation. The backend uses Compose env_file format: raw.
  const publicText = Object.entries(compose).map(([name, value]) => `${name}='${value.replaceAll("'", "\\'")}'`).join('\n') + '\n';
  const backendText = Object.entries(settings.backend).map(([name, value]) => `${name}=${value}`).join('\n') + '\n';
  await mkdir(directory, { recursive: true });
  for (const [name, content] of [['.env', publicText], ['.env.backend', backendText]]) {
    const target = resolve(directory, name);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, target);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const fixture = process.argv.includes('--fixture');
    if (fixture) {
      for (const name of ['.env', '.env.backend']) {
        const exists = await access(name).then(() => true, () => false);
        if (exists) throw new Error(`Fixture writer requires a clean checkout; refusing to replace ${name}`);
      }
    }
    if (!fixture && !process.env.CALUP_DEPLOY_SECRETS) throw new Error('CALUP_DEPLOY_SECRETS is required; local .env is not imported');
    const settings = prepareCollegeEnvironment({
      secrets: fixture ? fixtureSettings : JSON.parse(process.env.CALUP_DEPLOY_SECRETS),
      variables: JSON.parse(process.env.CALUP_DEPLOY_VARIABLES || '{}'), fixture,
    });
    await writeCollegeEnvironment(settings);
    console.log('Validated public build settings and backend-only runtime settings written.');
  } catch (error) { console.error(error instanceof SyntaxError ? 'Invalid deployment JSON input' : error.message); process.exitCode = 1; }
}
