/**
 * BookUp — Real Google Calendar Provider
 * Communicates with backend endpoints (/api/auth/google/*, /api/calendar/*)
 * to perform real OAuth 2.0 connection, fetch live busy intervals, and sync booking events.
 */

import { CalendarProvider } from './CalendarProvider';
import { supabase } from '../supabase/supabaseClient';

async function getAuthHeader() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
  } catch (err) {
    console.warn('Could not retrieve Supabase session token:', err);
  }
  return {};
}

import { getApiBase } from '../../utils/api.js';

export class RealGoogleCalendarProvider extends CalendarProvider {
  constructor(apiBase) {
    super();
    this._customApiBase = apiBase;
  }

  get apiBase() {
    return this._customApiBase || getApiBase();
  }

  /**
   * Get connection status for the authenticated provider
   */
  async getStatus(_providerId) {
    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch(`${this.apiBase}/auth/google/status`, {
        headers: { ...authHeaders },
      });
      if (!res.ok) return { isConnected: false, email: null };
      const data = await res.json();
      return {
        isConnected: Boolean(data.isConnected),
        email: data.email || null,
        connectedEmail: data.connectedEmail || data.email || null,
        profileEmail: data.profileEmail || null,
        hostAccessReady: Boolean(data.hostAccessReady),
        reconnectRequired: Boolean(data.reconnectRequired),
        connectedAt: data.connectedAt || null,
        provider: data.provider || 'google',
        capabilities: data.capabilities || {},
      };
    } catch (err) {
      console.warn('Could not fetch Google Calendar status from server:', err.message);
      return { isConnected: false, email: null };
    }
  }

  /**
   * Initiate Google OAuth flow:
   * Fetches authorization URL from backend and redirects the user
   */
  async connect(options = {}) {
    const authHeaders = await getAuthHeader();
    const returnTo = options.returnTo === 'onboarding' ? 'onboarding' : 'settings';
    const res = await fetch(`${this.apiBase}/auth/google/url?returnTo=${encodeURIComponent(returnTo)}${options.popup ? '&popup=true' : ''}`, {
      headers: { ...authHeaders },
    });
    const data = await res.json();

    if (!data.success || !data.url) {
      throw new Error(data.error || 'Failed to generate Google OAuth URL. Please ensure credentials are in .env');
    }

    if (options.popup) {
      const popup = options.popup;
      const callbackOrigin = data.callbackOrigin;
      if (!callbackOrigin) throw new Error('Restart the Calup backend to enable Google popup connections.');
      return new Promise((resolve, reject) => {
        let settled = false;
        let checkingClosed = false;
        let closedAt = null;
        const finish = error => {
          if (settled) return;
          settled = true;
          clearInterval(interval);
          clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          if (!popup.closed) popup.close();
          if (error) reject(error);
          else resolve({ connected: true });
        };
        const onMessage = event => {
          if (event.source !== popup || event.origin !== callbackOrigin || event.data?.type !== 'calup-google-oauth') return;
          if (event.data.result === 'connected') finish();
          else finish(new Error(event.data.result === 'account_mismatch'
            ? 'Connect the Google account that matches your business email.'
            : 'Google connection was cancelled or failed. Please try again.'));
        };
        window.addEventListener('message', onMessage);
        // If browser isolation removes the opener, reconcile through authenticated server status.
        const interval = setInterval(async () => {
          if (!popup.closed || checkingClosed || settled) return;
          closedAt ??= Date.now();
          if (Date.now() - closedAt < 1000) return;
          checkingClosed = true;
          const status = await this.getStatus();
          if (settled) return;
          finish(status.hostAccessReady ? null : new Error('Google window closed before the connection was completed. Please try again.'));
        }, 500);
        const timeout = setTimeout(() => finish(new Error('Google connection timed out. Please try again.')), 5 * 60 * 1000);
        try {
          popup.location.href = data.url;
        } catch {
          finish(new Error('Could not open Google. Allow popups for Calup and try again.'));
        }
      });
    }

    // Redirect current window to Google's consent screen
    window.location.href = data.url;
    return { redirecting: true };
  }

  /**
   * Run a live identity and permission check without creating an event.
   */
  async testConnection() {
    const authHeaders = await getAuthHeader();
    const res = await fetch(`${this.apiBase}/auth/google/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Google connection could not be verified.');
    }
    return data;
  }

  /**
   * Disconnect Google Calendar and revoke tokens
   */
  async disconnect(_providerId) {
    const authHeaders = await getAuthHeader();
    const res = await fetch(`${this.apiBase}/auth/google/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
    });

    const data = await res.json();
    return Boolean(data.success);
  }

  /**
   * Check if connected
   * @param {Object} calendarState
   */
  isConnected(calendarState) {
    return Boolean(calendarState?.isConnected);
  }

  /**
   * Fetch busy time intervals for a given date (YYYY-MM-DD)
   * Queries Google Calendar freebusy via backend for public booking slot filtering
   * @param {string} dateStr 'YYYY-MM-DD'
   * @param {string} providerId
   * @param {string} timeZone
   */
  async getBusyTimes(dateStr, providerId, timeZone = 'Asia/Kolkata') {
    if (!dateStr || !providerId) return [];

    try {
      const res = await fetch(`${this.apiBase}/calendar/busy?providerId=${encodeURIComponent(providerId)}&date=${encodeURIComponent(dateStr)}&timeZone=${encodeURIComponent(timeZone)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.busyTimes) ? data.busyTimes : [];
    } catch (err) {
      console.warn('Error fetching Google Calendar busy times:', err.message);
      return [];
    }
  }

  /**
   * Create an event for a confirmed booking
   * @param {Object} booking
   * @param {string} providerId
   * @param {string} timeZone
   */
  async createEvent(booking, providerId, timeZone = 'Asia/Kolkata') {
    if (!providerId || !booking) return { success: false, reason: 'missing_params' };

    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch(`${this.apiBase}/calendar/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ providerId, booking, timeZone }),
      });

      const data = await res.json();
      return {
        success: Boolean(data.success),
        eventId: data.eventId || null,
        htmlLink: data.htmlLink || null,
        meetLink: data.meetLink || null,
        organizerEmail: data.organizerEmail || null,
        duplicatePrevented: Boolean(data.duplicatePrevented),
      };
    } catch (err) {
      console.error('Failed to sync event to Google Calendar:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Update an existing event (e.g. Reschedule)
   * @param {string} eventId
   * @param {Object} booking
   * @param {string} providerId
   */
  async updateEvent(eventId, booking, providerId = 'provider-1') {
    if (!eventId) return { success: false };

    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch(`${this.apiBase}/calendar/events/${encodeURIComponent(eventId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ providerId, booking }),
      });

      const data = await res.json();
      return { success: Boolean(data.success) };
    } catch (err) {
      console.error('Failed to update Google Calendar event:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete event upon cancellation
   * @param {string} eventId
   * @param {string} providerId
   */
  async deleteEvent(eventId, providerId = 'provider-1') {
    if (!eventId) return { success: false };

    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch(`${this.apiBase}/calendar/events/${encodeURIComponent(eventId)}?providerId=${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
        headers: { ...authHeaders },
      });

      const data = await res.json();
      return { success: Boolean(data.success) };
    } catch (err) {
      console.error('Failed to delete Google Calendar event:', err.message);
      return { success: false, error: err.message };
    }
  }
}

export const realGoogleCalendarService = new RealGoogleCalendarProvider();
