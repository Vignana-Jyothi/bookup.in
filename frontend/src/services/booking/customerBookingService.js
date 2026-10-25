/**
 * BookUp — Customer Booking Management API Service
 * Communicates with clean, cookie-authenticated customer booking endpoints.
 */

import { getApiBase } from '../../utils/api.js';

export { getApiBase };

export const customerBookingService = {
  /**
   * Create booking via backend (authoritative conflict checks + server-side WhatsApp confirmations)
   */
  async createBooking(bookingPayload) {
    const apiBase = getApiBase();
    let res;
    try {
      res = await fetch(`${apiBase}/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(bookingPayload),
      });
    } catch (networkErr) {
      throw new Error(`Unable to reach booking server. Please check your connection and try again.`);
    }

    const result = await res.json().catch(() => ({}));
    if (res.ok && result.success) {
      return result;
    }

    // Never fall back to direct client Supabase insert: booking creation must always go through backend API.
    const err = new Error(result.error || result.details || 'Could not complete your booking. Please try again.');
    err.status = res.status;
    err.isConflict = res.status === 409;
    throw err;
  },

  /**
   * Fetch appointment by management token from the backend
   */
  async getBooking(token, customerPhone = '') {
    const apiBase = getApiBase();
    const bookingReference = String(token || '').trim().toUpperCase();

    if (/^M\d{9}$/.test(bookingReference)) {
      if (!customerPhone) return null;
      const res = await fetch(`${apiBase}/v1/public/customer-bookings/track`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ bookingId: bookingReference, customerPhone }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.data?.booking) return result.data;
      if (res.status === 404) {
        const legacyExchange = await fetch(`${apiBase}/v1/public/bookings/access-session`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ bookingId: bookingReference, customerPhone }),
        });
        if (legacyExchange.ok) {
          const current = await fetch(`${apiBase}/v1/public/bookings/current`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          });
          const currentResult = await current.json().catch(() => ({}));
          if (current.ok && currentResult.booking) return currentResult;
        }
      }
      const message = typeof result.error === 'string' ? result.error : result.error?.message;
      const error = new Error(message || 'Could not find this booking.');
      error.status = res.status;
      throw error;
    }

    if (token) {
      const exchange = await fetch(`${apiBase}/v1/public/bookings/access-session`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ managementToken: token }),
      });
      if (!exchange.ok) return null;
    }

    const currentReference = await fetch(`${apiBase}/v1/public/customer-bookings/current`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (currentReference.ok) {
      const result = await currentReference.json();
      if (result.data?.booking) return result.data;
    }

    const currentManagement = await fetch(`${apiBase}/v1/public/bookings/current`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (currentManagement.ok) {
      const result = await currentManagement.json();
      if (result.success && result.booking) return result;
    }
    return null;
  },

  /**
   * Reschedule appointment via backend (which verifies conflicts and Google Calendar)
   */
  async rescheduleBooking(token, newDate, newTime) {
    if (!newDate || !newTime) {
      throw new Error('Date and time are required for rescheduling.');
    }

    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/v1/public/bookings/current/reschedule`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ newDate, newTime }),
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(result.error || 'Failed to reschedule appointment');
      err.status = res.status;
      err.isConflict = res.status === 409;
      throw err;
    }
    return result;
  },

  /**
   * Cancel appointment via backend (which checks cancellation policy window)
   */
  async cancelBooking(token) {
    const apiBase = getApiBase();

    const res = await fetch(`${apiBase}/v1/public/bookings/current/cancel`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'Failed to cancel appointment');
    }
    return result;
  },

  /**
   * Mark booking as paid (customer-side, token-authed)
   * Sends optional screenshot file via FormData
   */
  async markPaid(token, screenshotFile = null) {
    const apiBase = getApiBase();

    const formData = new FormData();
    if (screenshotFile) {
      formData.append('screenshot', screenshotFile);
    }

    const res = await fetch(`${apiBase}/v1/public/bookings/current/mark-paid`, {
      method: 'POST',
      credentials: 'include',
      body: screenshotFile ? formData : undefined,
      headers: screenshotFile ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'Failed to mark payment');
    }
    return result;
  },

  /**
   * Customer reports coach no-show after start + grace period
   */
  async reportCoachNoShow(token) {
    const apiBase = getApiBase();

    const res = await fetch(`${apiBase}/v1/public/bookings/current/report-coach-no-show`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'Failed to report coach no-show');
    }
    return result;
  },

  /**
   * Customer confirms receipt or disputes refund
   */
  async refundAction(token, action, disputeNote = '') {
    const apiBase = getApiBase();

    const res = await fetch(`${apiBase}/v1/public/bookings/current/refund-action`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action, disputeNote }),
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'Failed to process refund action');
    }
    return result;
  },

  /**
   * Customer disputes a customer no-show within 48h
   */
  async disputeNoShow(token, disputeNote = '') {
    const apiBase = getApiBase();

    const res = await fetch(`${apiBase}/v1/public/bookings/current/dispute-no-show`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ disputeNote }),
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'Failed to submit dispute');
    }
    return result;
  },

  /**
   * Get public policy for provider
   */
  async getPublicPolicy(providerId) {
    if (!providerId) return null;
    const apiBase = getApiBase();
    try {
      const res = await fetch(`${apiBase}/policies/public/${encodeURIComponent(providerId)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return null;
  },
};

