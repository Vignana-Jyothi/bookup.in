import { Router } from 'express';
import crypto from 'crypto';
import { requireProviderAuth, serviceRoleClient } from '../middleware/auth.js';
import { config } from '../config.js';
import { emailService } from '../services/email.js';
import { REQUIRED_GOOGLE_SCOPES } from '../services/googleCalendar.js';
import { tokenStore } from '../services/tokenStore.js';
import { twoFactorOtpService } from '../services/twoFactorOtp.js';
import { createMerchantPhoneVerification } from '../services/merchantPhoneVerification.js';

const router = Router();
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const merchantContactEmail = req => String(req.provider?.email || req.user?.email || '').trim().toLowerCase();

function verificationHash(providerId, email, code) {
  return crypto.createHmac('sha256', Buffer.from(config.tokenEncryptionKey, 'hex'))
    .update(`merchant-email-verification:v1:${providerId}:${email}:${code}`)
    .digest('hex');
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

const normalizePhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};

const merchantContactPhone = req => normalizePhone(req.provider?.phone);

function maskPhone(phone) {
  return `******${phone.slice(-4)}`;
}

function rpcValue(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function errorResponse(res, status, code, message, details) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

function defaultSchedule() {
  return Object.fromEntries(DAYS.map((day, index) => [day, {
    available: index < 6,
    start: index === 5 ? '10:00' : '09:00',
    end: index === 5 ? '14:00' : (index === 4 ? '17:00' : '18:00'),
  }]));
}

function cleanDraft(input = {}) {
  const service = input.service || {};
  const rules = input.bookingRules || {};
  const availability = input.availability || defaultSchedule();
  return {
    businessName: String(input.businessName || '').trim(),
    providerName: String(input.providerName || '').trim(),
    merchantEmail: String(input.merchantEmail || '').trim().toLowerCase(),
    phone: normalizePhone(input.phone),
    bio: String(input.bio || '').trim(),
    timezone: 'Asia/Kolkata',
    service: {
      name: String(service.name || '').trim(),
      description: String(service.description || '').trim(),
      price: Number(service.price),
      duration: Number(service.duration),
      meetingType: ['online', 'in-person', 'both'].includes(service.meetingType) ? service.meetingType : 'online',
      locationAddress: String(service.locationAddress || '').trim(),
    },
    availability: Object.fromEntries(DAYS.map(day => [day, {
      available: Boolean(availability?.[day]?.available),
      start: String(availability?.[day]?.start || '09:00').slice(0, 5),
      end: String(availability?.[day]?.end || '18:00').slice(0, 5),
    }])),
    bookingRules: {
      minNotice: Number(rules.minNotice),
      maxAdvanceBooking: Number(rules.maxAdvanceBooking),
      bufferTime: Number(rules.bufferTime),
      cancellationWindow: Number(rules.cancellationWindow),
    },
  };
}

function validateDraft(draft) {
  const errors = {};
  if (draft.businessName.length < 2 || draft.businessName.length > 160) errors.businessName = 'Enter a valid business name.';
  if (draft.providerName.length < 2 || draft.providerName.length > 100) errors.providerName = 'Enter the merchant name.';
  if (!EMAIL.test(draft.merchantEmail)) errors.merchantEmail = 'Enter a valid Google host email.';
  if (!/^[6-9]\d{9}$/.test(draft.phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
  if (draft.bio.length < 20 || draft.bio.length > 1000) errors.bio = 'The business introduction must be 20–1000 characters.';
  if (draft.service.name.length < 3 || draft.service.name.length > 120) errors.serviceName = 'Enter a service name of 3–120 characters.';
  if (draft.service.description.length < 15 || draft.service.description.length > 2000) errors.serviceDescription = 'Describe the service in 15–2000 characters.';
  if (!Number.isFinite(draft.service.price) || draft.service.price < 0 || draft.service.price > 10000000) errors.price = 'Enter a valid service price.';
  if (!Number.isInteger(draft.service.duration) || draft.service.duration < 5 || draft.service.duration > 1440) errors.duration = 'Duration must be 5–1440 minutes.';
  if (draft.service.meetingType !== 'online' && !draft.service.locationAddress) errors.locationAddress = 'Add the address used for in-person appointments.';

  let activeDays = 0;
  for (const day of DAYS) {
    const value = draft.availability[day];
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.end) || value.end <= value.start) {
      errors.availability = `Enter valid working hours for ${day}.`;
      break;
    }
    if (value.available) activeDays += 1;
  }
  if (!activeDays) errors.availability = 'Make at least one weekday available.';

  for (const [key, min, max] of [
    ['minNotice', 0, 720],
    ['maxAdvanceBooking', 1, 365],
    ['bufferTime', 0, 240],
    ['cancellationWindow', 0, 720],
  ]) {
    if (!Number.isInteger(draft.bookingRules[key]) || draft.bookingRules[key] < min || draft.bookingRules[key] > max) {
      errors[key] = `${key} must be between ${min} and ${max}.`;
    }
  }
  return errors;
}

async function googleReadiness(providerId, profileEmail) {
  const status = await tokenStore.getStatus(providerId);
  const scopes = new Set(String(status.scope || '').split(/\s+/).filter(Boolean));
  const permissionsReady = REQUIRED_GOOGLE_SCOPES.every(scope => scope === 'openid' || scopes.has(scope));
  const email = String(status.email || '').trim().toLowerCase();
  return {
    connected: Boolean(status.isConnected),
    email: email || null,
    ready: Boolean(status.isConnected && permissionsReady && email === profileEmail),
  };
}

async function entitlementReadiness(providerId) {
  const { data, error } = await serviceRoleClient.rpc('get_merchant_subscription_v1', { p_provider_id: providerId });
  if (error) return { active: false, status: 'not_activated', billingUnavailable: true };
  const projection = rpcValue(data) || {};
  return {
    active: Boolean(projection.allowedActions?.createBookings),
    status: projection.status || 'not_activated',
    billingProfile: projection.billingProfile || null,
  };
}

router.use(requireProviderAuth);

router.get('/', async (req, res) => {
  const email = merchantContactEmail(req);
  const phone = merchantContactPhone(req);
  const [onboardingResult, providerResult, availabilityResult, google, entitlement, emailVerificationResult, phoneVerificationResult] = await Promise.all([
    serviceRoleClient.rpc('get_merchant_onboarding_v1', { p_provider_id: req.providerId }),
    serviceRoleClient.from('providers').select('id, name, business_name, email, phone, bio, slug, timezone, buffer_time, min_notice, max_advance_booking').eq('id', req.providerId).single(),
    serviceRoleClient.from('availability').select('day_of_week, start_time, end_time, active').eq('provider_id', req.providerId),
    googleReadiness(req.providerId, email),
    entitlementReadiness(req.providerId),
    serviceRoleClient.rpc('get_merchant_email_verification_v1', { p_provider_id: req.providerId, p_email: email }),
    serviceRoleClient.rpc('get_merchant_phone_verification_v1', { p_provider_id: req.providerId, p_phone: phone }),
  ]);
  if (providerResult.error) return errorResponse(res, 503, 'ONBOARDING_UNAVAILABLE', 'Could not load merchant setup.');

  const provider = providerResult.data;
  const onboarding = rpcValue(onboardingResult.data) || {};
  const saved = onboarding.draft || {};
  const schedule = availabilityResult.data?.length
    ? Object.fromEntries(availabilityResult.data.map(row => [row.day_of_week, {
      available: Boolean(row.active), start: String(row.start_time).slice(0, 5), end: String(row.end_time).slice(0, 5),
    }]))
    : defaultSchedule();
  return res.json({
    data: {
      status: onboarding.status || 'in_progress',
      currentStep: onboarding.currentStep || 0,
      draft: {
        businessName: saved.businessName || provider.business_name || '',
        providerName: saved.providerName || provider.name || '',
        merchantEmail: email,
        phone: saved.phone || provider.phone || '',
        bio: saved.bio || provider.bio || '',
        timezone: 'Asia/Kolkata',
        service: saved.service || null,
        availability: saved.availability || schedule,
        bookingRules: saved.bookingRules || {
          minNotice: Number(provider.min_notice ?? 2),
          maxAdvanceBooking: Number(provider.max_advance_booking ?? 30),
          bufferTime: Number(provider.buffer_time ?? 15),
          cancellationWindow: 24,
        },
      },
      identity: {
        emailVerified: Boolean(rpcValue(emailVerificationResult.data)?.verified),
        emailVerificationSent: Boolean(rpcValue(emailVerificationResult.data)?.sent),
        phoneVerified: Boolean(rpcValue(phoneVerificationResult.data)?.verified),
        phoneVerificationSent: Boolean(rpcValue(phoneVerificationResult.data)?.sent),
      },
      google,
      entitlement,
      slug: provider.slug,
    },
  });
});

router.put('/draft', async (req, res) => {
  const draft = cleanDraft(req.body?.draft);
  const currentStep = Math.max(0, Math.min(6, Number(req.body?.currentStep) || 0));
  const { error } = await serviceRoleClient.rpc('save_merchant_onboarding_draft_v1', {
    p_provider_id: req.providerId,
    p_current_step: currentStep,
    p_draft: draft,
  });
  if (error) return errorResponse(res, 503, 'DRAFT_SAVE_FAILED', 'Could not save setup progress.');

  if (draft.providerName.length >= 2 && EMAIL.test(draft.merchantEmail)) {
    const emailChanged = draft.merchantEmail !== String(req.provider?.email || '').trim().toLowerCase();
    const { error: profileError } = await serviceRoleClient.from('providers').update({
      name: draft.providerName,
      business_name: draft.businessName || null,
      email: draft.merchantEmail,
      phone: draft.phone || null,
      bio: draft.bio || null,
      updated_at: new Date().toISOString(),
    }).eq('id', req.providerId);
    if (profileError) return errorResponse(res, 503, 'PROFILE_SAVE_FAILED', 'Could not save the merchant profile.');
    if (emailChanged) {
      try {
        await tokenStore.deleteTokens(req.providerId);
      } catch (tokenError) {
        console.warn('[MerchantOnboarding] Changed email invalidated Google readiness; token cleanup will be retried on reconnect:', tokenError.message);
      }
    }
  }
  return res.json({ data: { saved: true, currentStep } });
});

router.post('/email-verification/send', async (req, res) => {
  const email = merchantContactEmail(req);
  if (!EMAIL.test(email)) return errorResponse(res, 422, 'ACCOUNT_EMAIL_INVALID', 'Your authenticated account does not have a valid email address.');
  if (!config.isEmailConfigured()) return errorResponse(res, 503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Email verification is temporarily unavailable.');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = verificationHash(req.providerId, email, code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { data, error } = await serviceRoleClient.rpc('start_merchant_email_verification_v1', {
    p_provider_id: req.providerId,
    p_email: email,
    p_code_hash: codeHash,
    p_expires_at: expiresAt,
  });
  if (error) {
    console.error('[MerchantOnboarding] Email verification could not start:', error.message);
    return errorResponse(res, 503, 'EMAIL_VERIFICATION_UNAVAILABLE', 'Could not start email verification.');
  }
  const started = rpcValue(data) || {};
  if (started.alreadyVerified) return res.json({ data: { sent: false, verified: true, email: maskEmail(email) } });
  if (started.rateLimited) {
    res.set('Retry-After', String(started.retryAfterSeconds || 60));
    return errorResponse(res, 429, 'EMAIL_VERIFICATION_RATE_LIMITED', `Wait ${started.retryAfterSeconds || 60} seconds before requesting another code.`, {
      retryAfterSeconds: started.retryAfterSeconds || 60,
    });
  }

  const delivery = await emailService.sendGenericEmail({
    to: email,
    subject: 'Your Calup email verification code',
    text: `Your Calup verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;color:#171a14"><strong style="font-size:20px">Calup</strong><h1 style="font-size:22px;margin:24px 0 8px">Verify your email</h1><p>Enter this code in your Calup setup page. It expires in 10 minutes.</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${code}</div><p style="color:#687061;font-size:13px">If you did not request this code, you can ignore this email.</p></div>`,
  });
  if (!delivery.success) {
    await serviceRoleClient.rpc('cancel_merchant_email_verification_v1', { p_provider_id: req.providerId, p_code_hash: codeHash });
    return errorResponse(res, 503, 'EMAIL_DELIVERY_FAILED', 'The verification email could not be delivered. Please try again.');
  }
  return res.json({ data: { sent: true, verified: false, email: maskEmail(email), expiresInSeconds: 600, resendAfterSeconds: 60 } });
});

