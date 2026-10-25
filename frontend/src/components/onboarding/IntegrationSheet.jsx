import { useMemo, useRef, useState } from 'react';
import {
  Check, ChevronRight, CreditCard, Search, ShieldCheck, X,
} from 'lucide-react';
import IntegrationBrandIcon from './IntegrationBrandIcon';
import AccessibleModal from '../ui/AccessibleModal.jsx';
import './IntegrationSheet.css';

const categories = ['All integrations', 'Calendars', 'Video calls', 'Payments', 'Communication'];

const integrations = [
  { id: 'calendar', name: 'Google Calendar & Meet', category: 'Calendars',
    description: 'One Google connection protects availability, creates Calendar events, and makes merchant-hosted Meet links.', recommended: true },
  { id: 'cashfree', name: 'Cashfree Payments', category: 'Payments',
    description: 'Accept secure customer payments and receive verified booking payment updates.' },
  { id: 'whatsapp', name: 'WhatsApp notifications', category: 'Communication',
    description: 'Send booking updates through Calup’s verified WhatsApp Business account.', managed: true },
  { id: 'sms', name: 'SMS verification', category: 'Communication',
    description: 'Verify the Indian mobile number used for OTPs and safety fallback messages.', required: true },
  { id: 'email', name: 'Email verification', category: 'Communication',
    description: 'Confirm ownership of the email address that protects the merchant account.', required: true },
  { id: 'zoom', name: 'Zoom', category: 'Video calls',
    description: 'Offer Zoom as an alternative meeting provider.', future: true },
  { id: 'webex', name: 'Webex', category: 'Video calls',
    description: 'Offer Webex as an alternative meeting provider.', future: true },
];

function IntegrationAction({ integration, googleReady, identityStatus, connectingGoogle, testingGoogle, onConnectGoogle, onTestGoogle, onOpenCashfree }) {
  if (integration.future) return <button type="button" className="integration-action" disabled>Coming later</button>;
  if (integration.id === 'email') {
    return identityStatus.emailVerified
      ? <span className="integration-managed"><Check size={14} /> Verified</span>
      : <span className="integration-required-status">Required</span>;
  }
  if (integration.id === 'sms') {
    return identityStatus.phoneVerified
      ? <span className="integration-managed"><Check size={14} /> Verified</span>
      : <span className="integration-required-status">Required</span>;
  }
  if (integration.managed) return <span className="integration-managed"><Check size={14} /> Included</span>;
  if (integration.id === 'cashfree') {
    return <button type="button" className="integration-action" onClick={onOpenCashfree}>Preview setup <ChevronRight size={15} /></button>;
  }
  if (googleReady) {
    return (
      <button type="button" className="integration-action is-connected" onClick={onTestGoogle} disabled={testingGoogle}>
        <Check size={15} /> {testingGoogle ? 'Testing...' : 'Calendar & Meet ready'}
      </button>
    );
  }
  return (
    <button type="button" className="integration-action" onClick={onConnectGoogle} disabled={connectingGoogle}>
      {connectingGoogle ? 'Connecting...' : 'Connect Calendar & Meet'}
    </button>
  );
}

