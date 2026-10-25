import { googleCalendarService } from './googleCalendar.js';

export class CalendarAvailabilityError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

// One merchant Google account belongs to the owner instructor, not every staff resource.
export async function assertCalendarAvailability({ database, providerId, service, provider, date, startTime, calendar = googleCalendarService }) {
  if (service?.instructor_id) {
    const { data, error } = await database.from('instructors').select('id, is_owner')
      .eq('id', service.instructor_id).eq('provider_id', providerId).maybeSingle();
    if (error || !data || typeof data.is_owner !== 'boolean') throw new CalendarAvailabilityError('Calendar resource could not be verified. Please try again.');
    if (!data.is_owner) return;
  }
  let result;
  try { result = await calendar.getBusyIntervals(providerId, date, provider?.timezone || 'Asia/Kolkata'); }
  catch { throw new CalendarAvailabilityError('Calendar availability is temporarily unavailable. Please try again.'); }
  if (!result || typeof result.connected !== 'boolean') {
    throw new CalendarAvailabilityError('Calendar availability is temporarily unavailable. Please try again.');
  }
  if (!result.connected) return;
  if (!Array.isArray(result.busyTimes)) throw new CalendarAvailabilityError('Calendar availability is temporarily unavailable. Please try again.');
  const minutes = value => {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value)) return NaN;
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  };
  const start = minutes(startTime);
  const duration = Number(service?.duration);
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) throw new CalendarAvailabilityError('The selected appointment time could not be verified.', 422);
  for (const interval of result.busyTimes) {
    const busyStart = minutes(interval.start);
    const busyEnd = minutes(interval.end);
    if (!Number.isFinite(busyStart) || !Number.isFinite(busyEnd) || busyEnd <= busyStart) throw new CalendarAvailabilityError('Calendar availability is temporarily unavailable. Please try again.');
    if (start < busyEnd && start + duration > busyStart) throw new CalendarAvailabilityError('Selected time slot conflicts with the instructor calendar.', 409);
  }
}
