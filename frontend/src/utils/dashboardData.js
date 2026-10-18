const excludedStatuses = new Set(['cancelled', 'late-cancellation', 'late_cancelled', 'rejected', 'expired']);
const paidStatuses = new Set(['paid', 'confirmed', 'succeeded']);

export function businessDate(now = Date.now(), timeZone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function persistedBookings(bookings = []) {
  return bookings.filter(booking => booking.id && !String(booking.id).startsWith('booking-') && /^\d{4}-\d{2}-\d{2}$/.test(booking.date || ''));
}

export function bookingTotals(bookings = []) {
  const rows = persistedBookings(bookings);
  const active = rows.filter(booking => !excludedStatuses.has(booking.status));
  const cancellations = rows.length - active.length;
  return {
    totalBookings: active.length,
    confirmed: active.filter(booking => booking.status === 'confirmed').length,
    completed: active.filter(booking => booking.status === 'completed').length,
    noShowRate: active.length ? active.filter(booking => ['no-show', 'customer_no_show'].includes(booking.status)).length / active.length * 100 : 0,
    cancellations,
    cancellationRate: rows.length ? cancellations / rows.length * 100 : 0,
    paidValue: rows.filter(booking => paidStatuses.has(booking.paymentStatus)).reduce((total, booking) => total + Math.round(Math.max(0, Number(booking.price) || 0) * 100), 0) / 100,
  };
}

export function dashboardForDate(bookings, date) {
  const rows = persistedBookings(bookings);
  const dayRows = rows.filter(booking => booking.date === date);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekStart = shiftDate(date, -((weekday + 6) % 7));
  const weekDates = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  return {
    ...bookingTotals(dayRows),
    schedule: dayRows.filter(booking => !excludedStatuses.has(booking.status)).sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || ''))),
    weekStart,
    weekDates,
    weeklyCounts: weekDates.map(day => rows.filter(booking => booking.date === day && !excludedStatuses.has(booking.status)).length),
  };
}

export function monthlyBookingAnalytics(bookings, today) {
  const current = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  return { monthlyData: Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 5 + index, 1));
    const prefix = date.toISOString().slice(0, 7);
    const totals = bookingTotals(bookings.filter(booking => booking.date?.startsWith(prefix)));
    return {
      month: date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      appointments: totals.totalBookings,
      revenue: totals.paidValue,
    };
  }) };
}
