import { Router } from 'express';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';
import { requireActiveEntitlement } from '../middleware/entitlement.js';

const router = Router();

function mapLegacyBooking(b) {
  return {
    id: b.id,
    bookingId: b.booking_reference || null,
    providerId: b.provider_id,
    serviceId: b.service_id,
    serviceName: b.services?.name || b.service_name || 'Service',
    customerId: b.customer_id,
    customerName: b.customer_name,
    customerPhone: b.customer_phone,
    customerWhatsApp: b.customer_whatsapp || b.customer_phone,
    customerEmail: b.customer_email || '',
    date: b.booking_date,
    startTime: b.start_time ? String(b.start_time).substring(0, 5) : '',
    endTime: b.end_time ? String(b.end_time).substring(0, 5) : '',
    actualEndTime: b.actual_end_time ? String(b.actual_end_time).substring(0, 5) : undefined,
    duration: Number(b.duration) || 60,
    price: Number(b.price) || 0,
    depositAmount: Number(b.deposit_amount) || 0,
    depositStatus: b.deposit_status || 'na',
    status: b.status,
    notes: b.notes || '',
    createdAt: b.created_at,
    paymentStatus: b.payment_status || null,
    paymentScreenshotUrl: b.payment_screenshot_url || null,
    paymentMarkedPaidAt: b.payment_marked_paid_at || null,
    paymentConfirmedAt: b.payment_confirmed_at || null,
    paymentRejectedAt: b.payment_rejected_at || null,
    paymentRejectedReason: b.payment_rejected_reason || null,
    policySnapshot: b.policy_snapshot || null,
    policyAcceptedAt: b.policy_accepted_at || null,
    rescheduleCount: b.reschedule_count || 0,
    refundAmount: b.refund_amount || 0,
    refundStatus: b.refund_status || 'none',
    refundReason: b.refund_reason || null,
    coachCancelledAt: b.coach_cancelled_at || null,
    customerNoShowAt: b.customer_no_show_at || null,
    coachNoShowReportedAt: b.coach_no_show_reported_at || null,
    disputedAt: b.disputed_at || null,
    disputeReason: b.dispute_reason || null,
    sourceSystem: 'legacy',
    googleEventId: b.google_event_id || null,
    meetLink: b.meet_link || null,
    syncedToGoogleCalendar: Boolean(b.google_event_id),
  };
}

router.get('/', requireProviderAuth, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');

  if (!serviceRoleClient) {
    return res.status(503).json({ success: false, error: 'Appointment storage is unavailable.' });
  }

  const [legacyResult, cashfreeResult] = await Promise.all([
    serviceRoleClient
      .from('bookings')
      .select('*, services(name)')
      .eq('provider_id', req.providerId)
      .order('booking_date', { ascending: false })
      .order('start_time', { ascending: false }),
    serviceRoleClient.rpc('get_merchant_cashfree_appointments_v1', {
      p_provider_id: req.providerId,
    }),
  ]);

  if (legacyResult.error || cashfreeResult.error) {
    console.error('[MerchantAppointments] Read failed:', {
      legacy: legacyResult.error?.message,
      cashfree: cashfreeResult.error?.message,
      providerId: req.providerId,
    });
    return res.status(503).json({ success: false, error: 'Appointments are temporarily unavailable.' });
  }

  const legacy = (legacyResult.data || []).map(mapLegacyBooking);
  const cashfreeBase = Array.isArray(cashfreeResult.data) ? cashfreeResult.data : [];
  const cashfree = await Promise.all(cashfreeBase.map(async appointment => {
    const { data } = await serviceRoleClient.rpc('get_appointment_meeting_v1', {
      p_appointment_id: appointment.id,
    });
    return data ? { ...appointment, ...data } : appointment;
  }));
  const appointments = [...legacy, ...cashfree].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) || String(b.startTime).localeCompare(String(a.startTime))
  );

  return res.json({ success: true, appointments });
});

export function createManualAppointmentHandler(database = serviceRoleClient) {
  return async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!database) return res.status(503).json({ error: 'Appointment storage is unavailable.' });
    const body = req.body || {};
    const key = String(req.headers['idempotency-key'] || '');
    const fields = ['serviceId', 'customerName', 'customerEmail', 'customerPhone', 'customerWhatsApp', 'bookingDate', 'startTime', 'notes'];
    const phone = String(body.customerPhone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    const date = String(body.bookingDate || '');
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key) ||
        Object.keys(body).some(field => !fields.includes(field) || typeof body[field] !== 'string') ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.serviceId || '')) ||
        !/^[6-9]\d{9}$/.test(phone) || String(body.customerName || '').trim().length < 2 ||
        String(body.customerName || '').length > 120 || String(body.notes || '').length > 2000 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.startTime || '')) ||
        (body.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.customerEmail))) {
      return res.status(422).json({ error: 'Enter a valid service, date, time, customer name and Indian mobile number.' });
    }
    const payload = {
      serviceId: body.serviceId, customerName: body.customerName.trim(),
      customerEmail: String(body.customerEmail || '').trim().toLowerCase(), customerPhone: phone,
      customerWhatsApp: String(body.customerWhatsApp || phone).trim(),
      bookingDate: body.bookingDate, startTime: body.startTime, notes: String(body.notes || '').trim(),
    };
    try {
      const { data, error } = await database.rpc('create_merchant_booking_v1', { p_provider_id: req.providerId, p_key: key, p_payload: payload });
      if (error) {
        const conflict = /SLOT_UNAVAILABLE|IDEMPOTENCY_CONFLICT|REQUEST_ENDED|conflict|overlap/i.test(error.message || '');
        return res.status(conflict ? 409 : 503).json({ error: conflict ? 'The appointment could not be saved. Check the selected slot or refresh your appointments before retrying.' : 'Appointment saving is temporarily unavailable. Your entries are preserved; retry the same request.' });
      }
      const row = typeof data === 'string' ? JSON.parse(data) : data;
      if (!row?.id || row.provider_id !== req.providerId) return res.status(503).json({ error: 'The saved appointment could not be verified. Retry the same request.' });
      return res.status(201).json({ success: true, appointment: mapLegacyBooking(row) });
    } catch {
      return res.status(503).json({ error: 'Appointment saving is temporarily unavailable. Retry the same request.' });
    }
  };
}
router.post('/', requireProviderAuth, requireActiveEntitlement, createManualAppointmentHandler());
export default router;
