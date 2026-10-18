import { Router } from 'express';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';
import { tokenRouteLimiter, bookingCreateLimiter } from '../middleware/rateLimiter.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const knownErrors = {
  NOT_FOUND: [404, 'Appointment not found.'], VALIDATION_FAILED: [422, 'Enter a reason of 10 to 2000 characters.'],
  IDEMPOTENCY_CONFLICT: [409, 'This retry differs from the original request.'],
  PAYMENT_NOT_REFUNDABLE: [409, 'This booking has no verified refundable payment.'],
  REFUND_ALREADY_IN_PROGRESS: [409, 'A refund is already being processed for this payment.'],
  ALREADY_REFUNDED: [409, 'This payment has already been fully refunded.'],
};

export function createBookingRefundRequestsRouter({ client = serviceRoleClient, auth = requireProviderAuth } = {}) {
  const router = Router();
  router.use(tokenRouteLimiter, auth);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!client) return res.status(503).json({ error: 'Refund requests are temporarily unavailable.' });
    next();
  });
  async function operate(req, res, create) {
    const input = req.body || {};
    const id = create ? input.appointmentId : req.params.appointmentId;
    const key = req.headers['idempotency-key'];
    if (!uuid.test(String(id || '')) || (create && (
      Object.keys(input).some(field => !['appointmentId', 'reason'].includes(field)) ||
      typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.trim().length > 2000 ||
      typeof key !== 'string' || !/^[\w-]{16,128}$/.test(key)))) return res.status(422).json({ error: 'Valid appointment, reason, and retry key are required.' });
    try {
      const { data, error } = await client.rpc(create ? 'request_booking_refund_v1' : 'get_booking_refund_request_v1', {
        p_provider_id: req.providerId, p_appointment_id: id,
        ...(create ? { p_user_id: req.user.id, p_reason: input.reason.trim(), p_key: key } : {}),
      });
      if (error) {
        const match = knownErrors[error.message];
        if (match) return res.status(match[0]).json({ error: match[1] });
        throw error;
      }
      return res.status(create ? 201 : 200).json({ data });
    } catch (error) {
      console.error('[BookingRefundRequests] Failed', { code: error?.code || 'unknown' });
      return res.status(503).json({ error: 'Refund requests are temporarily unavailable. Retry the same request.' });
    }
  }
  router.get('/:appointmentId', (req, res) => operate(req, res, false));
  router.post('/', bookingCreateLimiter, (req, res) => operate(req, res, true));
  return router;
}