router.post('/email-verification/verify', async (req, res) => {
  const email = merchantContactEmail(req);
  const code = String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return errorResponse(res, 422, 'EMAIL_CODE_INVALID', 'Enter the 6-digit email verification code.');
  const { data, error } = await serviceRoleClient.rpc('verify_merchant_email_code_v1', {
    p_provider_id: req.providerId,
    p_email: email,
    p_code_hash: verificationHash(req.providerId, email, code),
  });
  if (error) {
    console.error('[MerchantOnboarding] Email verification failed:', error.message);
    return errorResponse(res, 503, 'EMAIL_VERIFICATION_UNAVAILABLE', 'Could not verify the email code.');
  }
  const result = rpcValue(data) || {};
  if (result.verified) return res.json({ data: { verified: true, email: maskEmail(email) } });
  if (result.reason === 'expired') return errorResponse(res, 410, 'EMAIL_CODE_EXPIRED', 'This code has expired. Request a new code.');
  if (result.reason === 'attempts_exceeded') return errorResponse(res, 429, 'EMAIL_CODE_ATTEMPTS_EXCEEDED', 'Too many incorrect attempts. Request a new code.');
  if (result.reason === 'not_requested') return errorResponse(res, 409, 'EMAIL_CODE_NOT_REQUESTED', 'Request an email verification code first.');
  return errorResponse(res, 422, 'EMAIL_CODE_INCORRECT', 'That code is incorrect.', { remainingAttempts: result.remainingAttempts });
});

