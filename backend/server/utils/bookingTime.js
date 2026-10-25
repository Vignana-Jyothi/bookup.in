/** Interpret the stored wall-clock appointment time in its provider timezone. */
export function bookingStartMillis(booking, timezone = booking.providers?.timezone || 'Asia/Kolkata') {
  const date = String(booking.booking_date || '');
  const time = String(booking.start_time || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(time)) return NaN;
  const wallClock = `${date}T${time.slice(0, 8).length === 5 ? `${time}:00` : time.slice(0, 8)}`;
  const target = Date.parse(`${wallClock}Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 19) !== wallClock) return NaN;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const localMillis = value => {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    };
    let candidate = target;
    for (let attempt = 0; attempt < 3; attempt++) {
      const adjustment = target - localMillis(candidate);
      if (!adjustment) return candidate;
      candidate += adjustment;
    }
    return localMillis(candidate) === target ? candidate : NaN;
  } catch { return NaN; }
}

