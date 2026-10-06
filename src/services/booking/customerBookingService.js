/**
 * BookUp — Customer Booking Management API Service
 * Communicates with backend /api/public/bookings/manage/* endpoints.
 */

import { dbService } from '../supabase/dbService.js';
import { isSupabaseConfigured } from '../supabase/supabaseClient.js';

export function getApiBase() {
  const envUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
                 (typeof process !== 'undefined' && process.env?.VITE_API_URL) || '';
  if (envUrl.trim()) {
    return `${envUrl.trim().replace(/\/$/, '')}/api`;
  }
  if (typeof window !== 'undefined') {
    const host = window.location?.hostname || '';
    if (host.includes('vercel.app') || host.includes('calup.in') || (!host.includes('localhost') && !host.includes('127.0.0.1'))) {
      return 'https://bookup-in.onrender.com/api';
    }
  }
  if (typeof window === 'undefined' && typeof process !== 'undefined') {
    return import.meta.env.VITE_API_URL || '/api';
  }
  return '/api';
}

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
  async getBooking(token) {
    if (!token) return null;
    const apiBase = getApiBase();

    try {
      let res = await fetch(`${apiBase}/public/bookings/booking-status/${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok && res.status !== 404) {
        // Fallback to manage endpoint if booking-status alias failed
        res = await fetch(`${apiBase}/public/bookings/manage/${encodeURIComponent(token)}`, {
          headers: { Accept: 'application/json' },
        });
      }

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.booking) {
          return data;
        }
      } else if (res.status === 404) {
        // Return null for 404 so UI can show appointment not found
        return null;
      }
    } catch (apiErr) {
      console.warn('Backend API fetch error, falling back to direct dbService:', apiErr.message);
    }

    // Graceful fallback for demo or if backend server is unreachable
    if (isSupabaseConfigured()) {
      return dbService.getBookingByManagementToken(token);
    }

    return null;
  },

  /**
   * Reschedule appointment via backend (which verifies conflicts and Google Calendar)
   */
  async rescheduleBooking(token, newDate, newTime) {
    if (!token || !newDate || !newTime) {
      throw new Error('Date and time are required for rescheduling.');
    }

    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/public/bookings/manage/${encodeURIComponent(token)}/reschedule`, {
      method: 'POST',
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
    if (!token) throw new Error('Management token is required');
    const apiBase = getApiBase();

    const res = await fetch(`${apiBase}/public/bookings/manage/${encodeURIComponent(token)}/cancel`, {
      method: 'POST',
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
    if (!token) throw new Error('Management token is required');
    const apiBase = getApiBase();

    const formData = new FormData();
    if (screenshotFile) {
      formData.append('screenshot', screenshotFile);
    }

    const res = await fetch(`${apiBase}/public/bookings/manage/${encodeURIComponent(token)}/mark-paid`, {
      method: 'POST',
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
    if (!token) throw new Error('Management token is required');
    const apiBase = getApiBase();

    const res = await fetch(`${apiBase}/public/bookings/manage/${encodeURIComponent(token)}/report-coach-no-show`, {
      method: 'POST',
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
    if (!token) throw new Error('Management token is required');
    const apiBase = getApiBase();

    const res = await fetch(`${apiBase}/public/bookings/manage/${encodeURIComponent(token)}/refund-action`, {
      method: 'POST',
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
    if (!token) throw new Error('Management token is required');
    const apiBase = getApiBase();

    const res = await fetch(`${apiBase}/public/bookings/manage/${encodeURIComponent(token)}/dispute-no-show`, {
      method: 'POST',
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

