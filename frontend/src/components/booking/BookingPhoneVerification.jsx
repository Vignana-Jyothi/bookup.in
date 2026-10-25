import { useEffect, useMemo, useRef, useState } from 'react';
import { publicCommerceService } from '../../services/payments/publicCommerceService.js';
import { normalizedBookingPhone, currentBookingPhoneVerification } from '../../services/payments/bookingPhoneVerification.js';

export default function BookingPhoneVerification({ slug, phone, verification, onVerified }) {
  const api = useMemo(() => publicCommerceService(slug), [slug]);
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(() => currentBookingPhoneVerification(verification, slug, phone));
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const active = useRef(true);
  const inFlight = useRef(false);
  const nationalPhone = normalizedBookingPhone(phone);
  const validPhone = /^[6-9]\d{9}$/.test(nationalPhone);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!cooldownUntil) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);
  useEffect(() => {
    if (!verified) return undefined;
    const timer = setTimeout(() => { setVerified(false); setChallenge(null); onVerified(null); }, Math.max(0, (verification?.expiresAt || Date.now()) - Date.now()));
    return () => clearTimeout(timer);
  }, [verified, verification?.expiresAt, onVerified]);
  const act = async callback => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await callback(); }
    catch (failure) { if (active.current) setError(failure.message || 'Phone verification is unavailable. Please retry.'); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const send = () => {
    if (!validPhone || cooldown > 0) return;
    void act(async () => {
      const result = await api.send(nationalPhone);
      if (!active.current) return;
      if (!result?.challengeId) throw new Error('Could not start verification. Please retry.');
      setChallenge(result); setCode(''); setNow(Date.now());
      setCooldownUntil(Date.now() + Math.max(60, Number(result.retryAfter) || 60) * 1000);
    });
  };
  const verify = () => {
    if (!challenge || !/^\d{4,8}$/.test(code)) return;
    void act(async () => {
      const result = await api.verify(challenge.challengeId, code);
      if (!active.current) return;
      if (!result?.verified) throw new Error('The code could not be verified. Please retry.');
      setCode(''); setVerified(true);
      onVerified({ slug, phone: nationalPhone, expiresAt: Date.now() + 30 * 60 * 1000 });
    });
  };
  return <div className="booking-phone-verification">
    {verified ? <p role="status">Phone verified. You can continue to payment.</p> : <>
      <p>Verify your phone by SMS before continuing to payment.</p>
      <button type="button" className="btn btn-secondary" disabled={busy || !validPhone || cooldown > 0} onClick={send}>
        {busy ? 'Please wait…' : cooldown ? `Resend code in ${cooldown}s` : challenge ? 'Resend SMS code' : 'Send SMS code'}
      </button>
      {challenge && <>
        <p>Enter the SMS code sent to {challenge.maskedPhone}.</p>
        <label className="form-label" htmlFor="booking-phone-code">SMS verification code</label>
        <input id="booking-phone-code" className="form-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} disabled={busy}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); verify(); } }}
          onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
        <button type="button" className="btn btn-secondary" disabled={busy || !/^\d{4,8}$/.test(code)} onClick={verify}>Verify phone</button>
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
