import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const root = fileURLToPath(new URL('../../', import.meta.url));
const projectRef = 'jmgylovlxiiomvcejuhd';
const projectUrl = `https://${projectRef}.supabase.co`;

export function auditEnvironment(settings, inherited = {}, otherSettings = {}) {
  if (settings.CALUP_AUDIT_PROJECT_REF !== projectRef ||
      settings.SUPABASE_URL !== projectUrl || settings.VITE_SUPABASE_URL !== projectUrl) {
    throw new Error('Audit mode requires the configured disposable Supabase project.');
  }
  const publicKey = settings.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  let publicClaims;
  let serverClaims;
  try { publicClaims = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url')); } catch { /* Modern publishable key. */ }
  try { serverClaims = JSON.parse(Buffer.from((settings.SUPABASE_SERVICE_ROLE_KEY || '').split('.')[1], 'base64url')); } catch { /* Modern secret key. */ }
  if (!publicKey || publicKey.startsWith('sb_secret_') || publicClaims?.role === 'service_role' ||
      (publicClaims?.ref && publicClaims.ref !== projectRef)) {
    throw new Error('Audit frontend requires a publishable/anon key.');
  }
  if (!settings.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Set the test project SUPABASE_SERVICE_ROLE_KEY in .env.audit.local. Never use the original project key.');
  }
  if (!settings.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_') &&
      (serverClaims?.role !== 'service_role' || serverClaims.ref !== projectRef)) {
    throw new Error('Audit backend key must belong to the disposable project.');
  }
  if (settings.CASHFREE_ENVIRONMENT !== 'sandbox') throw new Error('Audit mode only permits Cashfree sandbox.');
  if (settings.CASHFREE_V1_ENABLED === 'true') {
    if (!/^TEST/i.test(settings.CASHFREE_CLIENT_ID || '') || !settings.CASHFREE_CLIENT_SECRET) {
      throw new Error('Cashfree requires sandbox test credentials.');
    }
    let url;
    try { url = new URL(settings.BACKEND_PUBLIC_URL); } catch { /* Report only the setting name. */ }
    if (url?.protocol !== 'https:') throw new Error('Set BACKEND_PUBLIC_URL to the dedicated HTTPS test tunnel before enabling checkout.');
  }
  if (settings.CASHFREE_MARKETPLACE_ENABLED === 'true' || settings.CASHFREE_CUSTOMER_MEMBERSHIPS_ENABLED === 'true') {
    throw new Error('Enable commerce sandbox modules only after their separate test setup.');
  }
  // dotenv in backend config must not fill missing settings from the original .env.
  // Vite environment files must not fill them either. Blank every known application setting.
  const env = { ...inherited };
  for (const name of new Set([...Object.keys(otherSettings), ...Object.keys(inherited)])) {
    if (/^(VITE_|SUPABASE_|GOOGLE_|CASHFREE_|RESEND_|TWO_FACTOR_|WHATSAPP_|RICH_AUTOMATE_|TOKEN_|INTERNAL_|BACKGROUND_|FRONTEND_|BACKEND_|APP_|SUPPORT_|CORS_|ALLOWED_|DEBUG_|ENABLE_|TRUST_|PORT$)/i.test(name) || name in otherSettings) env[name] = '';
  }
  let tunnelHost = '';
  if (settings.BACKEND_PUBLIC_URL) {
    try { const tunnel = new URL(settings.BACKEND_PUBLIC_URL); if (tunnel.protocol === 'https:') tunnelHost = tunnel.hostname; } catch { /* Checkout validation above reports malformed origins. */ }
  }
  return { ...env, ...settings, __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: tunnelHost, NODE_ENV: 'development', BACKGROUND_WORKERS_ENABLED: 'false', DEBUG_ROUTES: 'false', ENABLE_TEST_ROUTES: 'false' };
}

export function runAuditDev(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--check')) throw new Error('Only --check is supported.');
  const filename = path.join(root, '.env.audit.local');
  if (!fs.existsSync(filename)) throw new Error('Create the ignored .env.audit.local test configuration first.');
  const settings = dotenv.parse(fs.readFileSync(filename));
  const otherSettings = {};
  for (const name of fs.readdirSync(root).filter(name => /^\.env(?:$|[.-])/.test(name))) {
    if (fs.statSync(path.join(root, name)).isFile()) Object.assign(otherSettings, dotenv.parse(fs.readFileSync(path.join(root, name))));
  }
  const env = auditEnvironment(settings, process.env, otherSettings);
  console.log('Audit configuration valid: disposable Supabase, Cashfree sandbox, background workers disabled.');
  if (args.includes('--check')) return;
  const child = spawn(process.execPath, ['run-dev.js', '--no-watch'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  child.on('error', () => { console.error('Could not start audit development server.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runAuditDev(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
