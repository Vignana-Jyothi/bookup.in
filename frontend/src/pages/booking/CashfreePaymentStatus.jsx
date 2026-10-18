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
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const readAttempt = useCallback(async () => {
    const current = await cashfreeCheckoutService.getAttempt();
    setAttempt(current);
    return current;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await cashfreeCheckoutService.refreshPayment();
      await readAttempt();
    } catch (refreshError) {
      try {
        await readAttempt();
      } catch {
        setError(refreshError.message || 'Payment status is temporarily unavailable.');
      }
    } finally {
      setLoading(false);
    }
  }, [readAttempt, setError]);

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
      } catch {
        if (!cancelled) await refresh();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [location.state?.checkoutReturned, readAttempt, refresh]);

  const fulfilled = attempt?.paymentStatus === 'succeeded' && attempt?.fulfilmentStatus === 'fulfilled';
  const unfulfilled = attempt?.paymentStatus === 'succeeded' && attempt?.fulfilmentStatus === 'unfulfilled';
  const failed = !fulfilled && !unfulfilled && (
    ['creation_failed', 'closed_unpaid'].includes(attempt?.paymentStatus) ||
    ['released', 'expired'].includes(attempt?.attemptStatus)
  );
  const pending = !fulfilled && !unfulfilled && !failed;
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
      try {
        await cashfreeCheckoutService.openHostedPopup(session);
      } catch (popupError) {
        console.warn('Cashfree popup ended without a completed checkout:', popupError);
      }
      await cashfreeCheckoutService.finishCheckoutReturn();
      await readAttempt();
    } catch (checkoutError) {
      setError(checkoutError.message || 'Checkout could not be finalized.');
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
      setError(cancelError.message || 'The payment could not be safely cancelled yet.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  const title = fulfilled
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
          <div className={`payment-status-icon ${fulfilled ? 'is-success' : failed ? 'is-failed' : 'is-pending'}`} aria-hidden="true">
            {fulfilled ? '✓' : failed ? '×' : '…'}
          </div>
          <h1 id="payment-status-title">{title}</h1>
          <p className="payment-status-copy">
            {fulfilled && 'Your payment is verified and the appointment is reserved. Keep the booking ID below for support.'}
            {unfulfilled && 'The slot was no longer available when payment was confirmed. Calup has opened a resolution case for review and refund.'}
            {failed && 'The payment was not completed. Your temporary slot hold has been released. Restart the booking process to try again.'}
            {pending && 'We are checking Cashfree directly. Your slot remains protected while verification is in progress.'}
          </p>

          {fulfilled && attempt?.receipt?.bookingId && (
            <div className="payment-status-booking-id">
              <span>Booking ID</span>
              <strong>{attempt.receipt.bookingId}</strong>
            </div>
          )}
          {attempt?.holdExpiresAt && pending && (
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
