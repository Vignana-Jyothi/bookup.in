// Keep persisted step IDs compatible with existing drafts and the server's 0–6 draft range.
export const ONBOARDING_STEPS = [0, 1, 3, 4, 6, 7];
export const ONBOARDING_LABELS = ['Business profile', 'Billing details', 'First service', 'Hours & rules', 'Verification', 'Review'];

export function normalizeOnboardingStep(value) {
  const step = Number(value);
  if (step === 2) return 0;
  if (step === 5) return 4;
  return ONBOARDING_STEPS.includes(step) ? step : 0;
}

export function resolveOnboardingStart({ draft = {}, billingProfile, currentStep, calendarReturn }) {
  const profileReady = Boolean(draft.businessName?.trim() && draft.providerName?.trim()
    && draft.merchantEmail?.trim() && draft.phone && draft.bio?.trim().length >= 20);
  if (!profileReady) return 0;
  if (!billingProfile) return 1;
  if (calendarReturn) return 6;
  if (Number(currentStep) <= 1) return 3;
  return normalizeOnboardingStep(currentStep);
}

export function onboardingHoursError(availability, rules) {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!days.some(day => availability[day]?.available)) return 'Choose at least one working day.';
  for (const day of days) {
    const hours = availability[day];
    if (!hours || !time.test(hours.start) || !time.test(hours.end) || hours.end <= hours.start) {
      return `Enter valid opening and closing times for ${day}.`;
    }
  }
  for (const [field, label, min, max] of [
    ['minNotice', 'Minimum notice', 0, 720],
    ['maxAdvanceBooking', 'Advance booking', 1, 365],
    ['bufferTime', 'Buffer time', 0, 240],
    ['cancellationWindow', 'Cancellation window', 0, 720],
  ]) {
    const value = Number(rules[field]);
    if (rules[field] === '' || !Number.isInteger(value) || value < min || value > max) return `${label} must be a whole number between ${min} and ${max}.`;
  }
  return '';
}
