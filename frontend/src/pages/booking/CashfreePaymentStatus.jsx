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

  const handleStatusError = useCallback(error => {
    setAttempt(null);
    setStatusError([401, 403].includes(error?.status) ? 'access' : 'unavailable');
    setError('');
  }, [setError]);

  const readAttempt = useCallback(async () => {
    try {
      const current = await cashfreeCheckoutService.getAttempt();
      setAttempt(current);
      setStatusError(current ? null : 'unavailable');
      setNow(Date.now());
      return current;
    } catch (error) {
      handleStatusError(error);
      throw error;
    }
  }, [handleStatusError]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await cashfreeCheckoutService.refreshPayment();
      await readAttempt();
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
      setLoading(false);
    }
  }, [readAttempt, setError, handleStatusError]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        if (location.state?.checkoutReturned) {
          await cashfreeCheckoutService.finishCheckoutReturn();
        } else {
          await cashfreeCheckoutService.refreshPayment();
        }
        if (!cancelled) await readAttempt();
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
  const unfulfilled = attempt?.paymentStatus === 'succeeded' && attempt?.fulfilmentStatus === 'unfulfilled';
  const failed = !fulfilled && !unfulfilled && (
    ['creation_failed', 'closed_unpaid'].includes(attempt?.paymentStatus) ||
    ['released', 'expired'].includes(attempt?.attemptStatus)
  );
  const pending = Boolean(attempt) && !statusError && !fulfilled && !unfulfilled && !failed;
  const unavailable = Boolean(statusError) || (!loading && !attempt);
  const noticeShown = useRef(null);
  useEffect(() => {
    if (pending && location.state?.notice && noticeShown.current !== location.key) {
      noticeShown.current = location.key;
      addToast(location.state.notice, 'info');
    }
  }, [pending, location.state?.notice, location.key, addToast]);
  const remainingSeconds = attempt?.holdExpiresAt
    ? Math.max(0, Math.floor((new Date(attempt.holdExpiresAt).getTime() - now) / 1000))
    : null;
  const remainingLabel = remainingSeconds === null
    ? null
    : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;
  const holdProtected = pending && attempt.attemptStatus === 'hold_active' && remainingSeconds > 0;
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

  const title = unavailable
    ? statusError === 'access' ? 'We couldn’t access your payment session' : 'Payment status is unavailable'
    : !attempt
      ? 'Loading your payment session'
      : fulfilled
    ? 'Your appointment is confirmed'
    : unfulfilled
      ? 'Payment received — review started'
      : failed
        ? 'Payment failed'
        : 'Confirming your payment';

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
            {unfulfilled && 'The slot was no longer available when payment was confirmed. Calup has opened a resolution case for review and refund.'}
            {failed && 'The payment was not completed. Your temporary slot hold has been released. Restart the booking process to try again.'}
            {unavailable && 'We cannot confirm your payment or appointment reservation from this browser. Return to the browser where you started checkout and try again. If you were charged, contact your merchant with your payment reference before paying again.'}
            {!attempt && !unavailable && 'Loading the latest available payment details. Your payment and appointment reservation are not confirmed yet.'}
            {pending && (holdProtected
              ? 'We are checking Cashfree directly. Your slot is temporarily protected until the hold deadline shown below.'
              : 'We are checking Cashfree directly. Your appointment reservation is not confirmed. No active slot hold is confirmed.')}
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
            {pending && attempt?.paymentSessionId && (
              <button className="payment-status-button payment-status-button--primary" type="button" onClick={continuePayment} disabled={openingCheckout}>
                {openingCheckout ? 'Opening…' : 'Continue payment'}
              </button>
            )}
            {pending && <button className="payment-status-button" type="button" onClick={cancelAndRestart} disabled={loading}>{loading ? 'Checking…' : 'Cancel payment and restart'}</button>}
            {pending && <button className="payment-status-button" type="button" onClick={refresh} disabled={loading}>{loading ? 'Checking…' : 'Check again'}</button>}
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
