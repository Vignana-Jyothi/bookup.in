import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import BrandLogo from '../../components/ui/BrandLogo.jsx';
import TicketPanel from '../../components/support/TicketPanel';
import BookingReceipt from '../../components/ui/receipt-printer/BookingReceipt.jsx';
import { cashfreeCheckoutService } from '../../services/payments/cashfreeCheckout.js';
import { usePopupFeedback } from '../../hooks/usePopupFeedback.js';
import { useStore } from '../../data/store';
import './CashfreePaymentStatus.css';
/* Disabled navigation enhancement (user request):
import PageLinks from '../../components/ui/PageLinks';
*/
/* Disabled navigation enhancement (user request):
import { merchantBookingPath } from '../../utils/navigation';
*/

export default function CashfreePaymentStatus() {
  const location = useLocation();
  const { addToast } = useStore();
  const [attempt, setAttempt] = useState(null);
  const [, setError] = usePopupFeedback();
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState(null);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refreshInFlight = useRef(false);

  const handleStatusError = useCallback(error => {
    setAttempt(null);
    setStatusError([401, 403].includes(error?.status) ? 'access' : 'unavailable');
    setError('');
  }, [setError]);

  const readAttempt = useCallback(async (reconciled = null) => {
    try {
      const current = await cashfreeCheckoutService.getAttempt();
      setAttempt(current ? {
        ...current,
        retryableFailure: reconciled?.attemptId === current.attemptId && reconciled?.retryableFailure === true,
      } : null);
      setStatusError(current ? null : 'unavailable');
      setNow(Date.now());
      return current;
    } catch (error) {
      handleStatusError(error);
      throw error;
    }
  }, [handleStatusError]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const reconciled = await cashfreeCheckoutService.refreshPayment();
      await readAttempt(reconciled);
    } catch (refreshError) {
      if ([401, 403].includes(refreshError.status)) {
        handleStatusError(refreshError);
        return;
      }
      try {
        await readAttempt();
      } catch (readError) {
        handleStatusError(readError);
      }
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
    }
  }, [readAttempt, setError, handleStatusError]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const reconciled = location.state?.checkoutReturned
          ? await cashfreeCheckoutService.finishCheckoutReturn()
          : await cashfreeCheckoutService.refreshPayment();
        if (!cancelled) await readAttempt(reconciled);
      } catch (error) {
        if (!cancelled) {
          if ([401, 403].includes(error.status)) handleStatusError(error);
          else await refresh();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [location.state?.checkoutReturned, readAttempt, refresh, handleStatusError]);

  const fulfilled = attempt?.paymentStatus === 'succeeded' && attempt?.fulfilmentStatus === 'fulfilled';
  const unfulfilled = attempt?.paymentStatus === 'succeeded' && !fulfilled;
  const reviewRequired = !fulfilled && (unfulfilled || attempt?.attemptStatus === 'manual_review');
  const failed = !fulfilled && !reviewRequired && ['creation_failed', 'closed_unpaid'].includes(attempt?.paymentStatus);
  const pending = Boolean(attempt) && !statusError && !fulfilled && !reviewRequired && !failed
    && attempt.paymentStatus === 'pending';
  const unknown = Boolean(attempt) && !statusError && !fulfilled && !reviewRequired && !failed && !pending;
  const unavailable = Boolean(statusError) || (!loading && !attempt);
  const noticeShown = useRef(null);
  useEffect(() => {
    if (pending && location.state?.notice && noticeShown.current !== location.key) {
      noticeShown.current = location.key;
      addToast('Checkout has returned. Check the payment status below before paying again.', 'info');
    }
  }, [pending, location.state?.notice, location.key, addToast]);
  const remainingSeconds = attempt?.holdExpiresAt
    ? Math.max(0, Math.floor((new Date(attempt.holdExpiresAt).getTime() - now) / 1000))
    : null;
  const remainingLabel = remainingSeconds === null
    ? null
    : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;
  const holdProtected = pending && attempt.attemptStatus === 'hold_active' && remainingSeconds > 0;
  const holdExpired = pending && (['released', 'expired'].includes(attempt.attemptStatus) || remainingSeconds === 0);
  const retryableFailure = holdProtected && attempt.retryableFailure;
  const restartPath = /^[A-Za-z0-9._~-]+$/.test(attempt?.providerSlug || '')
    ? `/book/${attempt.providerSlug}`
    : cashfreeCheckoutService.getRestartPath();

  const continuePayment = async () => {
    setOpeningCheckout(true);
    setError('');
    try {
      const session = await cashfreeCheckoutService.getCheckoutSession();
      if (session?.gatewayReconciling) {
        setError('Cashfree is still preparing this payment. Please check again shortly.');
        return;
      }
      let popupResult;
      try {
        popupResult = await cashfreeCheckoutService.openHostedPopup(session);
      } catch (popupError) {
        if (popupError.code === 'CASHFREE_CHECKOUT_ACTIVE') {
          setError(popupError.message);
          return;
        }
        console.warn('Cashfree popup ended without a completed checkout:', popupError);
      }
      if (popupResult?.redirect) await cashfreeCheckoutService.refreshPayment();
      else await cashfreeCheckoutService.finishCheckoutReturn();
      await readAttempt();
    } catch (checkoutError) {
      if ([401, 403].includes(checkoutError.status)) handleStatusError(checkoutError);
      else setError(checkoutError.message || 'Checkout could not be finalized.');
    } finally {
      setOpeningCheckout(false);
    }
  };

  const cancelAndRestart = async () => {
    setLoading(true);
    setError('');
    try {
      await cashfreeCheckoutService.finishCheckoutReturn();
      const result = await readAttempt();
      if (result?.paymentStatus === 'pending' || result?.gatewayReconciling) {
        setError('Calup could not safely close this payment yet because Cashfree verification is still in progress. Please check again shortly.');
      }
    } catch (cancelError) {
      if ([401, 403].includes(cancelError.status)) handleStatusError(cancelError);
      else setError(cancelError.message || 'The payment could not be safely cancelled yet.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  // Reconcile with the server as well as advancing the local display clock.
  // A one-shot timer waits for each request to settle; terminal/access states stop it.
  useEffect(() => {
    if ((!pending && !unknown && !unfulfilled) || loading || openingCheckout) return undefined;
    const deadline = new Date(attempt.holdExpiresAt).getTime() - Date.now();
    const delay = deadline > 0 ? Math.max(1000, Math.min(10000, deadline)) : 10000;
    const timer = window.setTimeout(() => { void refresh(); }, delay);
    return () => window.clearTimeout(timer);
  }, [pending, unknown, unfulfilled, loading, openingCheckout, attempt, refresh]);

  const title = unavailable
    ? statusError === 'access' ? 'We couldn’t access your payment session' : 'Payment status is unavailable'
    : !attempt
      ? 'Loading your payment session'
      : fulfilled
    ? 'Your appointment is confirmed'
    : reviewRequired
      ? unfulfilled ? 'Payment received — confirmation needs review' : 'Your payment needs review'
      : failed
        ? 'Payment failed'
        : unknown ? 'Payment outcome is unknown'
          : holdExpired ? 'Your slot hold has expired'
            : retryableFailure ? 'Your payment attempt was unsuccessful' : 'Confirming your payment';

  return (
    <main className={`payment-status-page ${fulfilled ? 'payment-status-page--receipt' : ''}`}>
      <section className="payment-status-card" aria-labelledby="payment-status-title">
        <div className="payment-status-summary">
          <BrandLogo />
          <div className={`payment-status-icon ${fulfilled ? 'is-success' : failed || unavailable ? 'is-failed' : 'is-pending'}`} aria-hidden="true">
            {fulfilled ? '✓' : unavailable ? '?' : failed ? '×' : '…'}
          </div>
          <h1 id="payment-status-title">{title}</h1>
          <p className="payment-status-copy">
            {fulfilled && 'Your payment is verified and the appointment is reserved. Keep the booking ID below for support.'}
            {reviewRequired && 'Your appointment is not confirmed. Contact your merchant with your payment reference before paying again.'}
            {reviewRequired && attempt?.resolutionCaseId && ' A resolution case is recorded; keep the case reference below.'}
            {failed && 'The latest payment status reports that payment was not completed. You can restart booking. If you see a charge, contact your merchant before paying again.'}
            {unknown && 'We could not determine the payment outcome from the available details. Check again or contact your merchant with your payment reference before paying again.'}
            {unavailable && 'We cannot confirm your payment or appointment reservation from this browser. Return to the browser where you started checkout and try again. If you were charged, contact your merchant with your payment reference before paying again.'}
            {!attempt && !unavailable && 'Loading the latest available payment details. Your payment and appointment reservation are not confirmed yet.'}
            {retryableFailure && 'You can retry payment now using the same checkout. Your slot hold is not a retry waiting period; it lasts only until the deadline below. Your appointment is not confirmed yet.'}
            {pending && !retryableFailure && (holdProtected
              ? 'Payment is not confirmed. Your slot is temporarily protected until the hold deadline shown below. This page checks for updates automatically.'
              : 'Your appointment reservation is not confirmed. No active slot hold is confirmed. We will check for payment updates automatically. If you were charged, contact your merchant before paying again.')}
          </p>

          {fulfilled && attempt?.receipt?.bookingId && (
            <div className="payment-status-booking-id">
              <span>Booking ID</span>
              <strong>{attempt.receipt.bookingId}</strong>
            </div>
          )}
          {holdProtected && (
            <dl className="payment-status-meta">
              <div><dt>Time remaining</dt><dd>{remainingLabel}</dd></div>
              <div><dt>Hold deadline</dt><dd>{new Date(attempt.holdExpiresAt).toLocaleString()}</dd></div>
            </dl>
          )}
          {attempt?.resolutionCaseId && <p><strong>Case reference:</strong> {attempt.resolutionCaseId}</p>}
          {fulfilled && attempt?.receipt?.meetingType === 'online' && (
            <p className="payment-status-copy">Meeting details are shared through WhatsApp. Contact your merchant if you have not received them.</p>
          )}

          <div className="payment-status-actions">
            {unavailable && <button className="payment-status-button payment-status-button--primary" type="button" onClick={refresh} disabled={loading}>{loading ? 'Checking…' : 'Try again'}</button>}
            {unavailable && <Link className="payment-status-button" to="/booking-status">Find your booking</Link>}
            {pending && holdProtected && attempt?.paymentSessionId && (
              <button className="payment-status-button payment-status-button--primary" type="button" onClick={continuePayment} disabled={openingCheckout || loading}>
                {openingCheckout ? 'Opening…' : retryableFailure ? 'Retry payment' : 'Continue payment'}
              </button>
            )}
            {pending && <button className="payment-status-button" type="button" onClick={cancelAndRestart} disabled={loading || openingCheckout}>{loading ? 'Checking…' : 'Close checkout and check status'}</button>}
            {(pending || unknown || reviewRequired) && <button className="payment-status-button" type="button" onClick={refresh} disabled={loading || openingCheckout}>{loading ? 'Checking…' : 'Check again'}</button>}
            {(unknown || reviewRequired || holdExpired) && <Link className="payment-status-button" to="/booking-status">Find your booking</Link>}
            {failed && <Link className="payment-status-button payment-status-button--primary" to={restartPath}>Restart booking</Link>}
            {fulfilled && attempt?.receipt && (
              <button className="payment-status-button payment-status-button--primary" type="button" onClick={() => window.print()}>
                Print or save receipt
              </button>
            )}
            {fulfilled && <Link className="payment-status-button" to="/booking-status" state={{ bookingReference: attempt?.receipt?.bookingId || '' }}>Manage booking</Link>}
            <Link className="payment-status-button" to="/">Return to Calup</Link>
{/* Disabled navigation enhancement (user request):
            {fulfilled && <Link className="payment-status-button" to="/booking-status" state={{ bookingReference: attempt?.receipt?.bookingId || '', merchantSlug: attempt?.providerSlug }}>Manage booking</Link>}
*/}
{/* Disabled navigation enhancement (user request):
            {fulfilled && merchantBookingPath(attempt?.providerSlug) && <Link className="payment-status-button" to={merchantBookingPath(attempt.providerSlug)}>Book another session</Link>}
*/}
          </div>
{/* Disabled navigation enhancement (user request):
<PageLinks label="Payment help" links={[{ to: '/contact', label: 'Contact payment support' }, { to: '/refund-policy', label: 'Refund policy' }]} />
*/}
          {fulfilled && <p className="payment-status-copy">Need to cancel? Raise a service ticket below for your merchant to review. A ticket does not cancel your booking automatically.</p>}
          {attempt && <TicketPanel context="payment" key={attempt.attemptId} />}
        </div>

        {fulfilled && attempt?.receipt && (
          <div className="payment-status-receipt" aria-label="Payment receipt">
            <BookingReceipt key={attempt.receipt.bookingId} receipt={attempt.receipt} />
          </div>
        )}
      </section>
    </main>
  );
}
