/**
 * CalUp — Refund Service & Ledger Abstraction
 *
 * Implements the manual refund ledger with clean gateway abstraction.
 * When Cashfree Easy Split is integrated later, processRefund can execute
 * automatic payout transfers without altering policy or booking flow.
 */

import { emailService } from './email.js';

export class RefundService {
  constructor() {
    this.gatewayMode = 'manual'; // 'manual' | 'cashfree'
  }

  /**
   * Log state changes to public.audit_logs
   */
  async logAudit(supabase, {
    bookingId = null,
    providerId = null,
    entityType = 'booking',
    entityId,
    action,
    actorType = 'system',
    actorId = null,
    oldState = null,
    newState = null,
    details = null,
  }) {
    if (!supabase) return;
    try {
      await supabase.from('audit_logs').insert({
        booking_id: bookingId,
        provider_id: providerId,
        entity_type: entityType,
        entity_id: String(entityId),
        action,
        actor_type: actorType,
        actor_id: actorId,
        old_state: oldState,
        new_state: newState,
        details,
      });
    } catch (err) {
      console.warn('[AuditLogs] Failed to insert audit log entry:', err.message);
    }
  }

  /**
   * Abstracted refund entrypoint.
   * Creates or updates the refund ledger entry and synchronizes booking state.
   */
  async processRefund(supabase, {
    booking,
    amount,
    reason,
    actorType = 'customer',
    actorId = null,
    details = null,
  }) {
    const refundAmount = Math.round(Number(amount || 0));
    if (refundAmount <= 0) {
      return { success: true, refundAmount: 0, status: 'none' };
    }

    const providerId = booking.provider_id || booking.providerId;
    const bookingId = booking.id;

    // Idempotency: Check if refund row already exists
    const { data: existingRefund } = await supabase
      .from('refunds')
      .select('*')
      .eq('booking_id', bookingId)
      .maybeSingle();

    let refundRecord = null;

    if (existingRefund) {
      const { data: updated, error: updateErr } = await supabase
        .from('refunds')
        .update({
          amount: refundAmount,
          reason,
          status: 'refund_due',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRefund.id)
        .select('*')
        .single();

      if (updateErr) throw updateErr;
      refundRecord = updated;
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from('refunds')
        .insert({
          booking_id: bookingId,
          provider_id: providerId,
          amount: refundAmount,
          reason,
          status: 'refund_due',
        })
        .select('*')
        .single();

      if (insertErr) throw insertErr;
      refundRecord = inserted;
    }

    // Update booking record
    await supabase
      .from('bookings')
      .update({
        refund_amount: refundAmount,
        refund_reason: reason,
        refund_status: 'refund_due',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    // Audit log
    await this.logAudit(supabase, {
      bookingId,
      providerId,
      entityType: 'refund',
      entityId: refundRecord.id,
      action: 'refund_due_created',
      actorType,
      actorId,
      newState: { amount: refundAmount, reason, status: 'refund_due' },
      details: details || `Refund due of ₹${refundAmount} recorded (${reason})`,
    });

    return {
      success: true,
      refund: refundRecord,
      refundAmount,
      status: 'refund_due',
    };
  }

  /**
   * Coach marks refund as sent + provides proof URL
   */
  async markRefundSent(supabase, {
    refundId,
    providerId,
    proofUrl,
    actorId = null,
  }) {
    const { data: refund, error: getErr } = await supabase
      .from('refunds')
      .select('*, bookings (*)')
      .eq('id', refundId)
      .eq('provider_id', providerId)
      .single();

    if (getErr || !refund) {
      throw new Error('Refund record not found');
    }

    const refundedAt = new Date().toISOString();

    const { data: updatedRefund, error: updErr } = await supabase
      .from('refunds')
      .update({
        status: 'refunded',
        refunded_at: refundedAt,
        proof_url: proofUrl,
        updated_at: refundedAt,
      })
      .eq('id', refundId)
      .select('*')
      .single();

    if (updErr) throw updErr;

    // Update booking refund_status
    await supabase
      .from('bookings')
      .update({
        refund_status: 'refunded',
        updated_at: refundedAt,
      })
      .eq('id', refund.booking_id);

    // Audit log
    await this.logAudit(supabase, {
      bookingId: refund.booking_id,
      providerId,
      entityType: 'refund',
      entityId: refundId,
      action: 'refund_marked_sent',
      actorType: 'coach',
      actorId,
      oldState: { status: refund.status },
      newState: { status: 'refunded', proof_url: proofUrl, refunded_at: refundedAt },
      details: `Coach marked refund of ₹${refund.amount} as sent`,
    });

    // Notify customer by email
    const booking = refund.bookings;
    if (booking && booking.customer_email) {
      try {
        await emailService.sendGenericEmail({
          to: booking.customer_email,
          subject: `Refund sent: ₹${refund.amount} for ${booking.customer_name}`,
          text: `Hi ${booking.customer_name},\n\nYour coach has sent your refund of ₹${refund.amount}.\nPlease check your UPI/account and confirm receipt on your booking tracking link.\n\nThank you,\nCalUp Team`,
          html: `<div style="font-family: sans-serif; max-width: 520px; padding: 24px; color: #111;">
            <h2 style="color: #15803d; margin-top: 0;">Refund Sent: ₹${refund.amount}</h2>
            <p>Hi <strong>${booking.customer_name}</strong>,</p>
            <p>Your coach has marked your refund of <strong>₹${refund.amount}</strong> as transferred.</p>
            <p>Please check your UPI app or bank account. You can confirm receipt or report an issue on your session tracking page.</p>
            <div style="margin-top: 24px;">
              <a href="https://calup-in.vercel.app/track/${booking.management_token_hash || ''}" style="background: #111; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 700; display: inline-block;">View Tracking Page</a>
            </div>
          </div>`,
        });
      } catch (emErr) {
        console.warn('[RefundService] Failed to send refund notification email:', emErr.message);
      }
    }

    return updatedRefund;
  }

  /**
   * Customer confirms receipt or disputes refund
   */
  async customerRefundAction(supabase, {
    bookingId,
    action, // 'confirm' | 'dispute'
    disputeNote = '',
    actorId = null,
  }) {
    const { data: refund, error: getErr } = await supabase
      .from('refunds')
      .select('*, bookings (*)')
      .eq('booking_id', bookingId)
      .single();

    if (getErr || !refund) {
      throw new Error('Refund record not found');
    }

    const nowIso = new Date().toISOString();

    if (action === 'confirm') {
      const { data: updated, error: updErr } = await supabase
        .from('refunds')
        .update({
          status: 'confirmed',
          customer_confirmed_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', refund.id)
        .select('*')
        .single();

      if (updErr) throw updErr;

      await supabase
        .from('bookings')
        .update({ refund_status: 'confirmed', updated_at: nowIso })
        .eq('id', bookingId);

      await this.logAudit(supabase, {
        bookingId,
        providerId: refund.provider_id,
        entityType: 'refund',
        entityId: refund.id,
        action: 'refund_confirmed',
        actorType: 'customer',
        actorId,
        newState: { status: 'confirmed', customer_confirmed_at: nowIso },
        details: 'Customer confirmed receipt of refund',
      });

      return updated;
    } else if (action === 'dispute') {
      const { data: updated, error: updErr } = await supabase
        .from('refunds')
        .update({
          status: 'disputed',
          disputed_at: nowIso,
          dispute_note: disputeNote.trim() || 'Customer reports refund not received',
          updated_at: nowIso,
        })
        .eq('id', refund.id)
        .select('*')
        .single();

      if (updErr) throw updErr;

      await supabase
        .from('bookings')
        .update({
          status: 'disputed',
          refund_status: 'disputed',
          disputed_at: nowIso,
          dispute_reason: disputeNote.trim() || 'Customer reports refund not received',
          updated_at: nowIso,
        })
        .eq('id', bookingId);

      await this.logAudit(supabase, {
        bookingId,
        providerId: refund.provider_id,
        entityType: 'refund',
        entityId: refund.id,
        action: 'disputed',
        actorType: 'customer',
        actorId,
        newState: { status: 'disputed', dispute_note: disputeNote },
        details: `Customer disputed refund: ${disputeNote}`,
      });

      return updated;
    }

    throw new Error('Invalid refund action');
  }
}

export const refundService = new RefundService();
