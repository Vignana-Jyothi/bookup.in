import { formatCurrency } from '../../data/store';
import { DAY_FULL_LABELS, DAYS_OF_WEEK } from '../../utils/helpers';

/** Local presentation of unsaved inputs; no public URL, available slots or booking action. */
export default function DraftBookingPreview({ businessName, providerName, bio, service, availability, bookingRules }) {
  return (
    <section className="onb-draft-surface" aria-label="Draft customer page">
      <p className="onb-draft-label">Draft preview · Not published</p>
      <h2>{businessName.trim() || 'Your business name'}</h2>
      <p>{providerName.trim() || 'Your name'}</p>
      {bio.trim() && <p className="onb-draft-bio">{bio}</p>}
      <div className="onb-draft-service">
        <h3>{service.name.trim() || 'Your first service'}</h3>
        <p>{service.description.trim() || 'Your service description will appear here.'}</p>
        <dl className="onb-draft-facts">
          <div><dt>Duration</dt><dd>{service.duration || '—'} minutes</dd></div>
          <div><dt>Price</dt><dd>{service.price === '' ? 'Not set' : formatCurrency(Number(service.price) || 0)}</dd></div>
          <div><dt>Meeting</dt><dd>{service.meetingType === 'in-person' ? 'In person' : service.meetingType === 'both' ? 'Online or in person' : 'Google Meet'}</dd></div>
          <div><dt>Timezone</dt><dd>Asia/Kolkata</dd></div>
        </dl>
        {service.meetingType !== 'online' && <p>{service.locationAddress || 'Add your service address.'}</p>}
      </div>
      <h3>Working hours</h3>
      <ul className="onb-draft-hours">
        {DAYS_OF_WEEK.filter(day => availability[day]?.available).map(day => <li key={day}>{DAY_FULL_LABELS[day]}: {availability[day].start}–{availability[day].end}</li>)}
      </ul>
      {!DAYS_OF_WEEK.some(day => availability[day]?.available) && <p>No working days selected.</p>}
      <p>Bookings require {bookingRules.minNotice} hours of notice and can be made up to {bookingRules.maxAdvanceBooking} days ahead.</p>
      <p className="onb-draft-disclaimer">This preview uses your current form entries. Available times are checked only on the published booking page. No appointments can be booked here.</p>
    </section>
  );
}
