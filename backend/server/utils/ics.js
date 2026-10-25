/**
 * BookUp — RFC 5545 iCalendar (.ics) Generator
 * Generates standard VCALENDAR / VEVENT blocks for customer appointment confirmations.
 * No external dependencies required.
 */

import crypto from 'crypto';
import { bookingStartMillis } from './bookingTime.js';

/**
 * Escapes text according to RFC 5545 Section 3.3.11
 */
function escapeIcsText(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * Formats a Date object to UTC iCalendar format: YYYYMMDDTHHmmssZ
 */
function formatUtcIcs(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Folds lines to max 75 octets according to RFC 5545 Section 3.1
 */
function foldLine(line) {
  const chunks = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 75) {
      chunks.push(current);
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  chunks.push(current);
  return chunks.join('\r\n');
}

/**
 * Generates an RFC 5545 .ics calendar invite string
 *
 * @param {Object} params
 * @param {string} params.serviceName - Name of the service
 * @param {string} params.providerName - Coach / Provider name
 * @param {string} params.bookingDate - YYYY-MM-DD
 * @param {string} params.startTime - HH:mm
 * @param {number} params.duration - Duration in minutes
 * @param {string} [params.meetLink] - Google Meet video call URL
 * @param {string} [params.managementUrl] - Customer manage appointment link
 * @param {string} [params.bookingId] - Booking reference UUID or ID
 * @param {string} [params.timeZone] - Timezone identifier (default: Asia/Kolkata)
 * @returns {string} Standard .ics file content with CRLF line endings
 */
export function generateIcsCalendar({
  serviceName,
  providerName,
  bookingDate,
  startTime,
  duration = 60,
  meetLink = '',
  managementUrl = '',
  bookingId = '',
  timeZone = 'Asia/Kolkata',
  issuedAt = '',
  calendarDomain = '',
}) {
  const startMillis = bookingStartMillis({ booking_date: bookingDate, start_time: startTime }, timeZone);
  if (!Number.isFinite(startMillis)) throw new TypeError('Invalid calendar invite time or timezone');
  const startDate = new Date(startMillis);

  const durationMinutes = Number(duration) || 60;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const now = issuedAt ? new Date(issuedAt) : new Date();
  const dtStamp = formatUtcIcs(now);
  const dtStart = formatUtcIcs(startDate);
  const dtEnd = formatUtcIcs(endDate);

  function resolveIcsDomain(custom) {
    if (custom && typeof custom === 'string' && custom.trim().length > 0) return custom.trim();
    if (process.env.APP_DOMAIN && process.env.APP_DOMAIN.trim().length > 0) return process.env.APP_DOMAIN.trim();
    const candidateUrl = process.env.VITE_APP_URL || process.env.FRONTEND_URL || process.env.APP_URL;
    if (candidateUrl) {
      try {
        const host = new URL(candidateUrl).hostname;
        if (host) return host;
      } catch (_e) {}
    }
    return 'localhost';
  }

  const icsDomain = resolveIcsDomain(calendarDomain);
  const uid = bookingId ? `${bookingId}@${icsDomain}` : `${crypto.randomUUID()}@${icsDomain}`;
  const summary = `${serviceName} with ${providerName}`;

  const descriptionLines = [
    `Appointment: ${serviceName}`,
    `Coach / Provider: ${providerName}`,
    `Duration: ${durationMinutes} minutes`,
    meetLink ? `Google Meet Link: ${meetLink}` : 'Video Link: Will be provided before session',
    managementUrl ? `Manage Appointment: ${managementUrl}` : '',
  ].filter(Boolean).join('\n');

  const location = meetLink || 'Google Meet';

  const rawLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calup//Appointment Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(descriptionLines)}`,
    `LOCATION:${escapeIcsText(location)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return rawLines.map(foldLine).join('\r\n') + '\r\n';
}
