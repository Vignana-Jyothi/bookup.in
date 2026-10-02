/**
 * CalUp — Rate Limiting Middleware
 *
 * Three tiers:
 *   1. tokenRouteLimiter   — 120 req/min/IP  (track page polls every ~6s)
 *   2. bookingCreateLimiter — 20 req/hour/IP  (booking creation)
 *   3. markPaidLimiter      — 5 req/15min/IP  (payment screenshot upload)
 *
 * All limiters return 429 JSON responses and identify the client by IP.
 * Behind Render / reverse proxy, trust proxy must be set on the Express app
 * so req.ip reflects the real client (see index.js).
 */

import rateLimit from 'express-rate-limit';

let limiterOverride = {
  disabled: null,
};

export function setLimiterOverride(opts) {
  Object.assign(limiterOverride, opts);
}

const jsonHandler = (_req, res) => {
  res.status(429).json({
    success: false,
    error: 'Too many requests. Please try again later.',
  });
};

const shouldSkip = (req) => {
  if (process.env.NODE_ENV === 'production') return false;
  if (typeof limiterOverride.disabled === 'boolean') {
    return limiterOverride.disabled;
  }
  if (process.env.DISABLE_RATE_LIMIT === 'true') return true;
  if (req.headers['x-test-bypass-rate-limit'] === 'true') return true;
  return false;
};

export const tokenRouteLimiter = rateLimit({
  windowMs: 60 * 1000,          // 1 minute
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: shouldSkip,
  handler: jsonHandler,
});

export const bookingCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,     // 1 hour
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: shouldSkip,
  handler: jsonHandler,
});

export const markPaidLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,     // 15 minutes
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: shouldSkip,
  handler: jsonHandler,
});

/**
 * Reset all rate limiter stores (test-only, never call in production).
 */
export function resetAllLimiters() {
  limiterOverride.disabled = null;
  tokenRouteLimiter.resetKey?.('__all__');
  bookingCreateLimiter.resetKey?.('__all__');
  markPaidLimiter.resetKey?.('__all__');

  // MemoryStore exposes resetAll() on the store instance
  for (const limiter of [tokenRouteLimiter, bookingCreateLimiter, markPaidLimiter]) {
    if (limiter.store?.resetAll) {
      limiter.store.resetAll();
    }
  }
}
