import assert from 'node:assert/strict';
import { createPasswordService, getPasswordRequirements, validateNewPassword } from '../../frontend/src/services/supabase/passwordService.js';
import { estimatePasswordStrength } from '../../frontend/src/utils/passwordStrength.js';

let emit;
let user = { id: 'account-1', email: 'login@example.test' };
let currentPasswordValid = true;
let updateError = null;
const writes = [];
const auth = {
  onAuthStateChange(callback) { emit = callback; return { data: { subscription: { unsubscribe() {} } } }; },
  async getUser() { return { data: { user } }; },
  async resetPasswordForEmail(email, options) { writes.push({ email, options }); return {}; },
  async signInWithPassword(values) {
    assert.equal(values.email, 'login@example.test', 'Current password must be checked against the Auth email');
    return currentPasswordValid ? { data: { user } } : { error: new Error('private provider response') };
  },
  async updateUser(values) { writes.push(values); return { error: updateError }; },
  async signOut(options) { writes.push(options); emit('SIGNED_OUT', null); return {}; },
};
const service = createPasswordService(auth);
try {
  for (const invalid of ['short', 'longlowercase9!', 'LONGUPPERCASE9!', 'NoDigitsHere!', 'NoSpecialHere9', 'ValidLetters9£']) {
    assert.throws(() => validateNewPassword(invalid), /uppercase letter/);
  }
  assert.doesNotThrow(() => validateNewPassword('A-new-password9!'));
  assert.ok(getPasswordRequirements('Lime!Galaxy9Quartz').every(requirement => requirement.met));
  assert.equal(estimatePasswordStrength(''), null);
  assert.ok(estimatePasswordStrength('Password123!').score <= 1, 'Meeting format rules must not make a common password strong');
  assert.ok(estimatePasswordStrength('aaaaaaaaaaaaaaaaaaaa!1A').score <= 1, 'Length and format alone cannot make repetition strong');
  assert.ok(estimatePasswordStrength('mY9#pQ2@uV7!').score > estimatePasswordStrength('Password123!').score, 'Different guessability changes the rating even at equal length');
  assert.ok(estimatePasswordStrength('correct horse battery staple').score >= 3, 'A passphrase can estimate well without all required character classes');
  assert.throws(() => validateNewPassword('correct horse battery staple'), 'Format acceptance stays independent from strength');
  assert.ok(estimatePasswordStrength('Lime!Galaxy9Quartz').score >= 3);
  assert.ok(estimatePasswordStrength('Ananya#2026X', ['Ananya Sharma']).score <= estimatePasswordStrength('Ananya#2026X').score, 'Personal inputs cannot increase the rating');
  assert.ok(!('password' in estimatePasswordStrength('Lime!Galaxy9Quartz')), 'The adapter must not expose the raw library result');
  await assert.rejects(service.resetPassword('A-new-password9!'), /valid password-reset link/);
  assert.equal(writes.length, 0, 'An ordinary session cannot use the recovery form');
  await service.sendReset(' login@example.test ', 'https://calup.test/path');
  assert.deepEqual(writes.pop(), { email: 'login@example.test', options: { redirectTo: 'https://calup.test/reset-password' } });
  await assert.rejects(service.changePassword('Same-password9!', 'Same-password9!'), /different password/);
  currentPasswordValid = false;
  await assert.rejects(service.changePassword('wrong-password', 'A-new-password9!'), /could not be verified/);
  assert.equal(writes.length, 0, 'Wrong current passwords cannot reach updateUser');
  currentPasswordValid = true;
  await service.changePassword('old-password', 'A-new-password9!');
  assert.deepEqual(writes.pop(), { password: 'A-new-password9!', current_password: 'old-password' });
  emit('PASSWORD_RECOVERY', { user });
  user = { ...user, id: 'different-account' };
  await assert.rejects(service.resetPassword('A-new-password9!'), /invalid or expired/);
  assert.equal(writes.length, 0, 'Recovery cannot apply to a different account');
  user = { ...user, id: 'account-1' };
  updateError = { code: 'weak_password', message: 'private provider response' };
  await assert.rejects(service.resetPassword('A-new-password9!'), error => {
    assert.equal(error.code, 'weak_password');
    assert.match(error.message, /common or compromised/);
    assert.ok(!error.message.includes('private provider'));
    return true;
  });
  writes.pop();
  updateError = null;
  assert.deepEqual(await service.resetPassword('A-new-password9!'), { signedOut: true });
  assert.deepEqual(writes, [{ password: 'A-new-password9!' }, { scope: 'local' }]);
  await assert.rejects(service.resetPassword('Another-password9!'), /valid password-reset link/);
  console.log('PASS: password recovery ownership, current-password verification, and local session closure.');
} finally { service.dispose(); }
