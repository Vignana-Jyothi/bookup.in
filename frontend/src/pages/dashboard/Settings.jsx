/**
 * CalUp — Settings Page
 * Profile, Profile Completeness, Google Calendar, WhatsApp Reminders, and Account
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useStore } from '../../data/store';
import { ACTIONS } from '../../data/actions';
import { getInitials, generateSlug } from '../../utils/helpers';
import { realGoogleCalendarService } from '../../services/calendar/RealGoogleCalendarProvider';
import { supabase, isSupabaseConfigured } from '../../services/supabase/supabaseClient';
import { dbService } from '../../services/supabase/dbService';
import { passwordService, PASSWORD_REQUIREMENTS } from '../../services/supabase/passwordService.js';
import PillButton from '../../components/ui/PillButton';
import { usePopupFeedback } from '../../hooks/usePopupFeedback.js';

export default function Settings() {
  const { state, dispatch, addToast } = useStore();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const provider = state.provider || {};
  const gcal = state.googleCalendar || { isConnected: false, email: null };

  const [name, setName] = useState(provider.name || '');
  const [businessName, setBusinessName] = useState(provider.businessName || '');
  const [bio, setBio] = useState(provider.bio || '');
  const [email, setEmail] = useState(provider.email || '');
  const [phone, setPhone] = useState(provider.phone || '');
  const [avatar, setAvatar] = useState(provider.avatar || provider.avatarUrl || null);
  const [defaultLocationAddress, setDefaultLocationAddress] = useState(provider.defaultLocationAddress || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState('');
  const [paymentSaveError, setPaymentSaveError] = useState('');
  const avatarInputRef = useRef(null);
  const [bioError, setBioError] = useState('');
  const [profileErrors, setProfileErrors] = useState({});
  const [paymentErrors, setPaymentErrors] = useState({});
  const [isConnectingGcal, setIsConnectingGcal] = useState(false);
  const [isTestingGcal, setIsTestingGcal] = useState(false);
  const [isDisconnectingGcal, setIsDisconnectingGcal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirmation: '' });
  const [changingPassword, setChangingPassword] = useState(false);
  const [, setPasswordError] = usePopupFeedback();
  const [, setPasswordSuccess] = usePopupFeedback('', 'success');

  const changePassword = async event => {
    event.preventDefault();
    setPasswordError(''); setPasswordSuccess('');
    if (passwordForm.next !== passwordForm.confirmation) { setPasswordError('The new passwords do not match.'); return; }
    setChangingPassword(true);
    try {
      await passwordService.changePassword(passwordForm.current, passwordForm.next);
      setPasswordForm({ current: '', next: '', confirmation: '' });
      setPasswordSuccess('Your password has been changed.');
    } catch (error) { setPasswordError(error.message); }
    finally { setChangingPassword(false); }
  };

  // Payment settings state
  const [upiId, setUpiId] = useState(provider.upiId || '');
  const [qrCodeUrl, setQrCodeUrl] = useState(provider.qrCodeUrl || null);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const qrInputRef = useRef(null);

  // Sync state if provider is hydrated from Supabase
  useEffect(() => {
    if (state.provider) {
      if (state.provider.name && !name) setName(state.provider.name);
      if (state.provider.businessName && !businessName) setBusinessName(state.provider.businessName);
      if (state.provider.bio && !bio) setBio(state.provider.bio);
      if (state.provider.email && !email) setEmail(state.provider.email);
      if (state.provider.phone && !phone) setPhone(state.provider.phone);
      if ((state.provider.avatar || state.provider.avatarUrl) && !avatar) {
        setAvatar(state.provider.avatar || state.provider.avatarUrl);
      }
      if (state.provider.defaultLocationAddress && !defaultLocationAddress) {
        setDefaultLocationAddress(state.provider.defaultLocationAddress);
      }
      if (state.provider.upiId && !upiId) setUpiId(state.provider.upiId);
      if (state.provider.qrCodeUrl && !qrCodeUrl) setQrCodeUrl(state.provider.qrCodeUrl);
    }
  }, [state.provider]);

  // Handle return redirect from Google OAuth callback
  useEffect(() => {
    const calendarResult = searchParams.get('calendar');

    if (calendarResult === 'connected') {
      addToast('Connected to Google Calendar ✓');
      navigate('/dashboard/settings', { replace: true });
    } else if (calendarResult === 'account_mismatch') {
      addToast('Connect the Google account that matches your merchant email.', 'error');
      navigate('/dashboard/settings', { replace: true });
    } else if (calendarResult === 'error') {
      addToast('Google Calendar connection failed. Please try again.', 'error');
      navigate('/dashboard/settings', { replace: true });
    }
  }, [searchParams, dispatch, addToast, navigate]);

  // Synchronize calendar connection state with backend on mount
  useEffect(() => {
    const checkServerStatus = async () => {
      const providerId = provider?.id || 'provider-1';
      const status = await realGoogleCalendarService.getStatus(providerId);
      if (status.isConnected && (!gcal.isConnected || gcal.email !== status.email)) {
        dispatch({
          type: ACTIONS.CONNECT_GOOGLE_CALENDAR,
          payload: status,
        });
      } else if (!status.isConnected && gcal.isConnected) {
        dispatch({ type: ACTIONS.DISCONNECT_GOOGLE_CALENDAR });
      }
    };
    checkServerStatus().catch(() => { /* Keep the last verified connection state when status is unavailable. */ });
  }, [provider?.id, provider?.email, dispatch, gcal.isConnected, gcal.email]);

  // Profile Completeness Calculation
  const hasName = Boolean(name.trim().length >= 2);
  const hasBiz = Boolean(businessName.trim().length >= 2);
  const hasBio = Boolean(bio.trim().length >= 20);
  const hasContact = Boolean(email.trim() && phone.trim());
  const hasServices = Boolean(state.services?.some(s => s.isActive && s.name && s.description));

  const completenessScore = [hasName, hasBiz, hasBio, hasContact, hasServices].filter(Boolean).length * 20;

  const completenessNudges = [];
  if (!hasBio) completenessNudges.push('Add a descriptive bio (min 20 chars)');
  if (!hasBiz) completenessNudges.push('Add your studio or business name');
  if (!hasContact) completenessNudges.push('Complete your email & phone contact info');
  if (!hasServices) completenessNudges.push('Add at least one active service');

  const persistProvider = async (fields, id = provider.id) => {
    if (state.auth?.isDemoMode) return;
    if (!isSupabaseConfigured() || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) throw new Error('Reconnect your merchant account before saving.');
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Your sign-in could not be verified. Sign in again and retry.');
    const saved = await dbService.updateProviderProfile(id, fields);
    if (!saved) throw new Error('Your changes were not saved. Please retry.');
  };

  const handleAvatarFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      addToast('Profile image must be under 5MB.', 'error');
      return;
    }

    setUploadingAvatar(true);
    try {
      const url = await dbService.uploadAvatar(provider.id, file);
      if (url) {
        await persistProvider({ avatarUrl: url });
        setAvatar(url);
        dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: { avatar: url, avatarUrl: url } });
        addToast('Profile photo updated ✓');
      }
    } catch (err) {
      console.error('Failed to upload avatar:', err);
      addToast(err.message || 'Failed to upload image.', 'error');
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    if (uploadingAvatar) return;
    setUploadingAvatar(true);
    try {
      await persistProvider({ avatarUrl: null });
      setAvatar(null);
      dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: { avatar: null, avatarUrl: null } });
      addToast('Profile photo removed.');
    } catch (error) { addToast(error.message || 'Could not remove the photo. Please retry.', 'error'); }
    finally { setUploadingAvatar(false); }
  };

  const handleSaveProfile = async () => {
    if (savingProfile) return;
    setProfileSaveError('');
    const errors = {};
    if (!name || name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters';
    }
    if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Enter a valid email address';
    }
    if (phone && phone.trim()) {
      const cleanedPhone = phone.replace(/[\s\-()]/g, '');
      if (!/^(\+?91|0)?[6-9]\d{9}$/.test(cleanedPhone)) {
        errors.phone = 'Enter a valid phone number';
      }
    }
    if (bio.trim().length > 0 && bio.trim().length < 20) {
      errors.bio = 'Bio should be at least 20 characters to build trust with clients.';
    }

    if (Object.keys(errors).length > 0) {
      setProfileErrors(errors);
      if (errors.bio) setBioError(errors.bio);
      const firstKey = Object.keys(errors)[0];
      const el = document.getElementById(`settings-field-${firstKey}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      }
      addToast('Please fix the highlighted fields', 'error');
      return;
    }
    setProfileErrors({});
    setBioError('');

    setSavingProfile(true);
    try {
      const fields = { name, businessName, bio, email, phone, defaultLocationAddress: defaultLocationAddress.trim() || null };
      if (state.auth?.isDemoMode) {
        dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: fields });
        addToast('Demo profile updated on this device.', 'info');
        return;
      }
      if (!isSupabaseConfigured()) throw new Error('Reconnect your merchant account before saving.');
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) throw new Error('Your sign-in could not be verified. Sign in again; your edits are still here.');
      const existing = await dbService.getProviderByUserId(user.id);
      let saved;
      if (existing?.id) {
        await persistProvider(fields, existing.id);
        saved = { ...existing, ...fields };
      } else {
        const slug = `${generateSlug(businessName || name || 'provider')}-${user.id.slice(0, 5)}`;
        saved = await dbService.createProviderProfile({ userId: user.id, slug, ...fields });
        if (!saved?.id) throw new Error('Your profile was not saved. Please retry.');
      }
      dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: saved });
      addToast('Profile updated.');
    } catch (error) {
      setProfileSaveError(error.message || 'Could not save your profile. Your edits are still here; try again.');
      addToast(error.message || 'Could not save your profile.', 'error');
    } finally { setSavingProfile(false); }
  };

  const handleQrCodeUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      addToast('QR code image must be under 5MB.', 'error');
      return;
    }
    setUploadingQr(true);
    try {
      const activeProviderId = provider?.id;
      if (!state.auth?.isDemoMode && !activeProviderId) throw new Error('Reconnect your merchant account before uploading.');
      const url = await dbService.uploadQrCode(activeProviderId, file);
      if (url) {
        await persistProvider({ qrCodeUrl: url }, activeProviderId);
        setQrCodeUrl(url);
        dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: { qrCodeUrl: url } });
        addToast('QR code uploaded and saved ✓');
      }
    } catch (err) {
      addToast(err.message || 'Failed to upload QR code.', 'error');
    } finally {
      setUploadingQr(false);
      if (qrInputRef.current) qrInputRef.current.value = '';
    }
  };

  const handleSavePaymentSettings = async () => {
    const trimmedUpi = upiId.trim();
    if (trimmedUpi) {
      // Validate UPI ID format: username@bank
      const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
      if (!upiRegex.test(trimmedUpi)) {
        setPaymentErrors({ upiId: 'Enter a valid UPI ID (e.g. yourname@okhdfcbank or 9876543210@paytm)' });
        const el = document.getElementById('settings-field-upiId');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
        }
        addToast('Please enter a valid UPI ID', 'error');
        return;
      }
    }
    setPaymentErrors({});
    setPaymentSaveError('');
    setSavingPayment(true);
    try {
      await persistProvider({ upiId: trimmedUpi || null, qrCodeUrl: qrCodeUrl || null });
      dispatch({
        type: ACTIONS.UPDATE_PROVIDER,
        payload: { upiId: upiId.trim() || null, qrCodeUrl: qrCodeUrl || null },
      });
      addToast('Payment settings saved ✓');
    } catch (err) {
      setPaymentSaveError(err.message || 'Could not save payment settings. Your edits are still here; try again.');
      addToast(err.message || 'Failed to save payment settings.', 'error');
    } finally {
      setSavingPayment(false);
    }
  };

  const handleRemoveQr = async () => {
    if (uploadingQr || savingPayment) return;
    setUploadingQr(true); setPaymentSaveError('');
    try {
      await persistProvider({ qrCodeUrl: null });
      setQrCodeUrl(null);
      dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: { qrCodeUrl: null } });
      addToast('QR code removed.');
    } catch (error) { setPaymentSaveError(error.message || 'Could not remove your QR code. Please retry.'); }
    finally { setUploadingQr(false); }
  };

  const handleConnectGcal = async () => {
    setIsConnectingGcal(true);
    try {
      // Ensure provider profile exists in Supabase before requesting Google OAuth URL
      let providerId = provider?.id;
      if (isSupabaseConfigured()) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          let prov = await dbService.getProviderByUserId(authUser.id);
          if (!prov) {
            const pName = name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'Provider';
            const baseSlug = generateSlug(businessName || pName);
            const pSlug = `${baseSlug}-${authUser.id.slice(0, 5)}`;
            prov = await dbService.createProviderProfile({
              userId: authUser.id,
              name: pName,
              businessName: businessName || '',
              slug: pSlug,
              email: email || authUser.email,
              phone: phone || '',
              bio: bio || '',
            });
          } else if (email.trim() && prov.email !== email.trim().toLowerCase()) {
            await dbService.updateProviderProfile(prov.id, { email: email.trim().toLowerCase() });
            prov = { ...prov, email: email.trim().toLowerCase() };
          }
          if (prov?.id) {
            providerId = prov.id;
            dispatch({ type: ACTIONS.UPDATE_PROVIDER, payload: prov });
          }
        }
      }

      await realGoogleCalendarService.connect({ providerId: providerId || 'provider-1' });
    } catch (err) {
      console.error('Google OAuth init error:', err);
      addToast(err.message, 'error');
      setIsConnectingGcal(false);
    }
  };

  const handleDisconnectGcal = async () => {
    if (isDisconnectingGcal) return;
    setIsDisconnectingGcal(true);
    try {
      if (!provider?.id) throw new Error('Reconnect your merchant account before disconnecting Google.');
      await realGoogleCalendarService.disconnect(provider.id);
      dispatch({ type: ACTIONS.DISCONNECT_GOOGLE_CALENDAR });
      addToast('Google Calendar disconnected');
    } catch (error) { addToast(error.message || 'Could not disconnect Google. Please retry.', 'error'); }
    finally { setIsDisconnectingGcal(false); }
  };

  const handleTestGcal = async () => {
    setIsTestingGcal(true);
    try {
      const result = await realGoogleCalendarService.testConnection();
      addToast(`Google Calendar and Meet are ready for ${result.email}.`);
    } catch (err) {
      addToast(err.message || 'Google connection test failed.', 'error');
    } finally {
      setIsTestingGcal(false);
    }
  };

  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Profile Completeness Meter */}
      <div className="card card-padding" style={{ marginBottom: 'var(--space-6)', border: '1px solid var(--theme-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
          <div>
            <h4 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, margin: 0 }}>Profile Completeness</h4>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {completenessScore === 100
                ? ' Excellent! Your profile is complete and optimized for client trust.'
                : `Your profile is ${completenessScore}% complete — ${completenessNudges[0] || 'complete remaining steps'}`}
            </div>
          </div>
          <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, color: completenessScore === 100 ? 'var(--color-success-600)' : 'var(--color-primary-600)' }}>
            {completenessScore}%
          </div>
        </div>
        <div style={{ width: '100%', height: 8, background: 'var(--color-gray-100)', borderRadius: 999, overflow: 'hidden', marginTop: 'var(--space-3)' }}>
          <div style={{
            width: '100%', transform: `scaleX(${completenessScore / 100})`, transformOrigin: 'left',
            height: '100%',
            background: completenessScore === 100 ? 'var(--color-success-500)' : 'var(--color-primary-600)',
            transition: 'none',
          }} />
        </div>
      </div>

      {/* Profile */}
      <div className="card card-padding" style={{ marginBottom: 'var(--space-6)' }}>
        <h4 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-5)' }}>Profile</h4>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
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
              flexShrink: 0,
            }}
          >
            {avatar ? (
              <img src={avatar} alt={name || 'Coach'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              getInitials(name)
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input
                type="file"
                ref={avatarInputRef} aria-label="Profile photo file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={handleAvatarFileSelect}
              />
              <PillButton
                variant="primary"
                size="sm"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
              >
                {uploadingAvatar ? 'Uploading...' : (avatar ? 'Change Photo' : 'Upload Photo')}
              </PillButton>
              {avatar && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleRemoveAvatar}
                  disabled={uploadingAvatar}
                  style={{ fontSize: '12px', color: 'var(--color-error-600)' }}
                >
                  Remove
                </button>
              )}
            </div>
            <span style={{ fontSize: '11.5px', color: 'var(--theme-text-muted)' }}>
              JPG, PNG, or WebP up to 5MB.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 560 }}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="settings-field-name">Your name *</label>
              <input
                disabled={savingProfile} id="settings-field-name" aria-invalid={Boolean(profileErrors.name)} aria-describedby={profileErrors.name ? 'settings-error-name' : undefined}
                className={`form-input${profileErrors.name ? ' form-input-error' : ''}`}
                value={name}
                onChange={e => { setName(e.target.value); if (profileErrors.name) setProfileErrors(prev => ({ ...prev, name: '' })); }}
              />
              {profileErrors.name && <div id="settings-error-name" className="form-field-error" role="alert">{profileErrors.name}</div>}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="settings-field-businessName">Business name</label>
              <input
                disabled={savingProfile} id="settings-field-businessName"
                className="form-input"
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label className="form-label" htmlFor="settings-field-bio">Bio</label>
              <span style={{ fontSize: 'var(--font-size-xs)', color: bio.length >= 20 ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
                {bio.length}/20 min chars
              </span>
            </div>
            <textarea
              disabled={savingProfile} id="settings-field-bio" aria-invalid={Boolean(bioError)} aria-describedby="settings-bio-help"
              className={`form-input form-textarea ${bioError ? 'form-input-error' : ''}`}
              placeholder="e.g. Certified personal trainer helping busy professionals build strength and consistency."
              value={bio}
              onChange={e => {
                setBio(e.target.value);
                if (e.target.value.trim().length >= 20) setBioError('');
              }}
              rows={3}
            />
            {bioError ? (
              <span id="settings-bio-help" className="form-field-error" role="alert">{bioError}</span>
            ) : (
              <span id="settings-bio-help" className="form-hint">Brief intro displayed on your public booking page. Minimum 20 characters recommended.</span>
            )}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="settings-field-email">Merchant &amp; Google Calendar host email</label>
              <input
                disabled={savingProfile} id="settings-field-email" aria-invalid={Boolean(profileErrors.email)} aria-describedby={profileErrors.email ? 'settings-error-email' : undefined}
                className={`form-input${profileErrors.email ? ' form-input-error' : ''}`}
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); if (profileErrors.email) setProfileErrors(prev => ({ ...prev, email: '' })); }}
              />
              {profileErrors.email && <div id="settings-error-email" className="form-field-error" role="alert">{profileErrors.email}</div>}
              <span className="form-hint">
                Connect this same Google account below. Changing it requires reconnecting Google Calendar.
              </span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="settings-field-phone">Phone</label>
              <input
                disabled={savingProfile} id="settings-field-phone" aria-invalid={Boolean(profileErrors.phone)} aria-describedby={profileErrors.phone ? 'settings-error-phone' : undefined}
                className={`form-input${profileErrors.phone ? ' form-input-error' : ''}`}
                type="tel"
                value={phone}
                onChange={e => { setPhone(e.target.value); if (profileErrors.phone) setProfileErrors(prev => ({ ...prev, phone: '' })); }}
              />
              {profileErrors.phone && <div id="settings-error-phone" className="form-field-error" role="alert">{profileErrors.phone}</div>}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="settings-field-address">Business Address (Default Meeting Location)</label>
            <input
              disabled={savingProfile} id="settings-field-address"
              className="form-input"
              type="text"
              placeholder="e.g. 42 MG Road, Koramangala, Bengaluru, Karnataka"
              value={defaultLocationAddress}
              onChange={e => setDefaultLocationAddress(e.target.value)}
            />
            <span className="form-hint">Default physical address used for in-person appointments across your services.</span>
          </div>

            {profileSaveError && <p role="alert">{profileSaveError}</p>}
            <div style={{ marginTop: '8px' }}>
              <PillButton variant="primary" size="sm" onClick={handleSaveProfile} disabled={savingProfile}>
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </PillButton>
            </div>
          </div>
        </div>

      {/* Payment Settings (UPI) */}
      <div className="card card-padding" style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          
          <h4 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, margin: 0 }}>Payment Settings</h4>
        </div>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-5)' }}>
          Set up direct UPI payments so customers can pay you directly. CalUp tracks payment verification but never handles money.
        </p>

        {(!upiId && !qrCodeUrl) && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: '10px',
              color: '#92400E',
              fontSize: '13px',
              lineHeight: 1.5,
              marginBottom: 'var(--space-4)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
            }}
          >
            <span style={{ fontSize: '16px', flexShrink: 0 }}></span>
            <div>
              <strong>Payment details missing:</strong> You have not configured your UPI ID or QR code yet. Clients booking paid sessions will see a warning to contact you directly until you add your UPI details.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 560 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="settings-field-upiId">UPI ID</label>
            <input
              disabled={savingPayment || uploadingQr} id="settings-field-upiId" aria-invalid={Boolean(paymentErrors.upiId)} aria-describedby={paymentErrors.upiId ? 'settings-error-upiId' : undefined}
              className={`form-input${paymentErrors.upiId ? ' form-input-error' : ''}`}
              type="text"
              placeholder="e.g. yourname@upi"
              value={upiId}
              onChange={e => { setUpiId(e.target.value); if (paymentErrors.upiId) setPaymentErrors(prev => ({ ...prev, upiId: '' })); }}
            />
            {paymentErrors.upiId ? (
              <div id="settings-error-upiId" className="form-field-error" role="alert">{paymentErrors.upiId}</div>
            ) : (
              <span className="form-hint">Your UPI ID will be shown to customers on the booking confirmation page.</span>
            )}
          </div>

          <div className="form-group">
            <span className="form-label">Payment QR Code</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              {qrCodeUrl && (
                <div style={{
                  width: 100,
                  height: 100,
                  borderRadius: '12px',
                  overflow: 'hidden',
                  border: '1px solid var(--color-border)',
                  flexShrink: 0,
                }}>
                  <img src={qrCodeUrl} alt="QR Code" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="file"
                  ref={qrInputRef} aria-label="Payment QR code file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleQrCodeUpload}
                />
                <PillButton
                  variant="primary"
                  size="sm"
                  onClick={() => qrInputRef.current?.click()}
                  disabled={uploadingQr}
                >
                  {uploadingQr ? 'Uploading...' : (qrCodeUrl ? 'Change QR Code' : 'Upload QR Code')}
                </PillButton>
                {qrCodeUrl && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleRemoveQr} disabled={uploadingQr || savingPayment}
                    style={{ fontSize: '12px', color: 'var(--color-error-600)' }}
                  >Remove</button>
                )}
                <span style={{ fontSize: '11.5px', color: 'var(--theme-text-muted)' }}>JPG, PNG, or WebP up to 5MB.</span>
              </div>
            </div>
          </div>

          {paymentSaveError && <p role="alert">{paymentSaveError}</p>}
          <div style={{ marginTop: '8px' }}>
            <PillButton variant="primary" size="sm" onClick={handleSavePaymentSettings} disabled={savingPayment || uploadingQr}>
              {savingPayment ? 'Saving...' : 'Save Payment Settings'}
            </PillButton>
          </div>
        </div>
      </div>

      {/* Google Calendar Integration (Optional) */}
      <div className="card card-padding" style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 4 }}>
              
              <h4 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, margin: 0 }}>Google Calendar Integration</h4>
            </div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
              Connect the same Google account as your merchant email. That account owns calendar events and hosts Google Meet sessions.
            </p>
          </div>

          {gcal.isConnected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--theme-badge-bg)',
                  color: 'var(--theme-badge-text)',
                  fontWeight: 600,
                  fontSize: '13px',
                }}
              >
                <span style={{ fontSize: '14px', fontWeight: 800 }}>✓</span>
                Connected as {gcal.email}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleTestGcal}
                disabled={isTestingGcal}
                style={{ borderRadius: 'var(--radius-pill)' }}
              >
                {isTestingGcal ? 'Testing...' : 'Test connection'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleDisconnectGcal}
                disabled={isDisconnectingGcal}
                style={{ borderRadius: 'var(--radius-pill)' }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <PillButton
              variant="primary"
              size="sm"
              arrow
              onClick={handleConnectGcal}
              disabled={isConnectingGcal}
            >
              {isConnectingGcal ? 'Connecting...' : 'Connect Google Calendar'}
            </PillButton>
          )}
        </div>

        {gcal.isConnected ? (
          <div style={{
            background: 'var(--color-primary-50)',
            border: '1px solid var(--color-primary-200)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-4)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-primary-900)',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>✓ Real-time Sync Active</div>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
              <li>Every confirmed online booking is created on your primary Google Calendar.</li>
              <li>You are the event organizer and Google Meet host; the customer is invited as an attendee.</li>
              <li>Your personal Google Calendar busy intervals automatically block candidate booking slots on your public page.</li>
            </ul>
          </div>
        ) : (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
            Save your merchant email, then connect that same Google account to generate hosted Meet links automatically. You can still provide a manual meeting link when Google is unavailable.
          </div>
        )}
      </div>

      {/* WhatsApp Reminders */}
      <div className="card card-padding" style={{ marginBottom: 'var(--space-6)' }}>
        <h4 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>WhatsApp Reminders</h4>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-5)' }}>
          Reminder preferences are not available yet. These controls do not schedule messages or change transactional booking updates.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            { key: 'bookingConfirmation', label: 'Booking confirmation', desc: 'Send when a booking is confirmed' },
            { key: 'reminder24h', label: '24-hour reminder', desc: 'Remind clients 24 hours before' },
            { key: 'reminder2h', label: '2-hour reminder', desc: 'Remind clients 2 hours before' },
            { key: 'cancellationReminder', label: 'Cancellation policy', desc: 'Include cancellation policy in reminders' },
          ].map(r => (
            <div key={r.key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 'var(--space-4) 0', borderBottom: '1px solid var(--color-border)',
            }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{r.label}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>{r.desc}</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={false} disabled aria-label={`${r.label} ? not available yet`} />
                <span className="toggle-slider"></span>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Account */}
      <div className="card card-padding">
        <h4 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Account</h4>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
          {state.auth.isDemoMode ? 'You are using Calup in Demo Mode. All actions run locally.' : 'Manage your account settings.'}
        </p>
        <form onSubmit={changePassword} style={{ maxWidth: 480, marginBottom: 'var(--space-5)' }} aria-busy={changingPassword}>
          <h5 style={{ marginBottom: 'var(--space-3)' }}>Change password</h5>
          {[
            ['current', 'Current password', 'current-password'],
            ['next', 'New password', 'new-password'],
            ['confirmation', 'Confirm new password', 'new-password'],
          ].map(([key, label, autoComplete]) => (
            <div className="form-group" key={key}>
              <label className="form-label" htmlFor={`settings-password-${key}`}>{label}</label>
              <input id={`settings-password-${key}`} className="form-input" type="password" autoComplete={autoComplete}
                value={passwordForm[key]} required minLength={key === 'current' ? undefined : 8} disabled={changingPassword}
                onChange={event => setPasswordForm(current => ({ ...current, [key]: event.target.value }))} />
            </div>
          ))}
          <p className="form-hint" style={{ marginBottom: 12 }}>{PASSWORD_REQUIREMENTS} Your login email may differ from your business email.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={changingPassword}>{changingPassword ? 'Updating…' : 'Update password'}</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate('/forgot-password')} disabled={changingPassword}>Forgot current password?</button>
          </div>
        </form>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/contact')}>
            Contact Calup about account deletion
          </button>
        </div>
      </div>
    </div>
  );
}


/* Disabled navigation enhancement (user request):
navigate('/forgot-password', { state: { returnTo: '/dashboard/settings' } })
*/
