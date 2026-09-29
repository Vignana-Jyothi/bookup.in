/**
 * CalUp — Device Booking Persistence Utility
 * Manages tracking tokens stored on the customer's device (localStorage).
 * Key: "calup_last_booking" -> { token, savedAt, coachSlug }
 */

export const LAST_BOOKING_STORAGE_KEY = 'calup_last_booking';

/**
 * Save tracking token and coach slug to device storage.
 * Fails silently if localStorage is blocked or unavailable.
 */
export function saveLastBooking(token, coachSlug = '') {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!token || typeof token !== 'string') return;
    const payload = {
      token: token.trim(),
      savedAt: new Date().toISOString(),
      coachSlug: (coachSlug || '').trim(),
    };
    window.localStorage.setItem(LAST_BOOKING_STORAGE_KEY, JSON.stringify(payload));
  } catch (_err) {
    // Fail silently (localStorage unavailable, quota exceeded, private mode)
  }
}

/**
 * Retrieve saved booking from device storage.
 * Fails silently and returns null on corrupt data or error.
 */
export function getLastBooking() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(LAST_BOOKING_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && typeof data.token === 'string' && data.token.trim()) {
      return {
        token: data.token.trim(),
        savedAt: data.savedAt || null,
        coachSlug: typeof data.coachSlug === 'string' ? data.coachSlug.trim() : '',
      };
    }
    return null;
  } catch (_err) {
    return null;
  }
}

/**
 * Clear saved booking from device storage.
 * Fails silently if localStorage is blocked or unavailable.
 */
export function clearLastBooking() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(LAST_BOOKING_STORAGE_KEY);
  } catch (_err) {
    // Fail silently
  }
}

/**
 * Checks if a booking's scheduled appointment time has passed.
 */
export function isBookingExpired(booking) {
  if (!booking?.date) return false;
  try {
    const [y, m, d] = booking.date.split('-').map(Number);
    if (!y || !m || !d) return false;
    const timeStr = booking.endTime || booking.startTime || '23:59';
    const [h, min] = timeStr.split(':').map(Number);
    const bookingEnd = new Date(y, m - 1, d, h || 0, min || 0, 0);
    return bookingEnd.getTime() < Date.now();
  } catch (_err) {
    return false;
  }
}

/**
 * Evaluates whether a booking is considered active.
 *
 * Active states:
 * - pending / pending_payment / awaiting_payment
 * - payment verification pending (paymentStatus === 'verification_pending')
 * - confirmed and upcoming (!isExpired)
 *
 * Inactive states:
 * - completed, cancelled, late-cancellation, rejected
 * - expired (scheduled time has passed)
 */
export function isBookingActive(booking) {
  if (!booking) return false;

  const status = (booking.status || '').toLowerCase().trim();
  const paymentStatus = (booking.paymentStatus || '').toLowerCase().trim();

  // 1. Explicit terminal/inactive statuses
  if (['cancelled', 'late-cancellation', 'completed', 'rejected'].includes(status)) {
    return false;
  }
  if (paymentStatus === 'rejected') {
    return false;
  }

  // 2. Expired (appointment date/time has already passed)
  if (isBookingExpired(booking)) {
    return false;
  }

  // 3. Active cases:
  // - Pending (awaiting payment or coach approval)
  if (status === 'pending' || status === 'pending_payment' || paymentStatus === 'awaiting_payment') {
    return true;
  }

  // - Payment verification pending
  if (paymentStatus === 'verification_pending') {
    return true;
  }

  // - Confirmed and upcoming
  if (status === 'confirmed') {
    return true;
  }

  return false;
}
