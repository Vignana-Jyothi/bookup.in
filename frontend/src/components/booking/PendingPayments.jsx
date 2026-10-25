import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import AccessibleModal from '../ui/AccessibleModal.jsx';
import { publicCommerceService } from '../../services/payments/publicCommerceService.js';
import { cashfreeCheckoutService } from '../../services/payments/cashfreeCheckout.js';
import './PendingPayments.css';

export default function PendingPayments({ slug, onClose, onOpen }) {
  const api = useMemo(() => publicCommerceService(slug), [slug]);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [records, setRecords] = useState(null);
  const [verified, setVerified] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const inFlight = useRef(false);

  const load = async () => {
    try {
      const result = await api.bookingPayments();
      if (!Array.isArray(result?.attempts)) throw new Error('Payment lookup is unavailable. Please try again.');
      setRecords(result.attempts); setVerified(true);
      setMaskedPhone(result.maskedPhone);
    } catch (failure) { setRecords(null); throw failure; }
  };
  const act = async callback => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try { await callback(); }
    catch (failure) {
      if (failure.status === 401) { setVerified(false); setRecords(null); setChallenge(null); }
      setError(failure.message || 'Could not complete this action. Please try again.');
    }
    finally { inFlight.current = false; setBusy(false); }
  };

  useEffect(() => {
    let active = true;
    api.bookingPayments().then(result => {
      if (!Array.isArray(result?.attempts)) throw new Error('Payment lookup is unavailable. Please try again.');
      if (active) { setRecords(result.attempts); setVerified(true); setMaskedPhone(result.maskedPhone); }
    }).catch(failure => { if (active && failure.status !== 401) setError(failure.message); })
      .finally(() => { if (active) setCheckingAccess(false); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = event => {
    event.preventDefault();
    void act(async () => {
      setChallenge(await api.send(phone)); setCode(''); setCooldown(60);
    });
  };
  const verify = event => {
    event.preventDefault();
    void act(async () => {
      await api.verify(challenge.challengeId, code);
      setCode(''); setVerified(true);
      await load();
    });
  };
  const retry = record => act(async () => {
    await api.openBookingPayment(record.attemptId);
    if (record.paymentStatus === 'succeeded' || record.attemptStatus === 'manual_review') { onOpen(); return; }
    let session;
    try { session = await cashfreeCheckoutService.getCheckoutSession(); }
    catch (failure) { if ([409, 410].includes(failure.status)) { onOpen(); return; } throw failure; }
    if (session?.gatewayReconciling || !session?.paymentSessionId) { onOpen(); return; }
    // Release the native dialog's top layer/inertness before Cashfree mounts
    // its own hosted modal outside our portal.
    flushSync(() => onClose());
    let result;
    try { result = await cashfreeCheckoutService.openHostedPopup(session); }
    catch (failure) {
      if (failure.code === 'CASHFREE_CHECKOUT_ACTIVE') { onOpen(); return; }
      // Popup failure cannot establish payment truth. Reconcile on the server.
    }
    if (!result?.redirect) {
      try { await cashfreeCheckoutService.finishCheckoutReturn(); }
      catch { onOpen({ checkoutReturned: true }); return; }
    }
    onOpen();
  });
  const cancel = record => act(async () => {
    await api.openBookingPayment(record.attemptId);
    const result = await cashfreeCheckoutService.finishCheckoutReturn();
    setConfirmCancel(null);
    if (result?.paymentStatus === 'succeeded') { onOpen(); return; }
    if (['closed_unpaid', 'creation_failed'].includes(result?.paymentStatus)
      && ['released', 'expired'].includes(result?.attemptStatus)) {
      setMessage('Checkout closed. You can start a new booking.');
      await load();
    } else {
      setMessage('This payment could not be closed yet. It is still being checked. Open its status before paying again.');
    }
  });

  return <AccessibleModal label="Pending payments" onClose={() => !inFlight.current && onClose()}>
    <div className="modal pending-payments-modal">
      <header className="modal-header">
        <h2>Pending payments</h2>
        <button type="button" className="modal-close" aria-label="Close pending payments" disabled={busy} onClick={onClose}>×</button>
      </header>
      <div className="modal-body">
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {checkingAccess ? <p role="status">Checking secure access…</p> : records === null && verified ? <><p>Your phone is verified. Retry loading your payments.</p><button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(load)}>Find payments again</button></> : records === null ? <>
          <p>Verify your phone to find unfinished appointment payments with this merchant.</p>
          {!challenge ? <form key="send-code" onSubmit={send}>
            <label>Phone number<input className="form-input" type="tel" autoComplete="tel" required maxLength={18} value={phone} onChange={event => setPhone(event.target.value)} autoFocus /></label>
            <button className="btn btn-primary" disabled={busy || cooldown > 0}>{busy ? 'Sending…' : cooldown ? `Request another code in ${cooldown}s` : 'Send verification code'}</button>
          </form> : <form key="verify-code" onSubmit={verify}>
            <p>Enter the SMS code sent to {challenge.maskedPhone}.</p>
            <label>Verification code<input className="form-input" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{4,8}" maxLength={8} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} autoFocus /></label>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Verify and find payments'}</button>
            <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => { setChallenge(null); setCode(''); }}>Change phone or request another code</button>
          </form>}
        </> : <>
          <div className="pending-payments-toolbar"><p role="status">Verified phone: {maskedPhone}. {records.length} unfinished {records.length === 1 ? 'payment' : 'payments'} found.</p><button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => act(load)}>Refresh payments</button></div>
          {records.length === 25 && <p>Showing the 25 most recent unfinished checkouts.</p>}
          {records.length === 0 && <p>No unfinished payments found with this merchant.</p>}
          <ul className="pending-payments-list">{records.map(record => {
            const review = record.paymentStatus === 'succeeded' || record.attemptStatus === 'manual_review';
            return <li key={record.attemptId}>
              <h3>{record.serviceName}</h3>
              <p>{record.bookingDate} · {String(record.startTime || '').slice(0, 5)}</p>
              <p>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: record.currency }).format(record.amountPaise / 100)} · {review ? 'Needs review' : 'Payment not confirmed'}</p>
              <div className="pending-payments-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => retry(record)}>{review ? 'Review payment' : 'Retry payment'}</button>
                {!review && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setConfirmCancel(record.attemptId)}>Cancel payment</button>}
              </div>
              {confirmCancel === record.attemptId && <div className="pending-payment-confirm">
                <p>Close this checkout? We check the gateway first. A payment still processing cannot be cancelled here.</p>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => cancel(record)}>{busy ? 'Checking…' : 'Confirm cancellation'}</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmCancel(null)}>Keep checkout</button>
              </div>}
            </li>;
          })}</ul>
          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => act(async () => { await api.logout(); setRecords(null); setVerified(false); setChallenge(null); setCode(''); setPhone(''); })}>Use another phone number</button>
        </>}
      </div>
    </div>
  </AccessibleModal>;
}
