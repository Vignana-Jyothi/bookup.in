import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicSiteHeader from '../components/landing/PublicSiteHeader';
import PublicSiteFooter from '../components/landing/PublicSiteFooter';
import './SubscriptionHero.css';

function Arrow() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>;
}

function Check() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>;
}

const comparisons = [
  ['Your booking page', 'Messages back and forth', 'One link for clients to book'],
  ['Availability', 'Check your diary each time', 'Working hours & booking buffers'],
  ['Client payments', 'Chase payment updates', 'Cashfree payment tools'],
  ['Online sessions', 'Create a meeting manually', 'Google Calendar & Meet'],
  ['Booking management', 'Details in different places', 'Appointments in one dashboard'],
  ['Billing documents', 'Keep track yourself', 'Subscription invoices & receipts'],
];

/** Published pre-tax pricing. Sandbox/gross-only plans never replace the public offer. */
export default function SubscriptionHero({ signupHref = '/signup', loginHref = '/login', plan = null }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Subscriptions | Calup';
    window.scrollTo(0, 0);
    return () => { document.title = previousTitle; };
  }, []);

  const published = !plan?.isTest && Number.isSafeInteger(plan?.baseAmountPaise) && plan.baseAmountPaise > 0 && (!plan.currency || plan.currency === 'INR');
  const amount = published ? plan.baseAmountPaise : 29900;
  const days = published && Number.isSafeInteger(plan.durationDays) && plan.durationDays > 0 ? plan.durationDays : 30;
  const price = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount / 100);
  const questions = [
    ['What will I pay?', `Calup access costs ${price} plus applicable tax for ${days} days. Your subscription dashboard shows the tax breakdown and final payable amount before payment.`],
    ['Does my subscription renew automatically?', `No. You choose when to renew your ${days}-day access from your subscription dashboard. We do not automatically debit your account.`],
    ['What happens when my access expires?', 'There is a five-day grace period after access expires. Renew from your dashboard to keep accepting new bookings. Your account shows your exact access and grace-period dates.'],
    ['Where do I redeem an access code?', 'Create your account or sign in, then open the subscription page to redeem your Calup-issued access code. Access codes do not create a payment or tax invoice.'],
    ['Can I cancel a future prepaid period?', 'Unused future prepaid periods can be cancelled individually from your subscription dashboard. It shows the refund amount and how your access dates will change before you confirm.'],
  ];

  return <div id="top" className="subscription-public-site">
    <a href="#sh-main" className="sh-skip">Skip to content</a>
    <PublicSiteHeader />
    <div className="sh-page">
      <main id="sh-main" tabIndex={-1}>
        <section id="access" className="sh-offer" aria-labelledby="sh-title">
          <div className="sh-intro">
            <span className="sh-eyebrow">Calup access</span>
            <h1 id="sh-title">Your bookings,<br /><span>in one place.</span></h1>
            <p>A booking page, payment tools, and a calendar that works around you. Built for independent coaches, consultants, and tutors.</p>
            <a href="#included" className="sh-text-link">See everything included <Arrow /></a>
          </div>
          <article className="sh-plan-card" aria-labelledby="sh-plan-title">
            <h2 id="sh-plan-title">One plan. All the essentials.</h2>
            <div className="sh-price"><strong>{price}</strong><span>/ {days} days</span></div>
            <p className="sh-tax">+ applicable tax</p>
            <p className="sh-pricing-note">See the tax breakdown and final total before you pay.</p>
            <Link className="sh-button sh-button-lime" to={signupHref}>Create your account <Arrow /></Link>
            <p className="sh-member-link">Already have an account? <Link to={loginHref}>Sign in</Link></p>
            <div className="sh-plan-terms"><Check /><span>Renew when you choose. No automatic debit.</span></div>
          </article>
        </section>

        <section id="included" className="sh-included" aria-labelledby="sh-included-heading">
          <div className="sh-section-heading"><h2 id="sh-included-heading">Tools for your working day</h2><p>From the first booking to the next session.</p></div>
          <dl className="sh-features">
            <div><dt>Bookings and availability</dt><dd>Your own client booking page, working hours, and booking buffers.</dd></div>
            <div><dt>Payments and records</dt><dd>Cashfree payment tools, payment updates, and subscription invoices and receipts.</dd></div>
            <div><dt>Sessions and daily work</dt><dd>Google Calendar and Meet, appointments, reports, and support tools.</dd></div>
          </dl>
        </section>

        <section id="compare" className="sh-comparison" aria-labelledby="sh-compare-heading">
          <div className="sh-section-heading"><h2 id="sh-compare-heading">Less coordination between sessions</h2><p>Your booking details and tools, together.</p></div>
          <p id="sh-table-help" className="sh-table-note">On a small screen, scroll the table sideways to compare.</p>
          <div className="sh-table-wrap" role="region" aria-label="Compare manual booking with Calup" aria-describedby="sh-table-help" tabIndex={0}>
            <table><caption className="sh-sr-only">How Calup simplifies your booking workflow</caption><thead><tr><th scope="col">The everyday details</th><th scope="col">Doing it yourself</th><th scope="col">With Calup</th></tr></thead><tbody>{comparisons.map(([feature, before, after]) => <tr key={feature}><th scope="row">{feature}</th><td>{before}</td><td>{after}</td></tr>)}</tbody></table>
          </div>
        </section>

        <section id="questions" className="sh-faq" aria-labelledby="sh-faq-heading">
          <div><h2 id="sh-faq-heading">Before you subscribe</h2><p>Pricing, renewal, and access.</p></div>
          <div className="sh-faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
        </section>

        <section className="sh-code-note" aria-labelledby="sh-code-heading"><div><h2 id="sh-code-heading">Have a Calup access code?</h2><p>Redeem it from your subscription dashboard after signing in.</p></div><Link className="sh-button sh-button-outline" to={loginHref}>Sign in to redeem <Arrow /></Link></section>
      </main>
    </div>
    <PublicSiteFooter />
  </div>;
}
