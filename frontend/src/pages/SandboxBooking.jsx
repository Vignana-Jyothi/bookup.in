import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './SandboxBooking.css';

const services = [
  { id: 'strategy', name: 'Strategy session', duration: '60 minutes', price: '₹1,500' },
  { id: 'advisory', name: 'Quick advisory call', duration: '30 minutes', price: '₹800' },
];
const slots = ['10:00 AM', '11:30 AM', '2:30 PM'];

/** Local-only simulator. No merchant, checkout, cookie, storage or API dependencies. */
export default function SandboxBooking() {
  const [serviceId, setServiceId] = useState('strategy');
  const [slot, setSlot] = useState(slots[0]);
  const [step, setStep] = useState('select');
  const headingRef = useRef(null);
  const previousStep = useRef(step);
  const service = services.find(item => item.id === serviceId);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Booking sandbox | Calup';
    return () => { document.title = previousTitle; };
  }, []);
  useEffect(() => {
    if (previousStep.current !== step) headingRef.current?.focus();
    previousStep.current = step;
  }, [step]);

  const restart = () => { setServiceId('strategy'); setSlot(slots[0]); setStep('select'); };
  const titles = {
    select: 'Try booking a session', payment: 'Simulate a payment', failed: 'Example payment failure',
    confirmed: 'Demo completed', cancelled: 'Example checkout cancelled',
  };

  return <div className="booking-sandbox">
    <a className="sandbox-skip" href="#sandbox-main">Skip to sandbox</a>
    <header className="sandbox-header"><Link to="/" aria-label="Calup home">Calup</Link><Link to="/subscriptions">View the plan</Link></header>
    <main id="sandbox-main" className="sandbox-main" tabIndex={-1}>
      <aside className="sandbox-notice" aria-label="Sandbox information"><strong>Sandbox · example data only</strong><p>No real money, slot reservations, appointments, or notifications. Do not enter payment details. Reloading clears this demonstration.</p></aside>
      <section className="sandbox-panel" aria-labelledby="sandbox-title">
        <h1 id="sandbox-title" ref={headingRef} tabIndex={-1}>{titles[step]}</h1>
        {step === 'select' ? <>
          <p>Explore a fictional coach’s booking page. All availability and prices below are examples.</p>
          <form onSubmit={event => { event.preventDefault(); setStep('payment'); }}>
            <fieldset><legend>Choose an example service</legend>{services.map(item => <label className="sandbox-option" key={item.id}><input type="radio" name="sandbox-service" value={item.id} checked={serviceId === item.id} onChange={() => setServiceId(item.id)} /><span><strong>{item.name}</strong><small>{item.duration} · example price {item.price}</small></span></label>)}</fieldset>
            <fieldset><legend>Choose an example time · IST</legend><p className="sandbox-field-note">Example day only; these are not a merchant’s available slots.</p><div className="sandbox-slots">{slots.map(time => <label className="sandbox-option" key={time}><input type="radio" name="sandbox-slot" value={time} checked={slot === time} onChange={() => setSlot(time)} /><span>{time}</span></label>)}</div></fieldset>
            <button className="sandbox-button primary" type="submit">Continue to simulated payment</button>
          </form>
        </> : <>
          <dl className="sandbox-summary"><div><dt>Example service</dt><dd>{service.name}</dd></div><div><dt>Example time</dt><dd>{slot} IST</dd></div><div><dt>Example price</dt><dd>{service.price}</dd></div><div><dt>Actual charge</dt><dd>₹0 · simulation only</dd></div></dl>
          {step === 'payment' && <><p>Choose a result to see how the demo responds. This does not open Cashfree or contact a payment provider.</p><div className="sandbox-actions"><button className="sandbox-button primary" onClick={() => setStep('confirmed')}>Simulate successful payment</button><button className="sandbox-button" onClick={() => setStep('failed')}>Simulate failed payment</button><button className="sandbox-button" onClick={() => setStep('cancelled')}>Cancel example checkout</button></div></>}
          {step === 'failed' && <><p>The simulated payment failed. You can retry immediately or cancel this example checkout. No money was taken and no slot is held.</p><div className="sandbox-actions"><button className="sandbox-button primary" onClick={() => setStep('payment')}>Retry simulated payment</button><button className="sandbox-button" onClick={() => setStep('cancelled')}>Cancel example checkout</button></div></>}
          {step === 'confirmed' && <p>You completed the example flow. No real booking, payment, calendar event, or meeting link was created.</p>}
          {step === 'cancelled' && <p>This example checkout is cancelled. No real reservation needed to be released.</p>}
          {['confirmed', 'cancelled'].includes(step) && <button className="sandbox-button primary" onClick={restart}>Start another example</button>}
          {['payment', 'failed'].includes(step) && <button className="sandbox-back" onClick={() => setStep('select')}>Change example service or time</button>}
        </>}
      </section>
      <p className="sandbox-footer"><Link to="/">Back to Calup home</Link><span>Ready for your own booking page? <Link to="/signup">Create an account</Link></span></p>
    </main>
  </div>;
}