const merchantPhone = createMerchantPhoneVerification({ client: serviceRoleClient, otp: twoFactorOtpService });

router.post('/phone-verification/send', async (req, res) => {
  const phone = merchantContactPhone(req);
  if (!/^[6-9]\d{9}$/.test(phone)) return errorResponse(res, 422, 'PHONE_INVALID', 'Save a valid 10-digit Indian mobile number first.');
  if (!config.isTwoFactorConfigured()) return errorResponse(res, 503, 'SMS_DELIVERY_UNAVAILABLE', 'SMS verification is temporarily unavailable.');
  try {
    const result = await merchantPhone.send(req.providerId, phone);
    if (result.alreadyVerified) return res.json({ data: { sent: false, verified: true, phone: maskPhone(phone) } });
    if (result.rateLimited) {
      const retryAfterSeconds = result.retryAfterSeconds || 60;
      res.set('Retry-After', String(retryAfterSeconds));
      return errorResponse(res, 429, 'PHONE_VERIFICATION_RATE_LIMITED', 'Wait before requesting another SMS code.', { retryAfterSeconds });
    }
    if (!result.sent) throw new Error('PHONE_VERIFICATION_STORAGE');
    return res.json({ data: { sent: true, verified: false, phone: maskPhone(phone), expiresInSeconds: 600, resendAfterSeconds: 60 } });
  } catch {
    return errorResponse(res, 503, 'SMS_DELIVERY_FAILED', 'The SMS code could not be sent. Please try again.');
  }
});

