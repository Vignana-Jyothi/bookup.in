import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout, PasswordField } from './Auth';
import { passwordService, PASSWORD_REQUIREMENTS } from '../services/supabase/passwordService.js';
/* Disabled navigation enhancement (user request):
import { useAuth } from '../data/store';
*/
/* Disabled navigation enhancement (user request):
import { rememberSettingsReturn, settingsReturnPath } from '../utils/navigation';
*/
import { usePopupFeedback } from '../hooks/usePopupFeedback.js';

export default function PasswordRecovery({ reset = false }) {
/* Disabled navigation enhancement (user request):
  const location = useLocation();
  const auth = useAuth();
  const fromSettings = location.state?.returnTo === '/dashboard/settings' || Boolean(settingsReturnPath());
  useEffect(() => { if (location.state?.returnTo === '/dashboard/settings') rememberSettingsReturn(); }, [location.state?.returnTo]);

*/
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(reset);
  const [busy, setBusy] = useState(false);
  const [, setError] = usePopupFeedback();
  const [success, setSuccess] = usePopupFeedback('', 'success');
  useEffect(() => {
    if (!reset) return undefined;
    let active = true;
    const check = async () => {
      try {
        await passwordService.recoveryUser();
        if (active) { setReady(true); setError(''); }
      } catch (failure) {
        if (active) { setReady(false); setError(failure.message); }
      } finally { if (active) setChecking(false); }
    };
    const unsubscribe = passwordService.subscribeRecovery(check);
    check();
    return () => { active = false; unsubscribe(); };
  }, [reset, setError]);
  const submit = async event => {
    event.preventDefault();
    setError('');
    if (reset && password !== confirmation) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      if (reset) {
        const result = await passwordService.resetPassword(password);
        setPassword(''); setConfirmation(''); setReady(false);
        setSuccess(result.signedOut ? 'Password updated. Log in with your new password.' : 'Password updated. Your current session could not be signed out; you can still log in with your new password.');
      } else {
        await passwordService.sendReset(email, window.location.origin);
        setSuccess('If an account exists for this email, you will receive a password-reset link. Check your inbox and spam folder.');
      }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return (
    <AuthLayout mode="login">
      <div className="calup-auth-heading">
        <span>Account security</span><h1>{success ? reset ? 'Password updated.' : 'Check your inbox.' : reset ? 'Set a new password.' : 'Forgot your password?'}</h1>
        <p>{success ? reset ? 'Log in with your new password.' : 'Follow the password-reset link to continue.' : reset ? PASSWORD_REQUIREMENTS : 'Enter the email you use to log in to Calup.'}</p>
      </div>
      {!success && (
        <form className="calup-auth-form" onSubmit={submit} aria-busy={busy || checking}>
          {reset ? ready ? <>
            <label htmlFor="reset-password">New password<PasswordField id="reset-password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" disabled={busy} /></label>
            <label htmlFor="reset-confirmation">Confirm new password<PasswordField id="reset-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" disabled={busy} /></label>
          </> : <p>{checking ? 'Checking your reset link…' : <Link to="/forgot-password">Request a new reset link</Link>}</p> : (
            <label htmlFor="recovery-email">Login email<input id="recovery-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} /></label>
          )}
          {(!reset || ready) && <button className="calup-auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : reset ? 'Update password' : 'Send reset link'}</button>}
        </form>
      )}
      <p className="calup-auth-switch"><Link to="/login">Back to log in</Link></p>
{/* Disabled navigation enhancement (user request):
      {fromSettings && <p className="calup-auth-switch"><HomeLink dirty={Boolean(email || password || confirmation) && !success} busy={busy} to={auth.isAuthenticated && !success ? '/dashboard/settings' : '/login'}>{auth.isAuthenticated && !success ? 'Back to Settings' : 'Log in to return to Settings'}</HomeLink></p>}
*/}
    </AuthLayout>
  );
}
