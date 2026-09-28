import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useStore, formatCurrency, formatDate, formatTime, generateId } from '../../data/store';
import { ACTIONS } from '../../data/actions';
import {
  getCalendarDays,
  isDateAvailable,
  isPastDate,
  isFutureDate,
  getTimeSlotsDetailedForDate,
  getInitials,
} from '../../utils/helpers';
import {
  generateManagementToken,
  hashManagementToken,
  buildManagementUrl,
} from '../../utils/token';
import { realGoogleCalendarService } from '../../services/calendar/RealGoogleCalendarProvider';
import { customerBookingService } from '../../services/booking/customerBookingService';
import { isSupabaseConfigured } from '../../services/supabase/supabaseClient';
import { dbService } from '../../services/supabase/dbService';
import PillButton from '../../components/ui/PillButton';
import BrandLogo from '../../components/ui/BrandLogo';
import './BookingPage.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function PublicBookingPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, addToast } = useStore();

  // Demo mode completely disabled for production — always fetch from Supabase
  const isDemo = false;

  const [supabaseData, setSupabaseData] = useState(null);
  const [isLoadingPublic, setIsLoadingPublic] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    if (isDemo) {
      setIsLoadingPublic(false);
      return;
    }

    if (slug) {
      setIsLoadingPublic(true);
      setFetchError(null);
      dbService.getPublicBookingData(slug).then(data => {
        if (isMounted) {
          if (data) {
            setSupabaseData(data);
            if (data.error) {
              setFetchError(data.error);
            }
          }
          setIsLoadingPublic(false);
        }
      }).catch(err => {
        console.warn('Could not load public provider data from Supabase:', err.message);
        if (isMounted) {
          setFetchError(err.message || 'Database error');
          setIsLoadingPublic(false);
        }
      });
    }
    return () => { isMounted = false; };
  }, [slug]);

  const provider = supabaseData?.provider || ((state.provider && state.provider.slug === slug)
    ? state.provider
    : null);

  const availability = supabaseData?.availability || ((state.provider && state.provider.slug === slug)
    ? state.availability
    : null);

  const allServices = supabaseData?.services || ((state.provider && state.provider.slug === slug)
    ? (state.services || [])
    : []);
  const services = allServices.filter(s => s.isActive);

  const policies = supabaseData?.policies || ((state.provider && state.provider.slug === slug)
    ? state.policies
    : null);

  // Flow steps: 1 = 'service', 2 = 'datetime', 3 = 'details'
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedService, setSelectedService] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [customerMeetingType, setCustomerMeetingType] = useState('online');
  const [customerInfo, setCustomerInfo] = useState({ name: '', phone: '', email: '', notes: '' });
  const [policyAgreed, setPolicyAgreed] = useState(true);
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const [bookingError, setBookingError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // Field-level validation helpers
  const validateField = (field, value) => {
    switch (field) {
      case 'name':
        if (!value || !value.trim()) return 'This field is required';
        if (value.trim().length < 2) return 'Name must be at least 2 characters';
        return '';
      case 'phone': {
        if (!value || !value.trim()) return 'This field is required';
        // Accept Indian phone numbers: +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, XXXXXXXXXX
        const cleaned = value.replace(/[\s\-()]/g, '');
        // TODO(hardcoded): Indian phone number validation only
        if (!/^(\+?91|0)?[6-9]\d{9}$/.test(cleaned)) return 'Enter a valid phone number';
        return '';
      }
      case 'email':
        if (value && value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Enter a valid email address';
        return '';
      default:
        return '';
    }
  };

  const handleFieldBlur = (field) => {
    const error = validateField(field, customerInfo[field]);
    setFieldErrors(prev => ({ ...prev, [field]: error }));
  };

  const validateAllFields = () => {
    const errors = {};
    errors.name = validateField('name', customerInfo.name);
    errors.phone = validateField('phone', customerInfo.phone);
    errors.email = validateField('email', customerInfo.email);
    setFieldErrors(errors);
    return errors;
  };

  // Calendar month/year navigation
  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const calDays = useMemo(() => getCalendarDays(calYear, calMonth), [calYear, calMonth]);
  const todayStr = today.toISOString().split('T')[0];

  // Live busy times
  const [liveGcalBusyTimes, setLiveGcalBusyTimes] = useState([]);
  const [liveDbBusySlots, setLiveDbBusySlots] = useState([]);

  const fetchDateBusySlots = useCallback((date, provId, timezone) => {
    if (!date || !provId) return;

    // 1. Google Calendar busy times
    realGoogleCalendarService.getBusyTimes(date, provId, timezone || 'Asia/Kolkata')
      .then(times => {
        if (Array.isArray(times)) setLiveGcalBusyTimes(times);
      })
      .catch(err => {
        console.warn('Could not fetch calendar busy times:', err.message);
      });

    // 2. Database busy slots (Calup confirmed bookings)
    dbService.getBusySlots(provId, date)
      .then(slots => {
        if (Array.isArray(slots)) setLiveDbBusySlots(slots);
      })
      .catch(err => {
        console.warn('Could not fetch database busy slots:', err.message);
      });
  }, []);

  useEffect(() => {
    if (isDemo) return;
    if (selectedDate && provider?.id) {
      fetchDateBusySlots(selectedDate, provider.id, provider.timezone);
    }
  }, [isDemo, selectedDate, provider?.id, provider?.timezone, fetchDateBusySlots]);

  const calendarBusyTimes = useMemo(() => {
    return liveGcalBusyTimes;
  }, [liveGcalBusyTimes]);

  const timeSlotsDetailed = useMemo(() => {
    if (!selectedDate || !selectedService) return [];

    // Format database busy slots as bookings with date and times
    const formattedDbBookings = liveDbBusySlots.map(s => ({
      date: selectedDate,
      startTime: s.start_time,
      endTime: s.end_time,
      actualEndTime: s.actual_end_time,
      status: 'confirmed',
    }));

    const bookingsToCheck = [
      ...formattedDbBookings,
      ...(supabaseData?.bookings || []),
      ...(state.bookings || []),
    ];

    return getTimeSlotsDetailedForDate(
      selectedDate,
      availability,
      services,
      selectedService.id,
      bookingsToCheck,
      calendarBusyTimes
    );
  }, [selectedDate, selectedService, availability, services, liveDbBusySlots, supabaseData?.bookings, state.bookings, calendarBusyTimes]);

  const timeSlots = useMemo(() => {
    return timeSlotsDetailed.filter(s => s.available).map(s => s.time);
  }, [timeSlotsDetailed]);

  // Set initial selected date on Step 2 if not selected
  useEffect(() => {
    if (currentStep === 2 && !selectedDate) {
      setSelectedDate(todayStr);
    }
  }, [currentStep, selectedDate, todayStr]);

  if (isLoadingPublic) {
    return (
      <div className="janjiyuk-booking-canvas">
        <div className="janjiyuk-phone-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 480 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚡</div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Loading services...</h3>
            <p style={{ fontSize: '13px', color: 'var(--theme-text-muted)' }}>Please wait</p>
          </div>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="janjiyuk-booking-canvas">
        <div className="janjiyuk-phone-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚠️</div>
          <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '8px' }}>Unable to load services</h3>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px', fontSize: '14px', lineHeight: 1.5 }}>
            Unable to load services. Please try again.
          </p>
          <PillButton variant="primary" onClick={() => window.location.reload()}>
            Retry
          </PillButton>
        </div>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="janjiyuk-booking-canvas">
        <div className="janjiyuk-phone-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🔗</div>
          <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '8px' }}>Booking page not found</h3>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px', fontSize: '14px', lineHeight: 1.5 }}>
            The booking link <strong>/book/{slug}</strong> doesn't exist or hasn't been configured yet.
          </p>
          <PillButton variant="primary" onClick={() => navigate('/')}>
            Go to CalUp
          </PillButton>
        </div>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="janjiyuk-booking-canvas">
        <div className="janjiyuk-phone-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '20px' }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                overflow: 'hidden',
                background: '#252525',
                color: '#FFFFFF',
                border: '2px solid var(--color-lime)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '14px',
                flexShrink: 0,
              }}
            >
              {provider?.avatar || provider?.avatarUrl ? (
                <img src={provider.avatar || provider.avatarUrl} alt={provider.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                getInitials(provider?.name || 'User')
              )}
            </div>
            <div style={{ textAlign: 'left' }}>
              <h2 className="header-provider-name" style={{ fontSize: '1.1rem', margin: 0 }}>
                {provider.businessName || provider.name}
              </h2>
            </div>
          </div>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⏳</div>
          <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '8px' }}>This provider hasn't added any services yet</h3>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px', fontSize: '14px', lineHeight: 1.5 }}>
            This coach is still setting up their page. Please check back soon.
          </p>
          <PillButton variant="primary" onClick={() => navigate('/')}>
            Go to CalUp
          </PillButton>
        </div>
      </div>
    );
  }

  const handleNextStep = () => {
    setBookingError(null);
    if (currentStep === 1) {
      if (!selectedService) {
        addToast('Please select a service', 'error');
        return;
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (!selectedDate || !selectedTime) {
        addToast('Please choose a date and time slot', 'error');
        return;
      }
      setCurrentStep(3);
    }
  };

  const handlePrevStep = () => {
    setBookingError(null);
    if (currentStep > 1) {
      if (currentStep === 3 && selectedDate && provider?.id) {
        fetchDateBusySlots(selectedDate, provider.id, provider.timezone);
      }
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleConfirmBooking = async (e) => {
    if (e) e.preventDefault();
    if (submittingBooking) return;

    // Validate all fields with inline errors
    const errors = validateAllFields();
    const firstErrorField = Object.keys(errors).find(k => errors[k]);
    if (firstErrorField) {
      // Scroll and focus to first error field
      const el = document.getElementById(`booking-field-${firstErrorField}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      }
      addToast('Please fix the highlighted fields', 'error');
      return;
    }

    if (!timeSlots.includes(selectedTime)) {
      const conflictMsg = 'This time slot was just booked by someone else. Please go back and pick another time.';
      setBookingError(conflictMsg);
      addToast(conflictMsg, 'error');
      return;
    }

    setSubmittingBooking(true);
    setBookingError(null);

    const service = selectedService;
    const [h, m] = selectedTime.split(':').map(Number);
    const endMinutes = h * 60 + m + service.duration;
    const calculatedEndTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

    let authoritativeBookingId = generateId('bk');
    let authoritativePrice = service.price || 0;
    let authoritativeDeposit = service.depositAmount || 0;
    let authoritativeEndTime = calculatedEndTime;

    const localManagementToken = generateManagementToken();
    let tokenHash = '';
    try {
      tokenHash = await hashManagementToken(localManagementToken);
    } catch (err) {
      console.warn('Failed to hash token:', err);
    }
    let authoritativeToken = localManagementToken;
    let authoritativeUrl = buildManagementUrl(localManagementToken);

    const resolvedMeetingType = selectedService.meetingType === 'both'
      ? customerMeetingType
      : (selectedService.meetingType || 'online');

    const resolvedLocation = resolvedMeetingType === 'in-person'
      ? (selectedService.locationAddress || provider?.defaultLocationAddress || null)
      : null;

    const resolvedMapsLink = resolvedMeetingType === 'in-person' && resolvedLocation
      ? (selectedService.mapsLink || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(resolvedLocation)}`)
      : null;

    if (!isDemo && isSupabaseConfigured() && provider?.id) {
      try {
        const result = await customerBookingService.createBooking({
          providerId: provider.id,
          serviceId: service.id,
          customerName: customerInfo.name.trim(),
          customerEmail: customerInfo.email?.trim() || '',
          customerPhone: customerInfo.phone.trim(),
          customerWhatsApp: customerInfo.phone.trim(),
          bookingDate: selectedDate,
          startTime: selectedTime,
          notes: customerInfo.notes?.trim() || '',
          managementToken: localManagementToken,
          managementTokenHash: tokenHash,
          meetingType: resolvedMeetingType,
          locationAddress: resolvedLocation,
          mapsLink: resolvedMapsLink,
        });

        if (result?.bookingId) authoritativeBookingId = result.bookingId;
        if (result?.price !== undefined) authoritativePrice = result.price;
        if (result?.depositAmount !== undefined) authoritativeDeposit = result.depositAmount;
        if (result?.endTime) authoritativeEndTime = result.endTime;
        if (result?.managementToken) authoritativeToken = result.managementToken;
        if (result?.managementUrl) authoritativeUrl = result.managementUrl;
      } catch (err) {
        console.error('Booking creation error:', err);
        setSubmittingBooking(false);

        // Always refresh live busy slots from backend so the customer sees real-time slot state
        if (selectedDate && provider?.id) {
          fetchDateBusySlots(selectedDate, provider.id, provider.timezone);
        }

        const rawMsg = err.message || '';
        const isConflict =
          err.status === 409 ||
          err.isConflict ||
          rawMsg.toLowerCase().includes('no longer available') ||
          rawMsg.toLowerCase().includes('conflict') ||
          rawMsg.includes('409') ||
          rawMsg.toLowerCase().includes('was just booked') ||
          rawMsg.toLowerCase().includes('slot');

        if (isConflict) {
          // Send customer back to time picker (Step 2) with that slot removed
          setCurrentStep(2);
          setSelectedTime(null);
          const conflictMsg = 'That time was just taken, please pick another.';
          setBookingError(conflictMsg);
          addToast(conflictMsg, 'error');
          return;
        }

        let userFacingError = 'Could not complete your booking. Please try again.';
        if (rawMsg.toLowerCase().includes('unable to reach') || rawMsg.toLowerCase().includes('network')) {
          userFacingError = 'Unable to reach the booking server. Please check your connection and try again.';
        } else if (rawMsg.trim()) {
          userFacingError = rawMsg;
        }

        setBookingError(userFacingError);
        addToast(userFacingError, 'error');
        return;
      }
    }

    try {
      const booking = {
        id: authoritativeBookingId,
        providerId: provider.id,
        serviceId: service.id,
        serviceName: service.name,
        customerId: generateId('cust'),
        customerName: customerInfo.name,
        customerPhone: customerInfo.phone,
        customerWhatsApp: customerInfo.phone,
        customerEmail: customerInfo.email,
        date: selectedDate,
        startTime: selectedTime,
        endTime: authoritativeEndTime,
        duration: service.duration,
        price: authoritativePrice,
        depositAmount: authoritativeDeposit,
        depositStatus: 'na',
        paymentStatus: (authoritativePrice || 0) > 0 ? 'awaiting_payment' : 'not_required',
        status: (authoritativePrice || 0) > 0 ? 'pending_payment' : 'confirmed',
        source: 'CalUp booking page',
        notes: customerInfo.notes || '',
        managementToken: authoritativeToken,
        managementUrl: authoritativeUrl,
        meetingType: resolvedMeetingType,
        locationAddress: resolvedLocation,
        mapsLink: resolvedMapsLink,
        createdAt: new Date().toISOString(),
      };

      const customer = {
        id: booking.customerId,
        name: customerInfo.name,
        phone: customerInfo.phone,
        email: customerInfo.email,
      };

      dispatch({ type: ACTIONS.ADD_BOOKING, payload: { booking, customer } });
      setSubmittingBooking(false);

      // Directly navigate to confirmation / booking status screen
      navigate(`/booking-status/${encodeURIComponent(authoritativeToken)}`, { replace: true });

      if (!isDemo && provider?.id) {
        realGoogleCalendarService.createEvent(booking, provider.id, provider.timezone || 'Asia/Kolkata').catch(() => {});
      }
    } catch (e) {
      console.error('Final dispatch error:', e);
      setSubmittingBooking(false);
      navigate(`/booking-status/${encodeURIComponent(authoritativeToken)}`, { replace: true });
    }
  };

  const stepSubtitles = {
    1: 'Select Service',
    2: 'Choose Date & Time',
    3: 'Your Details',
  };

  return (
    <div className="janjiyuk-booking-canvas">
      {/* Mobile-first Phone Card (Image 4) */}
      <div className="janjiyuk-phone-card animate-scale-in">
        {/* Card Header with Provider Name + Back Chevron */}
        <header className="booking-card-header">
          <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {currentStep > 1 && (
              <button
                type="button"
                className="header-back-btn"
                onClick={handlePrevStep}
                title="Go back"
              >
                ‹
              </button>
            )}
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                overflow: 'hidden',
                background: '#252525',
                color: '#FFFFFF',
                border: '2px solid var(--color-lime)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '13px',
                flexShrink: 0,
              }}
            >
              {provider?.avatar || provider?.avatarUrl ? (
                <img src={provider.avatar || provider.avatarUrl} alt={provider.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                getInitials(provider?.name || 'User')
              )}
            </div>
            <div>
              <h2 className="header-provider-name">
                {provider.businessName || provider.name}
              </h2>
              <p className="header-step-sub">{stepSubtitles[currentStep]}</p>
            </div>
          </div>

          <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Link
              to="/booking-status"
              style={{
                fontSize: '11px',
                color: 'var(--color-primary-600, #4f46e5)',
                textDecoration: 'none',
                fontWeight: 600,
                background: 'rgba(79, 70, 229, 0.08)',
                padding: '4px 8px',
                borderRadius: '6px',
                whiteSpace: 'nowrap',
              }}
              title="Track existing booking"
            >
              Track booking ↗
            </Link>
            <BrandLogo iconOnly size="sm" to={null} />
          </div>
        </header>

        {/* --- STEP 1: SERVICE SELECTION --- */}
        {currentStep === 1 && (
          <div className="booking-step-pane animate-fade-in-up">
            <h3 className="pane-headline">What Would You Like to Book?</h3>

            <div className="service-selection-list">
              {services.map(svc => {
                const isSelected = selectedService?.id === svc.id;
                return (
                  <button
                    key={svc.id}
                    type="button"
                    className={`service-select-row ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedService(svc);
                      setCustomerMeetingType(svc.meetingType === 'in-person' ? 'in-person' : 'online');
                    }}
                  >
                    <div className="service-row-left">
                      <div className="service-row-radio">
                        {isSelected && <span className="service-radio-inner" />}
                      </div>
                      <div className="service-row-info">
                        <span className="service-row-title">{svc.name}</span>
                        <span className="service-row-meta">
                          {svc.duration} min · {formatCurrency(svc.price)} · {svc.meetingType === 'in-person' ? '📍 In-person' : (svc.meetingType === 'both' ? '🔀 Online / In-person' : '🌐 Online')}
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <span className="service-selected-star" title="Selected">
                        ★
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* --- STEP 2: DATE & TIME SELECTION --- */}
        {currentStep === 2 && (
          <div className="booking-step-pane animate-fade-in-up">
            {/* Horizontal Month Calendar Card */}
            <div className="calendar-month-strip">
              <div className="cal-strip-header">
                <button
                  type="button"
                  className="cal-nav-arrow"
                  onClick={() => {
                    if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
                    else setCalMonth(calMonth - 1);
                  }}
                >
                  ‹
                </button>
                <span className="cal-strip-title">
                  {MONTH_NAMES[calMonth]} {calYear}
                </span>
                <button
                  type="button"
                  className="cal-nav-arrow"
                  onClick={() => {
                    if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
                    else setCalMonth(calMonth + 1);
                  }}
                >
                  ›
                </button>
              </div>

              {/* Days Grid */}
              <div className="cal-strip-weekdays">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w, idx) => (
                  <span key={idx} className="cal-strip-weekday">{w}</span>
                ))}
              </div>

              <div className="cal-strip-days">
                {calDays.map((d, i) => {
                  const maxDays = availability?.maxAdvanceBooking ?? 60;
                  const isAvailable = d.isCurrentMonth && d.date && !isPastDate(d.date) && isFutureDate(d.date, maxDays) && isDateAvailable(d.date, availability);
                  const isSelected = d.date === selectedDate;

                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!isAvailable}
                      className={`cal-strip-day-btn ${!d.isCurrentMonth ? 'other-month' : ''} ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        if (isAvailable) {
                          setSelectedDate(d.date);
                          setSelectedTime(null);
                        }
                      }}
                    >
                      {d.day}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time Slots List with Capacity Dots */}
            <div className="time-slots-container">
              <div className="time-slots-title">
                Available Times on {selectedDate ? formatDate(selectedDate) : 'Today'}
              </div>

              {timeSlotsDetailed.length > 0 ? (
                <div className="time-slots-list">
                  {timeSlotsDetailed.map((slot, index) => {
                    const isSelected = selectedTime === slot.time;
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        disabled={!slot.available}
                        className={`timeslot-row ${isSelected ? 'selected' : ''} ${!slot.available ? 'disabled' : ''}`}
                        onClick={() => slot.available && setSelectedTime(slot.time)}
                      >
                        <div className="timeslot-left">
                          <span className="timeslot-label">{formatTime(slot.time)}</span>
                          <span className="timeslot-tz">IST</span>
                        </div>

                        {/* Cluster of capacity dots */}
                        <div className="timeslot-capacity-dots">
                          {slot.available ? (
                            Array.from({ length: 6 }).map((_, dotIdx) => (
                              <span
                                key={dotIdx}
                                className={`capacity-dot ${dotIdx < (4 + (index % 3)) ? 'filled' : 'empty'}`}
                              />
                            ))
                          ) : (
                            <span className="timeslot-booked-tag">Booked</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="no-slots-note">
                  No open slots on this date. Please pick another day on the calendar above.
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- STEP 3: DETAILS & CONFIRM --- */}
        {currentStep === 3 && (
          <form className="booking-step-pane animate-fade-in-up" onSubmit={handleConfirmBooking}>
            {/* Top Booking Summary Card (Image 4) */}
            <div className="summary-banner-card">
              <div className="summary-banner-label">Booking Summary</div>
              <div className="summary-banner-service">
                {selectedService?.name} ({selectedService?.duration} min)
              </div>
              <div className="summary-banner-chips">
                <span className="summary-chip">📅 {formatDate(selectedDate)}</span>
                <span className="summary-chip">⏰ {formatTime(selectedTime)}</span>
                <span className="summary-chip">💰 {formatCurrency(selectedService?.price)}</span>
                <span className="summary-chip">
                  {(selectedService?.meetingType === 'both' ? customerMeetingType : (selectedService?.meetingType || 'online')) === 'in-person' ? '📍 In-person' : '🌐 Online'}
                </span>
              </div>
            </div>

            {/* Meeting Mode Selection or Display */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label" style={{ fontWeight: 600 }}>Meeting Mode</label>
              {selectedService?.meetingType === 'both' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setCustomerMeetingType('online')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '12px',
                      border: customerMeetingType === 'online' ? '2px solid var(--color-lime, #22c55e)' : '1px solid var(--theme-border, #e2e8f0)',
                      background: customerMeetingType === 'online' ? 'var(--theme-bg-subtle, #f0fdf4)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text)' }}>🌐 Online Session</div>
                    <div style={{ fontSize: '11px', color: 'var(--theme-text-muted)' }}>Google Meet link provided</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerMeetingType('in-person')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '12px',
                      border: customerMeetingType === 'in-person' ? '2px solid var(--color-lime, #22c55e)' : '1px solid var(--theme-border, #e2e8f0)',
                      background: customerMeetingType === 'in-person' ? 'var(--theme-bg-subtle, #f0fdf4)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text)' }}>📍 In-person Session</div>
                    <div style={{ fontSize: '11px', color: 'var(--theme-text-muted)' }}>At physical location</div>
                  </button>
                </div>
              ) : (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '12px',
                  background: 'var(--theme-bg-subtle, #f8fafc)',
                  border: '1px solid var(--theme-border, #e2e8f0)',
                  fontSize: '13px',
                  color: 'var(--color-text)',
                }}>
                  {selectedService?.meetingType === 'in-person' ? (
                    <div>
                      <strong>📍 In-Person Session:</strong>{' '}
                      {selectedService.locationAddress || provider?.defaultLocationAddress || 'Address will be provided after booking'}
                    </div>
                  ) : (
                    <div>
                      <strong>🌐 Online Session:</strong> Google Meet link will be provided upon confirmation.
                    </div>
                  )}
                </div>
              )}
              {customerMeetingType === 'in-person' && selectedService?.meetingType === 'both' && (
                <div style={{ fontSize: '12px', color: 'var(--theme-text-muted)', marginTop: '6px' }}>
                  📍 Location: {selectedService.locationAddress || provider?.defaultLocationAddress || 'Address provided upon booking'}
                </div>
              )}
            </div>

            {/* Input fields with 16px radius */}
            <div className="booking-form-fields">
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input
                  id="booking-field-name"
                  className={`form-input${fieldErrors.name ? ' form-input-error' : ''}`}
                  type="text"
                  placeholder="e.g. Maya Lin"
                  required
                  value={customerInfo.name}
                  onChange={e => { setCustomerInfo({ ...customerInfo, name: e.target.value }); if (fieldErrors.name) setFieldErrors(prev => ({ ...prev, name: '' })); }}
                  onBlur={() => handleFieldBlur('name')}
                />
                {fieldErrors.name && <div className="form-field-error">{fieldErrors.name}</div>}
              </div>

              <div className="form-group">
                <label className="form-label">WhatsApp / Phone *</label>
                <input
                  id="booking-field-phone"
                  className={`form-input${fieldErrors.phone ? ' form-input-error' : ''}`}
                  type="tel"
                  placeholder="+91 98765 43210"
                  required
                  value={customerInfo.phone}
                  onChange={e => { setCustomerInfo({ ...customerInfo, phone: e.target.value }); if (fieldErrors.phone) setFieldErrors(prev => ({ ...prev, phone: '' })); }}
                  onBlur={() => handleFieldBlur('phone')}
                />
                {fieldErrors.phone && <div className="form-field-error">{fieldErrors.phone}</div>}
              </div>

              <div className="form-group">
                <label className="form-label">Email address (for calendar invite)</label>
                <input
                  id="booking-field-email"
                  className={`form-input${fieldErrors.email ? ' form-input-error' : ''}`}
                  type="email"
                  placeholder="your@email.com"
                  value={customerInfo.email}
                  onChange={e => { setCustomerInfo({ ...customerInfo, email: e.target.value }); if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: '' })); }}
                  onBlur={() => handleFieldBlur('email')}
                />
                {fieldErrors.email && <div className="form-field-error">{fieldErrors.email}</div>}
              </div>

              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Any questions or preferences for your session..."
                  value={customerInfo.notes}
                  onChange={e => setCustomerInfo({ ...customerInfo, notes: e.target.value })}
                />
              </div>
            </div>

            {/* Confirmation Note */}
            <div className="booking-notice-box">
              <div>• You will receive instant confirmation via email.</div>
              <div>• Please arrive 5 minutes before your scheduled start time.</div>
            </div>

            {/* Policy checkbox */}
            <label className="policy-agree-row">
              <input
                type="checkbox"
                checked={policyAgreed}
                onChange={e => setPolicyAgreed(e.target.checked)}
                className="form-checkbox"
              />
              <span>I agree to the booking and cancellation policy.</span>
            </label>

            {/* Error Banner */}
            {bookingError && (
              <div className="booking-conflict-banner animate-fade-in">
                ⚠️ {bookingError}
              </div>
            )}
          </form>
        )}

        {/* --- BOTTOM ACTION BAR: 3-DOT PROGRESS BUTTON --- */}
        <footer className="booking-card-footer">
          {currentStep === 1 && (
            <PillButton
              variant="primary"
              size="lg"
              arrow
              step={1}
              totalSteps={3}
              disabled={!selectedService}
              onClick={handleNextStep}
              className="w-full"
            >
              Continue
            </PillButton>
          )}

          {currentStep === 2 && (
            <PillButton
              variant="primary"
              size="lg"
              arrow
              step={2}
              totalSteps={3}
              disabled={!selectedDate || !selectedTime}
              onClick={handleNextStep}
              className="w-full"
            >
              Continue
            </PillButton>
          )}

          {currentStep === 3 && (
            <PillButton
              variant="primary"
              size="lg"
              arrow
              step={3}
              totalSteps={3}
              loading={submittingBooking}
              disabled={!policyAgreed || submittingBooking}
              onClick={handleConfirmBooking}
              className="w-full"
            >
              Confirm Booking
            </PillButton>
          )}

          <div className="booking-powered-by">
            Powered by <strong>calup.</strong>
          </div>
        </footer>
      </div>
    </div>
  );
}
