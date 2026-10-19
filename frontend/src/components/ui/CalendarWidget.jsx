import { useEffect, useState } from 'react';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function CalendarWidget({ selectedDate, onSelectDate }) {
  const [currentDate, setCurrentDate] = useState(() => (selectedDate ? new Date(`${selectedDate}T12:00:00`) : new Date()));
  const selectedMonth = selectedDate?.slice(0, 7);
  useEffect(() => { if (selectedMonth) setCurrentDate(new Date(`${selectedMonth}-01T12:00:00`)); }, [selectedMonth]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long' });

  // Get calendar grid days
  const firstDayIndex = new Date(year, month, 1).getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const prevLastDay = new Date(year, month, 0).getDate();

  const days = [];

  // Previous month days
  for (let x = firstDayIndex; x > 0; x--) {
    days.push({
      day: prevLastDay - x + 1,
      isCurrentMonth: false,
      dateStr: null,
    });
  }

  // Current month days
  for (let i = 1; i <= lastDay; i++) {
    const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    days.push({
      day: i,
      isCurrentMonth: true,
      dateStr: dStr,
    });
  }

  // Next month padding to fill grid
  const remaining = Math.max(35, Math.ceil(days.length / 7) * 7) - days.length;
  for (let j = 1; j <= remaining; j++) {
    days.push({
      day: j,
      isCurrentMonth: false,
      dateStr: null,
    });
  }

  const selectedStr = selectedDate || new Date().toLocaleDateString('en-CA');

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  return (
    <div className="calendar-widget-card">
      {/* Month & Navigation Header */}
      <div className="cal-widget-header">
        <span aria-live="polite" aria-atomic="true">{monthName} {year}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            onClick={handlePrevMonth}
            className="cal-widget-day-btn"
            style={{ width: 44, height: 44, fontSize: 13, cursor: 'pointer' }}
            aria-label="Previous month"
            title="Previous month"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={handleNextMonth}
            className="cal-widget-day-btn"
            style={{ width: 44, height: 44, fontSize: 13, cursor: 'pointer' }}
            aria-label="Next month"
            title="Next month"
          >
            ›
          </button>
        </div>
      </div>

      {/* Weekday headers: S M T W T F S */}
      <div className="cal-widget-grid">
        {WEEKDAYS.map((wd, i) => (
          <div key={i} className="cal-widget-day-header">
            {wd}
          </div>
        ))}

        {/* Day buttons */}
        {days.map((item, idx) => {
          const isSelected = item.dateStr && item.dateStr === selectedStr;
          return (
            <button
              key={idx}
              type="button"
              disabled={!item.isCurrentMonth}
              aria-label={item.dateStr ? new Date(`${item.dateStr}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : undefined}
              aria-pressed={Boolean(isSelected)}
              aria-current={item.dateStr === new Date().toLocaleDateString('en-CA') ? 'date' : undefined}
              onClick={() => item.dateStr && onSelectDate && onSelectDate(item.dateStr)}
              className={`cal-widget-day-btn ${!item.isCurrentMonth ? 'other-month' : ''} ${
                isSelected ? 'selected' : ''
              }`}
            >
              {item.day}
            </button>
          );
        })}
      </div>

      {/* Bottom dots */}
      <div className="cal-widget-dots">
        <span className="cal-widget-dot active" />
        <span className="cal-widget-dot" />
        <span className="cal-widget-dot" />
      </div>
    </div>
  );
}
