import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PillButton from '../../components/ui/PillButton';
import AccessibleModal from '../../components/ui/AccessibleModal.jsx';
import SubscriptionReceipt from '../../components/ui/receipt-printer/SubscriptionReceipt.jsx';
import { cashfreeCheckoutService } from '../../services/payments/cashfreeCheckout.js';
import { subscriptionService, isSubscriptionOrderApplied, subscriptionOrderNotice, findSubscriptionReceipt } from '../../services/payments/subscriptionService.js';
import { usePopupFeedback } from '../../hooks/usePopupFeedback.js';
import './Subscription.css';
/* Disabled navigation enhancement (user request):
import PageLinks from '../../components/ui/PageLinks';
*/

const emptyBilling = {
  legalName: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', gstin: '', version: null,
};

function money(paise = 0) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(paise) / 100);
}

function dateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function statusCopy(status) {
  if (status === 'active') return ['Active', 'Your booking page and merchant tools are available.'];
  if (status === 'grace') return ['Grace period', 'Renew before the grace deadline to avoid new bookings being blocked.'];
  if (status === 'frozen') return ['Frozen', 'New bookings are blocked. Existing customer obligations remain manageable.'];
  if (status === 'deletion_scheduled') return ['Deletion scheduled', 'Operational data reached its retention deadline. Contact Calup support immediately.'];
  if (status === 'operational_deleted') return ['Operational data removed', 'A new operational setup is required. Eligible financial history remains retained.'];
  return ['Access required', 'Choose the 30-day plan or redeem a Calup access code.'];
}

function remainingLabel(entitlement, serverTime) {
  if (!entitlement?.expiresAt) return 'No active period';
  const target = new Date(entitlement.status === 'grace' ? entitlement.graceEndsAt : entitlement.expiresAt).getTime();
  const now = new Date(serverTime || Date.now()).getTime();
  const days = Math.max(0, Math.ceil((target - now) / 86400000));
  return `${days} day${days === 1 ? '' : 's'} remaining`;
}

