import { dashboardForDate, businessDate } from '../../utils/dashboardData.js';

export default function WeeklyBookingsChart({ bookings = [], selectedDate, today = businessDate(), ready = true, error = false }) {
  const daysOfWeek = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const snapshot = dashboardForDate(bookings, selectedDate || today);
  const counts = snapshot.weeklyCounts;
  const maxVal = Math.max(...counts, 1);
  const peakIdx = counts.indexOf(Math.max(...counts));

  return (
    <div className="weekly-chart-card">
      <div className="weekly-chart-header">
        <span className="weekly-chart-title">Weekly Bookings Chart</span>
        <span className="weekly-chart-pill">Week of {snapshot.weekStart}</span>
      </div>

      <div className="weekly-chart-bars" style={!ready ? { alignItems: 'center', justifyContent: 'center' } : undefined}>
        {!ready && <p>{error ? 'Bookings could not be loaded.' : 'Loading bookings...'}</p>}
        {ready && counts.map((val, idx) => {
          const heightPct = Math.round((val / maxVal) * 100);
          const isPeak = val > 0 && idx === peakIdx;

          return (
            <div key={idx} className="weekly-bar-col" aria-label={`${snapshot.weekDates[idx]}: ${val} appointments`} title={`${snapshot.weekDates[idx]}: ${val} appointments`}>
              {isPeak && (
                <div className="weekly-bar-tooltip">
                  {val}
                </div>
              )}
              <div className="weekly-bar-track">
                <div
                  className="weekly-bar-fill"
                  style={{
                    height: `${heightPct}%`,
                    backgroundColor: isPeak ? 'var(--color-lime)' : undefined,
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--theme-text-muted)',
                  marginTop: '8px',
                }}
              >
                {daysOfWeek[idx]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
