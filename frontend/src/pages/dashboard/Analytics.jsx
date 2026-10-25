/**
 * CalUp — Analytics Page
 */

import { useEffect, useMemo, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CalendarDays, Wallet, CircleCheck, CheckCheck, CircleX, UserX } from 'lucide-react';
import { useStore, formatCurrency } from '../../data/store';
import { bookingTotals, businessDate, monthlyBookingAnalytics } from '../../utils/dashboardData.js';
import { Chart, registerables } from 'chart.js';
import StatCard from '../../components/ui/StatCard';
import MonthlyDataTable from '../../components/ui/MonthlyDataTable.jsx';
export { default as MonthlyDataTable } from '../../components/ui/MonthlyDataTable.jsx';
/* Disabled navigation enhancement (user request):
import PageLinks from '../../components/ui/PageLinks';
*/
/* Disabled navigation enhancement (user request):
import { shiftDate } from '../../utils/dashboardData.js';
*/

Chart.register(...registerables);

export default function Analytics() {
  const { state } = useStore();
  const { now, bookingSync } = useOutletContext() || {};
  const dataReady = Boolean(bookingSync?.updatedAt || state.bookings?.length);
  const today = businessDate(now, state.provider?.timezone || 'Asia/Kolkata');
  const metrics = useMemo(() => bookingTotals(state.bookings), [state.bookings]);
  const analyticsData = useMemo(() => monthlyBookingAnalytics(state.bookings, today), [state.bookings, today]);
  const monthlyData = analyticsData.monthlyData;
  const period = `${monthlyData[0].month} to ${monthlyData[monthlyData.length - 1].month}`;
  const monthlyAppointments = monthlyData.reduce((total, month) => total + month.appointments, 0);
  const monthlyValue = monthlyData.reduce((total, month) => total + month.revenue, 0);
  const noDataMessage = bookingSync?.error ? 'Chart data is unavailable. Please try again when the connection is restored.' : 'Loading chart data...';
  const chartRef1 = useRef(null);
  const chartRef2 = useRef(null);
  const chart1Instance = useRef(null);
  const chart2Instance = useRef(null);

  useEffect(() => {
    if (!dataReady || !analyticsData?.monthlyData) return;

    const labels = analyticsData.monthlyData.map(d => d.month);
    const chartAccent = chartRef1.current ? getComputedStyle(chartRef1.current).getPropertyValue('--theme-focus-ring').trim() : '#536B1F';

    // Appointments chart
    if (chartRef1.current) {
      if (chart1Instance.current) chart1Instance.current.destroy();
      chart1Instance.current = new Chart(chartRef1.current, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Appointments',
            data: analyticsData.monthlyData.map(d => d.appointments),
            backgroundColor: '#0E0E0E',
            borderRadius: 8,
            borderSkipped: false,
          }],
        },
        options: {
          animation: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(0,0,0,0.04)' },
              ticks: { font: { size: 12, family: 'Inter' } },
            },
            x: {
              grid: { display: false },
              ticks: { font: { size: 12, family: 'Inter' } },
            },
          },
        },
      });
    }

    // Revenue chart
    if (chartRef2.current) {
      if (chart2Instance.current) chart2Instance.current.destroy();
      chart2Instance.current = new Chart(chartRef2.current, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Revenue (₹)',
            data: analyticsData.monthlyData.map(d => d.revenue),
            borderColor: chartAccent,
            backgroundColor: 'rgba(198, 241, 53, 0.25)',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: '#C6F135',
            pointBorderColor: '#0E0E0E',
          }],
        },
        options: {
          animation: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? false : undefined,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(0,0,0,0.04)' },
              ticks: {
                font: { size: 12, family: 'Inter' },
                callback: (v) => `₹${(v / 1000).toFixed(0)}k`,
              },
            },
            x: {
              grid: { display: false },
              ticks: { font: { size: 12, family: 'Inter' } },
            },
          },
        },
      });
    }

    return () => {
      if (chart1Instance.current) chart1Instance.current.destroy();
      if (chart2Instance.current) chart2Instance.current.destroy();
    };
  }, [analyticsData, dataReady]);

  const STATS = [
    { label: 'Total Appointments', value: metrics.totalBookings, icon: <CalendarDays size={18} />, subtitle: 'Excludes cancelled and rejected' },
    { label: 'Paid booking value', value: formatCurrency(metrics.paidValue), icon: <Wallet size={18} />, subtitle: 'Verified payments · before refunds' },
    { label: 'Confirmed Slots', value: metrics.confirmed, icon: <CircleCheck size={18} />, subtitle: 'Confirmed appointments' },
    { label: 'Completed Sessions', value: metrics.completed, icon: <CheckCheck size={18} />, subtitle: 'Fulfilled appointments' },
    { label: 'Cancellation Rate', value: `${metrics.cancellationRate.toFixed(1)}%`, icon: <CircleX size={18} />, subtitle: `${metrics.cancellations} cancelled or rejected` },
    { label: 'No-Show Rate', value: `${metrics.noShowRate.toFixed(1)}%`, icon: <UserX size={18} />, subtitle: 'Recorded no-shows' },
  ];

  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
{/* Disabled navigation enhancement (user request):
<PageLinks links={[{ to: '/dashboard/appointments?from=' + today.slice(0, 7) + '-01&to=' + shiftDate(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10), -1), label: 'View this month appointments' }]} />
*/}
      <p role="status" style={{ fontSize: 12, color: 'var(--theme-text-muted)', margin: 0 }}>
        {bookingSync?.error || (dataReady ? 'Updates automatically every 5 seconds' : 'Loading appointments...')}
      </p>
      {/* Metric StatCards Grid */}
      <div>
        <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '15px', fontWeight: 700, margin: '0 0 14px', color: 'var(--color-text)' }}>
          Performance Metrics
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          {STATS.map((stat, i) => (
            <StatCard
              key={i}
              label={stat.label}
              value={dataReady ? stat.value : String.fromCharCode(8212)}
              icon={stat.icon}
              subtitle={stat.subtitle}
              arrowUp={stat.arrowUp}
            />
          ))}
        </div>
      </div>

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: '20px' }}>
        <div
          className="card"
          style={{
            borderRadius: 'var(--radius-card)',
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border)',
            boxShadow: 'var(--shadow-card)',
            padding: '24px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h4 style={{ fontFamily: 'var(--font-heading)', fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
              Appointments Trend
            </h4>
            <span style={{ fontSize: '12px', color: 'var(--theme-text-muted)' }}>Monthly volume</span>
          </div>
          <p id="appointments-chart-description" style={{ fontSize: 13, marginBottom: 12 }}>
            {dataReady
              ? `${monthlyAppointments} active appointments from ${period}. Cancelled, rejected, and expired appointments are excluded.${monthlyAppointments === 0 ? ' No active appointments in this period.' : ''}`
              : noDataMessage}
          </p>
          {dataReady && <>
            <div style={{ height: 260 }}>
              <canvas ref={chartRef1} role="img" aria-label={`Monthly active appointments, ${period}`} aria-describedby="appointments-chart-description">
                Monthly appointment counts are available in the data table below.
              </canvas>
            </div>
            <MonthlyDataTable rows={monthlyData} field="appointments" caption="Monthly active appointments" stale={Boolean(bookingSync?.error)} />
          </>}
        </div>

        <div
          className="card"
          style={{
            borderRadius: 'var(--radius-card)',
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border)',
            boxShadow: 'var(--shadow-card)',
            padding: '24px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h4 style={{ fontFamily: 'var(--font-heading)', fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
              Paid Booking Value
            </h4>
            <span style={{ fontSize: '12px', color: 'var(--theme-text-muted)' }}>Verified payments before refunds</span>
          </div>
          <p id="paid-value-chart-description" style={{ fontSize: 13, marginBottom: 12 }}>
            {dataReady
              ? `${formatCurrency(monthlyValue)} in verified payments from ${period}, grouped by appointment date, before refunds. This is not net profit.${monthlyValue === 0 ? ' No verified paid value in this period.' : ''}`
              : noDataMessage}
          </p>
          {dataReady && <>
            <div style={{ height: 260 }}>
              <canvas ref={chartRef2} role="img" aria-label={`Monthly paid booking value, ${period}`} aria-describedby="paid-value-chart-description">
                Monthly paid booking values are available in the data table below.
              </canvas>
            </div>
            <MonthlyDataTable rows={monthlyData} field="revenue" formatValue={formatCurrency} caption="Monthly paid booking value before refunds" stale={Boolean(bookingSync?.error)} />
          </>}
        </div>
      </div>
    </div>
  );
}

