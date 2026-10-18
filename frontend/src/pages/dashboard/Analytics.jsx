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
  const chartRef1 = useRef(null);
  const chartRef2 = useRef(null);
  const chart1Instance = useRef(null);
  const chart2Instance = useRef(null);

  useEffect(() => {
    if (!dataReady || !analyticsData?.monthlyData) return;

    const labels = analyticsData.monthlyData.map(d => d.month);

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
            borderColor: '#C6F135',
            backgroundColor: 'rgba(198, 241, 53, 0.25)',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: '#C6F135',
            pointBorderColor: '#0E0E0E',
          }],
        },
        options: {
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
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
          <div style={{ height: 260 }} aria-busy={!dataReady}>
            <canvas ref={chartRef1} />
          </div>
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
          <div style={{ height: 260 }}>
            <canvas ref={chartRef2} />
          </div>
        </div>
      </div>
    </div>
  );
}

