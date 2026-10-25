/**
 * Calup customer booking lookup and secure details page.
 * Persistent public customer-management route backed by Supabase.
 * Allows customers to view confirmation, reschedule slots, and cancel with policy evaluation.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import TicketPanel from '../../components/support/TicketPanel';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { usePopupFeedback } from '../../hooks/usePopupFeedback.js';
import {
  useStore,
  formatCurrency,
  formatDate,
  formatTime,
  getStatusBadgeClass,
  getDepositBadgeClass,
  getStatusLabel,
  getDepositLabel,
} from '../../data/store';
import { ACTIONS } from '../../data/actions';
import {
  getInitials,
  getTimeSlotsDetailedForDate,
  getCalendarDays,
  isDateAvailable,
  isPastDate,
  isFutureDate,
} from '../../utils/helpers';
import { dbService } from '../../services/supabase/dbService';
import { realGoogleCalendarService } from '../../services/calendar/RealGoogleCalendarProvider';
import { buildManagementUrl } from '../../utils/token';
import { isSupabaseConfigured } from '../../services/supabase/supabaseClient';
import { customerBookingService } from '../../services/booking/customerBookingService';
import { clearLastBooking } from '../../utils/lastBooking';
import { calculateCancellationRefund, DEFAULT_POLICY } from '../../utils/policyEngine';
import { bookingStartMillis } from '../../utils/bookingTime.js';
import PillButton from '../../components/ui/PillButton';
import AccessibleModal from '../../components/ui/AccessibleModal.jsx';
import BrandLogo from '../../components/ui/BrandLogo';
import './BookingPage.css';
/* Disabled navigation enhancement (user request):
import PageLinks from '../../components/ui/PageLinks';
*/
/* Disabled navigation enhancement (user request):
import { merchantBookingPath } from '../../utils/navigation';
*/

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function CustomerBooking() {
  const { token, id } = useParams();
  const lookupIdentifier = token || id;
  const normalizedLookupIdentifier = String(lookupIdentifier || '').trim().toUpperCase();
  const isPublicBookingReference = /^M\d{9}$/.test(normalizedLookupIdentifier);

  const navigate = useNavigate();
  const location = useLocation();
  const { state, dispatch, addToast } = useStore();

/* Disabled navigation enhancement (user request):
  useEffect(() => {
    if (location.state?.freshLookup) {
      setLookupInput(''); setTrackingPhone(''); setIsTrackingVerified(false); setSupabaseBookingData(null); setTrackingError('');
    } else if (location.state?.bookingReference) {
      setLookupInput(location.state.bookingReference); setTrackingPhone(''); setIsTrackingVerified(false);
    }
  }, [location.key, location.state?.freshLookup, location.state?.bookingReference, setTrackingError]);

*/

  const [lookupInput, setLookupInput] = useState(() => location.state?.bookingReference || '');
  const [trackingPhone, setTrackingPhone] = useState('');
  const [, setTrackingError] = usePopupFeedback();
  const [isVerifyingTracking, setIsVerifyingTracking] = useState(false);
  const [isTrackingVerified, setIsTrackingVerified] = useState(false);
  const [copiedTracking, setCopiedTracking] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [rescheduledSuccess, setRescheduledSuccess] = useState(false);
  const [isSubmittingReschedule, setIsSubmittingReschedule] = useState(false);

  // Month navigation for calendar picker in reschedule modal
  const [rescheduleCalMonth, setRescheduleCalMonth] = useState(() => new Date().getMonth());
  const [rescheduleCalYear, setRescheduleCalYear] = useState(() => new Date().getFullYear());

  // Slot fetching state for reschedule modal
  const [rescheduleDbBusySlots, setRescheduleDbBusySlots] = useState([]);
  const [rescheduleGcalBusyTimes, setRescheduleGcalBusyTimes] = useState([]);
  const [isLoadingRescheduleSlots, setIsLoadingRescheduleSlots] = useState(false);
  const [rescheduleSlotsError, setRescheduleSlotsError] = useState(null);
  const rescheduleRequestVersion = useRef(0);
  const [loadedRescheduleScope, setLoadedRescheduleScope] = useState(null);

  const [nowMillis, setNowMillis] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMillis(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const today = new Date(nowMillis).toISOString().split('T')[0];

  // Payment state
  const [paymentScreenshot, setPaymentScreenshot] = useState(null);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [isRetryingPayment, setIsRetryingPayment] = useState(false);
  const paymentFileRef = { current: null };

  const [supabaseBookingData, setSupabaseBookingData] = useState(null);
  const [isLoading, setIsLoading] = useState(() => location.pathname === '/booking-details' || Boolean(lookupIdentifier && !isPublicBookingReference));

  const bookingInState = state.bookings?.find(
    b => b.managementToken === lookupIdentifier || b.id === lookupIdentifier
  );

  // Authoritative server projection is source of truth when Supabase is configured.
  const resolvedBooking = isSupabaseConfigured()
    ? (supabaseBookingData?.booking || (!isLoading ? (bookingInState || null) : null))
    : (supabaseBookingData?.booking || bookingInState || null);

  // Authoritative Supabase hydration for persistent access across refresh, tabs, or incognito
  useEffect(() => {
    let isMounted = true;

    if (isPublicBookingReference) {
      setSupabaseBookingData(null);
      setLookupInput(normalizedLookupIdentifier);
      setTrackingError('');
      setIsTrackingVerified(false);
      setIsLoading(false);
      navigate('/booking-status', { replace: true, state: { bookingReference: normalizedLookupIdentifier } });
      return () => {
        isMounted = false;
      };
    }

    if ((lookupIdentifier && lookupIdentifier !== 'lookup') || location.pathname === '/booking-details') {
      setIsLoading(true);
      customerBookingService
        .getBooking(lookupIdentifier)
        .then(data => {
          if (isMounted) {
            if (data) {
              setSupabaseBookingData(data);
              setIsTrackingVerified(true);
              if (lookupIdentifier) navigate('/booking-details', { replace: true });
            }
            setIsLoading(false);
          }
        })
        .catch(err => {
          console.error('Failed to load booking from API/Supabase:', err);
          if (isMounted) setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [lookupIdentifier, isPublicBookingReference, location.pathname, navigate, normalizedLookupIdentifier, setTrackingError]);

  // Live status update on customer screen via backend token endpoint polling (every 6s)
  useEffect(() => {
    if ((!lookupIdentifier && location.pathname !== '/booking-details') || lookupIdentifier === 'lookup' || (isPublicBookingReference && !isTrackingVerified)) return;

    // Only poll while status is pending or active (stop polling once confirmed/cancelled/rejected/completed)
    const currentStatus = resolvedBooking?.status;
    const currentPaymentStatus = resolvedBooking?.paymentStatus;
    const isTerminal = (currentStatus === 'confirmed' && (currentPaymentStatus === 'confirmed' || currentPaymentStatus === 'not_required')) ||
      currentStatus === 'cancelled' ||
      currentStatus === 'late-cancellation' ||
      currentStatus === 'completed' ||
      currentStatus === 'rejected';

    if (isTerminal) return;

    let isMounted = true;
    const intervalId = setInterval(async () => {
      try {
        const freshData = await customerBookingService.getBooking(lookupIdentifier, trackingPhone);
        if (!isMounted || !freshData?.booking) return;

        const prevStatus = resolvedBooking?.status;
        const prevPaymentStatus = resolvedBooking?.paymentStatus;
        const newStatus = freshData.booking.status;
        const newPaymentStatus = freshData.booking.paymentStatus;

        // Detect status transitions and trigger user toasts
        if (newStatus !== prevStatus || newPaymentStatus !== prevPaymentStatus) {
          setSupabaseBookingData(freshData);

          if (newStatus === 'confirmed' && (newPaymentStatus === 'confirmed' || newPaymentStatus === 'not_required')) {
            addToast('Payment confirmed! Your session is set ✓');
          } else if (newStatus === 'rejected' || newPaymentStatus === 'rejected') {
            addToast('Payment could not be verified. Please contact your coach.', 'error');
          }
        }
      } catch (_err) {
        // Non-blocking poll error
      }
    }, 6000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [lookupIdentifier, isPublicBookingReference, isTrackingVerified, trackingPhone, resolvedBooking?.status, resolvedBooking?.paymentStatus, addToast, location.pathname]);

  const isStateBooking = Boolean(
    bookingInState &&
    state.provider &&
    (!bookingInState.providerId || bookingInState.providerId === state.provider.id)
  );
  const provider = supabaseBookingData?.provider || (isStateBooking ? state.provider : null);
  const policies = supabaseBookingData?.policies || supabaseBookingData?.cancellationPolicy || (isStateBooking ? state.policies : null) || {
    cancellationWindow: 12,
    freeCancellation: true,
  };
  const availability = supabaseBookingData?.availability || (isStateBooking ? state.availability : null);
  const services = useMemo(
    () => supabaseBookingData?.services || (isStateBooking ? (state.services || []) : []),
    [supabaseBookingData?.services, isStateBooking, state.services]
  );
  const isGcal = Boolean(isStateBooking && state.googleCalendar?.isConnected);
  const providerSlug = provider?.slug || '';
/* Disabled navigation enhancement (user request):
  const customerNavigation = <PageLinks label="Booking navigation" links={[
    { to: '/', label: 'Calup home' },
    merchantBookingPath(providerSlug || location.state?.merchantSlug) && { to: merchantBookingPath(providerSlug || location.state?.merchantSlug || state.provider?.slug), label: 'Merchant booking page' },
    { to: '/booking-status', label: 'Change booking ID', state: { freshLookup: true, merchantSlug: providerSlug || location.state?.merchantSlug } },
    { to: '/contact', label: 'Get help' },
  ]} />;
*/

  const managementUrl = buildManagementUrl(resolvedBooking?.managementToken || lookupIdentifier);

  const targetServiceId = resolvedBooking?.serviceId || resolvedBooking?.service_id || supabaseBookingData?.service?.id;

  const effectiveServices = useMemo(() => {
    let list = [...services];
    if (supabaseBookingData?.service?.id && !list.some(s => s.id === supabaseBookingData.service.id)) {
      list.push(supabaseBookingData.service);
    }
    if (targetServiceId && !list.some(s => s.id === targetServiceId)) {
      list.push({
        id: targetServiceId,
        name: resolvedBooking?.serviceName || 'Session',
        duration: resolvedBooking?.duration || 60,
      });
    }
    return list;
  }, [services, supabaseBookingData?.service, targetServiceId, resolvedBooking]);

  const maxAdvanceDays = availability?.maxAdvanceBooking ?? 30;
  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + maxAdvanceDays);
    return d.toISOString().split('T')[0];
  }, [maxAdvanceDays]);

  const rescheduleCalDays = useMemo(() => {
    return getCalendarDays(rescheduleCalYear, rescheduleCalMonth);
  }, [rescheduleCalYear, rescheduleCalMonth]);

  const rescheduleScope = `${provider?.id}:${resolvedBooking?.id}:${newDate}`;
  const rescheduleSlotsReady = loadedRescheduleScope === rescheduleScope && !isLoadingRescheduleSlots && !rescheduleSlotsError;
  const fetchRescheduleSlots = useCallback(async (date) => {
    const version = ++rescheduleRequestVersion.current;
    const isCurrent = () => version === rescheduleRequestVersion.current;
    setNewTime('');
    setLoadedRescheduleScope(null);
    setRescheduleDbBusySlots([]);
    setRescheduleGcalBusyTimes([]);
    if (!date || !provider?.id) return;
    setIsLoadingRescheduleSlots(true);
    setRescheduleSlotsError(null);
    const tz = provider.timezone || 'Asia/Kolkata';
    try {
      const [busySlots, gcalTimes] = await Promise.all([
        dbService.getBusySlots(provider.id, date, resolvedBooking?.id, targetServiceId, { strict: true }),
        realGoogleCalendarService.getBusyTimes(date, provider.id, tz),
      ]);
      if (!isCurrent()) return;
      if (!Array.isArray(busySlots) || !Array.isArray(gcalTimes)) throw new Error('Invalid availability response');
      setRescheduleDbBusySlots(busySlots);
      setRescheduleGcalBusyTimes(gcalTimes);
      setLoadedRescheduleScope(`${provider.id}:${resolvedBooking?.id}:${date}`);
    } catch {
      if (isCurrent()) setRescheduleSlotsError('Unable to load available slots. Please try again.');
    } finally {
      if (isCurrent()) setIsLoadingRescheduleSlots(false);
    }
  }, [provider?.id, provider?.timezone, resolvedBooking?.id, targetServiceId]);

  useEffect(() => {
    const requests = rescheduleRequestVersion;
    if (showRescheduleModal && newDate) fetchRescheduleSlots(newDate);
    return () => { ++requests.current; };
  }, [showRescheduleModal, newDate, fetchRescheduleSlots]);

  // Available slots for customer rescheduling (strictly available, excluding own current slot)
  const availableRescheduleSlots = useMemo(() => {
    if (!rescheduleSlotsReady || !resolvedBooking || !newDate || !availability || !targetServiceId) return [];

    const formattedDbBookings = rescheduleDbBusySlots.map(s => ({
      date: newDate,
      startTime: s.start_time,
      endTime: s.end_time,
      actualEndTime: s.actual_end_time,
      status: 'confirmed',
    }));

    const allBookingsToCheck = [
      ...formattedDbBookings,
      ...(supabaseBookingData?.bookings || []),
      ...(isStateBooking ? (state.bookings || []) : []),
    ];

    const slots = getTimeSlotsDetailedForDate(
      newDate,
      availability,
      effectiveServices,
      targetServiceId,
      allBookingsToCheck,
      rescheduleGcalBusyTimes,
      resolvedBooking.id // Exclude self
    );

    return slots
      .filter(s => s.available)
      .filter(s => {
        // Exclude customer's own current slot if on the same date
        if (newDate === resolvedBooking.date && s.time === resolvedBooking.startTime) {
          return false;
        }
        return true;
      });
  }, [
    rescheduleSlotsReady,
    resolvedBooking,
    newDate,
    availability,
    effectiveServices,
    targetServiceId,
    rescheduleDbBusySlots,
    rescheduleGcalBusyTimes,
    supabaseBookingData?.bookings,
    isStateBooking,
    state.bookings,
  ]);

  // Time-sensitive controls use the provider's wall clock and refresh while the page is open.
  const cancellationWindow = policies?.cancellationWindow ?? 12;
  const sessionStartMillis = bookingStartMillis({
    booking_date: resolvedBooking?.date,
    start_time: resolvedBooking?.startTime,
  }, provider?.timezone || 'Asia/Kolkata');
  const hoursNotice = (sessionStartMillis - nowMillis) / 3600000;
  const isWithinFreeCancellation = Number.isFinite(hoursNotice) && hoursNotice >= cancellationWindow;
  const rescheduleMinHours = Number(resolvedBooking?.policySnapshot?.reschedule_min_hours_before
    ?? policies?.reschedule_min_hours_before ?? DEFAULT_POLICY.reschedule_min_hours_before);
  const rescheduleWindow = Number.isFinite(rescheduleMinHours) ? rescheduleMinHours : DEFAULT_POLICY.reschedule_min_hours_before;
  const isWithinRescheduleWindow = Number.isFinite(hoursNotice) && hoursNotice >= rescheduleWindow;

  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeType, setDisputeType] = useState('refund');
  const [disputeNote, setDisputeNote] = useState('');
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);

  const liveRefundConsequence = useMemo(() => {
    if (!resolvedBooking) return null;
    return calculateCancellationRefund({
      booking: resolvedBooking,
      currentTime: new Date(nowMillis),
      timezone: provider?.timezone || 'Asia/Kolkata',
    });
  }, [resolvedBooking, provider?.timezone, nowMillis]);

  const canReportCoachNoShow = useMemo(() => {
    if (!resolvedBooking || resolvedBooking.status !== 'confirmed') return false;
    const policy = resolvedBooking.policySnapshot || DEFAULT_POLICY;
    const graceMinutes = Number(policy.no_show_grace_minutes ?? DEFAULT_POLICY.no_show_grace_minutes);
    try {
      return Number.isFinite(sessionStartMillis) && nowMillis >= sessionStartMillis + (graceMinutes * 60 * 1000);
    } catch (_) {
      return false;
    }
  }, [resolvedBooking, sessionStartMillis, nowMillis]);

  const canDisputeNoShow = useMemo(() => {
    if (!resolvedBooking || resolvedBooking.status !== 'no-show') return false;
    try {
      const markedAt = resolvedBooking.customerNoShowAt ? new Date(resolvedBooking.customerNoShowAt).getTime() : new Date(resolvedBooking.createdAt).getTime();
      return nowMillis - markedAt <= 48 * 60 * 60 * 1000;
    } catch (_) {
      return false;
    }
  }, [resolvedBooking, nowMillis]);

  // Loading state avoids flashing "Appointment Not Found" during the initial fetch.
  if (isLoading) {
    return (
      <div className="booking-page">
        <div className="booking-container">
          <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-6)' }}>
            <div className="spinner" style={{ margin: '0 auto var(--space-4)' }} />
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
              Loading your appointment details...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Lookup state when no identifier is provided in the URL or identifier is 'lookup'
  if ((!lookupIdentifier || lookupIdentifier === 'lookup') && location.pathname !== '/booking-details') {
    return (
      <div className="janjiyuk-booking-canvas">
        <div className="janjiyuk-phone-card" style={{ maxWidth: 480 }}>
          <div className="booking-card-header">
            <div className="header-left">
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#EEF2FF',
                color: '#4F46E5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 700,
              }}>
                🔍
              </div>
              <div>
                <div className="header-provider-name">CalUp</div>
                <div className="header-step-sub">Booking Status Tracking</div>
              </div>
            </div>
            <BrandLogo iconOnly size={26} />
          </div>

          <div className="booking-step-pane" style={{ padding: '24px' }}>
            <h3 className="pane-headline" style={{ marginBottom: '8px' }}>Track Your Booking</h3>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', lineHeight: 1.5, marginBottom: '20px' }}>
              Enter your booking ID and the mobile number used while booking.
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const bookingId = lookupInput.trim().toUpperCase();
                const phone = trackingPhone.replace(/\D/g, '').replace(/^91(?=[6-9]\d{9}$)/, '');
                if (!/^M\d{9}$/.test(bookingId)) {
                  setTrackingError('Enter a valid booking ID in the format M followed by 9 digits.');
                  return;
                }
                if (!/^[6-9]\d{9}$/.test(phone)) {
                  setTrackingError('Enter the 10-digit Indian mobile number used for this booking.');
                  return;
                }
                setIsVerifyingTracking(true);
                setTrackingError('');
                try {
                  const data = await customerBookingService.getBooking(bookingId, phone);
                  setSupabaseBookingData(data);
                  setIsTrackingVerified(true);
                  navigate('/booking-details', { replace: true });
                } catch (error) {
                  setTrackingError(error.message || 'The booking ID or mobile number does not match.');
                } finally {
                  setIsVerifyingTracking(false);
                }
              }}
            >
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label htmlFor="customer-field-1" className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>Booking ID</label>
                <input id="customer-field-1"
                  type="text"
                  className="form-input"
                  placeholder="M123456789"
                  value={lookupInput}
                  onChange={(e) => setLookupInput(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', fontSize: '13px' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label" htmlFor="booking-lookup-phone">Mobile number</label>
                <input id="booking-lookup-phone" type="tel" inputMode="numeric" autoComplete="tel" className="form-input"
                  placeholder="10-digit mobile number" value={trackingPhone}
                  onChange={(event) => setTrackingPhone(event.target.value)} disabled={isVerifyingTracking}
                  style={{ width: '100%' }} />
              </div>
              <PillButton type="submit" variant="primary" disabled={isVerifyingTracking} style={{ width: '100%', justifyContent: 'center' }}>
                Check Status →
              </PillButton>
            </form>
          </div>

          <div className="booking-card-footer">
{/* Disabled navigation enhancement (user request):
{customerNavigation}
*/}
            <div className="booking-powered-by">Powered by <BrandLogo size={18} /></div>
          </div>
        </div>
      </div>
    );
  }

  if (isPublicBookingReference && !isTrackingVerified) {
    const verifyTracking = async (event) => {
      event.preventDefault();
      const phone = trackingPhone.replace(/\D/g, '').replace(/^91(?=[6-9]\d{9}$)/, '');
      if (!/^[6-9]\d{9}$/.test(phone)) {
        setTrackingError('Enter the 10-digit Indian mobile number used for this booking.');
        return;
      }

      setIsVerifyingTracking(true);
      setTrackingError('');
      try {
        const data = await customerBookingService.getBooking(normalizedLookupIdentifier, phone);
        setTrackingPhone(phone);
        setSupabaseBookingData(data);
        setIsTrackingVerified(true);
      } catch (error) {
        setTrackingError(error.message || 'The booking ID or mobile number does not match.');
      } finally {
        setIsVerifyingTracking(false);
      }
    };

    return (
      <div className="janjiyuk-booking-canvas">
        <div className="janjiyuk-phone-card" style={{ maxWidth: 480 }}>
          <div className="booking-card-header">
            <div className="header-left">
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#EEF2FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>M</div>
              <div>
                <div className="header-provider-name">CalUp</div>
                <div className="header-step-sub">Secure Booking Tracking</div>
              </div>
            </div>
            <BrandLogo iconOnly size={26} />
          </div>
          <div className="booking-step-pane" style={{ padding: '24px' }}>
            <h3 className="pane-headline" style={{ marginBottom: '8px' }}>Verify Your Booking</h3>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', lineHeight: 1.5, marginBottom: '20px' }}>
              Enter the mobile number used during payment. The booking ID alone cannot open customer details.
            </p>
            <form onSubmit={verifyTracking}>
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label htmlFor="customer-field-2" className="form-label">Booking ID</label>
                <input id="customer-field-2" className="form-input" value={normalizedLookupIdentifier} readOnly style={{ width: '100%' }} />
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label" htmlFor="tracking-phone">Mobile number</label>
                <input
                  id="tracking-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  className="form-input"
                  placeholder="10-digit mobile number"
                  value={trackingPhone}
                  onChange={(event) => setTrackingPhone(event.target.value)}
                  disabled={isVerifyingTracking}
                  style={{ width: '100%' }}
                />
              </div>
              <PillButton type="submit" variant="primary" disabled={isVerifyingTracking} style={{ width: '100%', justifyContent: 'center' }}>
                {isVerifyingTracking ? 'Verifying...' : 'View Booking'}
              </PillButton>
            </form>
          </div>
          <div className="booking-card-footer">
{/* Disabled navigation enhancement (user request):
{customerNavigation}
*/}
            <div className="booking-powered-by">Powered by <BrandLogo size={18} /></div>
          </div>
        </div>
      </div>
    );
  }

  // If booking not found
  if (!resolvedBooking) {
    return (
      <div className="janjiyuk-booking-canvas">
        <div className="janjiyuk-phone-card" style={{ maxWidth: 480 }}>
          <div className="booking-card-header">
            <div className="header-left">
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#FEE2E2',
                color: '#EF4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 700,
              }}>
                ✕
              </div>
              <div>
                <div className="header-provider-name">CalUp</div>
                <div className="header-step-sub">Booking Status</div>
              </div>
            </div>
            <BrandLogo iconOnly size={26} />
          </div>
          <div className="booking-step-pane" style={{ textAlign: 'center', padding: '32px 24px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📋</div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Booking Not Found</h3>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', lineHeight: 1.5, margin: '0 auto 20px', maxWidth: 320 }}>
              We couldn't find an appointment matching reference <br />
              <code style={{ background: '#F1F5F9', padding: '2px 6px', borderRadius: '4px', wordBreak: 'break-all' }}>{lookupIdentifier}</code>.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <PillButton variant="primary" onClick={() => navigate('/booking-status')} style={{ width: '100%', justifyContent: 'center' }}>
                Try Another Booking Reference
              </PillButton>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/')}
                style={{ width: '100%', border: 'none', background: 'transparent', color: '#64748B', fontSize: '13px', cursor: 'pointer', padding: '8px' }}
              >
                Return to CalUp Home
              </button>
            </div>
          </div>
          <div className="booking-card-footer">
{/* Disabled navigation enhancement (user request):
{customerNavigation}
*/}
            <div className="booking-powered-by">Powered by <BrandLogo size={18} /></div>
          </div>
        </div>
      </div>
    );
  }

  const handleOpenReschedule = () => {
    if (!isWithinRescheduleWindow) {
      addToast(`Rescheduling is not allowed within ${rescheduleWindow} hours of the appointment. Please contact your provider directly.`, 'error');
      return;
    }

    let initialDate = (resolvedBooking?.date && resolvedBooking.date >= today) ? resolvedBooking.date : today;
    if (!isDateAvailable(initialDate, availability) || isPastDate(initialDate)) {
      const baseD = new Date();
      for (let i = 0; i <= 30; i++) {
        const nextD = new Date(baseD);
        nextD.setDate(baseD.getDate() + i);
        const yStr = nextD.getFullYear();
        const mStr = String(nextD.getMonth() + 1).padStart(2, '0');
        const dStr = String(nextD.getDate()).padStart(2, '0');
        const cand = `${yStr}-${mStr}-${dStr}`;
        if (!isPastDate(cand) && isDateAvailable(cand, availability)) {
          initialDate = cand;
          break;
        }
      }
    }

    const [initY, initM] = initialDate.split('-').map(Number);
    if (!isNaN(initY) && !isNaN(initM)) {
      setRescheduleCalYear(initY);
      setRescheduleCalMonth(initM - 1);
    }
    setNewDate(initialDate);
    setNewTime('');
    setLoadedRescheduleScope(null);
    setShowRescheduleModal(true);
  };

  const handleConfirmReschedule = async () => {
    if (!rescheduleSlotsReady || !newDate || !newTime || isSubmittingReschedule) return;

    const isSlotValid = availableRescheduleSlots.some(s => s.time === newTime);
    if (!isSlotValid) {
      addToast('That slot was just booked, please pick another', 'error');
      setNewTime('');
      fetchRescheduleSlots(newDate);
      return;
    }

    const [h, m] = newTime.split(':').map(Number);
    const endMinutes = h * 60 + m + (resolvedBooking.duration || 60);
    const calculatedEndTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

    setIsSubmittingReschedule(true);
    try {
      const result = await customerBookingService.rescheduleBooking(lookupIdentifier, newDate, newTime);
      const finalEndTime = result?.booking?.endTime || calculatedEndTime;

      // Synchronize store and local state
      dispatch({
        type: ACTIONS.RESCHEDULE_BOOKING,
        payload: {
          id: resolvedBooking.id,
          date: newDate,
          startTime: newTime,
          endTime: finalEndTime,
        },
      });

      setSupabaseBookingData(prev => prev ? {
        ...prev,
        booking: {
          ...prev.booking,
          date: newDate,
          startTime: newTime,
          endTime: finalEndTime,
        },
      } : null);

      setRescheduledSuccess(true);
      addToast('Appointment rescheduled successfully.');
      setShowRescheduleModal(false);
    } catch (err) {
      console.error('Failed to reschedule:', err);
      const isConflict = err.isConflict || err.status === 409 || (err.message && (err.message.includes('no longer available') || err.message.includes('conflict')));
      if (isConflict) {
        addToast('That slot was just booked, please pick another', 'error');
        setNewTime('');
        fetchRescheduleSlots(newDate);
      } else {
        addToast(err.message || 'Failed to reschedule appointment.', 'error');
      }
    } finally {
      setIsSubmittingReschedule(false);
    }
  };

  const handleConfirmCancel = async () => {
    try {
      const result = await customerBookingService.cancelBooking(lookupIdentifier);
      const actualNewStatus = result?.status || (isWithinFreeCancellation ? 'cancelled' : 'late-cancellation');

      if (actualNewStatus === 'cancelled') {
        dispatch({ type: ACTIONS.CANCEL_BOOKING, payload: resolvedBooking.id });
        addToast(result?.message || 'Appointment cancelled.');
      } else {
        dispatch({ type: ACTIONS.MARK_LATE_CANCELLATION, payload: resolvedBooking.id });
        addToast(result?.message || 'Appointment cancelled (late cancellation).');
      }

      setSupabaseBookingData(prev => prev ? {
        ...prev,
        booking: {
          ...prev.booking,
          status: actualNewStatus,
        },
      } : null);

      setRescheduledSuccess(false);
      setShowCancelModal(false);
    } catch (err) {
      console.error('Failed to cancel:', err);
      addToast(err.message || 'Failed to cancel appointment.', 'error');
    }
  };

  const handleAddToCalendar = () => {
    if (!resolvedBooking) return;
    const title = encodeURIComponent(`${resolvedBooking.serviceName || 'Session'} with ${provider?.name || 'CalUp'}`);
    const details = encodeURIComponent(
      `Appointment with ${provider?.name}\nBooking ID: ${resolvedBooking.bookingId || resolvedBooking.id}\nView your booking: ${managementUrl}`
    );
    const cleanDate = (resolvedBooking.date || '').replace(/-/g, '');
    const startClean = (resolvedBooking.startTime || '').replace(':', '') + '00';
    const endClean = (resolvedBooking.endTime || '').replace(':', '') + '00';
    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${cleanDate}T${startClean}/${cleanDate}T${endClean}&details=${details}`;
    window.open(gcalUrl, '_blank', 'noopener,noreferrer');
  };

  const handleConfirmRefundReceived = async () => {
    setIsSubmittingDispute(true);
    try {
      await customerBookingService.refundAction(lookupIdentifier, 'confirm');
      setSupabaseBookingData(prev => prev ? {
        ...prev,
        booking: { ...prev.booking, refundStatus: 'confirmed' }
      } : null);
      addToast('Thank you! Refund receipt confirmed ✓');
    } catch (err) {
      addToast(err.message || 'Failed to confirm refund receipt.', 'error');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const handleOpenDisputeRefund = () => {
    setDisputeType('refund');
    setDisputeNote('');
    setShowDisputeModal(true);
  };

  const handleOpenDisputeNoShow = () => {
    setDisputeType('no_show');
    setDisputeNote('');
    setShowDisputeModal(true);
  };

  const handleSubmitDispute = async (e) => {
    e.preventDefault();
    if (!disputeNote.trim()) {
      addToast('Please enter a note explaining the dispute.', 'error');
      return;
    }
    setIsSubmittingDispute(true);
    try {
      if (disputeType === 'refund') {
        await customerBookingService.refundAction(lookupIdentifier, 'dispute', disputeNote.trim());
        setSupabaseBookingData(prev => prev ? {
          ...prev,
          booking: { ...prev.booking, refundStatus: 'disputed', status: 'disputed' }
        } : null);
        addToast('Dispute recorded. Our team will review this transaction.');
      } else {
        await customerBookingService.disputeNoShow(lookupIdentifier, disputeNote.trim());
        setSupabaseBookingData(prev => prev ? {
          ...prev,
          booking: { ...prev.booking, status: 'disputed' }
        } : null);
        addToast('No-show dispute submitted. Coach and CalUp admin alerted.');
      }
      setShowDisputeModal(false);
      setDisputeNote('');
    } catch (err) {
      addToast(err.message || 'Failed to submit dispute.', 'error');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const handleReportCoachNoShow = async () => {
    if (!window.confirm('Are you sure you want to report that your coach did not attend? This will initiate a 100% refund and flag the booking for review.')) {
      return;
    }
    try {
      await customerBookingService.reportCoachNoShow(lookupIdentifier);
      setSupabaseBookingData(prev => prev ? {
        ...prev,
        booking: {
          ...prev.booking,
          status: 'disputed',
          refundStatus: resolvedBooking.price > 0 ? 'refund_due' : 'none',
          refundAmount: resolvedBooking.price,
        }
      } : null);
      addToast('Coach no-show reported. Full refund has been initiated.');
    } catch (err) {
      addToast(err.message || 'Failed to report coach no-show.', 'error');
    }
  };

  const isPaidService = (resolvedBooking?.price || 0) > 0;
  const isReadOnlyTracking = resolvedBooking?.readOnly === true;
  const rawPaymentStatus = resolvedBooking?.paymentStatus;
  let paymentStatus = rawPaymentStatus || (isPaidService ? 'awaiting_payment' : 'not_required');
  if (isRetryingPayment && rawPaymentStatus !== 'rejected') {
    paymentStatus = 'awaiting_payment';
  }

  // A booking is only truly confirmed if:
  // - For a paid service: Supabase status is 'confirmed' AND paymentStatus is 'confirmed'
  // - For a free service: Supabase status is 'confirmed'
  const isConfirmed = isPaidService
    ? (resolvedBooking?.status === 'confirmed' && paymentStatus === 'confirmed')
    : (resolvedBooking?.status === 'confirmed');

  const isCancelled = resolvedBooking?.status === 'cancelled' || resolvedBooking?.status === 'late-cancellation';
  const isCompleted = resolvedBooking?.status === 'completed';
  const isReschedulable = !isCancelled && !isCompleted && resolvedBooking?.status !== 'rejected' && paymentStatus !== 'rejected';

  const providerName = provider?.name || provider?.businessName || 'Coach';
  const providerUpiId = supabaseBookingData?.provider?.upiId || null;
  const providerQrCodeUrl = supabaseBookingData?.provider?.qrCodeUrl || null;
  const showPaymentSection = Boolean(isPaidService && paymentStatus !== 'not_required' && !isConfirmed && !isCancelled && !isCompleted);

  // TODO(hardcoded): User-agent based mobile detection for 5-10 user test
  const isMobile = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');

  const customerName = resolvedBooking?.customerName?.trim();
  const paymentNote = customerName
    ? `CalUp Booking - ${customerName}`.slice(0, 45)
    : 'CalUp Appointment Booking';

  // TODO(hardcoded): Fixed currency INR for UPI payment link with URLSearchParams safe encoding
  const upiLink = providerUpiId
    ? `upi://pay?${new URLSearchParams({
        pa: providerUpiId,
        pn: providerName,
        am: String(resolvedBooking?.price || 0),
        cu: 'INR',
        tn: paymentNote,
      }).toString()}`
    : '';

  // Use coach's saved QR code image, or dynamically generate QR code from valid UPI deep link
  const displayQrCodeUrl = providerQrCodeUrl || (upiLink ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}` : null);

  // Compute Headline, Subline, Celebrate Icon, and Status Badge strictly from payment_status and booking state (States A, B, C, D)
  let celebrateBadge = '💳';
  let heroHeadline = 'Booking Reserved';
  let heroSubline = 'Complete your payment using UPI and submit the payment screenshot.';
  let statusBadgeText = 'Booking Reserved';
  let statusBadgeStyle = { background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' };

  if (paymentStatus === 'rejected' || resolvedBooking?.status === 'rejected') {
    // State D: Coach rejects
    celebrateBadge = '⚠️';
    heroHeadline = 'Payment Not Confirmed';
    heroSubline = 'Your coach could not verify the payment. Please contact your coach.';
    statusBadgeText = 'Payment Not Confirmed';
    statusBadgeStyle = { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' };
  } else if (resolvedBooking?.status === 'no-show') {
    celebrateBadge = '🚫';
    heroHeadline = 'Session Marked as No-Show';
    heroSubline = 'Your coach marked this appointment as unattended (0% refund).';
    statusBadgeText = 'No-Show';
    statusBadgeStyle = { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' };
  } else if (resolvedBooking?.status === 'disputed') {
    celebrateBadge = '⚖️';
    heroHeadline = 'Booking Under Review';
    heroSubline = 'This booking has an active dispute under review.';
    statusBadgeText = 'Disputed';
    statusBadgeStyle = { background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' };
  } else if (isCancelled) {
    celebrateBadge = '❌';
    heroHeadline = 'Appointment Cancelled';
    heroSubline = `Your appointment with ${providerName} has been cancelled.`;
    statusBadgeText = getStatusLabel(resolvedBooking?.status);
    statusBadgeStyle = null;
  } else if (isCompleted) {
    celebrateBadge = '✓';
    heroHeadline = 'Session Completed';
    heroSubline = `Thank you for attending your session with ${providerName}.`;
    statusBadgeText = 'Completed';
    statusBadgeStyle = null;
  } else if (isConfirmed) {
    // State C: Coach accepts (or free service confirmed)
    celebrateBadge = '🎉';
    heroHeadline = isPaidService ? 'Payment Confirmed' : 'Booking Confirmed';
    heroSubline = isPaidService
      ? `Your payment is confirmed. Your appointment with ${providerName} is set!`
      : `Your appointment with ${providerName} is confirmed.`;
    statusBadgeText = isPaidService ? 'Payment Confirmed' : 'Confirmed';
    statusBadgeStyle = { background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' };
  } else if (isPaidService) {
    if (paymentStatus === 'verification_pending') {
      // State B: Screenshot submitted, coach has not accepted
      celebrateBadge = '⏱️';
      heroHeadline = 'Payment Verification Pending';
      heroSubline = 'Your payment details have been submitted. Your coach will verify your payment shortly.';
      statusBadgeText = 'Payment Verification Pending';
      statusBadgeStyle = { background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE' };
    } else {
      // State A: Booking created, payment not submitted
      celebrateBadge = '💳';
      heroHeadline = 'Booking Reserved';
      heroSubline = 'Complete your payment using UPI and submit the payment screenshot.';
      statusBadgeText = 'Booking Reserved';
      statusBadgeStyle = { background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' };
    }
  }

  const handleMarkPaid = async () => {
    if (isMarkingPaid) return;
    if (!paymentScreenshot && !resolvedBooking?.paymentScreenshotUrl) {
      addToast('Please select and upload your payment screenshot before clicking I\'ve Paid.', 'error');
      return;
    }
    setIsMarkingPaid(true);
    try {
      const res = await customerBookingService.markPaid(lookupIdentifier, paymentScreenshot);
      addToast('Payment submitted. Awaiting coach verification.');
      setSupabaseBookingData(prev => prev ? {
        ...prev,
        booking: {
          ...prev.booking,
          paymentStatus: 'verification_pending',
          paymentMarkedPaidAt: res?.booking?.paymentMarkedPaidAt || new Date().toISOString(),
          paymentScreenshotUrl: res?.booking?.paymentScreenshotUrl || prev.booking?.paymentScreenshotUrl,
        },
      } : null);
      setPaymentScreenshot(null);
      setIsRetryingPayment(false);
    } catch (err) {
      console.error('Payment submission failed:', err);
      addToast(err.message || 'Failed to submit payment. Please try again.', 'error');
      // CRITICAL: Do NOT mark as verification_pending or confirmed on failure!
    } finally {
      setIsMarkingPaid(false);
    }
  };

  const meetUrl = resolvedBooking?.meetLink || resolvedBooking?.meet_link;
  const meetingType = resolvedBooking?.meetingType || resolvedBooking?.meeting_type || (resolvedBooking?.locationAddressSnapshot || resolvedBooking?.location_address_snapshot ? 'in-person' : 'online');
  const isInPerson = meetingType === 'in-person';
  const locationAddress = resolvedBooking?.locationAddressSnapshot || resolvedBooking?.location_address_snapshot || resolvedBooking?.locationAddress || resolvedBooking?.location_address || null;
  const mapsLink = locationAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationAddress)}` : null;

  const handleBookAnotherSession = () => {
    clearLastBooking();
    const targetSlug = providerSlug || provider?.slug || '';
    if (targetSlug) {
      navigate(`/book/${encodeURIComponent(targetSlug)}?fresh=1`);
    } else {
      navigate('/');
    }
  };

  const fullTrackingUrl = (typeof window !== 'undefined')
    ? `${window.location.origin}/booking-status`
    : '/booking-status';

  return (
    <div className="janjiyuk-booking-canvas">
      <div className="janjiyuk-phone-card" style={{ maxWidth: 480 }}>
        {/* Header Bar */}
        <div className="booking-card-header">
          <div className="header-left">
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#EEF2FF',
              color: '#4F46E5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: 700,
            }}>
              ✓
            </div>
            <div>
              <div className="header-provider-name">{provider?.businessName || provider?.name || 'CalUp'}</div>
              <div className="header-step-sub">Booking Status & Verification</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={handleBookAnotherSession}
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--color-primary-600, #4f46e5)',
                background: 'rgba(79, 70, 229, 0.08)',
                border: 'none',
                padding: '4px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Book another session"
            >
              Book another ↗
            </button>
            <BrandLogo iconOnly size={26} />
          </div>
        </div>

        {/* Confirmation / Management Header */}
        <div className="manage-header-block animate-scale-up">
          <div className="manage-avatar">
            {getInitials(provider?.name || 'U')}
          </div>
          <div className="manage-celebrate-badge">
            {celebrateBadge}
          </div>
          <h1 className="manage-headline">
            {heroHeadline}
          </h1>
          <p className="manage-subline">
            {heroSubline}
          </p>
        </div>

        <div className="booking-step-pane" style={{ paddingTop: 0 }}>
          {/* Rescheduled Success Alert */}
          {rescheduledSuccess && (
            <div className="animate-fade-in-up" style={{
              padding: '12px 16px',
              background: 'var(--color-lime-light)',
              borderRadius: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '13px',
              color: '#0E0E0E',
              fontWeight: 600,
            }}>
              <span style={{ fontSize: '16px' }}>✓</span>
              <div>
                <div>Appointment rescheduled successfully!</div>
                <div style={{ fontSize: '11.5px', fontWeight: 400, opacity: 0.8 }}>
                  New slot: {formatDate(resolvedBooking.date)} at {formatTime(resolvedBooking.startTime)}
                </div>
              </div>
            </div>
          )}

          {/* Details Block: clean label/value rows */}
          <div className="manage-details-card">
            {resolvedBooking.bookingId && (
              <div className="manage-detail-row">
                <span className="manage-detail-label">Booking ID</span>
                <span className="manage-detail-val" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{resolvedBooking.bookingId}</span>
              </div>
            )}
            <div className="manage-detail-row">
              <span className="manage-detail-label">Service</span>
              <span className="manage-detail-val">{resolvedBooking.serviceName}</span>
            </div>
            <div className="manage-detail-row">
              <span className="manage-detail-label">Date</span>
              <span className="manage-detail-val">{formatDate(resolvedBooking.date)}</span>
            </div>
            <div className="manage-detail-row">
              <span className="manage-detail-label">Time</span>
              <span className="manage-detail-val">
                {formatTime(resolvedBooking.startTime)} – {formatTime(resolvedBooking.endTime)}
              </span>
            </div>
            <div className="manage-detail-row">
              <span className="manage-detail-label">Duration</span>
              <span className="manage-detail-val">{resolvedBooking.duration} min</span>
            </div>
            <div className="manage-detail-row">
              <span className="manage-detail-label">Mode</span>
              <span className="manage-detail-val">{isInPerson ? '📍 In-person' : '🌐 Online'}</span>
            </div>
            {isInPerson && locationAddress && (
              <div className="manage-detail-row">
                <span className="manage-detail-label">Location</span>
                <span className="manage-detail-val" style={{ textAlign: 'right', maxWidth: '60%' }}>
                  {locationAddress}
                </span>
              </div>
            )}
            {(resolvedBooking.price !== undefined && resolvedBooking.price !== null) && (
              <div className="manage-detail-row">
                <span className="manage-detail-label">Amount</span>
                <span className="manage-detail-val" style={{ fontWeight: 600 }}>
                  {resolvedBooking.price > 0 ? formatCurrency(resolvedBooking.price) : 'Free'}
                </span>
              </div>
            )}
            <div className="manage-detail-row">
              <span className="manage-detail-label">Status</span>
              <span
                className={`badge ${statusBadgeStyle ? '' : 'badge-active'}`}
                style={{ textTransform: 'capitalize', ...(statusBadgeStyle || {}) }}
              >
                {statusBadgeText}
              </span>
            </div>
            {paymentStatus && paymentStatus !== 'not_required' && (
              <div className="manage-detail-row">
                <span className="manage-detail-label">Payment</span>
                <span className="manage-detail-val" style={{
                  fontWeight: 600,
                  color: paymentStatus === 'confirmed' ? '#16A34A' : (paymentStatus === 'verification_pending' ? '#D97706' : '#64748B'),
                }}>
                  {paymentStatus === 'confirmed'
                    ? '✓ Verified & Confirmed'
                    : (paymentStatus === 'verification_pending'
                      ? '⏱ Verification Pending'
                      : (paymentStatus === 'awaiting_payment' ? 'Awaiting Payment' : paymentStatus))}
                </span>
              </div>
            )}
          </div>

          {/* Booking Tracking Link Card */}
          <div className="animate-fade-in-up" style={{
            background: '#F8FAFC',
            border: '1.5px solid #E2E8F0',
            borderRadius: '16px',
            padding: '16px',
            margin: '16px 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>🔗</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>Your Booking Tracking Link</span>
              </div>
              <span style={{ fontSize: '11px', background: '#E0F2FE', color: '#0369A1', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                Save this URL
              </span>
            </div>
            <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 10px 0', lineHeight: 1.4 }}>
              Bookmark or save this private link to check your booking & payment verification status at any time or from any device.
            </p>
            <div style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              background: '#FFFFFF',
              border: '1px solid #CBD5E1',
              borderRadius: '10px',
              padding: '6px 10px',
            }}>
              <input
                type="text"
                readOnly
                value={fullTrackingUrl}
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'transparent',
                  fontSize: '12px',
                  color: '#334155',
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
                onClick={e => e.target.select()}
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                    await navigator.clipboard.writeText(fullTrackingUrl);
                    setCopiedTracking(true);
                    setTimeout(() => setCopiedTracking(false), 2500);
                    addToast('Tracking link copied.');
                  } catch { setCopiedTracking(false); addToast('Could not copy the link. Select the tracking link above and copy it manually.', 'error'); }
                }}
                style={{
                  background: copiedTracking ? '#16A34A' : '#0F172A',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background-color 0.2s',
                }}
              >
                {copiedTracking ? '✓ Copied' : '📋 Copy Link'}
              </button>
            </div>
          </div>

          {/* Live Cancellation Consequence Box */}
          {resolvedBooking && !isCancelled && !isCompleted && isPaidService && liveRefundConsequence && (
            <div className="animate-fade-in-up" style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '14px',
              padding: '12px 14px',
              marginBottom: '14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                  If you cancel now:
                </span>
                <span style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: liveRefundConsequence.refundPercent === 100 ? '#DCFCE7' : (liveRefundConsequence.refundPercent > 0 ? '#FEF3C7' : '#F1F5F9'),
                  color: liveRefundConsequence.refundPercent === 100 ? '#166534' : (liveRefundConsequence.refundPercent > 0 ? '#92400E' : '#475569'),
                }}>
                  {liveRefundConsequence.refundPercent > 0 ? `${liveRefundConsequence.refundPercent}% refund (${formatCurrency(liveRefundConsequence.refundAmount)})` : 'No refund'}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#64748B', lineHeight: 1.4 }}>
                {liveRefundConsequence.refundPercent === 100 && `Full refund window active (${liveRefundConsequence.hoursNotice}h remaining until session).`}
                {liveRefundConsequence.refundPercent > 0 && liveRefundConsequence.refundPercent < 100 && `Partial refund tier (${liveRefundConsequence.hoursNotice}h remaining until session).`}
                {liveRefundConsequence.refundPercent === 0 && `Past refund window (${liveRefundConsequence.hoursNotice}h notice).`}
              </div>
            </div>
          )}

          {/* Refund Ledger Card (shown when refund is due, sent, confirmed, or disputed) */}
          {isPaidService && (resolvedBooking.refundStatus && resolvedBooking.refundStatus !== 'none') && (
            <div className="animate-fade-in-up" style={{
              background: '#F8FAFC',
              border: '1.5px solid #CBD5E1',
              borderRadius: '16px',
              padding: '16px',
              marginBottom: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>💸</span>
                  <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>Refund Status</span>
                </div>
                <span style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  background: resolvedBooking.refundStatus === 'confirmed' ? '#DCFCE7' : (resolvedBooking.refundStatus === 'disputed' ? '#FEE2E2' : '#FEF3C7'),
                  color: resolvedBooking.refundStatus === 'confirmed' ? '#166534' : (resolvedBooking.refundStatus === 'disputed' ? '#991B1B' : '#92400E'),
                }}>
                  {resolvedBooking.refundStatus === 'refund_due' && 'Refund Due'}
                  {resolvedBooking.refundStatus === 'refunded' && 'Refund Sent'}
                  {resolvedBooking.refundStatus === 'confirmed' && 'Confirmed ✓'}
                  {resolvedBooking.refundStatus === 'disputed' && 'Disputed'}
                </span>
              </div>

              <div style={{ fontSize: '13px', color: '#334155', marginBottom: '10px' }}>
                <strong>Amount:</strong> {formatCurrency(resolvedBooking.refundAmount || resolvedBooking.refundRecord?.amount || 0)}
              </div>

              {resolvedBooking.refundStatus === 'refund_due' && (
                <p style={{ fontSize: '12px', color: '#64748B', margin: 0, lineHeight: 1.4 }}>
                  Your coach has been alerted to send your refund directly via UPI. We will update you here once sent.
                </p>
              )}

              {resolvedBooking.refundStatus === 'refunded' && (
                <div>
                  <p style={{ fontSize: '12.5px', color: '#1E293B', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                    Your coach marked this refund as sent. Please verify your UPI account.
                  </p>
                  {(resolvedBooking.refundRecord?.proof_url || resolvedBooking.refundProofUrl) && (
                    <div style={{ marginBottom: '12px' }}>
                      <a
                        href={resolvedBooking.refundRecord?.proof_url || resolvedBooking.refundProofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '12px', color: '#2563EB', fontWeight: 600 }}
                      >
                        📄 View Coach Refund Payment Proof ↗
                      </a>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={handleConfirmRefundReceived}
                      disabled={isSubmittingDispute}
                      style={{ flex: 1, padding: '8px 12px', background: '#16A34A', color: '#FFF', borderRadius: '10px', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
                    >
                      ✓ I Received It
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={handleOpenDisputeRefund}
                      disabled={isSubmittingDispute}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: '10px', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
                    >
                      I Haven't Received It
                    </button>
                  </div>
                </div>
              )}

              {resolvedBooking.refundStatus === 'confirmed' && (
                <p style={{ fontSize: '12px', color: '#166534', margin: 0, fontWeight: 500 }}>
                  ✓ You confirmed receipt of this refund. Transaction complete.
                </p>
              )}

              {resolvedBooking.refundStatus === 'disputed' && (
                <p style={{ fontSize: '12px', color: '#991B1B', margin: 0, lineHeight: 1.4 }}>
                  ⚠️ You reported an issue with this refund. Our team and your coach have been alerted to review.
                </p>
              )}
            </div>
          )}

          {/* Meeting Mode Block: Directions for In-Person or Google Meet for Online */}
          {isInPerson ? (
            <div className="manage-meet-block animate-fade-in-up" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '18px' }}>
              <div className="manage-meet-title" style={{ color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>📍</span> In-Person Meeting Location
              </div>
              <p style={{ fontSize: '13.5px', color: '#334155', margin: '8px 0 16px', lineHeight: 1.5 }}>
                {locationAddress || 'Address will be confirmed by your coach.'}
              </p>
              {locationAddress && mapsLink && (
                <PillButton
                  variant="secondary"
                  href={mapsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  📍 Get Directions
                </PillButton>
              )}
            </div>
          ) : isConfirmed ? (
            meetUrl ? (
              <div className="manage-meet-block animate-fade-in-up">
                <div className="manage-meet-title">Virtual Session via Google Meet</div>
                <PillButton
                  variant="primary"
                  onClick={() => window.open(meetUrl, '_blank', 'noopener,noreferrer')}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  Join Google Meet →
                </PillButton>
                <a
                  href={meetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="manage-meet-link"
                >
                  {meetUrl}
                </a>
              </div>
            ) : (
              <div className="manage-meet-pending">
                Meet link will be sent before your session.
              </div>
            )
          ) : null}

          {isReadOnlyTracking && <p style={{ fontSize: 13, lineHeight: 1.6 }}>Need to cancel? Raise a service ticket below for your merchant to review. A ticket does not cancel your booking automatically.</p>}
          <TicketPanel key={resolvedBooking.id} />
          {/* Payment Verification Section */}
          {showPaymentSection && (
            <div className="animate-fade-in-up" style={{ marginTop: 'var(--space-3)' }}>
              {/* 1. Awaiting Payment */}
              {paymentStatus === 'awaiting_payment' && (
                <div style={{
                  background: 'var(--theme-card-bg, #FAFAFA)',
                  border: '1px solid var(--color-warning-200, #FDE68A)',
                  borderRadius: '16px',
                  padding: '20px',
                  marginBottom: 'var(--space-3)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '18px' }}>💳</span>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>Complete Payment</h3>
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 16px 0', lineHeight: 1.5 }}>
                    Pay your coach directly via UPI to confirm your booking. Your slot is reserved — complete payment to secure it.
                  </p>

                  {/* Amount Due Display */}
                  {resolvedBooking.price > 0 && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      background: 'var(--color-primary-50, #EFF6FF)',
                      borderRadius: '10px',
                      marginBottom: '16px',
                      fontWeight: 600,
                      fontSize: '14px',
                    }}>
                      <span>Amount Due</span>
                      <span style={{ fontSize: '18px', color: 'var(--color-primary-700)', fontWeight: 700 }}>{formatCurrency(resolvedBooking.price)}</span>
                    </div>
                  )}

                  {/* UPI Info / Mobile Pay Now / Desktop QR Code */}
                  {(providerUpiId || displayQrCodeUrl) ? (
                    <div style={{
                      background: 'var(--color-bg-subtle, #F8FAFC)',
                      borderRadius: '12px',
                      padding: '16px',
                      marginBottom: '16px',
                      border: '1px solid var(--color-border)',
                    }}>
                      {/* Mobile View: Plain <a href={upiLink}> opens UPI app directly (GPay/PhonePe/Paytm) */}
                      {isMobile && upiLink ? (
                        <div style={{ marginBottom: '16px', textAlign: 'center' }}>
                          <a
                            href={upiLink}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '8px',
                              width: '100%',
                              padding: '14px 20px',
                              background: '#16a34a',
                              color: '#ffffff',
                              borderRadius: '9999px',
                              fontWeight: 700,
                              fontSize: '15px',
                              textDecoration: 'none',
                              boxShadow: '0 2px 8px rgba(22, 163, 74, 0.35)',
                              boxSizing: 'border-box',
                            }}
                          >
                            <span>⚡ Pay Now</span>
                            <span style={{ fontSize: '12px', opacity: 0.9 }}>(GPay / PhonePe / Paytm)</span>
                          </a>
                          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '6px' }}>
                            Tap to open your UPI app directly
                          </div>
                        </div>
                      ) : null}

                      {/* QR Code: Displayed prominently on Desktop, AND visible as an alternative below Pay Now on Mobile */}
                      {displayQrCodeUrl ? (
                        <div style={{ textAlign: 'center', marginBottom: (providerUpiId || (!isMobile && upiLink)) ? '14px' : 0 }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-tertiary)', marginBottom: '8px' }}>
                            {isMobile ? 'Or Scan / Screenshot QR Code' : 'Scan QR Code with Phone'}
                          </div>
                          <img
                            src={displayQrCodeUrl}
                            alt="UPI QR Code"
                            style={{ maxWidth: '200px', width: '100%', borderRadius: '12px', border: '1px solid var(--color-border)' }}
                          />
                        </div>
                      ) : null}

                      {/* Desktop View: Also display Pay Now button alongside QR code */}
                      {!isMobile && upiLink ? (
                        <div style={{ marginBottom: '14px', textAlign: 'center' }}>
                          <a
                            href={upiLink}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              padding: '8px 18px',
                              background: '#16a34a',
                              color: '#ffffff',
                              borderRadius: '9999px',
                              fontWeight: 600,
                              fontSize: '13px',
                              textDecoration: 'none',
                              boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)',
                            }}
                          >
                            <span>⚡ Pay Now</span>
                            <span style={{ fontSize: '11px', opacity: 0.9 }}>(UPI App)</span>
                          </a>
                        </div>
                      ) : null}

                      {/* Always show text UPI ID with Copy button for manual entry if needed */}
                      {providerUpiId && (
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>Coach UPI ID</div>
                          <div style={{
                            fontSize: '14px',
                            fontWeight: 700,
                            fontFamily: 'monospace',
                            color: 'var(--color-text)',
                            background: 'var(--theme-input-bg, #fff)',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}>
                            <span>{providerUpiId}</span>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                                  await navigator.clipboard.writeText(providerUpiId);
                                  addToast('UPI ID copied.');
                                } catch { addToast('Could not copy the UPI ID. Select the displayed ID and copy it manually.', 'error'); }
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '12px',
                                color: 'var(--color-primary-600)',
                                fontWeight: 600,
                              }}
                            >Copy</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{
                      fontSize: '13px',
                      color: 'var(--color-warning-800, #92400E)',
                      padding: '14px',
                      background: 'var(--color-warning-50, #FFFBEB)',
                      border: '1px solid var(--color-warning-200, #FDE68A)',
                      borderRadius: '12px',
                      marginBottom: '16px',
                      textAlign: 'center',
                      lineHeight: 1.5,
                    }}>
                      Payment details have not been configured yet for this coach. Please contact your coach directly to complete your payment.
                    </div>
                  )}

                  {/* Screenshot Upload */}
                  <div style={{ marginBottom: '16px' }}>
                    <label htmlFor="customer-payment-screenshot" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px', display: 'block' }}>
                      Payment Screenshot <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
                    </label>
                    <input id="customer-payment-screenshot"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={e => setPaymentScreenshot(e.target.files?.[0] || null)}
                      disabled={isMarkingPaid}
                      style={{ fontSize: '13px' }}
                    />
                    {paymentScreenshot && (
                      <div style={{ fontSize: '12px', color: 'var(--color-success-600)', marginTop: '4px' }}>
                        ✓ {paymentScreenshot.name}
                      </div>
                    )}
                  </div>

                  <PillButton
                    variant="primary"
                    onClick={handleMarkPaid}
                    disabled={isMarkingPaid}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {isMarkingPaid ? 'Submitting...' : "I've Paid ✓"}
                  </PillButton>
                </div>
              )}

              {/* 2. Verification Pending */}
              {paymentStatus === 'verification_pending' && (
                <div style={{
                  padding: '16px 20px',
                  background: 'var(--color-warning-50, #FFFBEB)',
                  border: '1px solid var(--color-warning-200, #FDE68A)',
                  borderRadius: '16px',
                  marginBottom: 'var(--space-3)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '16px' }}>⏱️</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-warning-800, #92400E)' }}>Payment Verification Pending</span>
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--color-warning-700, #A16207)', margin: 0, lineHeight: 1.5 }}>
                    Your payment details have been submitted. Your coach ({providerName}) will verify your payment shortly.
                  </p>
                  {resolvedBooking.paymentMarkedPaidAt && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-warning-800)', fontWeight: 500 }}>
                      Marked paid on: {new Date(resolvedBooking.paymentMarkedPaidAt).toLocaleString()}
                    </div>
                  )}
                  {resolvedBooking.paymentScreenshotUrl && (
                    <div style={{ marginTop: '8px', fontSize: '12px' }}>
                      <a href={resolvedBooking.paymentScreenshotUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary-600)', fontWeight: 600 }}>
                        View uploaded payment screenshot ↗
                      </a>
                    </div>
                  )}
                  <div style={{
                    marginTop: '12px',
                    padding: '10px 12px',
                    background: '#FFFFFF',
                    borderRadius: '8px',
                    border: '1px dashed var(--color-warning-300, #FCD34D)',
                    fontSize: '12px',
                    color: 'var(--color-warning-900, #78350F)',
                    lineHeight: 1.4,
                  }}>
                    💡 <strong>Status is permanently saved:</strong> You can safely close your browser or reopen your tracking link at any time. When your coach approves your payment, this page will update automatically.
                  </div>
                </div>
              )}

              {/* 3. Payment Confirmed */}
              {paymentStatus === 'confirmed' && (
                <div style={{
                  padding: '14px 18px',
                  background: 'var(--color-lime-light, #F0FDF4)',
                  border: '1px solid var(--color-success-200, #BBF7D0)',
                  borderRadius: '14px',
                  marginBottom: 'var(--space-3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  color: 'var(--color-success-800, #166534)',
                  fontWeight: 600,
                }}>
                  <span>Payment received ✓</span>
                </div>
              )}

              {/* 4. Payment Rejected */}
              {paymentStatus === 'rejected' && (
                <div style={{
                  padding: '20px',
                  background: 'var(--color-error-50, #FEF2F2)',
                  border: '1px solid var(--color-error-200, #FECACA)',
                  borderRadius: '16px',
                  marginBottom: 'var(--space-4)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '18px' }}>⚠️</span>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-error-800, #991B1B)' }}>
                      Payment Not Confirmed
                    </span>
                  </div>
                  <p style={{ fontSize: '13.5px', color: 'var(--color-error-700, #B91C1C)', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                    Your coach could not verify the payment. Please contact your coach.
                  </p>
                  {resolvedBooking.paymentRejectedReason && (
                    <div style={{
                      fontSize: '13px',
                      color: 'var(--color-error-800, #991B1B)',
                      background: '#FEE2E2',
                      border: '1px solid #FCA5A5',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      marginBottom: '16px',
                    }}>
                      <strong>Reason from coach:</strong> {resolvedBooking.paymentRejectedReason}
                    </div>
                  )}

                  {/* Coach Contact Details Card */}
                  <div style={{
                    background: '#FFFFFF',
                    border: '1px solid #FECACA',
                    borderRadius: '12px',
                    padding: '16px',
                    marginTop: '8px',
                  }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#1E293B', marginBottom: '12px' }}>
                      Coach Contact Details
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13.5px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748B' }}>Coach</span>
                        <span style={{ fontWeight: 600, color: '#0F172A' }}>{providerName}</span>
                      </div>
                      {provider?.email && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: '#64748B' }}>Email</span>
                          <a href={`mailto:${provider.email}`} style={{ color: '#2563EB', fontWeight: 500, textDecoration: 'none' }}>
                            {provider.email}
                          </a>
                        </div>
                      )}
                      {provider?.phone && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: '#64748B' }}>Phone</span>
                          <a href={`tel:${provider.phone}`} style={{ color: '#2563EB', fontWeight: 500, textDecoration: 'none' }}>
                            {provider.phone}
                          </a>
                        </div>
                      )}
                      {(provider?.whatsapp || provider?.phone) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: '#64748B' }}>WhatsApp</span>
                          <a
                            href={`https://wa.me/${(provider.whatsapp || provider.phone).replace(/[^0-9]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#16A34A', fontWeight: 600, textDecoration: 'none' }}
                          >
                            Chat on WhatsApp ↗
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Customer Details Box: Quiet secondary styling */}
          <div className="manage-customer-box">
            <div className="manage-customer-heading">Customer Details</div>
            <div className="manage-customer-row">
              <span className="manage-customer-label">Name</span>
              <span className="manage-customer-val">{resolvedBooking.customerName}</span>
            </div>
            <div className="manage-customer-row">
              <span className="manage-customer-label">Phone</span>
              <span className="manage-customer-val">{resolvedBooking.customerPhone}</span>
            </div>
            {resolvedBooking.customerEmail && (
              <div className="manage-customer-row">
                <span className="manage-customer-label">Email</span>
                <span className="manage-customer-val">{resolvedBooking.customerEmail}</span>
              </div>
            )}
          </div>

          {/* Three Stacked Actions */}
          {isConfirmed && !isReadOnlyTracking && (
            <div className="manage-actions-stack">
              <PillButton
                variant={isWithinRescheduleWindow ? "primary" : "secondary"}
                onClick={handleOpenReschedule}
                disabled={!isWithinRescheduleWindow}
                title={!isWithinRescheduleWindow ? `Rescheduling is not allowed within ${rescheduleWindow} hours of appointment.` : ''}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  opacity: !isWithinRescheduleWindow ? 0.6 : 1,
                  cursor: !isWithinRescheduleWindow ? 'not-allowed' : 'pointer',
                }}
              >
                Reschedule Appointment
              </PillButton>
              {!isWithinRescheduleWindow && (
                <div style={{ fontSize: '11.5px', color: 'var(--color-text-tertiary, #64748b)', textAlign: 'center', marginTop: '-4px' }}>
                  Rescheduling closed within {rescheduleWindow}h cutoff window.
                </div>
              )}

              {isInPerson && locationAddress && mapsLink && (
                <PillButton
                  variant="secondary"
                  href={mapsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  📍 Get Directions
                </PillButton>
              )}

              <PillButton
                variant="secondary"
                onClick={handleAddToCalendar}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Add to Calendar
              </PillButton>

              <button
                type="button"
                onClick={() => setShowCancelModal(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#EF4444',
                  fontSize: '13px',
                  fontWeight: 600,
                  padding: '8px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'opacity var(--transition-fast)',
                }}
                onMouseOver={e => e.currentTarget.style.opacity = '0.75'}
                onMouseOut={e => e.currentTarget.style.opacity = '1'}
              >
                Cancel Appointment
              </button>

              <PillButton
                variant="secondary"
                onClick={handleBookAnotherSession}
                style={{ width: '100%', justifyContent: 'center', marginTop: '6px' }}
              >
                Book another session
              </PillButton>

              {canReportCoachNoShow && (
                <button
                  type="button"
                  onClick={handleReportCoachNoShow}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#DC2626',
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '8px',
                    cursor: 'pointer',
                    textAlign: 'center',
                    marginTop: '4px',
                    textDecoration: 'underline',
                  }}
                >
                  Coach didn't show up? Report Coach No-Show
                </button>
              )}
            </div>
          )}

          {resolvedBooking?.status === 'no-show' && !isReadOnlyTracking && (
            <div className="manage-actions-stack" style={{ marginTop: '16px' }}>
              {canDisputeNoShow ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleOpenDisputeNoShow}
                  style={{ width: '100%', borderColor: '#EF4444', color: '#DC2626', fontWeight: 600, padding: '10px' }}
                >
                  Dispute No-Show (Within 48h Window)
                </button>
              ) : (
                <div style={{ fontSize: '12px', color: '#64748B', textAlign: 'center' }}>
                  48-hour dispute window has expired.
                </div>
              )}
              <PillButton
                variant="primary"
                onClick={handleBookAnotherSession}
                style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
              >
                Book another session
              </PillButton>
            </div>
          )}

          {(isCancelled || isCompleted) && !isReadOnlyTracking && (
            <div className="manage-actions-stack">
              <PillButton
                variant="primary"
                onClick={handleBookAnotherSession}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Book another session
              </PillButton>
            </div>
          )}

          {!isConfirmed && !isCancelled && !isCompleted && isReschedulable && !isReadOnlyTracking && (
            <div className="manage-actions-stack" style={{ marginTop: '16px' }}>
              <PillButton
                variant={isWithinRescheduleWindow ? "primary" : "secondary"}
                onClick={handleOpenReschedule}
                disabled={!isWithinRescheduleWindow}
                title={!isWithinRescheduleWindow ? `Rescheduling is not allowed within ${rescheduleWindow} hours of appointment.` : ''}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  opacity: !isWithinRescheduleWindow ? 0.6 : 1,
                  cursor: !isWithinRescheduleWindow ? 'not-allowed' : 'pointer',
                }}
              >
                Reschedule Appointment
              </PillButton>
              <PillButton
                variant="secondary"
                onClick={handleBookAnotherSession}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Book another session
              </PillButton>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="booking-card-footer">
{/* Disabled navigation enhancement (user request):
{customerNavigation}
*/}
          <div className="booking-powered-by">
            Powered by <BrandLogo size={18} />
          </div>
        </div>

        {/* Reschedule Modal */}
        {showRescheduleModal && (
          <AccessibleModal label="Reschedule your session" onClose={() => !isSubmittingReschedule && setShowRescheduleModal(false)}>
            <div className="modal modal-md customer-reschedule-modal" onClick={e => e.stopPropagation()} style={{ borderRadius: '24px', padding: '24px', maxWidth: 440 }}>
              <div className="modal-header">
                <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800 }}>Reschedule Your Session</h3>
                <button type="button" aria-label="Close dialog" className="modal-close" onClick={() => !isSubmittingReschedule && setShowRescheduleModal(false)}>✕</button>
              </div>
              <div className="modal-body">
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--theme-text-muted)', marginBottom: 'var(--space-4)' }}>
                  Current slot: <strong>{formatDate(resolvedBooking.date)} at {formatTime(resolvedBooking.startTime)}</strong>
                </p>

                {/* Calendar Month Strip Date Picker */}
                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                  <span id="customer-reschedule-date-label" className="form-label" style={{ fontWeight: 600 }}>Choose a New Date</span>
                  <div role="group" aria-labelledby="customer-reschedule-date-label" className="calendar-month-strip" style={{ marginTop: '6px' }}>
                    <div className="cal-strip-header">
                      <button
                        type="button"
                        className="cal-nav-arrow"
                        aria-label="Previous month"
                        style={{ minWidth: 44, minHeight: 44 }}
                        onClick={() => {
                          if (rescheduleCalMonth === 0) {
                            setRescheduleCalMonth(11);
                            setRescheduleCalYear(rescheduleCalYear - 1);
                          } else {
                            setRescheduleCalMonth(rescheduleCalMonth - 1);
                          }
                        }}
                      >
                        ‹
                      </button>
                      <span className="cal-strip-title" aria-live="polite" aria-atomic="true">
                        {MONTH_NAMES[rescheduleCalMonth]} {rescheduleCalYear}
                      </span>
                      <button
                        type="button"
                        className="cal-nav-arrow"
                        aria-label="Next month"
                        style={{ minWidth: 44, minHeight: 44 }}
                        onClick={() => {
                          if (rescheduleCalMonth === 11) {
                            setRescheduleCalMonth(0);
                            setRescheduleCalYear(rescheduleCalYear + 1);
                          } else {
                            setRescheduleCalMonth(rescheduleCalMonth + 1);
                          }
                        }}
                      >
                        ›
                      </button>
                    </div>

                    <div className="cal-strip-weekdays">
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w, idx) => (
                        <span key={idx} className="cal-strip-weekday">{w}</span>
                      ))}
                    </div>

                    <div className="cal-strip-days">
                      {rescheduleCalDays.map((d, i) => {
                        const isAvailable = d.isCurrentMonth && d.date && !isPastDate(d.date) && isFutureDate(d.date, maxAdvanceDays) && isDateAvailable(d.date, availability);
                        const isSelected = d.date === newDate;

                        return (
                          <button
                            key={i}
                            type="button"
                            disabled={!isAvailable}
                            aria-label={d.date ? new Date(`${d.date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : `${d.day}, outside displayed month`}
                            aria-pressed={Boolean(isSelected && d.isCurrentMonth)}
                            className={`cal-strip-day-btn ${!d.isCurrentMonth ? 'other-month' : ''} ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              if (isAvailable) {
                                setNewDate(d.date);
                                setNewTime('');
                              }
                            }}
                          >
                            {d.day}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Available Time Slots Section */}
                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span id="customer-reschedule-time-label" className="form-label" style={{ fontWeight: 600, margin: 0 }}>Select Available Time Slot</span>
                    {newDate && (
                      <span style={{ fontSize: '12px', color: 'var(--theme-text-muted)' }}>
                        {formatDate(newDate)}
                      </span>
                    )}
                  </div>

                  {isLoadingRescheduleSlots || (!rescheduleSlotsReady && !rescheduleSlotsError) ? (
                    <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
                      <div className="spinner" style={{ margin: '0 auto 8px', width: 24, height: 24 }} />
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--theme-text-muted)' }}>
                        Checking coach availability...
                      </span>
                    </div>
                  ) : rescheduleSlotsError ? (
                    <div style={{
                      padding: 'var(--space-4)',
                      background: 'rgba(239, 68, 68, 0.08)',
                      borderRadius: 'var(--radius-md)',
                      textAlign: 'center',
                      border: '1px solid rgba(239, 68, 68, 0.2)'
                    }}>
                      <p style={{ fontSize: 'var(--font-size-xs)', color: '#EF4444', margin: '0 0 8px 0' }}>
                        {rescheduleSlotsError}
                      </p>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => fetchRescheduleSlots(newDate)}
                      >
                        Retry
                      </button>
                    </div>
                  ) : availableRescheduleSlots.length > 0 ? (
                    <div role="group" aria-labelledby="customer-reschedule-time-label" style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
                      gap: '8px',
                      maxHeight: 200,
                      overflowY: 'auto',
                      padding: '2px',
                    }}>
                      {availableRescheduleSlots.map(slot => {
                        const isSelected = newTime === slot.time;
                        return (
                          <button
                            key={slot.time}
                            type="button"
                            aria-pressed={isSelected}
                            className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                            style={{
                              padding: '10px 6px',
                              borderRadius: '12px',
                              fontSize: '13px',
                              fontWeight: isSelected ? 700 : 500,
                              background: isSelected ? 'var(--color-lime, #d4f933)' : undefined,
                              color: isSelected ? '#0E0E0E' : undefined,
                              borderColor: isSelected ? 'transparent' : undefined,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                            onClick={() => setNewTime(slot.time)}
                          >
                            {formatTime(slot.time)}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{
                      padding: 'var(--space-4)',
                      background: 'var(--theme-input-bg, #F8FAFC)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--theme-text-muted, #64748B)',
                      fontSize: 'var(--font-size-xs)',
                      textAlign: 'center',
                      border: '1px dashed #CBD5E1'
                    }}>
                      No available slots on this date. Please pick another date.
                    </div>
                  )}
                </div>

                {newTime && (
                  <div style={{
                    padding: '10px 14px',
                    background: 'var(--color-lime-light, rgba(212, 249, 51, 0.15))',
                    border: '1px solid var(--color-lime, #d4f933)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--font-size-sm)',
                    color: '#0E0E0E',
                    fontWeight: 600,
                  }}>
                    Rescheduling to: <strong>{formatDate(newDate)} at {formatTime(newTime)}</strong>
                  </div>
                )}
              </div>
              <div className="modal-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
                <PillButton variant="ghost" onClick={() => setShowRescheduleModal(false)} disabled={isSubmittingReschedule}>
                  Cancel
                </PillButton>
                <PillButton
                  variant="primary"
                  disabled={!rescheduleSlotsReady || !newDate || !newTime || isSubmittingReschedule}
                  onClick={handleConfirmReschedule}
                >
                  {isSubmittingReschedule ? 'Rescheduling...' : 'Confirm Reschedule'}
                </PillButton>
              </div>
            </div>
          </AccessibleModal>
        )}

        {/* Cancel Confirmation Modal with Policy Evaluation */}
        {showCancelModal && (
          <AccessibleModal label="Cancel your booking" onClose={() => setShowCancelModal(false)}>
            <div className="modal modal-md" onClick={e => e.stopPropagation()} style={{ borderRadius: '24px', padding: '24px' }}>
              <div className="modal-header">
                <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800 }}>Cancel Appointment</h3>
                <button type="button" aria-label="Close dialog" className="modal-close" onClick={() => setShowCancelModal(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div style={{
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--theme-input-bg)',
                  borderRadius: '16px',
                  marginBottom: 'var(--space-4)',
                  fontSize: 'var(--font-size-sm)'
                }}>
                  <div style={{ color: 'var(--theme-text-muted)', fontSize: 'var(--font-size-xs)' }}>Appointment</div>
                  <div style={{ fontWeight: 700 }}>{resolvedBooking.serviceName} with {provider?.name}</div>
                  <div style={{ color: 'var(--theme-text-muted)', fontSize: 'var(--font-size-xs)', marginTop: 2 }}>
                    {formatDate(resolvedBooking.date)} at {formatTime(resolvedBooking.startTime)}
                  </div>
                </div>

                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--theme-text-muted)', lineHeight: 1.5, marginBottom: '16px' }}>
                  Please confirm if you would like to cancel your session with {provider?.name}.
                </p>

                {isPaidService && liveRefundConsequence && (
                  <div style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    background: liveRefundConsequence.refundPercent === 100 ? '#F0FDF4' : (liveRefundConsequence.refundPercent > 0 ? '#FEF3C7' : '#FEE2E2'),
                    border: `1px solid ${liveRefundConsequence.refundPercent === 100 ? '#BBF7D0' : (liveRefundConsequence.refundPercent > 0 ? '#FDE68A' : '#FECACA')}`,
                    marginBottom: '16px',
                    fontSize: '13px',
                  }}>
                    <div style={{ fontWeight: 700, color: liveRefundConsequence.refundPercent === 100 ? '#166534' : (liveRefundConsequence.refundPercent > 0 ? '#92400E' : '#991B1B'), marginBottom: '4px' }}>
                      Cancellation Policy: {liveRefundConsequence.refundPercent > 0 ? `${liveRefundConsequence.refundPercent}% Refund (${formatCurrency(liveRefundConsequence.refundAmount)})` : 'Non-Refundable (0% Refund)'}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#475569', lineHeight: 1.4 }}>
                      Notice provided: {liveRefundConsequence.hoursNotice} hours before session start.
                      {liveRefundConsequence.refundPercent > 0 ? ' Your coach will be notified to refund this amount via UPI.' : ' Cancellations within this window forfeit payment under the policy.'}
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <PillButton variant="ghost" onClick={() => setShowCancelModal(false)}>
                  Keep appointment
                </PillButton>
                <PillButton
                  variant="primary"
                  onClick={handleConfirmCancel}
                  style={{ background: '#EF4444', color: '#FFFFFF' }}
                >
                  Cancel appointment
                </PillButton>
              </div>
            </div>
          </AccessibleModal>
        )}
        {/* Dispute Modal (Refund or Customer No-Show) */}
        {showDisputeModal && (
          <AccessibleModal label="Report a booking issue" onClose={() => !isSubmittingDispute && setShowDisputeModal(false)}>
            <div className="modal modal-md" onClick={e => e.stopPropagation()} style={{ borderRadius: '24px', padding: '24px', maxWidth: 460 }}>
              <div className="modal-header">
                <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800 }}>
                  {disputeType === 'refund' ? 'Dispute Refund' : 'Dispute No-Show Record'}
                </h3>
                <button type="button" aria-label="Close dialog" className="modal-close" onClick={() => !isSubmittingDispute && setShowDisputeModal(false)}>✕</button>
              </div>
              <form onSubmit={handleSubmitDispute}>
                <div className="modal-body" style={{ marginTop: '12px' }}>
                  <p style={{ fontSize: '13px', color: 'var(--theme-text-muted)', lineHeight: 1.5, marginBottom: '16px' }}>
                    {disputeType === 'refund'
                      ? 'Please describe why you have not received your refund (e.g. incorrect UPI, no payment received after coach confirmation).'
                      : 'Please explain why you dispute being marked as a no-show (e.g. attended Google Meet on time, technical issue).'}
                  </p>
                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label htmlFor="customer-field-3" className="form-label" style={{ fontWeight: 600, fontSize: '12.5px' }}>
                      Explanation / Note for CalUp & Coach <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <textarea id="customer-field-3"
                      className="form-input"
                      rows={4}
                      required
                      placeholder="Provide details..."
                      value={disputeNote}
                      onChange={e => setDisputeNote(e.target.value)}
                      style={{ width: '100%', borderRadius: '12px', padding: '10px 12px', fontSize: '13px' }}
                    />
                  </div>
                </div>
                <div className="modal-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <PillButton variant="ghost" onClick={() => setShowDisputeModal(false)} disabled={isSubmittingDispute}>
                    Cancel
                  </PillButton>
                  <PillButton
                    variant="primary"
                    type="submit"
                    disabled={!disputeNote.trim() || isSubmittingDispute}
                    style={{ background: '#EF4444', color: '#FFFFFF' }}
                  >
                    {isSubmittingDispute ? 'Submitting...' : 'Submit Dispute'}
                  </PillButton>
                </div>
              </form>
            </div>
          </AccessibleModal>
        )}
      </div>
    </div>
  );
}
