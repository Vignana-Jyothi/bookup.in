import { supabase, isSupabaseConfigured } from './supabaseClient.js';

export const PASSWORD_REQUIREMENTS = 'Use at least 8 characters, including an uppercase letter, a lowercase letter, a number, and a special character.';

export function getPasswordRequirements(password = '') {
  const hasSpecial = typeof password === 'string' && Array.from(password).some(character => {
    const code = character.charCodeAt(0);
    return code >= 33 && code <= 126 && !/[A-Za-z0-9]/.test(character);
  });
  return [
    { label: 'At least 8 characters', met: typeof password === 'string' && password.length >= 8 },
    { label: 'An uppercase letter (A–Z)', met: /[A-Z]/.test(password) },
    { label: 'A lowercase letter (a–z)', met: /[a-z]/.test(password) },
    { label: 'A number (0–9)', met: /[0-9]/.test(password) },
    { label: 'A special character, such as ! @ # $', met: hasSpecial },
  ];
}

export function validateNewPassword(password) {
  if (!getPasswordRequirements(password).every(requirement => requirement.met)) {
    throw new Error(PASSWORD_REQUIREMENTS);
  }
}

function passwordUpdateError(error) {
  const messages = {
    weak_password: PASSWORD_REQUIREMENTS + ' Avoid common or compromised passwords.',
    same_password: 'Choose a different password from your current one.',
    reauthentication_needed: 'Please log in again or request a new password-reset link before changing your password.',
    reauthentication_not_valid: 'Your security verification has expired. Please log in again or request a new reset link.',
    session_not_found: 'Your session has expired. Please log in again or request a new reset link.',
    over_request_rate_limit: 'Too many attempts. Please wait before trying again.',
  };
  const failure = new Error(messages[error.code] || 'Could not update your password. Please try again or request a new reset link.');
  failure.code = error.code;
  return failure;
}

export function createPasswordService(auth, configured = () => true) {
  let recoveryUserId = null;
  const listeners = new Set();
  const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recoveryUserId = session?.user?.id || null;
    else if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || (session?.user?.id && session.user.id !== recoveryUserId)) recoveryUserId = null;
    for (const listener of listeners) listener();
  });
  const requireConfigured = () => {
    if (!configured()) throw new Error('Authentication is unavailable. Please try again later.');
  };
  const recoveryUser = async () => {
    requireConfigured();
    if (!recoveryUserId) throw new Error('Open a valid password-reset link from your email. If it expired, request a new link.');
    const { data, error } = await auth.getUser();
    if (error || data?.user?.id !== recoveryUserId) throw new Error('This password-reset link is invalid or expired. Request a new link.');
    return data.user;
  };
  return {
    subscribeRecovery(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    recoveryUser,
    async sendReset(email, origin) {
      requireConfigured();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter a valid login email address.');
      const { error } = await auth.resetPasswordForEmail(email.trim(), { redirectTo: `${new URL(origin).origin}/reset-password` });
      if (error) throw new Error(error.status === 429 ? 'Too many requests. Please wait before requesting another reset link.' : 'Could not send the reset email. Please try again later.');
    },
    async resetPassword(password) {
      validateNewPassword(password);
      await recoveryUser();
      const { error } = await auth.updateUser({ password });
      if (error) throw passwordUpdateError(error);
      recoveryUserId = null;
      const { error: signOutError } = await auth.signOut({ scope: 'local' });
      return { signedOut: !signOutError };
    },
    async changePassword(currentPassword, password) {
      requireConfigured();
      validateNewPassword(password);
      if (!currentPassword) throw new Error('Enter your current password.');
      if (currentPassword === password) throw new Error('Choose a different password from your current one.');
      const { data: identity, error: identityError } = await auth.getUser();
      if (identityError || !identity?.user?.email) throw new Error('Please log in again before changing your password.');
      const { data: verified, error: verificationError } = await auth.signInWithPassword({ email: identity.user.email, password: currentPassword });
      if (verificationError || verified?.user?.id !== identity.user.id) throw new Error('Your current password could not be verified. Please try again.');
      const { error } = await auth.updateUser({ password, current_password: currentPassword });
      if (error) throw passwordUpdateError(error);
    },
    dispose() { subscription.unsubscribe(); listeners.clear(); },
  };
}

// Register before React mounts so URL recovery events cannot be missed by the form.
export const passwordService = createPasswordService(supabase.auth, isSupabaseConfigured);
