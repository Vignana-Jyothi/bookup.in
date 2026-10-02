/**
 * CalUp — Centralized Backend API URL Resolver
 * Determines the target backend API endpoint based on environment and context.
 *
 * Rules:
 * 1. If VITE_API_URL is configured, use it directly (normalizing trailing slash / /api suffix).
 * 2. In browser environments (SPA): default to '/api', delegating routing to Vite dev proxy or production reverse proxy.
 * 3. In server / Node environments (e.g. automated test suites, SSR): default to 'http://localhost:${PORT || 3001}/api'.
 * 4. Never fall back to a hardcoded remote production/staging domain.
 */

export function getApiBase() {
  const envUrl =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_API_URL) ||
    '';

  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    const clean = envUrl.trim().replace(/\/+$/, '');
    return clean.endsWith('/api') ? clean : `${clean}/api`;
  }

  if (typeof window !== 'undefined') {
    return '/api';
  }

  const port = (typeof process !== 'undefined' && process.env?.PORT) || 3001;
  return `http://localhost:${port}/api`;
}
