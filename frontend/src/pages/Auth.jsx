/** Calup sign-in and account creation, styled from trial-ui-components/login_page_1. */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, MailCheck, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, generateId } from '../data/store';
import { ACTIONS } from '../data/actions';
import BrandLogo from '../components/ui/BrandLogo';
import SetupShell from '../components/onboarding/SetupShell';
import PasswordStrength from '../components/ui/PasswordStrength';
import { usePopupFeedback } from '../hooks/usePopupFeedback.js';
import { supabase, isSupabaseConfigured } from '../services/supabase/supabaseClient';
import { dbService } from '../services/supabase/dbService';
import { onboardingService } from '../services/merchant/onboardingService';
import { validateNewPassword } from '../services/supabase/passwordService.js';
import { isCalupAdmin, startAdminPhoneChallenge, completeAdminPhoneChallenge, endAdminVerification } from '../services/supabase/adminMfa.js';
import { generateSlug } from '../utils/helpers';
import './Auth.css';
/* Disabled navigation enhancement (user request):
import { NotificationDialog } from '../components/ui/Notifications';
*/
/* Disabled navigation enhancement (user request):
import { settingsReturnPath, clearSettingsReturn } from '../utils/navigation';
*/

/* Disabled navigation enhancement (user request):
export function HomeLink({ dirty = false, busy = false, to = '/', children }) {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!dirty || busy) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  return <><Link className="calup-auth-home-link" to={to} aria-disabled={busy || undefined} onClick={event => {
    if (busy) { event.preventDefault(); return; }
    if (dirty && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setLeaving(true); }
  }}>{children || <><ArrowLeft size={16} aria-hidden="true" />Back to home</>}</Link>
    <NotificationDialog open={leaving} variant="warning" title="Leave this form?" message="Your unsaved entries will be discarded. No passwords will be saved." confirmLabel="Leave form" cancelLabel="Stay here" onClose={() => setLeaving(false)} onConfirm={() => navigate(to)} />
  </>;
}


*/
function HomeLink() {
  return <Link className="calup-auth-home-link" to="/"><ArrowLeft size={16} aria-hidden="true" />Back to home</Link>;
}

export function AuthLayout({ children, mode }) {
  const isSignup = mode === 'signup';
  return (
    <div className="calup-auth-page">
      <section className="calup-auth-shell" aria-label={isSignup ? 'Create a Calup account' : 'Sign in to Calup'}>
        <main className="calup-auth-panel">
          <header className="calup-auth-brand-row">
            <BrandLogo size="md" />
            <HomeLink />
          </header>
          <div className="calup-auth-form-area">{children}</div>
          <footer className="calup-auth-footer">
            <span>© {new Date().getFullYear()} Calup</span>
            <span><ShieldCheck size={14} aria-hidden="true" /> Your time. Your business.</span>
          </footer>
        </main>
        <aside className="calup-auth-story" aria-label="What Calup helps you do">
          <div>
            <span className="calup-auth-kicker"><span /> More space for what matters</span>
            <h2>You bring the expertise.<br />We’ll make the time.</h2>
            <p>Give clients one simple link to find a time, book your service, and pay securely.</p>
          </div>
          <blockquote>
            <Sparkles size={30} aria-hidden="true" />
            <p>Less “when are you free?”<br />More “see you then.”</p>
            <cite>That’s the Calup way.</cite>
          </blockquote>
          <div className="calup-auth-story-footer">
            <div className="calup-auth-benefits">
              <span><Check size={15} /> Your hours</span>
              <span><Check size={15} /> Your rates</span>
              <span><Check size={15} /> Your own link</span>
            </div>
            <div className="calup-auth-story-rule" />
            <p>Built for India’s service businesses.</p>
          </div>
        </aside>
      </section>
    </div>
  );
}

export function PasswordField({ id, value, onChange, autoComplete, placeholder, disabled, describedBy }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="calup-auth-password">
      <input id={id} type={visible ? 'text' : 'password'} autoComplete={autoComplete}
        placeholder={placeholder} value={value} onChange={onChange} disabled={disabled} aria-describedby={describedBy} required />
      <button type="button" aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible} onClick={() => setVisible(current => !current)} disabled={disabled}>
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

