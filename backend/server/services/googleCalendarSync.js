import crypto from 'crypto';
import { config } from '../config.js';
import { serviceRoleClient } from '../middleware/auth.js';
import { googleCalendarService } from './googleCalendar.js';

const workerId = `calendar-${crypto.randomUUID()}`;
let timer = null;
let running = false;

async function complete(job, succeeded, result = {}) {
  const { error } = await serviceRoleClient.rpc('complete_google_calendar_sync_v1', {
    p_appointment_id: job.appointment_id,
    p_lease_owner: workerId,
    p_lease_generation: job.lease_generation,
    p_succeeded: succeeded,
    p_google_event_id: result.eventId || null,
    p_meet_link: result.meetLink || null,
    p_safe_error: succeeded ? null : String(result.reason || result.error || 'calendar_sync_failed').slice(0, 200),
    p_max_attempts: 8,
  });
  if (error) throw error;
}

export async function runGoogleCalendarSyncCycle() {
  if (running || !config.isGoogleConfigured() || !serviceRoleClient) return;
  running = true;
  try {
    // Deleting an already absent event is successful; failed deletions stay durable.
    const cleanup = await serviceRoleClient.rpc('claim_refund_calendar_cleanup_v1', { p_owner: workerId });
    if (cleanup.error) throw cleanup.error;
    for (const job of cleanup.data || []) {
      let success = false;
      try { success = Boolean((await googleCalendarService.deleteEvent(job.providerId, job.eventId))?.success); }
      catch { /* Persist a retry without losing the durable cancellation. */ }
      const finished = await serviceRoleClient.rpc('finish_refund_calendar_cleanup_v1', {
        p_id: job.id, p_owner: workerId, p_generation: job.generation, p_success: success,
      });
      if (finished.error) throw finished.error;
    }
    const { data: jobs, error } = await serviceRoleClient.rpc('claim_google_calendar_sync_v1', {
      p_lease_owner: workerId,
      p_limit: 10,
      p_lease_seconds: 60,
    });
    if (error) throw error;

    for (const job of jobs || []) {
      try {
        const result = await googleCalendarService.createEvent(job.provider_id, {
          id: job.appointment_id,
          date: job.booking_date,
          startTime: job.start_time,
          endTime: job.end_time,
          duration: job.duration,
          serviceName: job.service_name,
          customerName: job.customer_name,
          customerEmail: job.customer_email,
          customerPhone: job.customer_phone,
          price: job.amount,
          meetingType: job.meeting_type,
        }, job.timezone || 'Asia/Kolkata');
        await complete(job, Boolean(result?.success && result?.eventId && result?.meetLink), result || {});
        // A refund may invalidate this creation lease while Google is responding.
        const current = await serviceRoleClient.rpc('get_appointment_meeting_v1', { p_appointment_id: job.appointment_id });
        if (!current.error && current.data?.calendarSyncStatus === 'not_required' && result?.eventId) {
          await googleCalendarService.deleteEvent(job.provider_id, result.eventId);
        }
      } catch (error_) {
        await complete(job, false, { error: error_?.message || 'calendar_sync_exception' }).catch(() => null);
      }
    }
  } catch (error) {
    if (error?.code !== 'PGRST202') console.error('[GoogleCalendarSync] Cycle failed:', error?.message || error);
  } finally {
    running = false;
  }
}

export function wakeGoogleCalendarSyncWorker() {
  setImmediate(() => runGoogleCalendarSyncCycle());
}

export function startGoogleCalendarSyncWorker() {
  if (timer || !config.isGoogleConfigured()) return;
  timer = setInterval(runGoogleCalendarSyncCycle, 30000);
  timer.unref?.();
  wakeGoogleCalendarSyncWorker();
}

export function stopGoogleCalendarSyncWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
