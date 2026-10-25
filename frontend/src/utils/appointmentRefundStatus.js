// Appointment cancellation and verified financial completion remain separate facts.
export function appointmentRefundLabel(booking, fallback) {
  if (booking.sourceSystem !== 'cashfree_v1') return fallback;
  if (booking.refundStatus === 'refunded') return 'Refunded';
  if (['approved', 'processing'].includes(booking.refundStatus)) return 'Refund processing';
  if (['failed', 'review_required'].includes(booking.refundStatus)) return 'Refund needs review';
  return fallback;
}
