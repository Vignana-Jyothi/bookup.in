import assert from 'node:assert/strict';
import { generateIcsCalendar } from '../server/utils/ics.js';

const input = { serviceName: 'Fixture session', providerName: 'Fixture merchant', bookingDate: '2026-03-08', startTime: '01:30:00', duration: 60, timeZone: 'America/New_York', bookingId: 'M123456789', issuedAt: '2026-01-01T00:00:00Z', calendarDomain: 'fixture.invalid' };
const invite = generateIcsCalendar(input);
assert.match(invite, /DTSTART:20260308T063000Z/);
assert.match(invite, /DTEND:20260308T073000Z/);
assert.equal(invite, generateIcsCalendar(input), 'A durable send retry must retain its exact attachment');
const unicode = '\u{1F4DA}\u092A\u0930\u093E\u092E\u0930\u094D\u0936'.repeat(20);
const utf8 = generateIcsCalendar({ ...input, serviceName: unicode });
for (const line of utf8.split('\r\n')) assert(Buffer.byteLength(line, 'utf8') <= 75, 'ICS lines are limited in bytes, not JavaScript character counts');
assert(utf8.replace(/\r\n /g, '').includes(unicode), 'Folding must preserve complete Unicode code points');
assert(!utf8.includes('\uFFFD'));
assert.throws(() => generateIcsCalendar({ ...input, timeZone: 'invalid-zone' }), /time/i);
console.log('PASS: calendar invite DST/PostgreSQL times, deterministic retry bytes and RFC UTF-8 folding');