router.post('/phone-verification/verify', async (req, res) => {
  const phone = merchantContactPhone(req);
  const code = String(req.body?.code || '').trim();
  if (!/^\d{4,8}$/.test(code)) return errorResponse(res, 422, 'PHONE_CODE_INVALID', 'Enter the numeric SMS verification code.');
  if (!/^[6-9]\d{9}$/.test(phone)) return errorResponse(res, 422, 'PHONE_INVALID', 'Save a valid mobile number first.');
  if (!config.isTwoFactorConfigured()) return errorResponse(res, 503, 'SMS_DELIVERY_UNAVAILABLE', 'SMS verification is temporarily unavailable.');
  try {
    const result = await merchantPhone.verify(req.providerId, phone, code);
    if (result.verified === true) return res.json({ data: { verified: true, phone: maskPhone(phone) } });
    if (result.reason === 'attempts_exceeded') return errorResponse(res, 429, 'PHONE_CODE_ATTEMPTS_EXCEEDED', 'Too many verification attempts. Request a new code.');
    if (result.reason === 'expired') return errorResponse(res, 410, 'PHONE_CODE_EXPIRED', 'This code has expired. Request a new code.');
    if (result.reason === 'not_requested') return errorResponse(res, 409, 'PHONE_CODE_NOT_REQUESTED', 'Request an SMS verification code first.');
    if (result.reason === 'busy') return errorResponse(res, 409, 'PHONE_CODE_BUSY', 'A code verification is already in progress. Please wait.');
    if (result.reason === 'stale') return errorResponse(res, 409, 'PHONE_CODE_STALE', 'This verification request changed or timed out. Try again with the current code.');
    return errorResponse(res, 422, 'PHONE_CODE_INCORRECT', 'That code is incorrect.', { remainingAttempts: result.remainingAttempts });
  } catch {
    return errorResponse(res, 503, 'PHONE_VERIFICATION_UNAVAILABLE', 'The SMS code could not be verified. Please try again.');
  }
});

