import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Calendar,
  Zap,
  Video,
  Mail,
  Link2,
  LayoutDashboard,
  Dumbbell,
  Briefcase,
  GraduationCap,
  Plus,
  Minus,
  Check,
  Menu,
  X,
  ArrowDown,
} from 'lucide-react';
import BrandLogo from '../components/ui/BrandLogo';
import PillButton from '../components/ui/PillButton';
import PhoneMockup from '../components/landing/PhoneMockup';
import { InstagramIcon, WhatsAppIcon, GoogleMeetIcon, UpiFlashIcon } from '../components/landing/LandingIcons';
import { LANDING_CONTENT, SUPPORT_EMAIL } from '../data/landingContent';
import './Landing.css';

export default function LandingMobile() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState(0);
  const [howVisible, setHowVisible] = useState(false);
  const howSectionRef = useRef(null);

  const toggleFaq = (index) => {
    setOpenFaqIndex(prev => prev === index ? null : index);
  };

  useEffect(() => {
    // Scroll reveal observer (triggers once)
    const elements = document.querySelectorAll('.reveal-on-scroll');
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    elements.forEach((el) => revealObserver.observe(el));

    // Observe how it works for vertical connector animation
    let howObserver;
    if (howSectionRef.current) {
      howObserver = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setHowVisible(true);
            if (howObserver) howObserver.disconnect();
          }
        },
        { threshold: 0.15 }
      );
      howObserver.observe(howSectionRef.current);
    }

    return () => {
      revealObserver.disconnect();
      if (howObserver) howObserver.disconnect();
    };
  }, []);

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
            {mobileMenuOpen ? <X size={20} strokeWidth={2} /> : <Menu size={20} strokeWidth={2} />}
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

      {/* ---------------- 2. PROBLEM SECTION (BEFORE / DOWNWARD ARROW / AFTER) ---------------- */}
      <section className="mobile-problem-section reveal-on-scroll">
        <h2 className="mobile-section-headline">
          {problem.headline}
        </h2>

        {/* Before: 3 WhatsApp Chat Bubbles */}
        <div className="mobile-problem-before">
          <div className="problem-col-badge before-badge" style={{ marginBottom: 12 }}>Before · The back-and-forth</div>
          <div className="mobile-problem-bubbles-stack">
            {problem.chatBubbles.map((bubble, idx) => (
              <div key={idx} className="problem-chat-bubble-wa">
                <div className="wa-bubble-content">
                  <span className="wa-message-text">"{bubble.text}"</span>
                  <span className="wa-message-meta">
                    <span className="wa-time">{bubble.time}</span>
                    <svg width="15" height="10" viewBox="0 0 16 11" fill="none" className="wa-ticks" aria-hidden="true">
                      <path d="M1 5.5L4.5 9L11 1.5M5 5.5L8.5 9L15 1.5" stroke="#4FC3F7" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Downward Arrow Divider */}
        <div className="mobile-problem-arrow-divider" aria-hidden="true">
          <div className="problem-arrow-circle">
            <ArrowDown size={20} strokeWidth={2.5} />
          </div>
        </div>

        {/* After: Clean Card */}
        <div className="mobile-problem-after">
          <div className="problem-col-badge after-badge" style={{ marginBottom: 12 }}>With Calup</div>
          <div className="problem-after-card">
            <div className="after-card-header">
              <div className="after-icon-tile">
                <Check size={20} strokeWidth={2.5} />
              </div>
              <h3 className="after-card-title">Booked. Paid. Meet link sent.</h3>
            </div>
            <p className="after-card-desc">
              {problem.resolution}
            </p>
            <div className="after-checklist">
              <div className="after-check-item">
                <span className="after-check-bullet"><Check size={14} strokeWidth={2.5} /></span>
                <span>Client picks an available time slot</span>
              </div>
              <div className="after-check-item">
                <span className="after-check-bullet"><Check size={14} strokeWidth={2.5} /></span>
                <span>Direct UPI payment with instant proof</span>
              </div>
              <div className="after-check-item">
                <span className="after-check-bullet"><Check size={14} strokeWidth={2.5} /></span>
                <span>Google Calendar invite + Meet link attached</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 3. HOW IT WORKS (VERTICAL STACK WITH CONNECTORS) ---------------- */}
      <section className="mobile-how-section reveal-on-scroll" id="how-it-works" ref={howSectionRef}>
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

          {/* Vertical Connector 1 -> 2 */}
          <div className={`step-connector-mobile ${howVisible ? 'is-animated' : ''}`} aria-hidden="true">
            <svg width="24" height="36" viewBox="0 0 24 36" fill="none" className="connector-svg-vert">
              <path
                d="M 12 2 V 26"
                stroke="#0E0E0E"
                strokeWidth="2"
                strokeDasharray="4 4"
                className="connector-line-vert"
              />
              <polyline
                points="7,22 12,30 17,22"
                stroke="#0E0E0E"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="connector-arrow-vert"
              />
            </svg>
          </div>

          {/* Step 2 */}
          <div className="mobile-step-card">
            <div className="mobile-step-number">{howItWorks.steps[1].number}</div>
            <h3 className="mobile-step-title">{howItWorks.steps[1].title}</h3>
            <p className="mobile-step-desc">{howItWorks.steps[1].desc}</p>
            <div className="mobile-step-ui-preview">
              <div className="mobile-mini-link">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Link2 size={12} strokeWidth={2} />
                  <span>calup.in/book/yourname</span>
                </span>
                <span className="mobile-copy-pill">Copy</span>
              </div>
              <div className="mobile-social-pills">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <InstagramIcon size={13} /> Instagram
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <WhatsAppIcon size={13} /> WhatsApp
                </span>
              </div>
            </div>
          </div>

          {/* Vertical Connector 2 -> 3 */}
          <div className={`step-connector-mobile ${howVisible ? 'is-animated' : ''}`} aria-hidden="true">
            <svg width="24" height="36" viewBox="0 0 24 36" fill="none" className="connector-svg-vert">
              <path
                d="M 12 2 V 26"
                stroke="#0E0E0E"
                strokeWidth="2"
                strokeDasharray="4 4"
                className="connector-line-vert"
              />
              <polyline
                points="7,22 12,30 17,22"
                stroke="#0E0E0E"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="connector-arrow-vert"
              />
            </svg>
          </div>

          {/* Step 3 */}
          <div className="mobile-step-card">
            <div className="mobile-step-number">{howItWorks.steps[2].number}</div>
            <h3 className="mobile-step-title">{howItWorks.steps[2].title}</h3>
            <p className="mobile-step-desc">{howItWorks.steps[2].desc}</p>
            <div className="mobile-step-ui-preview">
              <div className="mobile-mini-paid">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span>UPI Paid ₹1,500</span>
                  <Check size={12} strokeWidth={2.5} style={{ color: '#16A34A' }} />
                </span>
                <span className="mobile-approve-badge">Approve</span>
              </div>
              <div className="mobile-mini-meet" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <GoogleMeetIcon size={13} />
                <span>Google Meet link attached</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 4. FEATURES (COMPACT SINGLE COLUMN) ---------------- */}
      <section className="mobile-features-section reveal-on-scroll" id="features">
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
                <div className="mobile-feature-icon-tile">
                  {item.icon === 'calendar' && <Calendar size={18} strokeWidth={1.75} />}
                  {item.icon === 'upi' && <UpiFlashIcon size={18} />}
                  {item.icon === 'video' && <Video size={18} strokeWidth={1.75} />}
                  {item.icon === 'mail' && <Mail size={18} strokeWidth={1.75} />}
                  {item.icon === 'link' && <Link2 size={18} strokeWidth={1.75} />}
                  {item.icon === 'dashboard' && <LayoutDashboard size={18} strokeWidth={1.75} />}
                </div>
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
      <section className="mobile-audience-section reveal-on-scroll" id="who-its-for">
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
                <div className="audience-icon-tile">
                  {cat.icon === 'dumbbell' && <Dumbbell size={22} strokeWidth={1.75} />}
                  {cat.icon === 'briefcase' && <Briefcase size={22} strokeWidth={1.75} />}
                  {cat.icon === 'graduation-cap' && <GraduationCap size={22} strokeWidth={1.75} />}
                </div>
                <span className="mobile-audience-badge">{cat.badge}</span>
              </div>
              <h3 className="mobile-audience-title">{cat.title}</h3>
              <p className="mobile-audience-desc">{cat.desc}</p>
              {cat.snippet && (
                <div className="audience-snippet-box mobile-snippet-box">
                  <span className="snippet-bullet">●</span>
                  <span className="snippet-text">{cat.snippet}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- 6. LIVE DEMO ---------------- */}
      <section className="mobile-demo-section reveal-on-scroll">
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
      <section className="mobile-faq-section reveal-on-scroll" id="faq">
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
                  <span className="mobile-faq-icon">
                    {isOpen ? <Minus size={18} strokeWidth={2} /> : <Plus size={18} strokeWidth={2} />}
                  </span>
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
      <section className="mobile-final-cta-section reveal-on-scroll">
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
          <a href={`mailto:${SUPPORT_EMAIL}`} className="mobile-contact-email" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Mail size={14} strokeWidth={1.75} />
            <span>{SUPPORT_EMAIL}</span>
          </a>
        </div>

        <p className="mobile-copyright">
          © {new Date().getFullYear()} Calup. All rights reserved.
        </p>
      </footer>

      {/* ---------------- STICKY BOTTOM "START FREE" BAR ---------------- */}
      <div className="mobile-sticky-bottom-bar">
        <div className="sticky-bar-info">
          <span className="sticky-bar-title">Calup</span>
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