const signupAvailability = {
  monday: { available: true, start: '09:00', end: '18:00' },
  tuesday: { available: true, start: '09:00', end: '18:00' },
  wednesday: { available: true, start: '09:00', end: '18:00' },
  thursday: { available: true, start: '09:00', end: '18:00' },
  friday: { available: true, start: '09:00', end: '17:00' },
  saturday: { available: true, start: '10:00', end: '14:00' },
  sunday: { available: false, start: '09:00', end: '18:00' },
};

export function Login() {
  const navigate = useNavigate();
  const { state, dispatch, addToast } = useStore();
  const [form, setForm] = useState({ emailOrPhone: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [, setErrorMsg] = usePopupFeedback();
  const [adminStep, setAdminStep] = useState(false);
  const adminOperation = useRef(false);
  const [challenge, setChallenge] = useState(null);
  const [otp, setOtp] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!adminStep) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [adminStep]);

  const sendAdminCode = async () => {
    if (Date.now() < resendAt || adminOperation.current) return;
    adminOperation.current = true;
    setLoading(true);
    setAdminStep(true);
    setChallenge(null);
    setOtp('');
    try {
      setChallenge(await startAdminPhoneChallenge(supabase));
      setResendAt(Date.now() + 60000);
      setNow(Date.now());
    } catch (error) {
      setErrorMsg(error.message || 'Could not send your verification code.');
    } finally { adminOperation.current = false; setLoading(false); }
  };

  const verifyAdminCode = async event => {
    event.preventDefault();
    if (adminOperation.current) return;
    if (!challenge || !/^\d{4,8}$/.test(otp)) { setErrorMsg('Enter the SMS verification code.'); return; }
    setLoading(true);
    adminOperation.current = true;
    try {
      await completeAdminPhoneChallenge(supabase, challenge.challengeId, otp, () => {
        setChallenge(null);
        setOtp('');
      });
      navigate('/admin', { replace: true });
    } catch (error) { setErrorMsg(error.message || 'Verification failed. Request another code and try again.'); }
    finally { adminOperation.current = false; setLoading(false); }
  };

  const signOutCurrentAccount = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      if (isSupabaseConfigured()) {
        if (isCalupAdmin(state.auth.user)) await endAdminVerification(supabase).catch(() => {});
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
      }
      dispatch({ type: ACTIONS.LOGOUT });
      setAdminStep(false);
      setChallenge(null);
      setOtp('');
      setResendAt(0);
      setForm({ emailOrPhone: '', password: '' });
    } catch {
      setErrorMsg('Could not sign out. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMsg('');
    if (!form.emailOrPhone.trim() || !form.password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }
    if (!isSupabaseConfigured()) {
      setErrorMsg('Database connection is not configured. Please contact the administrator.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: form.emailOrPhone.trim(), password: form.password,
      });
      if (error) throw error;
      if (data?.user) {
        if (isCalupAdmin(data.user)) {
          dispatch({ type: ACTIONS.LOGOUT });
          dispatch({ type: ACTIONS.LOGIN, payload: data.user });
          setForm(current => ({ ...current, password: '' }));
          await sendAdminCode();
          return;
        }
        let provider = await dbService.getProviderByUserId(data.user.id);
        if (!provider) {
          const providerName = data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'Provider';
          const providerSlug = `${generateSlug(providerName)}-${data.user.id.slice(0, 5)}`;
          try {
            provider = await dbService.createProviderProfile({
              userId: data.user.id, name: providerName,
              businessName: data.user.user_metadata?.business_name || undefined,
              slug: providerSlug, email: data.user.email,
              phone: data.user.user_metadata?.merchant_phone || undefined,
            });
          } catch (profileError) {
            console.warn('Could not auto-provision provider profile on login:', profileError.message);
          }
        }
        dispatch({ type: ACTIONS.LOGIN, payload: {
          id: data.user.id, email: data.user.email,
          name: provider?.name || data.user.user_metadata?.name || 'Provider', ...provider,
        } });
        if (provider) {
          dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: provider });
          addToast(`Welcome back, ${provider.name}!`);
          try {
            const onboarding = await onboardingService.load();
/* Disabled navigation enhancement (user request):
            const returnTo = settingsReturnPath();
            clearSettingsReturn();
            const destination = onboarding?.status === 'completed' ? '/dashboard' : '/onboarding';
            navigate(destination === '/dashboard' && returnTo ? returnTo : destination);
*/
            navigate(onboarding?.status === 'completed' ? '/dashboard' : '/onboarding');
          } catch (setupError) {
            setErrorMsg(setupError.message || 'Could not verify your account setup. Please try signing in again.');
          }
        } else {
          navigate('/onboarding');
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      let message = error.message || 'Invalid email or password.';
      if (error.message?.toLowerCase().includes('invalid login credentials')) {
        message = 'Invalid email or password. Please check your credentials and try again.';
      } else if (error.message?.toLowerCase().includes('email not confirmed')) {
        message = 'Please confirm your email address before logging in.';
      }
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout mode="login">
      <div className="calup-auth-heading">
        <span>Good to see you again</span><h1>Welcome back.</h1>
        <p>Your next great session starts here.</p>
      </div>
      {adminStep ? <form className="calup-auth-form" onSubmit={verifyAdminCode} aria-busy={loading}>
        <h2>Verify administrator access</h2>
        <p role="status">{challenge ? `Enter the SMS code sent to ${challenge.maskedPhone}.` : 'Phone verification is required before opening your admin workspace.'}</p>
        <label htmlFor="admin-otp">SMS verification code
          <input id="admin-otp" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus
            value={otp} maxLength={8} onChange={event => setOtp(event.target.value.replace(/\D/g, ''))} disabled={loading || !challenge} required />
        </label>
        <button type="submit" className="calup-auth-submit" disabled={loading || !challenge}>{loading ? 'Please wait...' : 'Verify and continue'}</button>
        <button type="button" className="integration-action" disabled={loading || now < resendAt} onClick={sendAdminCode}>
          {now < resendAt ? `Resend in ${Math.ceil((resendAt - now) / 1000)}s` : challenge ? 'Resend SMS code' : 'Send SMS code'}
        </button>
        <button type="button" className="integration-action" disabled={loading} onClick={signOutCurrentAccount}>Cancel and sign out</button>
      </form> : <form className="calup-auth-form" onSubmit={handleSubmit} aria-busy={loading} noValidate>
        {state.auth.isAuthenticated && !state.auth.isDemoMode && (
          <div className="calup-auth-session" role="status">
            <p>Signed in{state.auth.user?.email ? ` as ${state.auth.user.email}` : ''}. You can enter credentials below to log in again or use another account.</p>
            <button type="button" className="integration-action" onClick={signOutCurrentAccount} disabled={loading}>Sign out</button>
            {isCalupAdmin(state.auth.user) && <button type="button" className="integration-action" onClick={sendAdminCode} disabled={loading}>Verify administrator phone</button>}
          </div>
        )}
        <label htmlFor="login-email">Email address
          <input id="login-email" type="email" autoComplete="email" inputMode="email"
            placeholder="you@example.com" value={form.emailOrPhone}
            onChange={event => setForm(current => ({ ...current, emailOrPhone: event.target.value }))}
            disabled={loading} required />
        </label>
        <label htmlFor="login-password">Password
          <PasswordField id="login-password" autoComplete="current-password" placeholder="Enter your password"
            value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))}
            disabled={loading} />
        </label>
        <Link to="/forgot-password" style={{ justifySelf: 'end', fontSize: 12, textDecoration: 'underline' }}>Forgot your password?</Link>
        <button className="calup-auth-submit" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}{!loading && <ArrowRight size={18} aria-hidden="true" />}
        </button>
      </form>}
      <p className="calup-auth-switch">New to Calup?
        <Link to="/signup">Create an account <ArrowRight size={14} /></Link>
      </p>
    </AuthLayout>
  );
}

