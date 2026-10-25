import assert from 'node:assert/strict';
import { customerBookingService } from '../../frontend/src/services/booking/customerBookingService.js';

const original = { fetch: globalThis.fetch, window: globalThis.window, api: process.env.VITE_API_URL };
const requests = [];
globalThis.window = {};
process.env.VITE_API_URL = 'https://external-backend.example/api';
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, options });
  assert(String(url).startsWith('/api/v1/public/'), 'Cookie-authorized booking flows must stay first-party');
  return Response.json({ success: true, booking: { id: 'fixture' }, data: { booking: { id: 'fixture' } } });
};
try {
  await customerBookingService.createBooking({ fixture: true });
  assert.equal(requests.at(-1).url, '/api/v1/public/bookings');
  await customerBookingService.getBooking('M123456789', '9876543210');
  await customerBookingService.getBooking('fixture-management-token');
  await customerBookingService.rescheduleBooking('', '2030-01-07', '09:00');
  await customerBookingService.cancelBooking('');
  await customerBookingService.markPaid('');
  await customerBookingService.reportCoachNoShow('');
  await customerBookingService.refundAction('', 'confirm');
  await customerBookingService.disputeNoShow('', 'Fixture note');
  assert(requests.slice(1).every(request => request.options.credentials === 'include'));
  const count = requests.length;
  await assert.rejects(customerBookingService.markPaid('', { size: 4 * 1024 * 1024 }), /smaller than 4 MB/);
  assert.equal(requests.length, count, 'Oversized screenshot must fail before sending');
  console.log('PASS: booking creation/tracking/management use first-party API despite external API setting; oversized upload rejected');
} finally {
  globalThis.fetch = original.fetch;
  if (original.window === undefined) delete globalThis.window; else globalThis.window = original.window;
  if (original.api === undefined) delete process.env.VITE_API_URL; else process.env.VITE_API_URL = original.api;
}
