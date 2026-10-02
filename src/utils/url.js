/**
 * Calup — App & Public URL Resolution Utility
 * Reads VITE_APP_URL environment variable if set,
 * or falls back to production URL https://calup-in.vercel.app.
 */

export function getAppBaseUrl() {
  let envUrl = '';
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_URL) {
      envUrl = import.meta.env.VITE_APP_URL;
    } else if (typeof process !== 'undefined' && process.env?.VITE_APP_URL) {
      envUrl = process.env.VITE_APP_URL;
    } else if (typeof process !== 'undefined' && (process.env?.FRONTEND_URL || process.env?.APP_URL)) {
      envUrl = process.env.FRONTEND_URL || process.env.APP_URL;
    }
  } catch (_e) {}

  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }

  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
    const port = process.env?.PORT || 5173;
    return `http://localhost:${port}`;
  }

  throw new Error('Missing required environment variable: VITE_APP_URL (or FRONTEND_URL)');
}

export const DEFAULT_APP_URL = getAppBaseUrl();

/**
 * Returns the full absolute public booking URL for a provider slug.
 * e.g. "https://calup-in.vercel.app/book/yourslovely"
 */
export function getBookingUrl(slug) {
  const base = getAppBaseUrl();
  const cleanSlug = slug ? encodeURIComponent(slug) : 'my-page';
  return `${base}/book/${cleanSlug}`;
}

/**
 * Returns the display version of booking URL without protocol.
 * e.g. "calup-in.vercel.app/book/yourslovely"
 */
export function getBookingDisplayUrl(slug) {
  const full = getBookingUrl(slug);
  return full.replace(/^https?:\/\//, '');
}

/**
 * Returns the customer management URL for a raw token.
 * e.g. "https://calup-in.vercel.app/manage/c8a9f..."
 */
export function getCustomerManagementUrl(token) {
  const base = getAppBaseUrl();
  return `${base}/manage/${encodeURIComponent(token || '')}`;
}

/**
 * Returns the customer booking tracking URL for a secure token or booking ID.
 * e.g. "https://calup-in.vercel.app/booking-status/c8a9f..."
 */
export function getCustomerBookingStatusUrl(token) {
  const base = getAppBaseUrl();
  return `${base}/booking-status/${encodeURIComponent(token || '')}`;
}

/**
 * Returns the customer booking tracking URL under /track route.
 * e.g. "https://calup-in.vercel.app/track/c8a9f..."
 */
export function getCustomerTrackUrl(token) {
  const base = getAppBaseUrl();
  return `${base}/track/${encodeURIComponent(token || '')}`;
}