export default function Subscription() {
  const [subscription, setSubscription] = useState(null);
  const [billing, setBilling] = useState(emptyBilling);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const billingDirty = useRef(false);
  const modalTrigger = useRef(null);
/* Disabled navigation enhancement (user request):
  const [loadFailed, setLoadFailed] = useState(false);
*/
  const [savingBilling, setSavingBilling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [, setNotice] = usePopupFeedback(null, 'info');
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [cancellationPeriod, setCancellationPeriod] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
/* Disabled navigation enhancement (user request):
    setLoadFailed(false);
*/
    try {
      const result = await subscriptionService.get();
      if (!result?.plan || !result?.allowedActions) throw new Error('Subscription details are incomplete. Please try again.');
      setSubscription(result);
      setLoadError('');
      if (!billingDirty.current) setBilling(result.billingProfile || emptyBilling);
    } catch (error) {
/* Disabled navigation enhancement (user request):
      setLoadFailed(true);
*/
      setLoadError(error.message || 'Subscription information is unavailable.');
      setNotice({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const entitlement = subscription?.entitlement;
  const plan = subscription?.plan;
  const openOrder = subscription?.openOrder;
  const cancellation = subscription?.cancellation;
  const [statusTitle, statusDescription] = statusCopy(entitlement?.status);
  const billingComplete = Boolean(billing.legalName && billing.addressLine1 && billing.city && billing.state && billing.postalCode);
  const priceRows = useMemo(() => plan ? [
    ['Plan price', money(plan.baseAmountPaise)],
    [`GST (${(plan.taxRateBps / 100).toFixed(0)}%)`, money(plan.taxAmountPaise)],
  ] : [], [plan]);

  const updateBilling = event => { billingDirty.current = true; setBilling(current => ({ ...current, [event.target.name]: event.target.value })); };

  const saveBilling = async event => {
    event.preventDefault();
    setSavingBilling(true);
    setNotice(null);
    try {
      const saved = await subscriptionService.saveBillingProfile(billing);
      billingDirty.current = false;
      setBilling(saved);
      setSubscription(current => ({ ...current, billingProfile: saved }));
      setNotice({ type: 'success', text: 'Billing details saved.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setSavingBilling(false);
    }
  };

  const applyProjection = result => {
    if (!result) return;
    setSubscription(result);
    if (result.billingProfile && !billingDirty.current) setBilling(result.billingProfile);
    window.dispatchEvent(new CustomEvent('calup:subscription-updated', { detail: result }));
  };

  const openLatestReceipt = async (projection, orderId) => {
    try {
      const document = await findSubscriptionReceipt(projection, orderId, subscriptionService.getDocument);
      if (document) { setSelectedDocument(document); return; }
      setNotice({ type: 'info', text: 'Payment verified. The receipt for this renewal is not available yet. Check Documents again shortly.' });
    } catch (error) {
      setNotice({ type: 'error', text: `Payment verified, but its receipt could not be loaded: ${error.message}` });
    }
  };

  const refreshPayment = async orderId => {
    modalTrigger.current = document.activeElement;
    setRefreshing(true);
    setNotice(null);
    try {
      const result = await subscriptionService.refreshOrder(orderId);
      applyProjection(result.data);
      const applied = isSubscriptionOrderApplied(result.data, orderId);
      setNotice(subscriptionOrderNotice(result.data, orderId));
      if (applied) await openLatestReceipt(result.data, orderId);
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setRefreshing(false);
    }
  };

  const startPayment = async () => {
    modalTrigger.current = document.activeElement;
    if (!billingComplete || billingDirty.current) {
      setNotice({ type: 'error', text: 'Save complete billing details before continuing to payment.' });
      window.document.getElementById('subscription-billing')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (!plan?.id) return;
    setPaying(true);
    setNotice(null);
    try {
      const key = crypto.randomUUID().replace(/-/g, '');
      const orderResult = await subscriptionService.createOrder(plan.id, key);
      const order = orderResult.data;
      if (!order?.paymentSessionId) {
        setNotice({ type: 'info', text: 'Cashfree has not provided an active checkout. Check payment status before trying again.' });
        await load();
        return;
      }
      const popupResult = await cashfreeCheckoutService.openHostedPopup({
        paymentSessionId: order.paymentSessionId,
        cashfreeMode: order.cashfreeMode,
        recoveryPath: '/dashboard/subscription',
      });
      const result = popupResult?.redirect
        ? await subscriptionService.refreshOrder(order.orderId)
        : await subscriptionService.finishCheckout(order.orderId);
      applyProjection(result.data);
      const applied = isSubscriptionOrderApplied(result.data, order.orderId);
      setNotice(subscriptionOrderNotice(result.data, order.orderId));
      if (applied) await openLatestReceipt(result.data, order.orderId);
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Subscription payment could not be completed.' });
      await load();
    } finally {
      setPaying(false);
    }
  };

  const redeem = async event => {
    event.preventDefault();
    setRedeeming(true);
    setNotice(null);
    try {
      const result = await subscriptionService.redeemCode(code);
      applyProjection(result);
      setCode('');
      setNotice({ type: 'success', text: 'Access code applied successfully.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setRedeeming(false);
    }
  };

  const cancelSelectedPeriod = async () => {
    if (!cancellationPeriod?.id) return;
    setCancelling(true);
    setNotice(null);
    try {
      const result = await subscriptionService.cancelPeriod(cancellationPeriod.id);
      applyProjection(result);
      setCancellationPeriod(null);
      setNotice({
        type: result.cancellationResult?.refundPending ? 'info' : 'success',
        text: result.cancellationResult?.refundPending
          ? 'The selected period is cancelled. Its Cashfree refund is being processed.'
          : 'The selected period is cancelled and its full refund has been submitted.',
      });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setCancelling(false);
    }
  };

  const viewDocument = async id => {
    modalTrigger.current = document.activeElement;
    try {
      setSelectedDocument(await subscriptionService.getDocument(id));
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    }
  };

  if (loading && !subscription) return <div className="subscription-loading"><div className="spinner" /><span>Loading subscription…</span></div>;

  if (!subscription) return <section className="subscription-card"><h2>Subscription information unavailable</h2><p role="alert">{loadError || 'We cannot confirm your access or plan price.'}</p><button type="button" className="btn btn-secondary" onClick={load}>Try loading again</button></section>;

  return (
    <div className="subscription-page animate-fade-in-up">
{/* Disabled navigation enhancement (user request):
<PageLinks links={[{ to: '/subscriptions', label: 'Plan details' }, { to: '/refund-policy', label: 'Refund policy' }, { to: '/contact', label: 'Billing support' }]} />
*/}
{/* Disabled navigation enhancement (user request):
      {loadFailed && <button type="button" className="btn btn-secondary" onClick={load}>Retry loading subscription</button>}
*/}

      {loadError && <p role="alert">Your last loaded subscription details may be out of date. {loadError} <button type="button" onClick={load} disabled={loading}>Try loading again</button></p>}
      <section className={`subscription-hero status-${entitlement?.status || 'none'}`}>
        <div>
          <div className="subscription-eyebrow">CALUP ACCESS</div>
          <div className="subscription-status-line">
            <span className="subscription-status-dot" />
            <h2>{statusTitle}</h2>
          </div>
          <p>{statusDescription}</p>
        </div>
        <div className="subscription-time-card">
          <strong>{remainingLabel(entitlement, subscription?.serverTime)}</strong>
          <span>Access ends {dateTime(entitlement?.expiresAt)}</span>
          {entitlement?.graceEndsAt && <span>Grace ends {dateTime(entitlement.graceEndsAt)}</span>}
          {entitlement?.deletionScheduledAt && <span>Retention deadline {dateTime(entitlement.deletionScheduledAt)}</span>}
        </div>
      </section>

      {subscription?.review && (
        <div className="subscription-notice warning">
          A payment is under manual review ({subscription.review.reason.replaceAll('_', ' ')}). Calup will resolve it by {dateTime(subscription.review.reviewDueAt)}. Do not pay again.
        </div>
      )}

      <div className="subscription-grid">
        <section className="subscription-card plan-card">
          <div className="subscription-card-heading">
            <div>
              <span className="section-kicker">CURRENT OFFERING</span>
              <h3>{plan?.name || 'Calup 30-Day Plan'}</h3>
            </div>
            {plan?.isTest && <span className="sandbox-badge">SANDBOX</span>}
          </div>
          <p className="subscription-muted">{plan?.description}</p>
          <div className="price-total">
            <strong>{money(plan?.totalAmountPaise)}</strong>
            <span>for {plan?.durationDays || 30} days</span>
          </div>
          <div className="price-breakdown">
            {priceRows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
            <div className="price-final"><span>Total payable</span><strong>{money(plan?.totalAmountPaise)}</strong></div>
          </div>
          <ul className="plan-features">
            <li>Accept and manage customer bookings</li>
            <li>Cashfree payments, Google Meet, reports, and support tools</li>
            <li>Five-day grace period after access expires</li>
          </ul>
          <PillButton
            variant="lime"
            size="lg"
            onClick={startPayment}
            loading={paying}
            disabled={Boolean(loadError) || loading || !subscription?.allowedActions?.renew || Boolean(subscription?.review)}
            style={{ width: '100%' }}
          >
            {openOrder?.paymentSessionId ? 'Continue payment' : 'Renew 30-day access'}
          </PillButton>
          {!subscription?.allowedActions?.renew && <p className="subscription-footnote">Renewal opens seven days before expiry.</p>}
          <p className="subscription-footnote">Automatic recurring debit is not enabled. Payment is verified by the Calup server.</p>
          <div className="subscription-renewal-summary">
            <div><span>Paid access currently ends</span><strong>{dateTime(entitlement?.expiresAt)}</strong></div>
            {cancellation?.refundablePeriodCount > 0 && <div><span>Unused prepaid periods</span><strong>{cancellation.refundablePeriodCount} · {money(cancellation.refundableAmountPaise)}</strong></div>}
            {cancellation?.refundPendingCount > 0 && <div><span>Refunds in progress</span><strong>{cancellation.refundPendingCount}</strong></div>}
          </div>
          {cancellation?.periods?.some(period => period.status === 'scheduled') && (
            <div className="prepaid-period-list">
              <span className="section-kicker">PREPAID PERIODS</span>
              {cancellation.periods.filter(period => period.status === 'scheduled').map((period, index) => (
                <div className="prepaid-period" key={period.id}>
                  <div><strong>Future period {index + 1}</strong><span>{dateTime(period.startsAt)} – {dateTime(period.endsAt)}</span><small>{period.invoiceNumber} · {money(period.amountPaise)}</small></div>
                  <button type="button" onClick={() => { modalTrigger.current = document.activeElement; setCancellationPeriod(period); }}>Cancel</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="subscription-card" id="subscription-billing">
          <div className="subscription-card-heading">
            <div><span className="section-kicker">REQUIRED FOR PAYMENT</span><h3>Billing identity</h3></div>
            {billing.version && !billingDirty.current && <span className="saved-badge">Saved</span>}{billingDirty.current && <span>Unsaved changes</span>}
          </div>
          <form className="billing-form" onSubmit={saveBilling}><fieldset disabled={savingBilling} className="subscription-billing-fields">
            <label>Legal name<input name="legalName" value={billing.legalName || ''} onChange={updateBilling} required minLength="2" /></label>
            <label>Address line 1<input name="addressLine1" value={billing.addressLine1 || ''} onChange={updateBilling} required minLength="5" /></label>
            <label>Address line 2 <span>Optional</span><input name="addressLine2" value={billing.addressLine2 || ''} onChange={updateBilling} /></label>
            <div className="billing-row">
              <label>City<input name="city" value={billing.city || ''} onChange={updateBilling} required /></label>
              <label>State<input name="state" value={billing.state || ''} onChange={updateBilling} required /></label>
            </div>
            <div className="billing-row">
              <label>Postal code<input name="postalCode" inputMode="numeric" maxLength="6" value={billing.postalCode || ''} onChange={updateBilling} required /></label>
              <label>GSTIN <span>Optional</span><input name="gstin" maxLength="15" value={billing.gstin || ''} onChange={updateBilling} /></label>
            </div>
            <PillButton type="submit" variant="secondary" loading={savingBilling}>Save billing details</PillButton></fieldset>
          </form>
        </section>
      </div>

      {openOrder && (
        <section className="subscription-card payment-status-card">
          <div><span className="section-kicker">OPEN RENEWAL</span><h3>Payment status: {openOrder.paymentStatus?.replaceAll('_', ' ')}</h3>
            <p>Order expires {dateTime(openOrder.expiresAt)}. Reuse this order instead of starting another payment.</p></div>
          <PillButton variant="secondary" onClick={() => refreshPayment(openOrder.id)} loading={refreshing}>Check payment status</PillButton>
        </section>
      )}

      <div className="subscription-grid lower-grid">
        <section className="subscription-card">
          <span className="section-kicker">CALUP-ISSUED ACCESS</span>
          <h3>Have an access code?</h3>
          <p className="subscription-muted">Codes are used for testing or approved Calup service resolutions. They do not create a payment or tax invoice.</p>
          <form className="code-form" onSubmit={redeem}>
            <label className="subscription-code-label">Calup access code<input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="CALUP-XXXX-XXXX" minLength="8" required /></label>
            <PillButton type="submit" variant="secondary" loading={redeeming}>Apply code</PillButton>
          </form>
        </section>

        <section className="subscription-card">
          <span className="section-kicker">BILLING HISTORY</span>
          <h3>Documents</h3>
          {subscription?.documents?.length ? (
            <div className="document-list">
              {subscription.documents.map(item => (
                <button key={item.id} type="button" onClick={() => viewDocument(item.id)}>
                  <span><strong>{item.number}</strong><small>{item.type.replace('_', ' ')} · {dateTime(item.issuedAt)}</small></span>
                  <span><strong>{money(item.amountPaise)}</strong><small>{item.isTest ? 'Sandbox' : 'Issued'}</small></span>
                </button>
              ))}
            </div>
          ) : <p className="subscription-muted">Verified paid renewals and their documents will appear here.</p>}
        </section>
      </div>

      {['frozen', 'deletion_scheduled'].includes(entitlement?.status) && (
        <section className="subscription-card frozen-guidance">
          <h3>What remains available</h3>
          <p>You can manage upcoming appointments, refunds, disputes, open tickets, and the 50 most recent past events. New services and customer bookings remain blocked until access is restored.</p>
        </section>
      )}

      {selectedDocument && (
        <AccessibleModal label="Subscription receipt" onClose={() => setSelectedDocument(null)} returnFocusRef={modalTrigger}>
          <div className="subscription-document subscription-receipt-modal" onClick={event => event.stopPropagation()}>
            <div className="document-header"><div><span className="section-kicker">{selectedDocument.isTest ? 'SANDBOX RECEIPT' : 'CALUP BILLING'}</span><h2>{selectedDocument.number}</h2></div><button type="button" onClick={() => setSelectedDocument(null)} aria-label="Close receipt">×</button></div>
            <SubscriptionReceipt key={selectedDocument.id} receipt={selectedDocument} />
            <div className="document-actions"><PillButton variant="secondary" onClick={() => window.print()}>Print / Save PDF</PillButton><PillButton onClick={() => setSelectedDocument(null)}>Close</PillButton></div>
          </div>
        </AccessibleModal>
      )}

      {cancellationPeriod && (
        <AccessibleModal label="Cancel future subscription period" onClose={() => { if (!cancelling) setCancellationPeriod(null); }} returnFocusRef={modalTrigger}>
          <div className="subscription-cancellation-modal" aria-labelledby="subscription-cancel-title" onClick={event => event.stopPropagation()}>
            <span className="section-kicker">CANCEL ONE PREPAID PERIOD</span>
            <h2 id="subscription-cancel-title">Cancel this future period?</h2>
            <p>The selected period runs from <strong>{dateTime(cancellationPeriod.startsAt)}</strong> to <strong>{dateTime(cancellationPeriod.endsAt)}</strong>.</p>
            <div className="cancellation-refund-summary">
              <div><span>Invoice</span><strong>{cancellationPeriod.invoiceNumber}</strong></div>
              <div><span>Full refund requested</span><strong>{money(cancellationPeriod.amountPaise)}</strong></div>
              <div><span>Access will end</span><strong>{dateTime(cancellationPeriod.accessEndsAtAfterCancellation)}</strong></div>
            </div>
            <p className="subscription-muted">Only this unused payment will be refunded. Later prepaid periods move forward to keep access continuous. The current period and every other prepaid payment remain active.</p>
            <div className="document-actions">
              <PillButton variant="secondary" onClick={() => setCancellationPeriod(null)} disabled={cancelling}>Keep period</PillButton>
              <PillButton onClick={cancelSelectedPeriod} loading={cancelling}>Cancel period and refund</PillButton>
            </div>
          </div>
        </AccessibleModal>
      )}
    </div>
  );
}
