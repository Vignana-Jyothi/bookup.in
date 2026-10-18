import assert from 'node:assert/strict';
import fs from 'node:fs';

const route = fs.readFileSync('backend/server/routes/merchantOnboarding.js', 'utf8');
const phoneService = fs.readFileSync('backend/server/services/merchantPhoneVerification.js', 'utf8');
const migration = fs.readFileSync('backend/supabase/20261015_merchant_onboarding.sql', 'utf8');
const emailVerificationMigration = fs.readFileSync('backend/supabase/20261015_merchant_email_verification.sql', 'utf8');
const phoneVerificationMigration = fs.readFileSync('backend/supabase/20261016_merchant_phone_verification.sql', 'utf8');
const page = fs.readFileSync('frontend/src/pages/Onboarding.jsx', 'utf8');
const auth = fs.readFileSync('frontend/src/pages/Auth.jsx', 'utf8');
const app = fs.readFileSync('frontend/src/App.jsx', 'utf8');
const integrationSheet = fs.readFileSync('frontend/src/components/onboarding/IntegrationSheet.jsx', 'utf8');

for (const fragment of [
  'router.use(requireProviderAuth)',
  "router.get('/',",
  "router.put('/draft'",
  "router.post('/complete'",
  "router.post('/email-verification/send'",
  "router.post('/email-verification/verify'",
  "router.post('/phone-verification/send'",
  "router.post('/phone-verification/verify'",
  'merchantPhone.send',
  'merchantPhone.verify',
  'phoneVerified',
  'publishReady',
  "serviceRoleClient.rpc('complete_merchant_onboarding_v1'",
]) assert(route.includes(fragment), `Onboarding route is missing ${fragment}`);

for (const fragment of [
  'app.merchant_onboarding',
  'providers_create_onboarding_v1',
  'save_merchant_onboarding_draft_v1',
  'complete_merchant_onboarding_v1',
  'p_publish_ready',
  'deposit_amount = 0',
]) assert(migration.includes(fragment), `Onboarding migration is missing ${fragment}`);

for (const fragment of [
  'email_verified_at',
  'start_merchant_email_verification_v1',
  'verify_merchant_email_code_v1',
  "interval '60 seconds'",
  'email_verification_attempts >= 5',
]) assert(emailVerificationMigration.includes(fragment), `Email verification migration is missing ${fragment}`);

for (const fragment of [
  'phone_verification_session_id',
  'start_merchant_phone_verification_v1',
  'complete_merchant_phone_verification_send_v1',
  'record_merchant_phone_verification_v1',
  "interval '60 seconds'",
  'phone_verification_attempts >= 5',
  'to service_role',
]) assert(phoneVerificationMigration.includes(fragment), `Phone verification migration is missing ${fragment}`);

assert(page.includes('onboardingService.saveDraft'), 'Wizard must persist progress through the backend');
assert(page.includes('onboardingService.complete'), 'Wizard must complete through the backend');
assert(page.includes('onboardingService.sendPhoneVerification'), 'Wizard must request the merchant phone OTP through the backend');
assert(!page.includes('UPI deposit to confirm'), 'Deposits are outside onboarding scope');
assert(!page.includes('WhatsApp Preview (Simulated)'), 'Onboarding must not claim simulated notification setup');
assert(auth.includes("onboarding?.status === 'completed' ? '/dashboard' : '/onboarding'"), 'Login must resume incomplete onboarding');
assert(auth.includes('<SetupShell') && auth.includes('totalSteps={8}'), 'Signup must begin the eight-stage setup UI');
assert(auth.includes('business_name: form.businessName.trim()'), 'Signup must carry the business name into account metadata');
assert(auth.includes('merchant_phone: phone'), 'Signup must carry the normalized mobile number into account metadata');
assert(auth.includes("supabase.auth.resend"), 'Signup must support resending email verification');
assert(auth.includes('onboardingService.saveDraft'), 'Signup must initialize durable onboarding progress');
assert(page.includes('<SetupShell') && page.includes('step={WIZARD_STEPS.indexOf(step)}'), 'Onboarding must use the consolidated visible step order');
assert(page.includes('subscriptionService.saveBillingProfile(billing)'), 'Billing onboarding must save through the versioned merchant billing API');
assert(route.includes('billingProfile: projection.billingProfile') && route.includes("'BILLING_REQUIRED'"), 'Onboarding must restore saved billing details and reject completion without a billing profile');
assert(page.includes('Previous step') && page.includes("'Next step'"), 'Onboarding must expose persistent previous and next controls');
assert(app.includes('function DashboardRoute') && app.includes("onboardingStatus !== 'completed'"), 'Dashboard must reject incomplete onboarding');
assert(app.includes("<Navigate to=\"/onboarding\" replace />"), 'Incomplete merchants must return to onboarding');
for (const integration of ['Google Calendar & Meet', 'Cashfree Payments', 'WhatsApp notifications', 'SMS verification', 'Email verification', 'Zoom', 'Webex']) {
  assert(integrationSheet.includes(integration), `Integration sheet is missing ${integration}`);
}
assert(page.includes('<IntegrationSheet'), 'Onboarding must present integrations in one sheet');
assert(integrationSheet.includes('onConnectGoogle') && integrationSheet.includes('onTestGoogle'), 'Integration sheet must preserve real Google operations');
assert(page.includes('onboardingService.verifyPhone') && page.includes('verifyPhoneOtp'), 'Onboarding must verify mobile ownership through the server-owned SMS OTP flow');
assert(!page.includes("type: 'phone_change'") && !page.includes('supabase.auth.verifyOtp'), 'Merchant phone verification must not depend on Supabase Auth phone-change OTP');
assert(page.includes('onboardingService.verifyEmail') && page.includes('Email verification is required before continuing.'), 'Integration step must enforce Calup-owned email OTP verification');
assert(!route.includes('req.user.email_confirmed_at'), 'Supabase Auth confirmation must not satisfy Calup onboarding email verification');
assert(!page.includes('value={merchantEmail} readOnly'), 'Merchant business email must remain editable before verification');
assert(route.includes('merchantContactEmail') && !route.includes('draft.merchantEmail = accountEmail(req)'), 'Server must verify the saved merchant contact email instead of forcing the login email');
assert(app.includes('onboarding?.identity?.emailVerified') && app.includes('onboarding?.identity?.phoneVerified'), 'Dashboard gate must recheck durable identity verification');
assert(page.includes('SMS verification is required before continuing.'), 'Integration step must enforce verified mobile ownership');
assert(integrationSheet.includes('integration.required') && integrationSheet.includes('onVerifyPhoneOtp'), 'Integration sheet must show and perform required identity verification');

assert(phoneService.includes('reserve_verify') && phoneService.includes('finish_verify') && phoneService.includes('encryptToken(sent.sessionId)'));
console.log('Merchant onboarding contract tests passed.');
