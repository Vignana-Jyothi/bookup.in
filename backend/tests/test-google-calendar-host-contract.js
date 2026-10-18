import assert from 'node:assert/strict';
import fs from 'node:fs';
import { config } from '../server/config.js';
import { googleCalendarService } from '../server/services/googleCalendar.js';
import { generateOAuthState, verifyOAuthState } from '../server/utils/crypto.js';

const previous = {
  clientId: config.googleClientId,
  clientSecret: config.googleClientSecret,
  redirectUri: config.googleRedirectUri,
};

const popupState = generateOAuthState('popup-provider', { returnTo: 'onboarding', popup: true });
assert.equal(verifyOAuthState(popupState).popup, true, 'Popup mode survives signed state verification');
assert.equal(verifyOAuthState(popupState).returnTo, 'onboarding');
const [payload, signature] = popupState.split('.');
const modifiedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString());
modifiedPayload.popup = false;
assert.equal(verifyOAuthState(`${Buffer.from(JSON.stringify(modifiedPayload)).toString('base64url')}.${signature}`).valid, false, 'Popup mode cannot be changed without invalidating the signature');
assert.equal(verifyOAuthState(generateOAuthState('settings-provider')).popup, false, 'Existing redirect mode remains the default');

try {
  config.googleClientId = 'test-client';
  config.googleClientSecret = 'test-secret';
  config.googleRedirectUri = 'https://api.calup.test/api/auth/google/callback';
  const url = new URL(googleCalendarService.generateAuthUrl('00000000-0000-0000-0000-000000000001', 'HOST@Example.com', { returnTo: 'onboarding' }));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('login_hint'), 'host@example.com');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.match(url.searchParams.get('scope'), /calendar\.events/);
  assert.match(url.searchParams.get('scope'), /calendar\.freebusy/);
  const state = url.searchParams.get('state');
  assert.ok(state, 'OAuth URL includes signed state');
} finally {
  config.googleClientId = previous.clientId;
  config.googleClientSecret = previous.clientSecret;
  config.googleRedirectUri = previous.redirectUri;
}

const serviceSource = fs.readFileSync('backend/server/services/googleCalendar.js', 'utf8');
assert.match(serviceSource, /GOOGLE_ACCOUNT_MISMATCH/);
assert.match(serviceSource, /calendars\/primary\/events/);
assert.match(serviceSource, /sendUpdates: 'all'/);
assert.match(serviceSource, /guestsCanModify: false/);
assert.match(serviceSource, /deterministicEventId/);
assert.match(serviceSource, /async testConnection\(providerId\)/);

const authRoute = fs.readFileSync('backend/server/routes/auth.js', 'utf8');
assert.match(authRoute, /router\.post\('\/test'/);
assert.match(authRoute, /connected\?\.returnTo === 'onboarding'/);

const migration = fs.readFileSync('backend/supabase/20261014_google_calendar_host_sync.sql', 'utf8');
assert.match(migration, /calendar_lease_generation/);
assert.match(migration, /calendar_lease_owner = p_lease_owner/);
assert.match(migration, /calendar_sync_status = 'succeeded'/);

const onboarding = fs.readFileSync('frontend/src/pages/Onboarding.jsx', 'utf8');
assert.match(onboarding, /Google account used for Calendar and Meet/);
assert.match(onboarding, /email: merchantEmail\.trim\(\)\.toLowerCase\(\)/);

console.log('PASS: Google OAuth host identity, Meet ownership, and durable sync contracts are present.');
