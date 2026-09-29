import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import BrandLogo from '../components/ui/BrandLogo';
import PillButton from '../components/ui/PillButton';
import PhoneMockup from '../components/landing/PhoneMockup';
import DashboardMockup from '../components/landing/DashboardMockup';
import { LANDING_CONTENT } from '../data/landingContent';
import './Landing.css';

export default function LandingDesktop() {
  const navigate = useNavigate();
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
    <div className="landing-desktop landing-janjiyuk">
      {/* ---------------- NAVIGATION ---------------- */}
      <header className="landing-nav-wrap">
        <div className="landing-nav">
          <BrandLogo size="md" />

          <nav className="landing-nav-links">
            {nav.links.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="landing-nav-actions">
            <Link to="/login" className="btn btn-ghost" style={{ fontWeight: 600, fontSize: '14px' }}>
              {nav.login}
            </Link>
            <PillButton
              variant="primary"
              size="sm"
              arrow
              onClick={() => navigate('/signup')}
            >
              {nav.cta}
            </PillButton>
          </div>
        </div>
      </header>

      {/* ---------------- 1. HERO SECTION ---------------- */}
      <section className="landing-hero-section">
        {/* Subtle decorative background blobs */}
        <div className="hero-blob hero-blob-1" aria-hidden="true" />
        <div className="hero-blob hero-blob-2" aria-hidden="true" />
        <div className="hero-blob hero-blob-3" aria-hidden="true" />

        <div className="hero-two-col">
          {/* Left: Text & CTAs */}
          <div className="hero-text-col animate-fade-in-up">
            <h1 className="hero-headline">
              {hero.headlineBold} <br />
              <em className="headline-accent">{hero.headlineItalic}</em>
            </h1>

            <p className="hero-subline">
              {hero.subline}
            </p>

            <div className="hero-cta-row">
              <PillButton
                variant="primary"
                size="lg"
                arrow
                onClick={() => navigate('/signup')}
              >
                {hero.primaryCta}
              </PillButton>

              <PillButton
                variant="secondary"
                size="lg"
                onClick={() => navigate(hero.demoUrl)}
              >
                {hero.secondaryCta}
              </PillButton>
            </div>

            <div className="hero-badges-row">
              <span className="hero-badge-item">
                <span className="badge-bullet">●</span> {hero.badges}
              </span>
            </div>
          </div>

          {/* Right: Dual Mockups (Phone + Dashboard Together) */}
          <div className="hero-mockups-col">
            <div className="desktop-hero-visual-combo">
              <DashboardMockup />
              <div className="desktop-overlapping-phone">
                <PhoneMockup />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 2. PROBLEM SECTION ---------------- */}
      <section className="landing-problem-section">
        <div className="container">
          <div className="section-title-wrap text-center">
            <h2 className="section-headline">
              {problem.headline}
            </h2>
          </div>

          <div className="problem-chat-row">
            {problem.chatBubbles.map((bubble, idx) => (
              <div key={idx} className="problem-chat-card animate-scale-in">
                <div className="chat-bubble-tail" />
                <div className="chat-bubble-header">
                  <div className="chat-avatar-dot">💬</div>
                  <span className="chat-sender-label">Client</span>
                  <span className="chat-time-label">{bubble.time}</span>
                </div>
                <div className="chat-bubble-text">
                  "{bubble.text}"
                </div>
              </div>
            ))}
          </div>

          <div className="problem-resolution-banner animate-fade-in-up">
            <div className="resolution-sparkle">✓</div>
            <div className="resolution-text">{problem.resolution}</div>
          </div>
        </div>
      </section>

      {/* ---------------- 3. HOW IT WORKS ---------------- */}
      <section className="landing-how-section" id="how-it-works">
        <div className="container">
          <div className="section-title-wrap text-center">
            <span className="section-tag-pill">3-Step Flow</span>
            <h2 className="section-headline">
              {howItWorks.headline}
            </h2>
          </div>

          <div className="how-steps-grid">
            {/* Step 1 */}
            <div className="how-step-card">
              <div className="how-step-badge">{howItWorks.steps[0].number}</div>
              <h3 className="how-step-title">{howItWorks.steps[0].title}</h3>
              <p className="how-step-desc">{howItWorks.steps[0].desc}</p>
              
              <div className="how-mini-ui step-ui-1">
                <div className="mini-schedule-row">
                  <span className="mini-row-day">Mon – Fri</span>
                  <span className="mini-row-time">09:00 AM – 06:00 PM</span>
                  <span className="mini-row-status active">Active</span>
                </div>
                <div className="mini-service-pill">
                  <span>1-on-1 Consultation</span>
                  <span className="mini-price-tag">₹1,500 · 60m</span>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="how-step-card">
              <div className="how-step-badge">{howItWorks.steps[1].number}</div>
              <h3 className="how-step-title">{howItWorks.steps[1].title}</h3>
              <p className="how-step-desc">{howItWorks.steps[1].desc}</p>

              <div className="how-mini-ui step-ui-2">
                <div className="mini-link-box">
                  <span className="mini-link-icon">🔗</span>
                  <span className="mini-link-text">calup.in/book/yourname</span>
                  <span className="mini-copy-pill">Copy</span>
                </div>
                <div className="mini-channels-row">
                  <span className="mini-channel-badge">📱 Instagram Bio</span>
                  <span className="mini-channel-badge">💬 WhatsApp</span>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="how-step-card">
              <div className="how-step-badge">{howItWorks.steps[2].number}</div>
              <h3 className="how-step-title">{howItWorks.steps[2].title}</h3>
              <p className="how-step-desc">{howItWorks.steps[2].desc}</p>

              <div className="how-mini-ui step-ui-3">
                <div className="mini-payment-receipt">
                  <div className="mini-receipt-top">
                    <span>UPI Direct Pay</span>
                    <span className="mini-green-check">✓ Paid</span>
                  </div>
                  <div className="mini-meet-pill">
                    <span>📹 Google Meet Link Attached</span>
                  </div>
                </div>
                <div className="mini-approve-btn">1-Tap Approve ✓</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 4. FEATURES ---------------- */}
      <section className="landing-features-section" id="features">
        <div className="container">
          <div className="section-title-wrap text-center">
            <span className="section-tag-pill">Features</span>
            <h2 className="section-headline">
              Everything that exists. <em className="headline-accent">Nothing that doesn't.</em>
            </h2>
          </div>

          <div className="features-6card-grid">
            {features.items.map((item, idx) => (
              <div key={idx} className="feature-card">
                <div className="feature-card-header">
                  <div className="feature-icon-bubble">
                    {item.icon === 'calendar' && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E0E0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    )}
                    {item.icon === 'upi' && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E0E0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    )}
                    {item.icon === 'video' && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E0E0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    )}
                    {item.icon === 'mail' && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E0E0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
                      </svg>
                    )}
                    {item.icon === 'link' && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E0E0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                    )}
                    {item.icon === 'dashboard' && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E0E0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
                      </svg>
                    )}
                  </div>
                  <h3 className="feature-card-title">{item.title}</h3>
                </div>
                <p className="feature-card-desc">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Small Coming Soon Row */}
          <div className="features-coming-soon-banner">
            <span className="coming-soon-dot">●</span>
            <span>{features.comingSoon}</span>
          </div>
        </div>
      </section>

      {/* ---------------- 5. WHO IT'S FOR ---------------- */}
      <section className="landing-audience-section" id="who-its-for">
        <div className="container">
          <div className="section-title-wrap text-center">
            <span className="section-tag-pill">Target Audience</span>
            <h2 className="section-headline">
              {whoItsFor.headline}
            </h2>
          </div>

          <div className="audience-3card-grid">
            {whoItsFor.categories.map((cat, idx) => (
              <div key={idx} className="audience-card">
                <div className="audience-icon-large">{cat.icon}</div>
                <div className="audience-badge">{cat.badge}</div>
                <h3 className="audience-title">{cat.title}</h3>
                <p className="audience-desc">{cat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- 6. LIVE DEMO ---------------- */}
      <section className="landing-demo-section">
        <div className="container">
          <div className="demo-highlight-card">
            <div className="demo-text-side">
              <span className="section-tag-pill" style={{ background: '#0E0E0E', color: '#FFFFFF' }}>Live Client Experience</span>
              <h2 className="demo-headline">
                {liveDemo.headline}
              </h2>
              <p className="demo-sub">
                {liveDemo.desc}
              </p>
              <PillButton
                variant="primary"
                size="lg"
                arrow
                onClick={() => navigate(liveDemo.demoUrl)}
              >
                {liveDemo.cta}
              </PillButton>
            </div>

            <div className="demo-interactive-preview">
              <div className="demo-pill-badge">⚡ Instant preview</div>
              <PhoneMockup style={{ maxWidth: 220 }} />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 7. FAQ (ACCORDION) ---------------- */}
      <section className="landing-faq-section" id="faq">
        <div className="container" style={{ maxWidth: 840 }}>
          <div className="section-title-wrap text-center">
            <span className="section-tag-pill">Got Questions?</span>
            <h2 className="section-headline">
              {faq.headline}
            </h2>
          </div>

          <div className="faq-accordion-list">
            {faq.items.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div
                  key={idx}
                  className={`faq-accordion-item ${isOpen ? 'open' : ''}`}
                  onClick={() => toggleFaq(idx)}
                >
                  <button
                    type="button"
                    className="faq-accordion-header"
                    aria-expanded={isOpen}
                  >
                    <span className="faq-question-text">{item.question}</span>
                    <span className="faq-toggle-icon">{isOpen ? '−' : '+'}</span>
                  </button>
                  {isOpen && (
                    <div className="faq-accordion-body animate-fade-in-up">
                      <p>{item.answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------- 8. FINAL CTA ---------------- */}
      <section className="landing-final-cta-section">
        <div className="container">
          <div className="final-cta-card">
            <h2 className="final-cta-headline">
              {finalCta.headline}
            </h2>
            <PillButton
              variant="primary"
              size="lg"
              arrow
              onClick={() => navigate('/signup')}
            >
              {finalCta.cta}
            </PillButton>
          </div>
        </div>
      </section>

      {/* ---------------- 9. FOOTER ---------------- */}
      <footer className="landing-footer">
        <div className="container">
          <div className="footer-top-row">
            <div className="footer-brand-col">
              <BrandLogo size="lg" light />
              <p className="footer-tagline">
                {footer.tagline}
              </p>
            </div>

            <div className="footer-links-col">
              <h4>Navigation</h4>
              {footer.links.map(l => (
                <a key={l.label} href={l.href}>
                  {l.label}
                </a>
              ))}
            </div>

            <div className="footer-links-col">
              <h4>Contact</h4>
              <a href={`mailto:${footer.contactEmail}`} className="footer-email-link">
                ✉ {footer.contactEmail}
              </a>
              <div className="footer-direct-note">
                Early access support for verified coaches & tutors.
              </div>
            </div>
          </div>

          <div className="footer-bottom-row">
            <p>© {new Date().getFullYear()} CalUp. All rights reserved.</p>
            <div className="footer-legal">
              <span>0% Commission Booking</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
