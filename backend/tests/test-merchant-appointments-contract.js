import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relativePath => fs.readFileSync(path.resolve(here, relativePath), 'utf8');

const sql = read('../supabase/20261014_merchant_cashfree_appointments.sql');
const bookingReferenceSql = read('../supabase/20261014_public_booking_reference.sql');
const route = read('../server/routes/merchantAppointments.js');
const server = read('../server/index.js');
const dbService = read('../../frontend/src/services/supabase/dbService.js');
const appointments = read('../../frontend/src/pages/dashboard/Appointments.jsx');
const store = read('../../frontend/src/data/store.jsx');
const liveAppointments = read('../../frontend/src/hooks/useLiveAppointments.js');
const dashboardLayout = read('../../frontend/src/layouts/DashboardLayout.jsx');

for (const fragment of [
  'get_merchant_cashfree_appointments_v1',
  "po.payment_status = 'succeeded'",
  "po.fulfilment_status = 'fulfilled'",
  "at time zone coalesce(p.timezone, 'Asia/Kolkata')",
  "'sourceSystem', 'cashfree_v1'",
  'revoke all on function public.get_merchant_cashfree_appointments_v1(uuid) from public, anon, authenticated',
  'grant execute on function public.get_merchant_cashfree_appointments_v1(uuid) to service_role',
]) {
  assert(sql.includes(fragment), `Merchant appointment projection is missing: ${fragment}`);
}

assert(route.includes("router.get('/', requireProviderAuth"), 'Merchant endpoint must require provider authentication');
assert(route.includes('p_provider_id: req.providerId'), 'Merchant endpoint must derive ownership from the authenticated provider');
assert(route.includes(".eq('provider_id', req.providerId)"), 'Legacy rows must be scoped to the authenticated provider');
assert(route.includes("res.set('Cache-Control', 'private, no-store')"), 'PII response must not be cached');
assert(server.includes("app.use('/api/v1/merchant/appointments', merchantAppointmentsRoutes)"), 'Server must mount the merchant endpoint');
assert(dbService.includes("/v1/merchant/appointments"), 'Frontend data service must use the merchant endpoint');
assert(dbService.includes('Authorization: `Bearer ${session.access_token}`'), 'Frontend request must carry the Supabase JWT');
assert(liveAppointments.includes('setInterval(refresh, 5000)') && dashboardLayout.includes('useLiveAppointments(provider?.id)'), 'All dashboard routes must share automatic appointment refresh');
assert(appointments.includes("booking.sourceSystem === 'cashfree_v1'"), 'Dashboard must identify Cashfree rows safely');
assert(store.includes('case ACTIONS.SET_BOOKINGS'), 'Store must support replacing bookings with server truth');
assert(bookingReferenceSql.includes("'bookingId', a.booking_reference"), 'Merchant projection must expose the public booking ID');
assert(appointments.includes('b.bookingId?.toLowerCase().includes(query)'), 'Dashboard search must include the public booking ID');

console.log('Merchant appointment dashboard contract tests passed.');