export function Signup() {
  const navigate = useNavigate();
  const { dispatch, addToast } = useStore();
  const [form, setForm] = useState({
    name: '', businessName: '', businessType: 'Coach', emailOrPhone: '', phone: '', password: '',
  });
  const [loading, setLoading] = useState(false);
  const [, setErrorMsg] = usePopupFeedback();
  const [pendingEmail, setPendingEmail] = useState('');
  const [resendingEmail, setResendingEmail] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMsg('');
    if (form.name.trim().length < 2) { setErrorMsg('Please enter your full name.'); return; }
    if (form.businessName.trim().length < 2) { setErrorMsg('Please enter your business or studio name.'); return; }
    if (!form.emailOrPhone.trim()) { setErrorMsg('Please enter your email.'); return; }
    const phone = form.phone.replace(/\D/g, '').replace(/^91(?=[6-9]\d{9}$)/, '');
    if (!/^[6-9]\d{9}$/.test(phone)) { setErrorMsg('Please enter a valid 10-digit Indian mobile number.'); return; }
    try { validateNewPassword(form.password); }
    catch (error) { setErrorMsg(error.message); return; }
    if (!isSupabaseConfigured()) {
      const user = { id: generateId('provider'), name: form.name.trim(), businessName: form.businessName.trim(),
        businessType: form.businessType, email: form.emailOrPhone.trim(), phone, createdAt: new Date().toISOString() };
      dispatch({ type: ACTIONS.SIGNUP, payload: user });
      navigate('/onboarding');
      return;
    }
    setLoading(true);
    try {
      const email = form.emailOrPhone.trim();
      const { data, error } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: { data: {
          name: form.name.trim(), business_name: form.businessName.trim(), business_type: form.businessType,
          merchant_phone: phone,
        }, emailRedirectTo: `${window.location.origin}/login` },
      });
      if (error) throw error;
      if (data?.user) {
        if (data.user.identities && data.user.identities.length === 0) {
          setErrorMsg('An account with this email already exists. Please sign in.'); return;
        }
        const user = { id: data.user.id, userId: data.user.id, name: form.name.trim(), email,
          createdAt: data.user.created_at || new Date().toISOString() };
        if (data.session) {
          let provider = null;
          try {
            const providerSlug = `${generateSlug(form.name.trim())}-${data.user.id.slice(0, 5)}`;
            provider = await dbService.createProviderProfile({
              userId: data.user.id, name: form.name.trim(), businessName: form.businessName.trim(),
              slug: providerSlug, email, phone,
            });
          } catch (profileError) {
            console.warn('Provider profile pre-provision note:', profileError.message);
          }
          dispatch({ type: ACTIONS.SIGNUP, payload: { user, provider } });
          if (provider) dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: provider });
          try {
            await onboardingService.saveDraft({
              businessName: form.businessName.trim(), providerName: form.name.trim(), merchantEmail: email,
              phone, bio: '', timezone: 'Asia/Kolkata',
              service: { name: '', description: '', price: 1000, duration: 60, meetingType: 'online', locationAddress: '' },
              availability: signupAvailability,
              bookingRules: { minNotice: 2, maxAdvanceBooking: 30, bufferTime: 15, cancellationWindow: 12 },
            }, 1);
          } catch (draftError) {
            console.warn('Could not initialize onboarding draft:', draftError.message);
          }
          addToast('Account created! Let’s set up your business.');
          navigate('/onboarding');
        } else {
          setPendingEmail(email);
          setForm(current => ({ ...current, password: '' }));
        }
      }
    } catch (error) {
      console.error('Signup error:', error);
      let message = error.message || 'Failed to create account.';
      if (error.message?.includes('over_email_send_rate_limit')) {
        message = 'Too many confirmation emails were requested. Please wait and try again.';
      }
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  const resendVerificationEmail = async () => {
    if (!pendingEmail || !isSupabaseConfigured()) return;
    setResendingEmail(true);
    setErrorMsg('');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup', email: pendingEmail, options: { emailRedirectTo: `${window.location.origin}/login` },
      });
      if (error) throw error;
      addToast('Verification email sent again.', 'info');
    } catch (error) {
      setErrorMsg(error.message || 'Could not resend the verification email.');
    } finally {
      setResendingEmail(false);
    }
  };

  if (pendingEmail) {
    return (
      <SetupShell step={0} totalSteps={8} title="Verify your email"
        description="Confirm the address that protects your Calup merchant account."
        headerAction={<nav className="calup-auth-navigation" aria-label="Account navigation"><HomeLink /><Link to="/login">Already verified? Sign in <ArrowRight size={14} /></Link></nav>}
        footer={(
          <div className="setup-footer-actions">
            <span className="setup-footer-note"><ShieldCheck size={15} /> Verification links expire for your safety.</span>
            <div><button className="setup-next-button" type="button" onClick={() => navigate('/login')}>Back to sign in <ArrowRight size={17} /></button></div>
          </div>
        )}
      >
        <div className="calup-auth-verification">
          <span className="calup-auth-verification-icon"><MailCheck size={32} /></span>
          <span>Check your inbox</span>
          <h1>Verify your email address.</h1>
          <p>We sent a secure confirmation link to <strong>{pendingEmail}</strong>. Open it, then return to sign in. Your mobile number will be verified by SMS in the next setup step.</p>
          <button type="button" className="integration-action" onClick={resendVerificationEmail} disabled={resendingEmail}>
            {resendingEmail ? 'Sending...' : 'Resend verification email'}
          </button>
        </div>
      </SetupShell>
    );
  }

  return (
    <SetupShell
      step={0}
      totalSteps={8}
      title="Make it yours"
      description="A little about you. A big step toward a simpler way to get booked and paid."
      headerAction={<nav className="calup-auth-navigation" aria-label="Account navigation"><HomeLink /><Link to="/login">Already signed up? Log in <ArrowRight size={14} /></Link></nav>}
      footer={(
        <div className="setup-footer-actions">
          <span className="setup-footer-note"><ShieldCheck size={15} /> Made for your next chapter.</span>
          <div>
            <button className="setup-next-button" type="submit" form="calup-signup-form" disabled={loading}>
              {loading ? 'Creating account…' : 'Next step'}
              {!loading && <ArrowRight size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      )}
    >
      <div className="calup-auth-setup-form">
        <div className="calup-auth-heading calup-auth-heading--left">
          <span>Let’s start with you</span>
          <h1>A little hello.<br />A whole lot of possibility.</h1>
          <p>Create your Calup account and give your expertise a home.</p>
        </div>
        <form id="calup-signup-form" className="calup-auth-form" onSubmit={handleSubmit} aria-busy={loading} noValidate>
          <div className="calup-auth-field-grid">
            <label htmlFor="signup-name">Full name
              <input id="signup-name" type="text" autoComplete="name" placeholder="Priya Sharma" value={form.name}
                onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                disabled={loading} required />
            </label>
            <label htmlFor="signup-business">Business or studio name
              <input id="signup-business" type="text" autoComplete="organization" placeholder="The Growth Studio"
                value={form.businessName}
                onChange={event => setForm(current => ({ ...current, businessName: event.target.value }))}
                disabled={loading} required />
            </label>
          </div>
          <label htmlFor="signup-email">Email address
            <input id="signup-email" type="email" autoComplete="email" inputMode="email"
              placeholder="you@example.com" value={form.emailOrPhone}
              onChange={event => setForm(current => ({ ...current, emailOrPhone: event.target.value }))}
              disabled={loading} required />
          </label>
          <label htmlFor="signup-phone">Mobile number
            <div className="calup-auth-phone-field"><span>+91</span><input id="signup-phone" type="tel" inputMode="numeric"
              autoComplete="tel-national" placeholder="98765 43210" value={form.phone}
              onChange={event => setForm(current => ({ ...current, phone: event.target.value.replace(/\D/g, '').slice(0, 10) }))}
              disabled={loading} required /></div>
            <span className="calup-auth-field-hint">We’ll verify this number by SMS during the integrations step.</span>
          </label>
          <label htmlFor="signup-password">Password
            <PasswordField id="signup-password" autoComplete="new-password" placeholder="Create a secure password"
              value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))}
              disabled={loading} describedBy="signup-password-strength" />
            <PasswordStrength id="signup-password-strength" password={form.password} userInputs={[form.name, form.businessName, form.emailOrPhone]} />
          </label>
          <fieldset className="calup-auth-role-field">
            <legend>What best describes your business?</legend>
            <div>{['Coach', 'Consultant', 'Tutor', 'Other service'].map(type => (
              <label key={type} className={form.businessType === type ? 'is-selected' : ''}>
                <input type="radio" name="businessType" value={type} checked={form.businessType === type}
                  onChange={() => setForm(current => ({ ...current, businessType: type }))} />
                {type}
              </label>
            ))}</div>
          </fieldset>
{/* Disabled navigation enhancement (user request):
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>Review our <Link to="/terms-and-conditions" target="_blank" rel="noopener noreferrer">Terms and Conditions</Link> and <Link to="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link> before creating your account.</p>
*/}
        </form>
      </div>
    </SetupShell>
  );
}


/* Disabled navigation enhancement (user request):
<HomeLink to="/login" dirty={Boolean(form.name || form.businessName || form.emailOrPhone || form.phone || form.password)} busy={loading}>Already signed up? Log in <ArrowRight size={14} /></HomeLink>
*/

/* Disabled navigation enhancement (user request):
<HomeLink to="/signup" dirty={Boolean(form.emailOrPhone || form.password)} busy={loading}>Create an account <ArrowRight size={14} /></HomeLink>
*/

/* Disabled navigation enhancement (user request):
<HomeLink to="/forgot-password" dirty={Boolean(form.emailOrPhone || form.password)} busy={loading}>Forgot your password?</HomeLink>
*/
