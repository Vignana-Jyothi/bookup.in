/**
 * CalUp — Policy Engine & Helpers
 * Core defaults, validations, plain-language formatting, and refund calculations.
 * Used identically across server and client.
 */

export const DEFAULT_POLICY = {
  full_refund_hours: 24,
  partial_refund_hours: 2,
  partial_refund_percent: 50,
  no_show_grace_minutes: 15,
  max_reschedules: 2,
  reschedule_min_hours_before: 24,
  payment_verification_timeout_hours: 24,
};

/**
 * Validate policy values against domain rules.
 * Returns { valid: boolean, errors: string[] }
 */
export function validatePolicy(policy = {}) {
  const errors = [];
  const full = Number(policy.full_refund_hours ?? DEFAULT_POLICY.full_refund_hours);
  const partial = Number(policy.partial_refund_hours ?? DEFAULT_POLICY.partial_refund_hours);
  const percent = Number(policy.partial_refund_percent ?? DEFAULT_POLICY.partial_refund_percent);
  const grace = Number(policy.no_show_grace_minutes ?? DEFAULT_POLICY.no_show_grace_minutes);
  const maxResched = Number(policy.max_reschedules ?? DEFAULT_POLICY.max_reschedules);
  const reschedNotice = Number(policy.reschedule_min_hours_before ?? DEFAULT_POLICY.reschedule_min_hours_before);
  const timeout = Number(policy.payment_verification_timeout_hours ?? DEFAULT_POLICY.payment_verification_timeout_hours);

  if (isNaN(full) || full < 0) errors.push('Full refund window must be at least 0 hours.');
  if (isNaN(partial) || partial < 0) errors.push('Partial refund window must be at least 0 hours.');
  if (full < partial) errors.push('Full refund window must be greater than or equal to partial refund window.');
  if (isNaN(percent) || percent < 0 || percent > 100) errors.push('Partial refund percentage must be between 0% and 100%.');
  if (isNaN(grace) || grace < 0) errors.push('No-show grace period must be at least 0 minutes.');
  if (isNaN(maxResched) || maxResched < 0) errors.push('Maximum reschedules must be 0 or greater.');
  if (isNaN(reschedNotice) || reschedNotice < 0) errors.push('Reschedule minimum notice must be 0 or greater.');
  if (isNaN(timeout) || timeout <= 0) errors.push('Payment verification timeout must be greater than 0 hours.');

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate human-friendly plain-language text describing the policy.
 */
export function generatePolicyText(policy = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const lines = [];

  lines.push(`• Cancellation: Cancel at least ${p.full_refund_hours} hours in advance for a 100% refund.`);
  if (p.partial_refund_hours > 0 && p.partial_refund_percent > 0) {
    lines.push(`• Partial Refund: Cancel between ${p.partial_refund_hours} and ${p.full_refund_hours} hours before for a ${p.partial_refund_percent}% refund.`);
    lines.push(`• Non-Refundable: Cancellations under ${p.partial_refund_hours} hours before the session are non-refundable.`);
  } else {
    lines.push(`• Non-Refundable: Cancellations under ${p.full_refund_hours} hours before the session are non-refundable.`);
  }

  lines.push(`• Rescheduling: Up to ${p.max_reschedules} reschedule${p.max_reschedules === 1 ? '' : 's'} allowed at least ${p.reschedule_min_hours_before} hours before session start.`);
  lines.push(`• Late Arrival: Session ends at the scheduled finish time and will not be extended.`);
  lines.push(`• No-Show: Forfeits refund if absent after ${p.no_show_grace_minutes} minutes grace period.`);

  return lines.join('\n');
}

/**
 * Compute hours remaining until appointment start, taking timezone into account.
 */
export function getHoursUntilSession(bookingDate, startTime, timezone = 'Asia/Kolkata') {
  if (!bookingDate || !startTime) return 0;
  try {
    const sessionDateStr = `${bookingDate}T${startTime}:00`;
    // Create Date representing appointment in specified timezone
    const sessionTime = new Date(sessionDateStr).getTime();
    const now = Date.now();
    return (sessionTime - now) / (1000 * 60 * 60);
  } catch (_e) {
    return 0;
  }
}

/**
 * Calculate refund amount and reason based on booking policy snapshot.
 * All amounts returned in integer currency units (e.g. ₹ or paise).
 */
export function calculateCancellationRefund({
  booking,
  currentTime = new Date(),
  timezone = 'Asia/Kolkata',
}) {
  const price = Math.round(Number(booking.price || 0));
  if (price <= 0) {
    return {
      refundPercent: 0,
      refundAmount: 0,
      refundReason: 'free_session',
      refundStatus: 'none',
      hoursNotice: 0,
    };
  }

  const policy = booking.policy_snapshot || booking.policySnapshot || DEFAULT_POLICY;
  const fullHours = Number(policy.full_refund_hours ?? DEFAULT_POLICY.full_refund_hours);
  const partialHours = Number(policy.partial_refund_hours ?? DEFAULT_POLICY.partial_refund_hours);
  const partialPercent = Number(policy.partial_refund_percent ?? DEFAULT_POLICY.partial_refund_percent);

  let hoursNotice = 0;
  try {
    const sessionTime = new Date(`${booking.booking_date || booking.date}T${booking.start_time || booking.startTime}:00`).getTime();
    const now = currentTime instanceof Date ? currentTime.getTime() : new Date(currentTime).getTime();
    hoursNotice = (sessionTime - now) / (1000 * 60 * 60);
  } catch (_e) {
    hoursNotice = 0;
  }

  let refundPercent = 0;
  let refundReason = 'customer_cancelled_no_refund';

  if (hoursNotice >= fullHours) {
    refundPercent = 100;
    refundReason = 'customer_cancelled_full';
  } else if (hoursNotice >= partialHours && partialPercent > 0) {
    refundPercent = partialPercent;
    refundReason = 'customer_cancelled_partial';
  } else {
    refundPercent = 0;
    refundReason = 'customer_cancelled_no_refund';
  }

  const refundAmount = Math.round((price * refundPercent) / 100);
  const refundStatus = refundAmount > 0 ? 'refund_due' : 'none';

  return {
    refundPercent,
    refundAmount,
    refundReason,
    refundStatus,
    hoursNotice: Math.round(hoursNotice * 10) / 10,
  };
}
