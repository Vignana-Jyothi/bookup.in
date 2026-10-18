import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicSiteHeader from '../components/landing/PublicSiteHeader';
import PublicSiteFooter from '../components/landing/PublicSiteFooter';
import './SubscriptionHero.css';

function Arrow({ diagonal = false }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{diagonal ? <path d="M6 18 18 6M6 6h12v12" /> : <path d="M4 12h16m-6-6 6 6-6 6" />}</svg>;
}
function Check() { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>; }

const comparisons = [
  ['Your booking page', 'Messages back and forth', 'One link for clients to book'],
  ['Availability', 'Check your diary each time', 'Working hours & booking buffers'],
  ['Client payments', 'Chase payment updates', 'Cashfree payment tools'],
  ['Online sessions', 'Create a meeting manually', 'Google Calendar & Meet'],
  ['Booking management', 'Details in different places', 'Appointments in one dashboard'],
  ['Billing documents', 'Keep track yourself', 'Subscription invoices & receipts'],
];
const questions = [
  ['Do I need an account to see the plan?', 'You can explore the features here without an account. Sign in to see the current 30-day price, applicable tax, and your account’s subscription details before paying.'],
  ['Does my subscription renew automatically?', 'No. Automatic recurring debit is not enabled. You choose when to renew your 30-day access from your subscription dashboard.'],
  ['What happens when my access expires?', 'There is a five-day grace period after access expires. Renew from your dashboard to keep accepting new bookings. Your account shows your exact access and grace-period dates.'],
  ['I already have a Calup access code. Where do I use it?', 'Create your account or sign in, then open the subscription page to redeem your Calup-issued access code. Access codes do not create a payment or tax invoice.'],
  ['Can I cancel a future prepaid period?', 'Unused future prepaid periods can be cancelled individually from your subscription dashboard. It shows the refund amount and how your access dates will change before you confirm.'],
];

