// Keep an uncertain request identical when the server may already own its hold.
export function bookingPaymentIntent(previous, input, newKey = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify(input);
  if (previous?.fingerprint === fingerprint) return previous;
  return {
    fingerprint,
    key: newKey(),
    payload: { ...input, policyAcceptedAt: new Date().toISOString() },
  };
}

export function shouldResetBookingPaymentIntent(error) {
  if (['ATTEMPT_TERMINAL', 'PAYMENTS_UNAVAILABLE', 'SLOT_UNAVAILABLE', 'IDEMPOTENCY_CONFLICT'].includes(error?.code)) return true;
  return error?.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
}
