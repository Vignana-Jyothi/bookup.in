import { Router } from 'express';
import { googleCalendarService } from '../services/googleCalendar.js';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/calendar/busy
 * Fetch busy time intervals for a provider on a specific date (YYYY-MM-DD)
 * Public endpoint used by /book/:slug and dashboard availability.
 * Returns only { connected, busyTimes: [{ start, end }] } with zero private event information.
 */
router.get('/busy', async (req, res) => {
  const { providerId, date, timeZone = 'Asia/Kolkata' } = req.query;

  if (!providerId) {
    return res.status(400).json({ success: false, error: 'providerId parameter is required' });
  }

  if (!date) {
    return res.status(400).json({ success: false, error: 'date parameter is required (YYYY-MM-DD)' });
  }

  try {
    const result = await googleCalendarService.getBusyIntervals(providerId, date, timeZone);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error fetching calendar busy intervals:', err.message);
    res.status(503).json({ success: false, error: 'Calendar availability is temporarily unavailable. Please try again.' });
  }
});

/**
 * POST /api/calendar/events
 * Create an event on the provider's Google Calendar for a confirmed booking.
 * Idempotent with persistent database deduplication.
 */
router.post('/events', requireProviderAuth, async (req, res) => {
  const bookingId = req.body?.booking?.id;
  const providerId = req.providerId;
  if (typeof bookingId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
    return res.status(400).json({ success: false, error: 'A persisted booking ID is required' });
  }
  if (!serviceRoleClient) return res.status(503).json({ success: false, error: 'Booking storage is unavailable' });
  try {
    const { data: saved, error } = await serviceRoleClient.from('bookings')
      .select('*, services(name, meeting_type), providers(timezone, name)')
      .eq('id', bookingId).eq('provider_id', providerId).maybeSingle();
    if (error) return res.status(503).json({ success: false, error: 'Booking could not be loaded' });
    if (!saved || saved.provider_id !== providerId) return res.status(404).json({ success: false, error: 'Booking not found' });
    if (saved.status !== 'confirmed' || !((saved.price !== null && saved.price !== undefined && Number(saved.price) === 0) || saved.payment_status === 'confirmed')) {
      return res.status(409).json({ success: false, error: 'Booking must be confirmed with any required payment completed' });
    }
    if (saved.google_event_id) return res.json({ success: true, eventId: saved.google_event_id, meetLink: saved.meet_link || null, duplicatePrevented: true });
    const booking = {
      id: saved.id, date: saved.booking_date, startTime: saved.start_time, endTime: saved.end_time,
      duration: saved.duration, price: saved.price, serviceName: saved.services?.name,
      providerName: saved.providers?.name, customerName: saved.customer_name, customerEmail: saved.customer_email,
      customerPhone: saved.customer_phone, notes: saved.notes, meetingType: saved.meeting_type || saved.services?.meeting_type,
    };
    const result = await googleCalendarService.createEvent(providerId, booking, saved.providers?.timezone || 'Asia/Kolkata');
    if (result.success && result.eventId) {
      const { data: updated, error: updateError } = await serviceRoleClient.from('bookings')
        .update({ google_event_id: result.eventId, ...(result.meetLink ? { meet_link: result.meetLink } : {}) })
        .eq('id', bookingId).eq('provider_id', providerId).eq('status', 'confirmed')
        .select('id').maybeSingle();
      if (updateError || !updated) return res.status(503).json({ success: false, error: 'Calendar details could not be saved. Please retry.' });
    }
    return res.json(result);
  } catch (err) {
    console.error('[CalendarRoutes] Event creation failed:', err.message);
    return res.status(503).json({ success: false, error: 'Calendar synchronization is temporarily unavailable' });
  }
});

/**
 * PATCH /api/calendar/events/:eventId
 * Update event on Google Calendar (e.g. Reschedule)
 */
router.patch('/events/:eventId', requireProviderAuth, async (req, res) => {
  const { eventId } = req.params;
  const providerId = req.providerId;
  const { booking } = req.body;

  if (!eventId || !booking) {
    return res.status(400).json({ success: false, error: 'eventId and booking details required' });
  }

  try {
    if (!serviceRoleClient) return res.status(503).json({ success: false, error: 'Booking storage is unavailable' });
    const { data: saved, error } = await serviceRoleClient.from('bookings')
      .select('id, provider_id, booking_date, start_time, end_time, providers(timezone)')
      .eq('google_event_id', eventId).eq('provider_id', providerId).maybeSingle();
    if (error) return res.status(503).json({ success: false, error: 'Booking could not be loaded' });
    if (!saved || saved.provider_id !== providerId) return res.status(404).json({ success: false, error: 'Booking not found' });
    const result = await googleCalendarService.updateEvent(providerId, eventId, {
      date: saved.booking_date, startTime: saved.start_time, endTime: saved.end_time,
    }, saved.providers?.timezone || 'Asia/Kolkata');
    res.json(result);
  } catch (err) {
    console.error('Error updating Google Calendar event:', err.message);
    res.status(503).json({ success: false, error: 'Calendar synchronization is temporarily unavailable' });
  }
});

/**
 * DELETE /api/calendar/events/:eventId
 * Delete event from Google Calendar (e.g. Cancellation)
 */
router.delete('/events/:eventId', requireProviderAuth, async (req, res) => {
  const { eventId } = req.params;
  const providerId = req.providerId;

  if (!eventId) {
    return res.status(400).json({ success: false, error: 'eventId parameter is required' });
  }

  try {
    if (!serviceRoleClient) return res.status(503).json({ success: false, error: 'Booking storage is unavailable' });
    const { data: saved, error } = await serviceRoleClient.from('bookings')
      .select('id, provider_id').eq('google_event_id', eventId).eq('provider_id', providerId).maybeSingle();
    if (error) return res.status(503).json({ success: false, error: 'Booking could not be loaded' });
    if (!saved || saved.provider_id !== providerId) return res.status(404).json({ success: false, error: 'Booking not found' });
    const result = await googleCalendarService.deleteEvent(providerId, eventId);
    res.json(result);
  } catch (err) {
    console.error('Error deleting Google Calendar event:', err.message);
    res.status(503).json({ success: false, error: 'Calendar synchronization is temporarily unavailable' });
  }
});

export default router;
