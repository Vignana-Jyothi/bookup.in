import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import BrandLogo from '../components/ui/BrandLogo';
import PillButton from '../components/ui/PillButton';
import PhoneMockup from '../components/landing/PhoneMockup';
import { LANDING_CONTENT } from '../data/landingContent';
import './Landing.css';

export default function LandingMobile() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState(0);

  const toggleFaq = (index) => {
    setOpenFaqIndex(prev => prev === index ? null : index);
  };

  const {
    nav,
    hero,
    problem,
    howItWorks,
    features,
    whoItsFor,
    liveDemo,
    faq,
    finalCta,
    footer,
  } = LANDING_CONTENT;

  return (
    <div className="landing-mobile landing-janjiyuk">
      {/* ---------------- MOBILE HEADER BAR ---------------- */}
      <header className="mobile-nav-header">
        <BrandLogo size="md" />

        <div className="mobile-nav-actions">
          <Link to="/login" className="mobile-login-link">
            {nav.login}
          </Link>
          <button
            type="button"
            className="mobile-hamburger-btn"
            onClick={() => setMobileMenuOpen(prev => !prev)}
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </header>

      {/* ---------------- MOBILE HAMBURGER DRAWER ---------------- */}
      {mobileMenuOpen && (
        <div className="mobile-drawer-overlay animate-fade-in-up" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-drawer-content" onClick={e => e.stopPropagation()}>
            <nav className="mobile-drawer-links">
              {nav.links.map(l => (
                <a
                  key={l.href}
                  href={l.href}
                  className="mobile-drawer-link"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {l.label}
                </a>
              ))}
            </nav>

            <div className="mobile-drawer-ctas">
              <Link
                to="/login"
                className="btn btn-secondary mobile-tap-target"
                onClick={() => setMobileMenuOpen(false)}
              >
                Log In
              </Link>
              <PillButton
                variant="primary"
                size="lg"
                arrow
                className="mobile-tap-target"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate('/signup');
                }}
              >
                {nav.cta}
              </PillButton>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 1. HERO SECTION (MOBILE SINGLE COLUMN) ---------------- */}
      <section className="mobile-hero-section">
        {/* Headline first */}
        <h1 className="mobile-hero-headline">
          {hero.headlineBold} <br />
          <em className="headline-accent">{hero.headlineItalic}</em>
        </h1>

        {/* Subline second */}
        <p className="mobile-hero-subline">
          {hero.subline}
        </p>

        {/* Action Buttons third */}
        <div className="mobile-hero-cta-col">
          <PillButton
            variant="primary"
            size="lg"
            arrow
            className="mobile-tap-target"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => navigate('/signup')}
          >
            {hero.primaryCta}
          </PillButton>

          <PillButton
            variant="secondary"
            size="lg"
            className="mobile-tap-target"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => navigate(hero.demoUrl)}
          >
            {hero.secondaryCta}
          </PillButton>
        </div>

        {/* Badges Under Buttons */}
        <div className="mobile-hero-badges">
          <span>● {hero.badges}</span>
        </div>

        {/* ONE Phone Mockup at a readable size (no laptop, no floating cards) */}
        <div className="mobile-hero-phone-wrap animate-fade-in-up">
          <PhoneMockup className="mobile-hero-phone-instance" />
        </div>
      </section>

      {/* ---------------- 2. PROBLEM SECTION (CHAT BUBBLES VERTICAL) ---------------- */}
      <section className="mobile-problem-section">
        <h2 className="mobile-section-headline">
          {problem.headline}
        </h2>

        <div className="mobile-problem-bubbles-stack">
          {problem.chatBubbles.map((bubble, idx) => (
            <div key={idx} className="mobile-chat-bubble-card">
              <div className="mobile-chat-bubble-top">
                <span className="mobile-bubble-sender">💬 Client</span>
                <span className="mobile-bubble-time">{bubble.time}</span>
              </div>
              <div className="mobile-bubble-text">
                "{bubble.text}"
              </div>
            </div>
          ))}
        </div>

        <div className="mobile-resolution-box">
          <span className="mobile-resolution-tick">✓</span>
          <p className="mobile-resolution-text">{problem.resolution}</p>
        </div>
      </section>

      {/* ---------------- 3. HOW IT WORKS (VERTICAL STACK) ---------------- */}
      <section className="mobile-how-section" id="how-it-works">
        <div className="mobile-section-header">
          <span className="section-tag-pill">3-Step Flow</span>
          <h2 className="mobile-section-headline">
            {howItWorks.headline}
          </h2>
        </div>

        <div className="mobile-how-steps-stack">
          {/* Step 1 */}
          <div className="mobile-step-card">
            <div className="mobile-step-number">{howItWorks.steps[0].number}</div>
            <h3 className="mobile-step-title">{howItWorks.steps[0].title}</h3>
            <p className="mobile-step-desc">{howItWorks.steps[0].desc}</p>
            <div className="mobile-step-ui-preview">
              <div className="mobile-mini-schedule">
                <span>Mon – Fri · 09:00 AM – 06:00 PM</span>
                <span className="mobile-mini-badge">Active</span>
              </div>
              <div className="mobile-mini-svc">
                <span>1-on-1 Consultation · ₹1,500</span>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="mobile-step-card">
            <div className="mobile-step-number">{howItWorks.steps[1].number}</div>
            <h3 className="mobile-step-title">{howItWorks.steps[1].title}</h3>
            <p className="mobile-step-desc">{howItWorks.steps[1].desc}</p>
            <div className="mobile-step-ui-preview">
              <div className="mobile-mini-link">
                <span>🔗 calup.in/book/yourname</span>
                <span className="mobile-copy-pill">Copy</span>
              </div>
              <div className="mobile-social-pills">
                <span>📱 Instagram</span>
                <span>💬 WhatsApp</span>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="mobile-step-card">
            <div className="mobile-step-number">{howItWorks.steps[2].number}</div>
            <h3 className="mobile-step-title">{howItWorks.steps[2].title}</h3>
            <p className="mobile-step-desc">{howItWorks.steps[2].desc}</p>
            <div className="mobile-step-ui-preview">
              <div className="mobile-mini-paid">
                <span>UPI Paid ₹1,500 ✓</span>
                <span className="mobile-approve-badge">Approve</span>
              </div>
              <div className="mobile-mini-meet">
                📹 Google Meet link attached
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 4. FEATURES (COMPACT SINGLE COLUMN) ---------------- */}
      <section className="mobile-features-section" id="features">
        <div className="mobile-section-header">
          <span className="section-tag-pill">Features</span>
          <h2 className="mobile-section-headline">
            {features.headline}
          </h2>
        </div>

        <div className="mobile-features-stack">
          {features.items.map((item, idx) => (
            <div key={idx} className="mobile-feature-card">
              <div className="mobile-feature-card-header">
                <span className="mobile-feature-icon-bullet">⚡</span>
                <h3 className="mobile-feature-title">{item.title}</h3>
              </div>
              <p className="mobile-feature-desc">{item.desc}</p>
            </div>
          ))}
        </div>

        <div className="mobile-coming-soon-banner">
          <span className="coming-soon-dot">●</span>
          <span>{features.comingSoon}</span>
        </div>
      </section>

      {/* ---------------- 5. WHO IT'S FOR (VERTICAL STACK) ---------------- */}
      <section className="mobile-audience-section" id="who-its-for">
        <div className="mobile-section-header">
          <span className="section-tag-pill">Who It's For</span>
          <h2 className="mobile-section-headline">
            {whoItsFor.headline}
          </h2>
        </div>

        <div className="mobile-audience-stack">
          {whoItsFor.categories.map((cat, idx) => (
            <div key={idx} className="mobile-audience-card">
              <div className="mobile-audience-header">
                <span className="mobile-audience-icon">{cat.icon}</span>
                <span className="mobile-audience-badge">{cat.badge}</span>
              </div>
              <h3 className="mobile-audience-title">{cat.title}</h3>
              <p className="mobile-audience-desc">{cat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- 6. LIVE DEMO ---------------- */}
      <section className="mobile-demo-section">
        <div className="mobile-demo-card">
          <span className="section-tag-pill" style={{ background: '#0E0E0E', color: '#FFFFFF' }}>Demo</span>
          <h2 className="mobile-demo-headline">{liveDemo.headline}</h2>
          <p className="mobile-demo-desc">{liveDemo.desc}</p>
          <PillButton
            variant="primary"
            size="lg"
            arrow
            className="mobile-tap-target"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => navigate(liveDemo.demoUrl)}
          >
            {liveDemo.cta}
          </PillButton>
        </div>
      </section>

      {/* ---------------- 7. FAQ ACCORDION ---------------- */}
      <section className="mobile-faq-section" id="faq">
        <div className="mobile-section-header">
          <span className="section-tag-pill">FAQ</span>
          <h2 className="mobile-section-headline">{faq.headline}</h2>
        </div>

        <div className="mobile-faq-stack">
          {faq.items.map((item, idx) => {
            const isOpen = openFaqIndex === idx;
            return (
              <div
                key={idx}
                className={`mobile-faq-item ${isOpen ? 'open' : ''}`}
                onClick={() => toggleFaq(idx)}
              >
                <div className="mobile-faq-header">
                  <span className="mobile-faq-question">{item.question}</span>
                  <span className="mobile-faq-icon">{isOpen ? '−' : '+'}</span>
                </div>
                {isOpen && (
                  <div className="mobile-faq-body animate-fade-in-up">
                    <p>{item.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------- 8. FINAL CTA ---------------- */}
      <section className="mobile-final-cta-section">
        <div className="mobile-final-cta-card">
          <h2 className="mobile-final-cta-headline">
            {finalCta.headline}
          </h2>
          <PillButton
            variant="primary"
            size="lg"
            arrow
            className="mobile-tap-target"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => navigate('/signup')}
          >
            {finalCta.cta}
          </PillButton>
        </div>
      </section>

      {/* ---------------- 9. FOOTER ---------------- */}
      <footer className="mobile-footer">
        <BrandLogo size="md" light />
        <p className="mobile-footer-tagline">{footer.tagline}</p>

        <div className="mobile-footer-links">
          {footer.links.map(l => (
            <a key={l.label} href={l.href} className="mobile-footer-link">
              {l.label}
            </a>
          ))}
        </div>

        <div className="mobile-footer-contact">
          <a href={`mailto:${footer.contactEmail}`} className="mobile-contact-email">
            ✉ {footer.contactEmail}
          </a>
        </div>

        <p className="mobile-copyright">
          © {new Date().getFullYear()} CalUp. All rights reserved.
        </p>
      </footer>

      {/* ---------------- STICKY BOTTOM "START FREE" BAR ---------------- */}
      <div className="mobile-sticky-bottom-bar">
        <div className="sticky-bar-info">
          <span className="sticky-bar-title">CalUp</span>
          <span className="sticky-bar-sub">Free during early access</span>
        </div>
        <PillButton
          variant="primary"
          size="sm"
          arrow
          className="mobile-tap-target"
          style={{ padding: '10px 20px', minHeight: '44px' }}
          onClick={() => navigate('/signup')}
        >
          {nav.cta}
        </PillButton>
      </div>
    </div>
  );
}