export default function IntegrationSheet({
  setupMode = false, meetingType = 'online',
  googleStatus, merchantEmail, phone, phoneOtp, phoneOtpSent, emailOtp, emailOtpSent, identityStatus,
  connectingGoogle, testingGoogle, verifyingEmail, verifyingPhone,
  onConnectGoogle, onTestGoogle, onSendEmailOtp, onVerifyEmailOtp, onEmailOtpChange,
  onSendPhoneOtp, onVerifyPhoneOtp, onPhoneChange, onPhoneOtpChange,
}) {
  const [category, setCategory] = useState(categories[0]);
  const [query, setQuery] = useState('');
  const [cashfreeOpen, setCashfreeOpen] = useState(false);
  const cashfreeTriggerRef = useRef(null);
  const googleReady = Boolean(googleStatus?.isConnected);
  const filtered = useMemo(() => integrations.filter(integration => {
    if (setupMode) return ['email', 'sms', ...(meetingType !== 'in-person' ? ['calendar'] : [])].includes(integration.id);
    const inCategory = category === categories[0] || integration.category === category;
    const searchable = `${integration.name} ${integration.description}`.toLowerCase();
    return inCategory && searchable.includes(query.trim().toLowerCase());
  }).sort((a, b) => setupMode ? ['email', 'sms', 'calendar'].indexOf(a.id) - ['email', 'sms', 'calendar'].indexOf(b.id) : 0), [category, query, setupMode, meetingType]);
  const activeCount = (setupMode ? 0 : integrations.filter(item => item.managed).length) + (googleReady && (!setupMode || meetingType !== 'in-person') ? 1 : 0)
    + (identityStatus.emailVerified ? 1 : 0) + (identityStatus.phoneVerified ? 1 : 0);

  return (
    <div className={`integration-sheet${setupMode ? ' is-setup' : ''}`}>
      <div className="integration-heading">
        <div>
          {!setupMode && <span>Your workflow, connected</span>}
          <h2>{setupMode ? 'Verify your business' : 'All your tools. Working together.'}</h2>
          <p>{setupMode ? 'Confirm your email and mobile number. Online sessions also need Google Calendar and Meet before publishing.' : 'Review every connection Calup uses to run bookings, meetings, payments, and notifications.'}</p>
        </div>
        <strong><span /> {activeCount} ready</strong>
      </div>

      {!setupMode && <div className="integration-toolbar">
        <div className="integration-tabs" role="group" aria-label="Filter integrations">
          {categories.map(item => (
            <button type="button" key={item} className={category === item ? 'is-active' : ''}
              aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>
          ))}
        </div>
        <label className="integration-search">
          <Search size={17} />
          <input aria-label="Search integrations" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
      </div>}

      <div className="integration-list" aria-live="polite">
        {filtered.length ? filtered.map(integration => {
          return (
            <div className="integration-row" key={integration.id}>
              <IntegrationBrandIcon id={integration.id} />
              <div className="integration-copy">
                <h3>{integration.name}{integration.recommended && <small>{setupMode ? 'Before publishing' : 'Recommended'}</small>}{integration.required && <small className="is-required">Required</small>}</h3>
                <p>{integration.description}</p>
                {integration.id === 'email' && !identityStatus.emailVerified && (
                  <div className="integration-verification-stack">
                    <div className="integration-verification-controls">
                      <span className="integration-locked-value">{merchantEmail}</span>
                      <button type="button" onClick={onSendEmailOtp} disabled={verifyingEmail}>
                        {verifyingEmail ? 'Sending...' : emailOtpSent ? 'Resend code' : 'Send code'}
                      </button>
                    </div>
                    {emailOtpSent && (
                      <div className="integration-verification-controls">
                        <input className="integration-otp-input" aria-label="Six-digit email verification code" inputMode="numeric"
                          autoComplete="one-time-code" placeholder="6-digit code" value={emailOtp} onChange={event => onEmailOtpChange(event.target.value)} />
                        <button type="button" onClick={onVerifyEmailOtp} disabled={verifyingEmail || emailOtp.length !== 6}>Confirm email</button>
                      </div>
                    )}
                  </div>
                )}
                {integration.id === 'sms' && !identityStatus.phoneVerified && (
                  <div className="integration-verification-stack">
                    <div className="integration-verification-controls">
                      <label className="integration-phone-input"><span>+91</span><input aria-label="Mobile number for SMS verification"
                        inputMode="numeric" autoComplete="tel-national" value={phone} onChange={event => onPhoneChange(event.target.value)} /></label>
                      <button type="button" onClick={onSendPhoneOtp} disabled={verifyingPhone}>
                        {verifyingPhone ? 'Sending...' : phoneOtpSent ? 'Resend code' : 'Send code'}
                      </button>
                    </div>
                    {phoneOtpSent && (
                      <div className="integration-verification-controls">
                        <input className="integration-otp-input" aria-label="SMS verification code" inputMode="numeric"
                          autoComplete="one-time-code" placeholder="SMS code" value={phoneOtp} onChange={event => onPhoneOtpChange(event.target.value)} />
                        <button type="button" onClick={onVerifyPhoneOtp} disabled={verifyingPhone || phoneOtp.length < 4}>Confirm code</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <IntegrationAction integration={integration} googleReady={googleReady}
                identityStatus={identityStatus}
                connectingGoogle={connectingGoogle} testingGoogle={testingGoogle}
                onConnectGoogle={onConnectGoogle} onTestGoogle={onTestGoogle}
                onOpenCashfree={event => {
                  cashfreeTriggerRef.current = event.currentTarget;
                  setCashfreeOpen(true);
                }} />
            </div>
          );
        }) : <div className="integration-empty"><Search size={25} /><strong>No matching tools</strong><button type="button" onClick={() => { setQuery(''); setCategory(categories[0]); }}>Clear filters</button></div>}
      </div>

      <p className="integration-note"><ShieldCheck size={17} /> {setupMode ? 'Your draft remains private until the required activation checks pass. Other tools can be reviewed later in Settings.' : 'Connections can be reviewed later in Settings. Calup never asks merchants to expose provider secrets in the browser.'}</p>

      {cashfreeOpen && (
        <AccessibleModal label="Cashfree merchant onboarding" onClose={() => setCashfreeOpen(false)} returnFocusRef={cashfreeTriggerRef}>
          <section className="integration-modal" aria-labelledby="cashfree-preview-title">
            <button type="button" className="integration-modal-close" aria-label="Close Cashfree setup preview" onClick={() => setCashfreeOpen(false)}><X size={18} /></button>
            <span className="integration-modal-icon"><CreditCard size={27} /></span>
            <h2 id="cashfree-preview-title">Cashfree merchant onboarding</h2>
            <p>This is the sandbox onboarding placeholder. Production activation will open Cashfree’s secure merchant flow and return only verified onboarding status to Calup.</p>
            <div className="integration-modal-summary">
              <span>Merchant account</span><strong>{merchantEmail || 'Added after contact verification'}</strong>
              <span>Environment</span><strong>Sandbox</strong>
              <span>Credential handling</span><strong>Server only</strong>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setCashfreeOpen(false)}>Close preview</button>
          </section>
        </AccessibleModal>
      )}
    </div>
  );
}
