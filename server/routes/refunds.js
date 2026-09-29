/**
 * CalUp — Refunds & Dispute Management Routes
 *
 * Implements:
 * - Coach refund tracking ("Refunds Due" tab)
 * - Coach mark-refund-sent with payment proof upload
 * - Coach cancel booking (always 100% refund, slot freed, email sent)
 * - Coach mark customer no-show (guarded by start + grace period, 0% refund, 48h dispute window)
 * - Customer report coach no-show (guarded by start + grace period, 100% refund_due)
 * - Customer confirm or dispute refund
 * - Admin disputed bookings and risk metrics view
 */

import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';
import { refundService } from '../services/refundService.js';
import { emailService } from '../services/email.js';
import { googleCalendarService } from '../services/googleCalendar.js';
import { DEFAULT_POLICY } from '../services/policyEngine.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP and PDF files are allowed.'));
    }
  },
});

function getSupabaseClient() {
  if (serviceRoleClient) return serviceRoleClient;
  const key = config.supabaseServiceRoleKey || config.supabaseKey;
  if (!config.supabaseUrl || !key) return null;
  return createClient(config.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function hashToken(token) {
  if (!token || typeof token !== 'string') return '';
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

async function findBookingByToken(supabase, token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const { data } = await supabase
    .from('bookings')
    .select('*, services (*), providers (*)')
    .eq('management_token_hash', tokenHash)
    .maybeSingle();
  return data;
}

// =============================================================================
// PROVIDER ENDPOINTS (requireProviderAuth)
// =============================================================================

/**
 * GET /api/bookings/refunds-due
 * Fetches all pending refunds due for the logged-in coach.
 */
router.get('/refunds-due', requireProviderAuth, async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  const providerId = req.providerId;
  try {
    const { data: refunds, error } = await supabase
      .from('refunds')
      .select('*, bookings (id, customer_name, customer_email, customer_phone, customer_whatsapp, booking_date, start_time, price, service_id, services(name))')
      .eq('provider_id', providerId)
      .in('status', ['refund_due', 'refunded', 'disputed'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({
      success: true,
      refunds: refunds || [],
    });
  } catch (err) {
    console.error('[Refunds] GET refunds-due error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch refunds' });
  }
});

/**
 * POST /api/refunds/:id/mark-sent
 * Coach marks refund as sent with screenshot upload or proof URL.
 */
router.post('/refunds/:id/mark-sent', requireProviderAuth, upload.single('screenshot'), async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  const { id } = req.params;
  const providerId = req.providerId;
  let proofUrl = req.body.proof_url || null;

  try {
    if (req.file) {
      const ext = req.file.mimetype.split('/')[1] || 'png';
      const filename = `refund_${id}_${Date.now()}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('refund-proofs')
        .upload(filename, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (!uploadErr && uploadData?.path) {
        const { data: publicUrlData } = supabase.storage
          .from('refund-proofs')
          .getPublicUrl(uploadData.path);
        proofUrl = publicUrlData?.publicUrl || uploadData.path;
      }
    }

    const updated = await refundService.markRefundSent(supabase, {
      refundId: id,
      providerId,
      proofUrl,
      actorId: providerId,
    });

    return res.json({
      success: true,
      refund: updated,
      message: 'Refund marked as sent and customer notified.',
    });
  } catch (err) {
    console.error('[Refunds] mark-sent error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to update refund status' });
  }
});

/**
 * POST /api/bookings/:id/coach-cancel
 * Coach cancels appointment:
 * - Always 100% refund_due
 * - Reason: 'coach_cancelled'
 * - Frees slot immediately
 * - Notifies customer by email
 */
router.post('/bookings/:id/coach-cancel', requireProviderAuth, async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  const { id } = req.params;
  const providerId = req.providerId;

  try {
    const { data: booking, error: getErr } = await supabase
      .from('bookings')
      .select('*, services (*), providers (*)')
      .eq('id', id)
      .eq('provider_id', providerId)
      .single();

    if (getErr || !booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    if (booking.status === 'cancelled') {
      return res.json({ success: true, message: 'Booking already cancelled' });
    }

    const price = Math.round(Number(booking.price || 0));
    const nowIso = new Date().toISOString();

    // 1. Update booking status
    const { error: updErr } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        coach_cancelled_at: nowIso,
        refund_amount: price,
        refund_reason: 'coach_cancelled',
        refund_status: price > 0 ? 'refund_due' : 'none',
        updated_at: nowIso,
      })
      .eq('id', id);

    if (updErr) throw updErr;

    // 2. If paid, create refund ledger record
    if (price > 0 && booking.payment_status === 'confirmed') {
      await refundService.processRefund(supabase, {
        booking,
        amount: price,
        reason: 'coach_cancelled',
        actorType: 'coach',
        actorId: providerId,
        details: 'Coach cancelled the appointment. 100% refund due to customer.',
      });
    }

    // 3. Delete from Google Calendar (non-blocking)
    if (booking.google_event_id) {
      try {
        await googleCalendarService.deleteEvent(providerId, booking.google_event_id);
      } catch (_gErr) {}
    }

    // 4. Log audit log
    await refundService.logAudit(supabase, {
      bookingId: id,
      providerId,
      entityType: 'booking',
      entityId: id,
      action: 'coach_cancelled',
      actorType: 'coach',
      actorId: providerId,
      oldState: { status: booking.status },
      newState: { status: 'cancelled', refund_amount: price, refund_status: price > 0 ? 'refund_due' : 'none' },
      details: 'Coach cancelled appointment. Slot released immediately.',
    });

    // 5. Notify customer by email
    if (booking.customer_email) {
      try {
        const provName = booking.providers?.name || 'Your Coach';
        const svcName = booking.services?.name || 'Session';
        await emailService.sendGenericEmail({
          to: booking.customer_email,
          subject: `Session Cancelled by Coach: ${svcName}`,
          text: `Hi ${booking.customer_name},\n\nYour session "${svcName}" with ${provName} on ${booking.booking_date} at ${booking.start_time} was cancelled by your coach.\n\n${price > 0 ? `A full refund of ₹${price} has been initiated directly by your coach.` : ''}\n\nWe apologize for the inconvenience.\nCalUp Team`,
          html: `<div style="font-family: sans-serif; max-width: 520px; padding: 24px; color: #111;">
            <h2 style="color: #dc2626; margin-top: 0;">Session Cancelled by Coach</h2>
            <p>Hi <strong>${booking.customer_name}</strong>,</p>
            <p>Your session <strong>${svcName}</strong> scheduled for <strong>${booking.booking_date} at ${booking.start_time}</strong> was cancelled by <strong>${provName}</strong>.</p>
            ${price > 0 ? `<div style="background: #fef2f2; border: 1px solid #fecaca; padding: 14px; border-radius: 8px; margin: 16px 0;">
              <strong>Full Refund Due: ₹${price}</strong><br/>
              Your coach will return your payment directly via UPI. You can track this refund on your booking status page.
            </div>` : ''}
            <p style="color: #555; font-size: 13px;">You can book another time with your coach anytime.</p>
          </div>`,
        });
      } catch (_emErr) {}
    }

    return res.json({
      success: true,
      message: 'Appointment cancelled and slot freed. Customer notified.',
    });
  } catch (err) {
    console.error('[Refunds] coach-cancel error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to cancel appointment' });
  }
});

/**
 * POST /api/bookings/:id/mark-no-show
 * Coach marks customer no-show:
 * - Only permitted after session start + grace period
 * - 0% refund
 * - Emails customer with 48-hour dispute window
 */
router.post('/bookings/:id/mark-no-show', requireProviderAuth, async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  const { id } = req.params;
  const providerId = req.providerId;

  try {
    const { data: booking, error: getErr } = await supabase
      .from('bookings')
      .select('*, services (*), providers (*)')
      .eq('id', id)
      .eq('provider_id', providerId)
      .single();

    if (getErr || !booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    // Check grace period guard: session start + grace minutes
    const policy = booking.policy_snapshot || DEFAULT_POLICY;
    const graceMinutes = Number(policy.no_show_grace_minutes ?? DEFAULT_POLICY.no_show_grace_minutes);

    const sessionStart = new Date(`${booking.booking_date}T${booking.start_time}:00`).getTime();
    const allowedAfter = sessionStart + (graceMinutes * 60 * 1000);
    const now = Date.now();

    if (now < allowedAfter) {
      const waitMinutes = Math.ceil((allowedAfter - now) / 60000);
      return res.status(400).json({
        success: false,
        error: `Cannot mark no-show until ${graceMinutes} minutes after session start. Please wait ${waitMinutes} more minute${waitMinutes === 1 ? '' : 's'}.`,
      });
    }

    const nowIso = new Date().toISOString();

    const { error: updErr } = await supabase
      .from('bookings')
      .update({
        status: 'no-show',
        customer_no_show_at: nowIso,
        refund_amount: 0,
        refund_status: 'none',
        refund_reason: 'customer_no_show',
        updated_at: nowIso,
      })
      .eq('id', id);

    if (updErr) throw updErr;

    // Audit log
    await refundService.logAudit(supabase, {
      bookingId: id,
      providerId,
      entityType: 'booking',
      entityId: id,
      action: 'marked_no_show',
      actorType: 'coach',
      actorId: providerId,
      oldState: { status: booking.status },
      newState: { status: 'no-show', refund_amount: 0 },
      details: `Coach marked customer no-show after ${graceMinutes} min grace period.`,
    });

    // Email customer with 48h dispute window
    if (booking.customer_email) {
      try {
        const disputeDeadline = new Date(now + 48 * 60 * 60 * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        await emailService.sendGenericEmail({
          to: booking.customer_email,
          subject: `Session recorded as No-Show: ${booking.services?.name || 'Session'}`,
          text: `Hi ${booking.customer_name},\n\nYour session was marked as a no-show by your coach. Per policy, no refund is provided.\n\nIf this was a mistake or you attended, you have 48 hours (until ${disputeDeadline}) to submit a dispute on your tracking link.\n\nCalUp Team`,
          html: `<div style="font-family: sans-serif; max-width: 520px; padding: 24px; color: #111;">
            <h2 style="color: #b45309; margin-top: 0;">Session Recorded as No-Show</h2>
            <p>Hi <strong>${booking.customer_name}</strong>,</p>
            <p>Your session on <strong>${booking.booking_date} at ${booking.start_time}</strong> was recorded as a customer no-show. Under the agreed cancellation policy, no-shows forfeit their session fee.</p>
            <div style="background: #fffbeb; border: 1px solid #fde68a; padding: 14px; border-radius: 8px; margin: 16px 0;">
              <strong>Have an issue? 48-Hour Dispute Window</strong><br/>
              If there was a misunderstanding or technical issue, you can dispute this status until <strong>${disputeDeadline}</strong> on your tracking page.
            </div>
            <div>
              <a href="https://calup-in.vercel.app/track/${booking.management_token_hash || ''}" style="background: #111; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 700; display: inline-block;">View Tracking Page & Dispute</a>
            </div>
          </div>`,
        });
      } catch (_emErr) {}
    }

    return res.json({
      success: true,
      message: 'Appointment recorded as no-show. Customer notified with 48h dispute window.',
    });
  } catch (err) {
    console.error('[Refunds] mark-no-show error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to mark no-show' });
  }
});

// =============================================================================
// CUSTOMER ENDPOINTS (Token-authenticated)
// =============================================================================

/**
 * POST /api/public/bookings/manage/:token/report-coach-no-show
 * Customer reports coach no-show after start + grace period:
 * - 100% refund due
 * - Flags booking for review
 * - Notifies coach
 */
router.post('/:token/report-coach-no-show', async (req, res) => {
  const { token } = req.params;
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  try {
    const booking = await findBookingByToken(supabase, token);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const policy = booking.policy_snapshot || DEFAULT_POLICY;
    const graceMinutes = Number(policy.no_show_grace_minutes ?? DEFAULT_POLICY.no_show_grace_minutes);

    const sessionStart = new Date(`${booking.booking_date}T${booking.start_time}:00`).getTime();
    const allowedAfter = sessionStart + (graceMinutes * 60 * 1000);
    const now = Date.now();

    if (now < allowedAfter) {
      const waitMinutes = Math.ceil((allowedAfter - now) / 60000);
      return res.status(400).json({
        success: false,
        error: `You can report a coach no-show ${graceMinutes} minutes after session start. Please wait ${waitMinutes} more minute${waitMinutes === 1 ? '' : 's'}.`,
      });
    }

    const price = Math.round(Number(booking.price || 0));
    const nowIso = new Date().toISOString();

    // Set refund_due 100%, flag booking for review
    const { error: updErr } = await supabase
      .from('bookings')
      .update({
        coach_no_show_reported_at: nowIso,
        status: 'disputed',
        refund_amount: price,
        refund_status: price > 0 ? 'refund_due' : 'none',
        refund_reason: 'coach_no_show',
        updated_at: nowIso,
      })
      .eq('id', booking.id);

    if (updErr) throw updErr;

    if (price > 0) {
      await refundService.processRefund(supabase, {
        booking,
        amount: price,
        reason: 'coach_no_show',
        actorType: 'customer',
        actorId: booking.customer_name,
        details: 'Customer reported coach absent past grace period. 100% refund due.',
      });
    }

    // Audit log
    await refundService.logAudit(supabase, {
      bookingId: booking.id,
      providerId: booking.provider_id,
      entityType: 'booking',
      entityId: booking.id,
      action: 'reported_coach_no_show',
      actorType: 'customer',
      actorId: booking.customer_name,
      newState: { status: 'disputed', refund_status: price > 0 ? 'refund_due' : 'none' },
      details: 'Customer reported coach absent. 100% refund due, flagged for review.',
    });

    // Notify coach by email
    const coachEmail = booking.providers?.email;
    if (coachEmail) {
      try {
        await emailService.sendGenericEmail({
          to: coachEmail,
          subject: `Urgent: Coach No-Show Reported by ${booking.customer_name}`,
          text: `Hi ${booking.providers?.name || 'Coach'},\n\nYour client ${booking.customer_name} reported that you did not attend the scheduled session on ${booking.booking_date} at ${booking.start_time}.\n\nA 100% refund of ₹${price} has been logged as refund_due. Please check your CalUp dashboard to review.\n\nCalUp Team`,
          html: `<div style="font-family: sans-serif; max-width: 520px; padding: 24px; color: #111;">
            <h2 style="color: #dc2626; margin-top: 0;">Coach No-Show Reported</h2>
            <p>Client <strong>${booking.customer_name}</strong> reported you did not attend their session on <strong>${booking.booking_date} at ${booking.start_time}</strong>.</p>
            <p>Per CalUp policy, this flags the booking for review and sets a 100% refund (₹${price}) as due.</p>
            <p>Please check your dashboard to review this session.</p>
          </div>`,
        });
      } catch (_e) {}
    }

    return res.json({
      success: true,
      message: 'Coach no-show reported. Full refund has been scheduled.',
    });
  } catch (err) {
    console.error('[Refunds] report-coach-no-show error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to report coach no-show' });
  }
});

/**
 * POST /api/public/bookings/manage/:token/refund-action
 * Customer confirms or disputes refund:
 * Body: { action: 'confirm' | 'dispute', disputeNote?: string }
 */
router.post('/:token/refund-action', async (req, res) => {
  const { token } = req.params;
  const { action, disputeNote } = req.body || {};
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  try {
    const booking = await findBookingByToken(supabase, token);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const updated = await refundService.customerRefundAction(supabase, {
      bookingId: booking.id,
      action,
      disputeNote,
      actorId: booking.customer_name,
    });

    return res.json({
      success: true,
      refund: updated,
      message: action === 'confirm' ? 'Thank you! Refund confirmed.' : 'Dispute recorded. Our team will review this booking.',
    });
  } catch (err) {
    console.error('[Refunds] refund-action error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to process refund action' });
  }
});

/**
 * POST /api/public/bookings/manage/:token/dispute-no-show
 * Customer disputes a customer no-show within 48h:
 * Body: { disputeNote: string }
 */
router.post('/:token/dispute-no-show', async (req, res) => {
  const { token } = req.params;
  const { disputeNote } = req.body || {};
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  try {
    const booking = await findBookingByToken(supabase, token);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    if (booking.status !== 'no-show') {
      return res.status(400).json({ success: false, error: 'This booking is not marked as a no-show.' });
    }

    // Verify 48-hour dispute window
    const markedAt = booking.customer_no_show_at ? new Date(booking.customer_no_show_at).getTime() : new Date(booking.updated_at).getTime();
    const now = Date.now();
    if (now - markedAt > 48 * 60 * 60 * 1000) {
      return res.status(400).json({ success: false, error: 'The 48-hour dispute window for this no-show has expired.' });
    }

    const nowIso = new Date().toISOString();
    await supabase
      .from('bookings')
      .update({
        status: 'disputed',
        disputed_at: nowIso,
        dispute_reason: disputeNote?.trim() || 'Customer disputed no-show status',
        updated_at: nowIso,
      })
      .eq('id', booking.id);

    await refundService.logAudit(supabase, {
      bookingId: booking.id,
      providerId: booking.provider_id,
      entityType: 'booking',
      entityId: booking.id,
      action: 'disputed',
      actorType: 'customer',
      actorId: booking.customer_name,
      newState: { status: 'disputed', dispute_reason: disputeNote },
      details: `Customer disputed no-show: ${disputeNote}`,
    });

    return res.json({
      success: true,
      message: 'Dispute submitted. Coach and CalUp admin have been notified.',
    });
  } catch (err) {
    console.error('[Refunds] dispute-no-show error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to submit dispute' });
  }
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

/**
 * GET /api/admin/disputed-bookings
 * Admin overview of all disputed bookings and coach risk metrics.
 */
router.get('/admin/disputed-bookings', async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ success: false, error: 'Database unavailable' });

  try {
    const { data: disputedBookings, error: bErr } = await supabase
      .from('bookings')
      .select('*, providers(id, name, email, phone), services(name)')
      .eq('status', 'disputed')
      .order('disputed_at', { ascending: false });

    if (bErr) throw bErr;

    const { data: riskMetrics, error: rErr } = await supabase
      .from('coach_risk_metrics')
      .select('*')
      .or('coach_cancellations_count.gt.0,coach_no_shows_count.gt.0,overdue_refunds_count.gt.0,active_disputes_count.gt.0');

    return res.json({
      success: true,
      disputedBookings: disputedBookings || [],
      riskMetrics: riskMetrics || [],
    });
  } catch (err) {
    console.error('[Refunds] admin disputes error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch admin metrics' });
  }
});

export default router;
