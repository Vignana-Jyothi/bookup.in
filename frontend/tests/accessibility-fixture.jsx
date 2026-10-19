// Development-only fixture. Playwright replaces data adapters in its isolated context.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import AccessibleModal from '../src/components/ui/AccessibleModal.jsx';
import CalendarWidget from '../src/components/ui/CalendarWidget.jsx';
import Services from '../src/pages/dashboard/Services.jsx';
import Appointments from '../src/pages/dashboard/Appointments.jsx';
import Analytics from '../src/pages/dashboard/Analytics.jsx';
import Availability from '../src/pages/dashboard/Availability.jsx';
import BookingPage from '../src/pages/booking/BookingPage.jsx';
import CustomerBooking from '../src/pages/booking/CustomerBooking.jsx';
import '../src/styles/global.css';
import '../src/styles/components.css';
import '../src/pages/Landing.css';
import '../src/layouts/DashboardLayout.css';

const snapshotAt = Date.now();

export function ModalFixture() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return <main>
    <h1 style={{ fontSize: 24 }}>Native modal keyboard verification</h1>
    <button type="button" id="background-control">Background control</button>
    <button type="button" id="modal-opener" onClick={() => setOpen(true)}>Open test dialog</button>
    {open && <AccessibleModal label="Keyboard verification" onClose={() => !pending && setOpen(false)}>
      <div className="modal" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 20 }}>Keyboard verification</h2>
        <label htmlFor="fixture-name">Name</label><input id="fixture-name" className="form-input" autoFocus />
        <label><input type="checkbox" checked={pending} onChange={event => setPending(event.target.checked)} />Operation pending</label>
        <button type="button" disabled={pending} onClick={() => setOpen(false)}>Close test dialog</button>
      </div>
    </AccessibleModal>}
  </main>;
}

export function Fixture() {
  const surface = new URLSearchParams(location.search).get('surface') || 'modal';
  const [date, setDate] = useState('2026-10-19');
  const views = {
    modal: <ModalFixture />,
    calendar: <CalendarWidget selectedDate={date} onSelectDate={setDate} />,
    services: <Services />,
    appointments: <Appointments />,
    analytics: <Analytics />,
    availability: <Availability />,
    booking: <BookingPage />,
    customer: <CustomerBooking />,
  };
  const entry = surface === 'booking' ? '/book/a11y-fixture' : surface === 'customer' ? '/booking-details' : '/dashboard';
  return <MemoryRouter initialEntries={[entry]}><Routes>
    <Route element={<div className="janjiyuk-workspace-frame" style={{ minHeight: '100vh', padding: 16 }}><Outlet context={{ now: snapshotAt, bookingSync: { updatedAt: snapshotAt, loading: false, error: null } }} /></div>}>
      <Route path={surface === 'booking' ? '/book/:slug' : '*'} element={views[surface] || <p>Unknown fixture</p>} />
    </Route>
  </Routes></MemoryRouter>;
}

if (!globalThis.__CALUP_A11Y_FIXTURE__) {
  createRoot(document.getElementById('root')).render(<p>This fixture requires the isolated accessibility browser test. It is not a customer page.</p>);
} else {
  createRoot(document.getElementById('root')).render(<Fixture />);
}