/** Public subscription landing page. Pass published pricing via plan when available. */
export default function SubscriptionHero({ signupHref = '/signup', loginHref = '/login', plan = null }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Subscriptions | Calup';
    window.scrollTo(0, 0);
    return () => { document.title = previousTitle; };
  }, []);
  const priced = Number.isFinite(plan?.totalAmountPaise) && plan.totalAmountPaise > 0 && !plan.isTest;
  const price = priced ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: plan.currency || 'INR', maximumFractionDigits: 2 }).format(plan.totalAmountPaise / 100) : null;
  return <div id="top"><PublicSiteHeader /><div className="sh-page"><a href="#sh-main" className="sh-skip">Skip to content</a>
    <div className="sh-announcement"><span className="sh-announcement-dot" />A little less admin. A lot more doing what you love.<a href="#access">Meet Calup access <Arrow /></a></div>

    <main id="sh-main">
      <section className="sh-hero" aria-labelledby="sh-title"><span className="sh-eyebrow"><span />CALUP ACCESS</span><h1 id="sh-title">Your time is valuable.<br /><span>Make more of it.</span></h1><p>One home for your bookings, payments, and sessions.<br className="sh-desktop-break" /> A simple 30-day plan, so you can get on with your best work.</p><div className="sh-hero-actions"><a className="sh-button sh-button-dark" href="#access">Explore the plan<Arrow /></a><a href="#included" className="sh-text-link">See what’s included<span aria-hidden="true">↓</span></a></div><div className="sh-hero-note"><span><Check />No automatic recurring debit</span><span><Check />Made for independent professionals</span></div><div className="sh-orbit sh-orbit-one" aria-hidden="true">✳</div><div className="sh-orbit sh-orbit-two" aria-hidden="true">↗</div></section>
      <section className="sh-access-section" id="access" aria-labelledby="sh-access-heading"><div className="sh-section-label"><span>LESS FRICTION. MORE POSSIBILITY.</span><span>01 / THE PLAN</span></div><div className="sh-access-grid">
        <div className="sh-plan-intro"><span className="sh-mini-label">KEEP IT SIMPLE</span><h2 id="sh-access-heading">One plan.<br />All the essentials.</h2><p>You bring the expertise.<br />We’ll help with the busywork.</p><p className="sh-intro-small">Built for coaches, consultants, and tutors who’d rather spend their time with clients.</p><a href="#compare" className="sh-guide-link">See the difference<Arrow diagonal /></a><span className="sh-doodle" aria-hidden="true">↳</span></div>
        <article className="sh-plan-card"><div className="sh-recommended"><span>YOUR NEXT CHAPTER STARTS HERE</span><span aria-hidden="true">✳</span></div><div className="sh-plan-body"><div className="sh-plan-title"><h3>Calup access</h3><span>30-DAY PLAN</span></div><p>Everything you need to get booked<br />and keep things moving.</p><div className="sh-price">{priced ? <><strong>{price}</strong><span>for {plan.durationDays || 30} days · tax included</span></> : <><strong>30<span>days</span></strong><span>of more organised, less complicated work.</span></>}</div><Link className="sh-button sh-button-lime sh-full-button" to={signupHref}>Create your account<Arrow /></Link><p className="sh-pricing-note">{priced ? 'Review your billing details before payment.' : 'See the current price and applicable tax after sign in.'}</p><div className="sh-plan-divider" /><h4>YOUR EVERYDAY ESSENTIALS</h4><ul>{['Your own client booking page', 'Availability, hours & booking buffers', 'Cashfree payments & payment updates', 'Google Calendar & Google Meet', 'Appointments, reports & support tools', 'Subscription invoices & receipts'].map(feature => <li key={feature}><Check />{feature}</li>)}</ul><div className="sh-plan-foot"><span>Renew when you choose.</span><span>No automatic debit.</span></div></div></article>
        <aside className="sh-side-notes"><div className="sh-control-note"><span className="sh-note-icon" aria-hidden="true">↗</span><span className="sh-mini-label">ON YOUR TERMS</span><h3>A subscription.<br />Without surprises.</h3><p>Your account shows the price, tax, and exact access dates before you pay.</p><div className="sh-note-line" /><p>You choose your renewal. We don’t automatically debit your account.</p></div><div className="sh-code-note"><span className="sh-mini-label">ALREADY HAVE A CODE?</span><h3>A little head start.</h3><p>Redeem your Calup-issued access code from your subscription dashboard.</p><Link to={loginHref}>Sign in to redeem<Arrow /></Link></div></aside>
      </div></section>
      <section id="included" className="sh-included" aria-labelledby="sh-included-heading"><div className="sh-section-label"><span>YOUR WORKDAY, A LITTLE LIGHTER.</span><span>02 / THE ESSENTIALS</span></div><div className="sh-included-heading"><h2 id="sh-included-heading">From “are you free?”<br /><span>to “see you then.”</span></h2><p>The useful stuff, working together.<br />So your next session takes less organising.</p></div><div className="sh-benefits">{[
        ['01', 'One link. Fewer messages.', 'Give clients one place to pick a time and book a session.', '↗'],
        ['02', 'A calendar with boundaries.', 'Set your working hours and buffers. Make space between sessions.', '◷'],
        ['03', 'Keep everything in view.', 'Manage appointments and payment updates from your dashboard.', '▤'],
      ].map(([number, title, description, glyph]) => <article key={number}><div><span>{number}</span><span className="sh-benefit-icon" aria-hidden="true">{glyph}</span></div><h3>{title}</h3><p>{description}</p></article>)}</div></section>
      <section id="compare" className="sh-comparison" aria-labelledby="sh-compare-heading"><div className="sh-comparison-heading"><span className="sh-eyebrow">A SMALL CHANGE. A BETTER WORKDAY.</span><h2 id="sh-compare-heading">More sessions.<br /><span>Less spreadsheet energy.</span></h2></div><div className="sh-table-wrap" role="region" aria-label="Compare manual booking with Calup" tabIndex={0}><table><caption className="sh-sr-only">How Calup simplifies your booking workflow</caption><thead><tr><th scope="col">The everyday details</th><th scope="col">Doing it yourself</th><th scope="col"><span className="sh-table-brand">With Calup<span>✳</span></span></th></tr></thead><tbody>{comparisons.map(([feature, before, after]) => <tr key={feature}><th scope="row">{feature}</th><td>{before}</td><td><span><Check />{after}</span></td></tr>)}</tbody></table></div><p className="sh-table-note">Your time is for your clients. Let the tools take care of the coordination.</p></section>
      <section id="questions" className="sh-faq" aria-labelledby="sh-faq-heading"><div><span className="sh-eyebrow">BEFORE YOU GET STARTED</span><h2 id="sh-faq-heading">Good questions.<br /><span>Clear answers.</span></h2><p>A few things worth knowing<br />about Calup access.</p></div><div className="sh-faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className="sh-final-cta"><div><span className="sh-eyebrow">MAKE ROOM FOR WHAT’S NEXT</span><h2>Your next client<br />starts with one link.</h2></div><div><Link to={signupHref} className="sh-button sh-button-lime">Let’s get you set up<Arrow /></Link><span>Already here? <Link to={loginHref}>Log in to Calup</Link></span></div><span className="sh-final-sun" aria-hidden="true">✳</span></section>
    </main></div><PublicSiteFooter />
  </div>;
}
