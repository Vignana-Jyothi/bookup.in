import { encryptToken, decryptToken } from './crypto.js';
import { config } from '../config.js';

const COOKIE_NAME = 'calup_customer_access';
const MAX_AGE_SECONDS = 30 * 60;

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((cookies, pair) => {
    const separator = pair.indexOf('=');
    if (separator <= 0) return cookies;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = '';
    }
    return cookies;
  }, {});
}

export function setCustomerAccessCookie(res, access) {
  const payload = encryptToken(JSON.stringify({
    ...access,
    expiresAt: Date.now() + (MAX_AGE_SECONDS * 1000),
  }));
  const cookieSecurity = process.env.NODE_ENV === 'production' ? '; Secure; SameSite=None' : '; SameSite=Lax';
  res.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(payload)}; Path=/api; HttpOnly; Max-Age=${MAX_AGE_SECONDS}${cookieSecurity}`,
  );
}

export function customerRequestIsTrusted(req) {
  if (process.env.NODE_ENV !== 'production') return true;
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (!origin) return false;
  const allowed = [config.frontendUrl, config.corsOrigin]
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(value => value.trim().replace(/\/+$/, ''));
  return allowed.includes(origin);
}

export function getCustomerAccess(req) {
  const encrypted = parseCookies(req)[COOKIE_NAME];
  if (!encrypted) return null;
  try {
    const access = JSON.parse(decryptToken(encrypted));
    if (!access?.expiresAt || access.expiresAt <= Date.now()) return null;
    return access;
  } catch {
    return null;
  }
}

export function getManagementToken(req) {
  const routeToken = String(req.params?.token || '').trim();
  if (routeToken && routeToken !== 'current') return routeToken;
  const access = getCustomerAccess(req);
  return access?.kind === 'management' ? String(access.token || '').trim() : '';
}

