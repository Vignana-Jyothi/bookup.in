import { useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { CalendarDays, CircleCheck, Wallet, Briefcase } from 'lucide-react';
import { useStore, formatCurrency } from '../../data/store';
import { businessDate, dashboardForDate } from '../../utils/dashboardData.js';
import StatCard from '../../components/ui/StatCard';
import CalendarWidget from '../../components/ui/CalendarWidget';
import WeeklyBookingsChart from '../../components/ui/WeeklyBookingsChart';
import PillButton from '../../components/ui/PillButton';

export default function Overview() {
  const { state } = useStore();
  const navigate = useNavigate();
  const provider = state.provider;
  const { bookingSync, now } = useOutletContext() || {};
  const todayStr = businessDate(now, provider?.timezone || 'Asia/Kolkata');
  const [chosenDate, setChosenDate] = useState(null);
  const selectedCalendarDate = chosenDate || todayStr;
  const metrics = useMemo(() => dashboardForDate(state.bookings || [], selectedCalendarDate), [state.bookings, selectedCalendarDate]);
  const dataReady = Boolean(bookingSync?.updatedAt || state.bookings?.length);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Active services check for guard-rail banner
  const activeServices = (state.services || []).filter(s => s.isActive);
  const showServicesBanner = activeServices.length === 0 && !bannerDismissed;

  const tableRows = metrics.schedule.slice(0, 6).map(b => ({
        id: b.id,
        time: b.startTime ? String(b.startTime).substring(0, 5) : '—',
        customer: b.customerName || 'Client',
        service: b.serviceName || 'Session',
        staff: b.instructorName || provider?.name || '—',
        contact: b.customerPhone || b.customerWhatsApp || 'Not provided',
      }));

  const todayFormatted = new Date(`${selectedCalendarDate}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="overview-layout-grid animate-fade-in-up">
      {/* Zero-services onboarding banner */}
      {showServicesBanner && (
        <div
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            padding: '14px 20px',
            borderRadius: 'var(--radius-card)',
            background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
            border: '1px solid #F59E0B',
            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.15)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <Briefcase size={22} aria-hidden="true" />
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '14px', color: '#92400E', marginBottom: '2px' }}>
                Your booking page isn't ready yet
              </div>
              <div style={{ fontSize: '13px', color: '#78350F', lineHeight: 1.4 }}>
                Add your first service so clients can book appointments through your link.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <PillButton variant="primary" size="sm" onClick={() => navigate('/dashboard/services')}>
              + Add a Service
            </PillButton>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss banner"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                color: '#92400E',
                padding: '4px',
                lineHeight: 1,
                opacity: 0.7,
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {/* Left Column: Quick Stats + Today's Schedule */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0, width: '100%' }}>
        {/* Quick Stats Header + 3 Stat Cards */}
        <div>
          <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '14px', color: 'var(--color-text)' }}>
            {selectedCalendarDate === todayStr ? 'Today' : todayFormatted}
          </h3>
          <p style={{ fontSize: 12, color: 'var(--theme-text-muted)', marginBottom: 12 }}>
            {bookingSync?.error || (bookingSync?.loading ? 'Loading appointments…' : 'Updates automatically every 5 seconds')}
            {chosenDate && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosenDate(null)}>Back to today</button>}
          </p>
          <div className="overview-quick-stats-grid">
            <StatCard
              label="Appointments"
              value={dataReady ? metrics.totalBookings : '—'}
              subtitle="For the selected date"
              icon={<CalendarDays size={18} />}
            />
            <StatCard
              label="Paid booking value"
              value={dataReady ? formatCurrency(metrics.paidValue) : '—'}
              subtitle="Verified payments · before refunds"
              icon={<Wallet size={18} />}
            />
            <StatCard
              label="Confirmations"
              value={dataReady ? metrics.confirmed : '—'}
              subtitle="Confirmed appointments on this date"
              icon={<CircleCheck size={18} />}
            />
          </div>
        </div>

        {/* Today's Schedule (Image 1) */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Header Bar: Dark Pill Header matching Image 1 */}
          <div className="schedule-card-header-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '16px' }}>
                {selectedCalendarDate === todayStr ? "Today's Schedule" : 'Schedule'}
              </span>
              <span style={{ fontSize: '13px', color: '#888' }}>
                {tableRows.length} / {metrics.totalBookings}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  background: '#222222',
                  color: '#FFFFFF',
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                {todayFormatted}
              </span>

              <PillButton
                variant="lime"
                size="sm"
                arrow
                onClick={() => navigate('/dashboard/appointments')}
              >
                View full calendar
              </PillButton>
            </div>
          </div>

          {/* Schedule Table (Desktop) & Cards (Mobile) */}
          <div style={{ padding: '16px 18px' }}>
            {/* Desktop Table */}
            <div className="table-container schedule-desktop-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Customer</th>
                    <th>Service</th>
                    <th>Staff</th>
                    <th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {!tableRows.length && <tr><td colSpan={5}>{!dataReady ? bookingSync?.error ? 'Appointments could not be loaded.' : 'Loading appointments…' : 'No appointments for this date.'}</td></tr>}
                  {tableRows.map((row, idx) => (
                    <tr key={row.id} className={idx % 2 === 0 ? 'highlighted-lime' : ''}>
                      <td style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>{row.time}</td>
                      <td style={{ fontWeight: 600 }}>{row.customer}</td>
                      <td>{row.service}</td>
                      <td>{row.staff}</td>
                      <td>
                        <span className="pill-contact">
                          <span style={{ color: '#22C55E' }}>●</span>
                          {row.contact}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards */}
            <div className="schedule-mobile-cards">
              {!tableRows.length && <p>{!dataReady ? bookingSync?.error ? 'Appointments could not be loaded.' : 'Loading appointments…' : 'No appointments for this date.'}</p>}
              {tableRows.map(row => (
                <div key={row.id} className="schedule-card-mobile">
                  <div className="schedule-card-mobile-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
                      <span className="schedule-card-time-pill">{row.time}</span>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-text)', wordBreak: 'break-word' }}>
                        {row.customer}
                      </span>
                    </div>
                    <span className="pill-contact" style={{ fontSize: '11px', flexShrink: 0 }}>
                      <span style={{ color: '#22C55E' }}>●</span>
                      {row.contact}
                    </span>
                  </div>
                  <div className="schedule-card-mobile-body">
                    <div className="schedule-card-field">
                      <span className="field-label">Service</span>
                      <span className="field-value">{row.service}</span>
                    </div>
                    <div className="schedule-card-field" style={{ textAlign: 'right' }}>
                      <span className="field-label">Staff</span>
                      <span className="field-value">{row.staff}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Month Calendar Widget + Weekly Bookings Chart */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0, width: '100%' }}>
        {/* Lime Calendar Widget */}
        <CalendarWidget
          selectedDate={selectedCalendarDate}
          onSelectDate={dateStr => setChosenDate(dateStr === todayStr ? null : dateStr)}
        />

        {/* Weekly Bookings Chart Card */}
        <WeeklyBookingsChart bookings={state.bookings} selectedDate={selectedCalendarDate} today={todayStr} ready={dataReady} error={Boolean(bookingSync?.error)} />
      </div>
    </div>
  );
}


/* Disabled navigation enhancement (user request):
navigate('/dashboard/appointments?from=' + selectedCalendarDate + '&to=' + selectedCalendarDate)
*/
