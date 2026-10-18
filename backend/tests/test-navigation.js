/* Disabled navigation enhancement (user request):
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { appointmentFilters, merchantBookingPath, rememberSettingsReturn, settingsReturnPath, clearSettingsReturn } from '../../frontend/src/utils/navigation.js';

assert.equal(merchantBookingPath('studio-one'), '/book/studio-one?fresh=1');
for (const slug of ['', '//evil.example', '../admin', 'https://evil.example', 'a?token=x', 'a/b']) assert.equal(merchantBookingPath(slug), null);
assert.deepEqual(appointmentFilters('?q=Priya&from=2024-02-29&to=2024-03-01'), { query: 'Priya', from: '2024-02-29', to: '2024-03-01' });
assert.equal(appointmentFilters('?from=2026-02-30').from, '');
assert.equal(appointmentFilters('?from=2026-10-16&to=2026-10-15').to, '');
assert.equal(appointmentFilters('?q=' + 'x'.repeat(250)).query.length, 200);

const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
rememberSettingsReturn();
assert.equal(settingsReturnPath(), '/dashboard/settings');
const key = [...storage.keys()][0];
storage.set(key, 'https://evil.example');
assert.equal(settingsReturnPath(), null, 'Recovery navigation cannot become an open redirect');
clearSettingsReturn();
assert.equal(storage.size, 0);
delete globalThis.sessionStorage;
assert.doesNotThrow(rememberSettingsReturn);
assert.equal(settingsReturnPath(), null, 'Blocked storage falls back to normal login');

const onboarding = fs.readFileSync(new URL('../../frontend/src/pages/Onboarding.jsx', import.meta.url), 'utf8');
const source = onboarding.slice(onboarding.indexOf('  const saveAndExit ='), onboarding.indexOf('  const prevStep ='));
async function exercise({ draftFails = false, billingFails = false, switchAccount = false, step = 1, signOutFails = false } = {}) {
  const calls = [];
  const context = {
    isSaving: false, isLoading: false, isConnectingGoogle: false, step, billing: {},
    setIsSaving: value => calls.push(['saving', value]), setStepError: message => calls.push(['error', message]),
    setBilling: () => calls.push(['billing-saved']), isSupabaseConfigured: () => true,
    draftPayload: () => ({ providerName: 'Merchant' }),
    subscriptionService: { async saveBillingProfile() { if (billingFails) throw new Error('Invalid billing'); return {}; } },
    onboardingService: { async saveDraft() { calls.push(['draft']); if (draftFails) throw new Error('Save failed'); } },
    supabase: { auth: { async signOut() { calls.push(['signout']); return { error: signOutFails ? new Error('Signout failed') : null }; } } },
    dispatch: action => calls.push(['dispatch', action.type]), ACTIONS: { LOGOUT: 'LOGOUT' },
    addToast: () => {}, navigate: path => calls.push(['navigate', path]),
  };
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.exitSetup = saveAndExit;', context);
  await context.exitSetup(switchAccount);
  return calls;
}
for (const options of [{ draftFails: true }, { billingFails: true }, { draftFails: true, switchAccount: true }, { switchAccount: true, signOutFails: true }]) {
  const calls = await exercise(options);
  assert(!calls.some(([name]) => name === 'navigate'), 'Failed saving/signout must keep the setup page open');
  if (options.draftFails || options.billingFails) assert(!calls.some(([name]) => name === 'signout'), 'Never sign out before saving');
}
const switched = await exercise({ switchAccount: true });
assert(switched.findIndex(([name]) => name === 'draft') < switched.findIndex(([name]) => name === 'signout'));
assert(switched.some(([name, value]) => name === 'dispatch' && value === 'LOGOUT'));
assert(switched.some(([name, value]) => name === 'navigate' && value === '/login'));
const exited = await exercise({ step: 2 });
assert(!exited.some(([name]) => name === 'signout'));
assert(exited.some(([name, value]) => name === 'navigate' && value === '/'));
console.log('PASS: safe navigation destinations, civil-date filters, recovery allowlist/storage fallback, and save-before-exit/account-switch failures.');

*/
