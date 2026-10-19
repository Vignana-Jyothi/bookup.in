/**
 * CalUp — Onboarding Flow
 * Eight-stage merchant setup, continuing account creation.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';
import { useStore, formatCurrency } from '../data/store';
import { ACTIONS } from '../data/actions';
import { getInitials, DAYS_OF_WEEK, DAY_FULL_LABELS } from '../utils/helpers';
import { getBookingUrl } from '../utils/url';
import { supabase, isSupabaseConfigured } from '../services/supabase/supabaseClient';
import { dbService } from '../services/supabase/dbService';
import { realGoogleCalendarService } from '../services/calendar/RealGoogleCalendarProvider';
import { onboardingService } from '../services/merchant/onboardingService';
import { subscriptionService } from '../services/payments/subscriptionService';
import SetupShell from '../components/onboarding/SetupShell';
import IntegrationSheet from '../components/onboarding/IntegrationSheet';
import { usePopupFeedback } from '../hooks/usePopupFeedback.js';
import './Onboarding.css';

const TOTAL_STEPS = 8;
// Reuse the former duplicate contact step for billing; later persisted identifiers stay stable.
const WIZARD_STEPS = [0, 1, 2, 3, 4, 5, 6, 7];

const STEP_DETAILS = [
  ['Make it yours', 'A little about you. A big step toward a simpler way to get booked and paid.'],
  ['Your billing details', 'Add the legal name and address used on Calup subscription receipts. GSTIN is optional.'],
  ['Introduce yourself', 'Help customers understand who they will meet and why they can trust your expertise.'],
  ['Create your first service', 'Set the service, delivery method, duration, and customer price.'],
  ['Choose your hours', 'Mark the days and times when customers may request appointments.'],
  ['Set booking rules', 'Control notice, booking range, breaks, and cancellation timing.'],
  ['Connect your tools', 'Bring calendars, meetings, payments, and notifications together in one setup sheet.'],
  ['Review and finish', 'Check activation requirements and save the first publishable version of your business.'],
];

const defaultAvailability = {
  monday:    { available: true, start: '09:00', end: '18:00' },
  tuesday:   { available: true, start: '09:00', end: '18:00' },
  wednesday: { available: true, start: '09:00', end: '18:00' },
  thursday:  { available: true, start: '09:00', end: '18:00' },
  friday:    { available: true, start: '09:00', end: '17:00' },
  saturday:  { available: true, start: '10:00', end: '14:00' },
  sunday:    { available: false, start: '09:00', end: '18:00' },
};

export default function Onboarding() {
  const { state, dispatch, addToast } = useStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const calendarReturn = useRef(searchParams.get('calendar'));
  const [step, setStep] = useState(1);
  const [billing, setBilling] = useState({ legalName: state.provider?.name || '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', gstin: '', version: null });
  const billingNameEdited = useRef(false);

  const [businessName, setBusinessName] = useState(state.provider?.businessName || '');
  const [providerName, setProviderName] = useState(state.provider?.name || '');
  const [merchantEmail, setMerchantEmail] = useState(state.provider?.email || '');
  const [phone, setPhone] = useState(state.provider?.phone || '');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(state.provider?.avatar || state.provider?.avatarUrl || null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef(null);
  const [service, setService] = useState({ name: '', description: '', price: 1000, duration: 60, meetingType: 'online', locationAddress: '' });
  const [availability, setAvailability] = useState(defaultAvailability);
  const [bookingRules, setBookingRules] = useState({ minNotice: 2, maxAdvanceBooking: 30, bufferTime: 15, cancellationWindow: 12 });
  const [stepError, setStepError] = usePopupFeedback();
  const [googleStatus, setGoogleStatus] = useState({ isConnected: false, email: null });
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isTestingGoogle, setIsTestingGoogle] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured());
  const [identityStatus, setIdentityStatus] = useState({ emailVerified: false, phoneVerified: false });
  const [entitlementStatus, setEntitlementStatus] = useState({ active: false, status: 'not_activated' });
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [emailOtp, setEmailOtp] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [isVerifyingPhone, setIsVerifyingPhone] = useState(false);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [completionResult, setCompletionResult] = useState(null);

  // Always use the permanent slug saved in the database, never a locally generated slug
  const slug = state.provider?.slug || 'my-page';

  const draftPayload = () => ({
    businessName,
    providerName,
    merchantEmail,
    phone,
    bio,
    timezone: 'Asia/Kolkata',
    service,
    availability,
    bookingRules,
  });

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }
    Promise.all([onboardingService.load(), subscriptionService.get()]).then(([result, subscription]) => {
      const draft = result.draft || {};
      setBusinessName(draft.businessName || '');
      setProviderName(draft.providerName || '');
      setMerchantEmail(draft.merchantEmail || '');
      setPhone(draft.phone || '');
      setBio(draft.bio || '');
      if (draft.service) setService(current => ({ ...current, ...draft.service }));
      if (draft.availability) setAvailability(draft.availability);
      if (draft.bookingRules) setBookingRules(current => ({ ...current, ...draft.bookingRules }));
      const savedStep = Math.max(0, Math.min(TOTAL_STEPS - 1, Number(result.currentStep) || 0));
      const basicsReady = Boolean(draft.businessName && draft.providerName && draft.merchantEmail && draft.phone);
      // Read the canonical billing record even when an older onboarding API is running.
      const savedBilling = subscription.billingProfile;
      if (savedBilling) setBilling(savedBilling);
      else setBilling(current => ({ ...current, legalName: draft.providerName || '' }));
      setStep(!basicsReady ? 0 : !savedBilling ? 1 : calendarReturn.current ? 6 : savedStep <= 1 ? 2 : savedStep);
      setIdentityStatus(result.identity || { emailVerified: false, phoneVerified: false });
      setEmailOtpSent(Boolean(result.identity?.emailVerificationSent));
      setPhoneOtpSent(Boolean(result.identity?.phoneVerificationSent));
      setGoogleStatus({
        isConnected: Boolean(result.google?.ready),
        email: result.google?.email || null,
        hostAccessReady: Boolean(result.google?.ready),
      });
      setEntitlementStatus(result.entitlement || { active: false, status: 'not_activated' });
    }).catch(error => {
      console.error('[Onboarding] Load failed:', error);
      setStepError(error.message || 'Could not load setup progress.');
    }).finally(() => setIsLoading(false));
  }, [setStepError]);

  useEffect(() => {
    if (!state.provider?.slug && isSupabaseConfigured()) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          dbService.getProviderByUserId(user.id).then(prov => {
            if (prov) {
              dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: prov });
            }
          });
        }
      }).catch(err => {
        console.warn('Could not hydrate provider in onboarding:', err);
      });
    }
  }, [state.provider?.slug, dispatch]);

  useEffect(() => {
    if (merchantEmail || !isSupabaseConfigured()) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setMerchantEmail(user.email.toLowerCase());
    }).catch(() => null);
  }, [merchantEmail]);

  useEffect(() => {
    const refreshGoogleStatus = async () => {
      const status = await realGoogleCalendarService.getStatus(state.provider?.id);
      setGoogleStatus({ ...status, isConnected: Boolean(status.hostAccessReady) });
      if (status.isConnected) {
        dispatch({ type: ACTIONS.CONNECT_GOOGLE_CALENDAR, payload: status });
      }
    };
    refreshGoogleStatus();
  }, [state.provider?.id, dispatch]);

  useEffect(() => {
    const result = searchParams.get('calendar');
    if (!result) return;
    if (result === 'connected') addToast('Google Calendar and Meet connected.');
    else if (result === 'account_mismatch') addToast('Connect the Google account that matches the host email.', 'error');
    else addToast('Google connection was not completed. Please try again.', 'error');
    navigate('/onboarding', { replace: true });
  }, [searchParams, addToast, navigate]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      addToast('Profile image must be under 5MB.', 'error');
      return;
    }

    setUploadingAvatar(true);
    try {
      const url = await dbService.uploadAvatar(state.provider?.id, file);
      if (url) {
        setAvatarUrl(url);
        dispatch({
          type: ACTIONS.UPDATE_PROVIDER,
          payload: { avatar: url, avatarUrl: url },
        });
        addToast('Profile photo added ✓');
      }
    } catch (err) {
      console.error('Failed to upload avatar in onboarding:', err);
      addToast(err.message || 'Failed to upload photo.', 'error');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const nextStep = async () => {
    setStepError('');
    if (step === 0) {
      if (!businessName.trim() || businessName.trim().length < 2) {
        setStepError('Please enter your business or studio name.');
        return;
      }
    }
    if (step === 0) {
      if (!providerName.trim() || providerName.trim().length < 2) {
        setStepError('Please enter your full name.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merchantEmail.trim())) {
        setStepError('Enter the Google email that should host your Calendar events and Meet links.');
        return;
      }
      const digits = phone.replace(/\D/g, '').replace(/^91(?=[6-9]\d{9}$)/, '');
      if (!/^[6-9]\d{9}$/.test(digits)) {
        setStepError('Enter a valid 10-digit Indian mobile number.');
        return;
      }
    }
    if (step === 2) {
      if (!bio.trim() || bio.trim().length < 20) {
        setStepError('Bio must be at least 20 characters to introduce yourself to clients.');
        return;
      }
    }
    if (step === 1) {
      if (billing.legalName.trim().length < 2 || billing.addressLine1.trim().length < 5 || billing.city.trim().length < 2 || billing.state.trim().length < 2 || !/^[1-9]\d{5}$/.test(billing.postalCode)) {
        setStepError('Enter your legal name, full address, city, state, and a valid six-digit PIN code.');
        return;
      }
      if (billing.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(billing.gstin)) {
        setStepError('Enter a valid GSTIN or leave it blank.');
        return;
      }
    }
    if (step === 3) {
      if (!service.name.trim() || service.name.trim().length < 3) {
        setStepError('Service name must be at least 3 characters.');
        return;
      }
      if (!service.description.trim() || service.description.trim().length < 15) {
        setStepError('Service description must be at least 15 characters so clients know what they are booking.');
        return;
      }
      if (service.meetingType !== 'online' && !service.locationAddress.trim()) {
        setStepError('Enter the address used for in-person appointments.');
        return;
      }
    }
    if (step === 6) {
      if (!identityStatus.emailVerified) {
        setStepError('Email verification is required before continuing.');
        return;
      }
      if (!identityStatus.phoneVerified) {
        setStepError('SMS verification is required before continuing.');
        return;
      }
    }
    if (step < TOTAL_STEPS - 1) {
      setIsSaving(true);
      try {
        if (step === 1 && isSupabaseConfigured()) setBilling(await subscriptionService.saveBillingProfile(billing));
        const next = WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1];
        if (isSupabaseConfigured()) await onboardingService.saveDraft(draftPayload(), next);
        setStep(next);
      } catch (error) {
        if (step === 1 && error.code === 'VERSION_CONFLICT') {
          try {
            const latest = await subscriptionService.get();
            if (latest.billingProfile) setBilling(latest.billingProfile);
            setStepError('Billing details were already saved or changed in another tab. We loaded the latest details; review them and click Next step again.');
          } catch {
            setStepError('Could not reload billing details. Refresh the page before trying again.');
          }
          return;
        }
        setStepError(error.message || 'Could not save your setup progress.');
      } finally {
        setIsSaving(false);
      }
    }
  };

/* Disabled navigation enhancement (user request):
  const saveAndExit = async (switchAccount = false) => {
    if (isSaving || isLoading || isConnectingGoogle) return;
    setIsSaving(true);
    setStepError('');
    try {
      if (!isSupabaseConfigured()) throw new Error('Setup cannot be saved while the server is unavailable.');
      if (step === 1) setBilling(await subscriptionService.saveBillingProfile(billing));
      await onboardingService.saveDraft(draftPayload(), Math.min(step, 6));
      if (switchAccount) {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
        dispatch({ type: ACTIONS.LOGOUT });
      }
      addToast('Setup progress saved. You can resume after signing in.');
      navigate(switchAccount ? '/login' : '/');
    } catch (error) { setStepError(error.message || 'Could not save setup. You are still on this page.'); }
    finally { setIsSaving(false); }
  };


*/
  const prevStep = () => {
    setStepError('');
    if (step > 0) setStep(WIZARD_STEPS[WIZARD_STEPS.indexOf(step) - 1]);
  };

  const finishOnboarding = async () => {
    setStepError('');
    setIsSaving(true);
    try {
      const result = isSupabaseConfigured()
        ? await onboardingService.complete(draftPayload())
        : { completed: true, publishReady: false, missing: ['calup_access'] };
      setCompletionResult(result);
      setIdentityStatus(result.identity || identityStatus);
      setGoogleStatus(current => ({ ...current, isConnected: Boolean(result.google?.ready ?? current.isConnected), email: result.google?.email || current.email }));
      setEntitlementStatus(result.entitlement || entitlementStatus);
      dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: {
        name: providerName, businessName, email: merchantEmail.trim().toLowerCase(), phone, bio,
      } });
      dispatch({ type: ACTIONS.COMPLETE_ONBOARDING });
      setStep(TOTAL_STEPS);
    } catch (error) {
      setStepError(error.message || 'Setup could not be completed. Your progress is saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const sendPhoneOtp = async () => {
    const digits = phone.replace(/\D/g, '').replace(/^91(?=[6-9]\d{9}$)/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setStepError('Enter a valid 10-digit Indian mobile number first.');
      return;
    }
    setIsVerifyingPhone(true);
    setStepError('');
    try {
      await onboardingService.saveDraft(draftPayload(), step);
      const result = await onboardingService.sendPhoneVerification();
      setPhone(digits);
      if (result.verified) {
        setIdentityStatus(current => ({ ...current, phoneVerified: true }));
        setPhoneOtpSent(false);
        addToast('Mobile number is already verified.');
      } else {
        setPhoneOtpSent(true);
        addToast('Verification code sent by SMS.');
      }
    } catch (error) {
      setStepError(error.message || 'Could not send the SMS verification code.');
    } finally {
      setIsVerifyingPhone(false);
    }
  };

  const sendEmailVerification = async () => {
    if (!merchantEmail || !isSupabaseConfigured()) return;
    setIsVerifyingEmail(true);
    setStepError('');
    try {
      const result = await onboardingService.sendEmailVerification();
      if (result.verified) {
        setIdentityStatus(current => ({ ...current, emailVerified: true }));
        setEmailOtpSent(false);
        addToast('Email address is already verified.');
      } else {
        setEmailOtpSent(true);
        addToast('A 6-digit verification code was sent by email.', 'info');
      }
    } catch (error) {
      setStepError(error.message || 'Could not send the verification email.');
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  const verifyEmailOtp = async () => {
    if (!/^\d{6}$/.test(emailOtp)) {
      setStepError('Enter the 6-digit email verification code.');
      return;
    }
    setIsVerifyingEmail(true);
    setStepError('');
    try {
      await onboardingService.verifyEmail(emailOtp);
      setIdentityStatus(current => ({ ...current, emailVerified: true }));
      setEmailOtpSent(false);
      setEmailOtp('');
      addToast('Email address verified.');
    } catch (error) {
      setStepError(error.message || 'The email verification code was not accepted.');
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  const verifyPhoneOtp = async () => {
    if (!/^\d{4,8}$/.test(phoneOtp)) {
      setStepError('Enter the numeric SMS verification code.');
      return;
    }
    setIsVerifyingPhone(true);
    setStepError('');
    try {
      await onboardingService.verifyPhone(phoneOtp);
      setIdentityStatus(current => ({ ...current, phoneVerified: true }));
      setPhoneOtpSent(false);
      setPhoneOtp('');
      addToast('Mobile number verified.');
    } catch (error) {
      setStepError(error.message || 'The SMS verification code was not accepted.');
    } finally {
      setIsVerifyingPhone(false);
    }
  };

  const connectGoogle = async () => {
    // Open during the click event, before asynchronous draft saving, to avoid popup blockers.
    const popup = window.open('about:blank', 'calup-google-connect', 'popup,width=560,height=720');
    if (!popup) {
      addToast('Allow popups for Calup, then try connecting Google again.', 'error');
      return;
    }
    setIsConnectingGoogle(true);
    try {
      if (isSupabaseConfigured()) await onboardingService.saveDraft(draftPayload(), step);
      await realGoogleCalendarService.connect({ returnTo: 'onboarding', popup });
      const status = await realGoogleCalendarService.getStatus(state.provider?.id);
      setGoogleStatus({ ...status, isConnected: Boolean(status.hostAccessReady) });
      if (!status.hostAccessReady) throw new Error('Google connection is not ready. Reconnect using your verified business email.');
      dispatch({ type: ACTIONS.CONNECT_GOOGLE_CALENDAR, payload: status });
      addToast('Google Calendar and Meet connected.');
    } catch (err) {
      if (!popup.closed) popup.close();
      addToast(err.message || 'Could not start Google connection.', 'error');
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  const testGoogle = async () => {
    setIsTestingGoogle(true);
    try {
      const result = await realGoogleCalendarService.testConnection();
      setGoogleStatus({ isConnected: true, email: result.email, capabilities: result.capabilities });
      addToast('Google Calendar availability and Meet permissions are ready.');
    } catch (err) {
      addToast(err.message || 'Google connection test failed.', 'error');
    } finally {
      setIsTestingGoogle(false);
    }
  };

  const goToDashboard = () => {
    addToast(completionResult?.publishReady ? 'Welcome to CalUp! Your booking page is live.' : 'Setup saved. Complete the remaining activation checks from your dashboard.');
    navigate('/dashboard');
  };

  const renderStepContent = () => {
    switch (step) {
      case 0:
        return (
          <div className="calup-auth-setup-form">
            <div className="calup-auth-heading calup-auth-heading--left calup-auth-heading--edit">
              <span>Your business starts with you</span>
              <h1>A little hello.<br />A whole lot of possibility.</h1>
              <p>Review your saved details and give your expertise a home.</p>
            </div>
            <div className="calup-auth-form">
            <div className="calup-auth-field-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="onboarding-business">Business or studio name</label>
              <input id="onboarding-business" className="form-input"
                value={businessName} onChange={event => setBusinessName(event.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="onboarding-name">Full name</label>
              <input
                id="onboarding-name"
                className="form-input"
                placeholder="e.g. Priya Sharma"
                value={providerName}
                onChange={event => {
                  const name = event.target.value;
                  setProviderName(name);
                  if (!billingNameEdited.current) {
                    setBilling(current => current.version ? current : { ...current, legalName: name });
                  }
                }}
                autoFocus
              />
            </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="onboarding-merchant-email">Business email</label>
              <input id="onboarding-merchant-email" className="form-input" type="email"
                value={merchantEmail} aria-describedby="onboarding-email-hint"
                onChange={event => {
                  setMerchantEmail(event.target.value.trimStart());
                  setIdentityStatus(current => ({ ...current, emailVerified: false }));
                  setEmailOtp('');
                  setEmailOtpSent(false);
                  setGoogleStatus(current => ({ ...current, isConnected: false, hostAccessReady: false }));
                }} />
              <span id="onboarding-email-hint" className="form-hint">This business email receives the Calup verification code and must match the Google account used for Calendar and Meet.</span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="onboarding-phone">Merchant mobile number</label>
              <input id="onboarding-phone" className="form-input" inputMode="numeric"
                placeholder="10-digit mobile number" value={phone}
                onChange={event => {
                  setPhone(event.target.value.replace(/\D/g, '').slice(0, 10));
                  setIdentityStatus(current => ({ ...current, phoneVerified: false }));
                  setPhoneOtp('');
                  setPhoneOtpSent(false);
                }} autoComplete="tel-national" />
              <span className="form-hint">Confirm the number here. SMS verification happens on the integrations step.</span>
            </div>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="calup-auth-setup-form">
            <div className="calup-auth-heading calup-auth-heading--left">
              <span>For your records</span>
              <h1>Your billing details.</h1>
              <p>Use the legal name and address you want on your Calup subscription receipts.</p>
            </div>
            <div className="calup-auth-form">
              {[
                ['legalName', 'Legal name', 160],
                ['addressLine1', 'Address line 1', 240],
                ['addressLine2', 'Address line 2 (optional)', 240],
                ['city', 'City', 100],
                ['state', 'State / Union territory', 100],
                ['postalCode', 'PIN code', 6],
                ['gstin', 'GSTIN (optional)', 15],
              ].map(([key, label, maxLength]) => (
                <label key={key} htmlFor={`onboarding-billing-${key}`}>{label}
                  <input id={`onboarding-billing-${key}`} value={billing[key] || ''}
                    maxLength={maxLength} inputMode={key === 'postalCode' ? 'numeric' : 'text'}
                    required={!['addressLine2', 'gstin'].includes(key)} disabled={isSaving}
                    onChange={event => {
                      let value = event.target.value;
                      if (key === 'legalName') billingNameEdited.current = true;
                      if (key === 'postalCode') value = value.replace(/\D/g, '');
                      if (key === 'gstin') value = value.replace(/\s/g, '').toUpperCase();
                      setBilling(current => ({ ...current, [key]: value }));
                    }} />
                </label>
              ))}
              <span className="calup-auth-field-hint">GSTIN is optional. Format validation does not verify GST registration.</span>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="onb-step animate-fade-in-up">
            <h2>Tell clients about yourself</h2>
            <p>A short bio that appears on your booking page.</p>
            <div className="onb-avatar-section">
              <div
                className="avatar avatar-xl"
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  background: 'var(--theme-input-bg)',
                  border: '2px solid var(--color-lime)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '22px',
                  color: 'var(--color-text)',
                  margin: '0 auto',
                }}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt={providerName || 'Coach'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  getInitials(providerName)
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <input
                  type="file"
                  aria-label="Profile photo"
                  ref={fileInputRef}
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleAvatarUpload}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                >
                  {uploadingAvatar ? 'Uploading...' : (avatarUrl ? 'Change Photo' : 'Upload Profile Photo')}
                </button>
                <span className="onb-avatar-hint">JPG, PNG, or WebP up to 5MB</span>
              </div>
            </div>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <label className="form-label" htmlFor="onboarding-bio" style={{ margin: 0 }}>Your Bio</label>
                <span style={{ fontSize: 'var(--font-size-xs)', color: bio.length >= 20 ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
                  {bio.length}/20 min chars
                </span>
              </div>
              <textarea
                id="onboarding-bio"
                aria-describedby="onboarding-bio-hint"
                className="form-input form-textarea"
                placeholder="e.g. Certified personal trainer with 6+ years of experience helping busy professionals achieve lasting fitness and posture strength."
                value={bio}
                onChange={e => {
                  setBio(e.target.value);
                  if (stepError && e.target.value.trim().length >= 20) setStepError('');
                }}
                rows={4}
              />
              <span id="onboarding-bio-hint" className="form-hint">At least 20 characters required. Helps clients trust your expertise.</span>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="onb-step animate-fade-in-up">
            <h2>Create your first service</h2>
            <p>You can add more services later from your dashboard.</p>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label className="form-label" htmlFor="onboarding-service-name">Service name</label>
                <span style={{ fontSize: 'var(--font-size-xs)', color: service.name.length >= 3 ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
                  min 3 chars
                </span>
              </div>
              <input id="onboarding-service-name"
                className="form-input"
                placeholder="e.g. Personal Training Session"
                value={service.name}
                onChange={e => {
                  setService({ ...service, name: e.target.value });
                  if (stepError && e.target.value.trim().length >= 3) setStepError('');
                }}
              />
            </div>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label className="form-label" htmlFor="onboarding-service-description">Description</label>
                <span style={{ fontSize: 'var(--font-size-xs)', color: service.description.length >= 15 ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
                  {service.description.length}/15 min chars
                </span>
              </div>
              <textarea id="onboarding-service-description"
                className="form-input form-textarea"
                placeholder="e.g. Comprehensive 1-on-1 session covering goal setting, fitness assessment, and customized workout plan."
                value={service.description}
                onChange={e => {
                  setService({ ...service, description: e.target.value });
                  if (stepError && e.target.value.trim().length >= 15) setStepError('');
                }}
                rows={3}
              />
              <span className="form-hint">Minimum 15 characters. Clear descriptions result in higher booking conversions.</span>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="onboarding-service-price">Price (₹)</label>
                <input id="onboarding-service-price"
                  className="form-input"
                  type="number"
                  min="0"
                  value={service.price}
                  onChange={e => setService({ ...service, price: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="onboarding-service-duration">Duration (minutes)</label>
                <input id="onboarding-service-duration"
                  className="form-input"
                  type="number"
                  min="15"
                  step="15"
                  value={service.duration}
                  onChange={e => setService({ ...service, duration: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="onboarding-service-mode">How is this service delivered?</label>
              <select id="onboarding-service-mode" className="form-input" value={service.meetingType} onChange={e => setService({ ...service, meetingType: e.target.value })}>
                <option value="online">Online with Google Meet</option>
                <option value="in-person">In person</option>
                <option value="both">Online or in person</option>
              </select>
            </div>
            {service.meetingType !== 'online' && (
              <div className="form-group">
                <label className="form-label" htmlFor="onboarding-service-address">Service address</label>
                <textarea id="onboarding-service-address" className="form-input form-textarea" value={service.locationAddress} onChange={e => setService({ ...service, locationAddress: e.target.value })} placeholder="Full address customers should visit" rows={2} />
              </div>
            )}
            {service.name && (
              <div className="onb-service-preview">
                <strong>{service.name}</strong> — {formatCurrency(Number(service.price))} — {service.duration} min
                {' '}? {service.meetingType === 'online' ? 'Google Meet' : service.meetingType === 'in-person' ? 'In person' : 'Online or in person'}
              </div>
            )}
          </div>
        );

      case 4:
        return (
          <div className="onb-step animate-fade-in-up">
            <h2>Set your availability</h2>
            <p>Choose when clients can book appointments with you.</p>
            <div className="onb-availability">
              {DAYS_OF_WEEK.map(day => (
                <div className="onb-day-row" key={day}>
                  <label className="form-checkbox-group">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={availability[day].available}
                      onChange={e => setAvailability({
                        ...availability,
                        [day]: { ...availability[day], available: e.target.checked }
                      })}
                    />
                    <span className="onb-day-label">{DAY_FULL_LABELS[day]}</span>
                  </label>
                  {availability[day].available ? (
                    <div className="onb-time-range">
                      <input
                        type="time"
                        className="form-input onb-time-input"
                        aria-label={`${DAY_FULL_LABELS[day]} opening time`}
                        value={availability[day].start}
                        onChange={e => setAvailability({
                          ...availability,
                          [day]: { ...availability[day], start: e.target.value }
                        })}
                      />
                      <span>to</span>
                      <input
                        type="time"
                        className="form-input onb-time-input"
                        aria-label={`${DAY_FULL_LABELS[day]} closing time`}
                        value={availability[day].end}
                        onChange={e => setAvailability({
                          ...availability,
                          [day]: { ...availability[day], end: e.target.value }
                        })}
                      />
                    </div>
                  ) : (
                    <span className="onb-unavailable">Unavailable</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );

      case 5:
        return (
          <div className="onb-step animate-fade-in-up">
            <h2>Booking rules</h2>
            <p>Set how far in advance clients can book and other scheduling preferences.</p>
            <div className="form-group">
              <label className="form-label" htmlFor="onboarding-min-notice">Minimum scheduling notice</label>
              <div className="onb-input-with-unit">
                <input id="onboarding-min-notice" aria-describedby="onboarding-min-notice-unit"
                  className="form-input"
                  type="number"
                  min="0"
                  value={bookingRules.minNotice}
                  onChange={e => setBookingRules({ ...bookingRules, minNotice: Number(e.target.value) })}
                />
                <span id="onboarding-min-notice-unit" className="onb-unit">hours</span>
              </div>
              <span className="form-hint">How much notice do you need before an appointment?</span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="onboarding-max-advance">Maximum advance booking</label>
              <div className="onb-input-with-unit">
                <input id="onboarding-max-advance" aria-describedby="onboarding-max-advance-unit"
                  className="form-input"
                  type="number"
                  min="1"
                  value={bookingRules.maxAdvanceBooking}
                  onChange={e => setBookingRules({ ...bookingRules, maxAdvanceBooking: Number(e.target.value) })}
                />
                <span id="onboarding-max-advance-unit" className="onb-unit">days</span>
              </div>
              <span className="form-hint">How far in advance can clients book?</span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="onboarding-buffer">Buffer time between appointments</label>
              <div className="onb-input-with-unit">
                <input id="onboarding-buffer" aria-describedby="onboarding-buffer-unit"
                  className="form-input"
                  type="number"
                  min="0"
                  max="240"
                  step="5"
                  value={bookingRules.bufferTime}
                  onChange={e => setBookingRules({ ...bookingRules, bufferTime: Number(e.target.value) })}
                />
                <span id="onboarding-buffer-unit" className="onb-unit">minutes</span>
              </div>
              <span className="form-hint">Available starts advance by the service duration plus this break.</span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="onboarding-cancellation">Cancellation window</label>
              <div className="onb-input-with-unit">
                <input id="onboarding-cancellation" aria-describedby="onboarding-cancellation-unit"
                  className="form-input"
                  type="number"
                  min="0"
                  value={bookingRules.cancellationWindow}
                  onChange={e => setBookingRules({ ...bookingRules, cancellationWindow: Number(e.target.value) })}
                />
                <span id="onboarding-cancellation-unit" className="onb-unit">hours before appointment</span>
              </div>
              <span className="form-hint">Cancellations after this window are considered "late"</span>
            </div>
          </div>
        );

      case 6:
        return (
          <div className="onb-step animate-fade-in-up">
            <IntegrationSheet
              googleStatus={googleStatus}
              merchantEmail={merchantEmail}
              phone={phone}
              phoneOtp={phoneOtp}
              phoneOtpSent={phoneOtpSent}
              emailOtp={emailOtp}
              emailOtpSent={emailOtpSent}
              identityStatus={identityStatus}
              connectingGoogle={isConnectingGoogle}
              testingGoogle={isTestingGoogle}
              verifyingEmail={isVerifyingEmail}
              verifyingPhone={isVerifyingPhone}
              onConnectGoogle={connectGoogle}
              onTestGoogle={testGoogle}
              onSendEmailOtp={sendEmailVerification}
              onVerifyEmailOtp={verifyEmailOtp}
              onEmailOtpChange={value => setEmailOtp(value.replace(/\D/g, '').slice(0, 6))}
              onSendPhoneOtp={sendPhoneOtp}
              onVerifyPhoneOtp={verifyPhoneOtp}
              onPhoneChange={value => {
                setPhone(value.replace(/\D/g, '').slice(0, 10));
                setIdentityStatus(current => ({ ...current, phoneVerified: false }));
                setPhoneOtp('');
                setPhoneOtpSent(false);
              }}
              onPhoneOtpChange={value => setPhoneOtp(value.replace(/\D/g, '').slice(0, 8))}
            />
            {service.meetingType === 'in-person' && <span className="form-hint">Google remains optional for an in-person-only service.</span>}
          </div>
        );

      case 7:
        return (
          <div className="onb-step animate-fade-in-up">
            <h2>Review your setup</h2>
            <p>Saving setup creates one draft service under you, the default merchant instructor.</p>
            <div className="onb-policy-preview" style={{ padding: 16 }}>
              <p><strong>{businessName}</strong> ? {providerName}</p>
              <p>{service.name} ? {formatCurrency(Number(service.price) || 0)} ? {service.duration} minutes</p>
              <p>{DAYS_OF_WEEK.filter(day => availability[day]?.available).length} working days ? {bookingRules.bufferTime} minute buffer</p>
            </div>
            <div className="onb-reminder-list">
              {[
                ['Email verified', identityStatus.emailVerified],
                ['Mobile verified by SMS', identityStatus.phoneVerified],
                ['Google Calendar ready', service.meetingType === 'in-person' || googleStatus.isConnected],
                ['Calup access active', entitlementStatus.active],
              ].map(([label, ready]) => (
                <div className="onb-reminder-item" key={label}>
                  <span className="onb-reminder-label">{label}</span>
                  <strong style={{ color: ready ? 'var(--color-success-600)' : 'var(--color-warning-600)' }}>{ready ? 'Ready' : 'Required before publishing'}</strong>
                </div>
              ))}
            </div>
            <span className="form-hint">You may save setup before activation. The service stays private until every required check passes.</span>
          </div>
        );

      default:
        return null;
    }
  };

  if (isLoading) {
    return <SetupShell step={1} totalSteps={WIZARD_STEPS.length} title="Loading your setup" description="Restoring your saved onboarding progress." loading />;
  }

  // Completion screen
  if (step === TOTAL_STEPS) {
    const publishReady = Boolean(completionResult?.publishReady);
    const missing = completionResult?.missing || [];
    return (
      <div className="onb-page">
        <div className="onb-completion animate-fade-in-up">
          <div className="onb-completion-icon" aria-hidden="true">OK</div>
          <h2>{publishReady ? 'Your booking page is ready!' : 'Your setup is saved'}</h2>
          <p>{publishReady ? 'Customers can now book your service. Calup protects availability and creates merchant-hosted Meet links.' : 'Your service remains private until the activation checks below are complete.'}</p>
          <div className="onb-link-display" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <strong>{publishReady ? 'All checks passed' : missing.length + ' activation check' + (missing.length === 1 ? '' : 's') + ' remaining'}</strong>
            {missing.includes('phone_verification') && <span>Verify the merchant mobile number by SMS.</span>}
            {missing.includes('google_calendar') && <span>Connect and test the Google host account.</span>}
            {missing.includes('calup_access') && <span>Activate a subscription or redeem a Calup access code.</span>}
            {missing.includes('email_verification') && <span>Verify the login email.</span>}
          </div>
          <div className="onb-link-display"><span className="onb-link-url" style={{ wordBreak: 'break-all' }}>{getBookingUrl(slug)}</span></div>
          <div className="onb-completion-actions">
            <button className="btn btn-primary btn-lg" onClick={goToDashboard}>Open Dashboard</button>
            {missing.includes('calup_access') && <button className="btn btn-secondary btn-lg" onClick={() => navigate('/dashboard/subscription')}>Activate Calup access</button>}
            {missing.includes('phone_verification') && <button className="btn btn-secondary btn-lg" onClick={() => setStep(6)}>Verify mobile</button>}
            <button className="btn btn-secondary btn-lg" onClick={() => navigate('/book/' + slug)} disabled={!publishReady}>Open Booking Page</button>
            {publishReady && <a className="btn btn-whatsapp" href={`https://wa.me/?text=${encodeURIComponent(getBookingUrl(slug))}`} target="_blank" rel="noopener noreferrer">Share to WhatsApp</a>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <SetupShell
      step={WIZARD_STEPS.indexOf(step)}
      totalSteps={WIZARD_STEPS.length}
      title={STEP_DETAILS[step][0]}
      description={STEP_DETAILS[step][1]}
      footer={(
        <>
          <div className="setup-footer-actions">
            {step > 0 ? (
              <button className="setup-previous-button" onClick={prevStep} disabled={isSaving}>
                <ArrowLeft size={17} /> Previous step
              </button>
            ) : (
              <span className="setup-footer-note"><ShieldCheck size={15} /> Made for your next chapter.</span>
            )}
            <div>
              {step < TOTAL_STEPS - 1 ? (
                <button className="setup-next-button" onClick={nextStep} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Next step'} <ArrowRight size={17} />
                </button>
              ) : (
                <button className="setup-next-button" onClick={finishOnboarding} disabled={isSaving}>
                  {isSaving ? 'Saving setup...' : 'Finish setup'} <ArrowRight size={17} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    >
        <div className="onb-wizard-content">
          {renderStepContent()}
        </div>

    </SetupShell>
  );
}


/* Disabled navigation enhancement (user request):
      headerAction={<nav className="calup-auth-navigation" aria-label="Setup navigation">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => saveAndExit()} disabled={isSaving || isLoading || isConnectingGoogle}>Save and exit</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => saveAndExit(true)} disabled={isSaving || isLoading || isConnectingGoogle}>Save and switch account</button>
      </nav>}

*/

/* Disabled navigation enhancement (user request):
window.open('https://wa.me/?text=' + encodeURIComponent('Book a session with me: ' + url), '_blank', 'noopener,noreferrer');
*/
