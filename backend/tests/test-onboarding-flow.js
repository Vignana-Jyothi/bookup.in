import assert from 'node:assert/strict';
import { ONBOARDING_STEPS, normalizeOnboardingStep, resolveOnboardingStart, onboardingHoursError } from '../../frontend/src/utils/onboardingFlow.js';

assert.deepEqual(ONBOARDING_STEPS, [0, 1, 3, 4, 6, 7]);
assert.equal(normalizeOnboardingStep(2), 0, 'Legacy bio step returns to the combined profile');
assert.equal(normalizeOnboardingStep('5'), 4, 'Legacy rules step returns to hours and rules');
for (const value of [null, undefined, 'bad', -1, 8]) assert.equal(normalizeOnboardingStep(value), 0);
const draft = { businessName:'Practice',providerName:'Merchant',merchantEmail:'fixture@example.invalid',phone:'9876543210',bio:'A clear introduction with enough characters.' };
const billingProfile = {version:1};
for(const [saved, expected] of [[0,3],[1,3],[2,0],[3,3],[4,4],[5,4],[6,6],[7,7]]) {
  assert.equal(resolveOnboardingStart({draft,billingProfile,currentStep:saved}),expected);
}
assert.equal(resolveOnboardingStart({draft:{...draft,bio:''},billingProfile,currentStep:6,calendarReturn:'connected'}),0,'Incomplete profile cannot be skipped by a return URL');
assert.equal(resolveOnboardingStart({draft,currentStep:6,calendarReturn:'connected'}),1,'Billing remains required');
assert.equal(resolveOnboardingStart({draft,billingProfile,currentStep:3,calendarReturn:'connected'}),6,'Calendar return restores verification');
const availability=Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day=>[day,{available:true,start:'09:00',end:'18:00'}]));
const rules={minNotice:2,maxAdvanceBooking:30,bufferTime:15,cancellationWindow:12};
assert.equal(onboardingHoursError(availability,rules),'');
assert.match(onboardingHoursError(Object.fromEntries(Object.entries(availability).map(([day,hours])=>[day,{...hours,available:false}])),rules),/at least one/);
assert.match(onboardingHoursError({...availability,monday:{available:true,start:'18:00',end:'09:00'}},rules),/monday/);
for(const [key,value] of [['minNotice',721],['maxAdvanceBooking',0],['bufferTime',241],['cancellationWindow',-1],['minNotice',0.5],['bufferTime','']]) {
  assert.notEqual(onboardingHoursError(availability,{...rules,[key]:value}),'',`${key} rejects ${value}`);
}
console.log('PASS: six-screen ordering, legacy resume IDs, prerequisite precedence, OAuth return, hours and booking-rule boundaries');