router.post('/complete', async (req, res) => {
  const draft = cleanDraft(req.body?.draft);
  const errors = validateDraft(draft);
  if (Object.keys(errors).length) return errorResponse(res, 422, 'VALIDATION_FAILED', 'Review the highlighted setup information.', errors);

  const [google, entitlement, emailVerificationResult, phoneVerificationResult] = await Promise.all([
    googleReadiness(req.providerId, draft.merchantEmail),
    entitlementReadiness(req.providerId),
    serviceRoleClient.rpc('get_merchant_email_verification_v1', { p_provider_id: req.providerId, p_email: draft.merchantEmail }),
    serviceRoleClient.rpc('get_merchant_phone_verification_v1', { p_provider_id: req.providerId, p_phone: draft.phone }),
  ]);
  const identity = {
    emailVerified: Boolean(rpcValue(emailVerificationResult.data)?.verified),
    phoneVerified: Boolean(rpcValue(phoneVerificationResult.data)?.verified),
  };
  if (entitlement.billingUnavailable) return errorResponse(res, 503, 'BILLING_UNAVAILABLE', 'Could not verify billing details. Please try again.');
  if (!entitlement.billingProfile) return errorResponse(res, 422, 'BILLING_REQUIRED', 'Save your legal name and billing address before completing setup.');
  const googleRequired = ['online', 'both'].includes(draft.service.meetingType);
  const publishReady = Boolean(identity.emailVerified && identity.phoneVerified && entitlement.active && (!googleRequired || google.ready));
  const { data, error } = await serviceRoleClient.rpc('complete_merchant_onboarding_v1', {
    p_provider_id: req.providerId,
    p_draft: draft,
    p_publish_ready: publishReady,
  });
  if (error) {
    console.error('[MerchantOnboarding] Completion failed:', error.message);
    return errorResponse(res, 503, 'COMPLETION_FAILED', 'Setup could not be completed. Your saved progress is still available.');
  }

  const missing = [];
  if (!identity.emailVerified) missing.push('email_verification');
  if (!identity.phoneVerified) missing.push('phone_verification');
  if (!entitlement.active) missing.push('calup_access');
  if (googleRequired && !google.ready) missing.push('google_calendar');
  return res.json({ data: { ...rpcValue(data), identity, google, entitlement, missing } });
});

export default router;
