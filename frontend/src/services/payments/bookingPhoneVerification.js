export function normalizedBookingPhone(value) {
  return String(value || '').replace(/\D/g, '').replace(/^91(?=[6-9]\d{9}$)/, '');
}

export function currentBookingPhoneVerification(proof, slug, phone, now = Date.now()) {
  return Boolean(proof && proof.slug === slug && proof.phone === normalizedBookingPhone(phone) && proof.expiresAt > now);
}
