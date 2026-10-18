import { Router } from 'express';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';

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

export default router;
