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
  CalendarCheck,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import BrandLogo from '../components/ui/BrandLogo';
import PillButton from '../components/ui/PillButton';
import PhoneMockup from '../components/landing/PhoneMockup';
import DashboardMockup from '../components/landing/DashboardMockup';
import { InstagramIcon, WhatsAppIcon, GoogleMeetIcon, UpiFlashIcon } from '../components/landing/LandingIcons';
import { LANDING_CONTENT, SUPPORT_EMAIL } from '../data/landingContent';
import './Landing.css';

export default function LandingDesktop() {
  const navigate = useNavigate();
  const [openFaqIndex, setOpenFaqIndex] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [howVisible, setHowVisible] = useState(false);
  const howSectionRef = useRef(null);

  const toggleFaq = (index) => {
    setOpenFaqIndex(prev => prev === index ? null : index);
  };

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

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
      { threshold: 0.12 }
    );
    elements.forEach((el) => revealObserver.observe(el));

    // How it works step connector animation observer
    let howObserver;
    if (howSectionRef.current) {
      howObserver = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setHowVisible(true);
            if (howObserver) howObserver.disconnect();
          }
        },
        { threshold: 0.2 }
      );
      howObserver.observe(howSectionRef.current);
    }

    return () => {
      window.removeEventListener('scroll', handleScroll);
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
    <div className="landing-desktop landing-janjiyuk">
      {/* ---------------- NAVIGATION ---------------- */}
      <header className={`landing-nav-wrap ${isScrolled ? 'is-scrolled' : ''}`}>
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

          {/* Right: Dual Mockups (Phone + Dashboard Together + Floating Cards) */}
          <div className="hero-mockups-col">
            <div className="desktop-hero-visual-combo">
              <DashboardMockup />
              <div className="desktop-overlapping-phone">
                <PhoneMockup />

                {/* Floating Card 1: Top Left */}
                <div className="hero-floating-card floating-card-1" aria-hidden="true">
                  <div className="floating-card-icon lime-tile">
                    <CalendarCheck size={16} strokeWidth={2} />
                  </div>
                  <div className="floating-card-text">
                    <span className="floating-card-title">New booking</span>
                    <span className="floating-card-sub">Aarav · 10:00 AM</span>
                  </div>
                </div>

                {/* Floating Card 2: Bottom Right */}
                <div className="hero-floating-card floating-card-2" aria-hidden="true">
                  <div className="floating-card-icon lime-tile">
                    <ShieldCheck size={16} strokeWidth={2} />
                  </div>
                  <div className="floating-card-text">
                    <span className="floating-card-title">Payment approved</span>
                    <span className="floating-card-sub">₹1,500 · Direct UPI</span>
                  </div>
                </div>

                {/* Floating Card 3: Top Right */}
                <div className="hero-floating-card floating-card-3" aria-hidden="true">
                  <div className="floating-card-icon lime-tile">
                    <Video size={16} strokeWidth={2} />
                  </div>
                  <div className="floating-card-text">
                    <span className="floating-card-title">Meet link sent</span>
                    <span className="floating-card-sub">Calendar synced</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 2. PROBLEM SECTION: BEFORE / AFTER ---------------- */}
      <section className="landing-problem-section reveal-on-scroll">
        <div className="container">
          <div className="section-title-wrap text-center">
            <h2 className="section-headline">
              {problem.headline}
            </h2>
          </div>

          <div className="problem-comparison-grid">
            {/* Left: Before (WhatsApp chat bubbles) */}
            <div className="problem-before-col">
              <div className="problem-col-badge before-badge">Before · The back-and-forth</div>
              <div className="problem-chat-bubbles-stack">
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

            {/* Middle: Arrow indicator */}
            <div className="problem-arrow-divider" aria-hidden="true">
              <div className="problem-arrow-circle">
                <ArrowRight size={22} strokeWidth={2.5} />
              </div>
            </div>

            {/* Right: After (Single clean card) */}
            <div className="problem-after-col">
              <div className="problem-col-badge after-badge">With Calup</div>
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
          </div>
        </div>
      </section>

      {/* ---------------- 3. HOW IT WORKS ---------------- */}
      <section className="landing-how-section reveal-on-scroll" id="how-it-works" ref={howSectionRef}>
        <div className="container">
          <div className="section-title-wrap text-center">
            <span className="section-tag-pill">3-Step Flow</span>
            <h2 className="section-headline">
              {howItWorks.headline}
            </h2>
          </div>

          <div className="how-steps-flow">
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

            {/* Connector 1 -> 2 */}
            <div className={`step-connector-desktop ${howVisible ? 'is-animated' : ''}`} aria-hidden="true">
              <svg width="48" height="24" viewBox="0 0 48 24" fill="none" className="connector-svg">
                <path
                  d="M 2 12 H 38"
                  stroke="#0E0E0E"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                  className="connector-line"
                />
                <polyline
                  points="34,7 42,12 34,17"
                  stroke="#0E0E0E"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="connector-arrow"
                />
              </svg>
            </div>

            {/* Step 2 */}
            <div className="how-step-card">
              <div className="how-step-badge">{howItWorks.steps[1].number}</div>
              <h3 className="how-step-title">{howItWorks.steps[1].title}</h3>
              <p className="how-step-desc">{howItWorks.steps[1].desc}</p>

              <div className="how-mini-ui step-ui-2">
                <div className="mini-link-box">
                  <span className="mini-link-icon"><Link2 size={13} strokeWidth={2} /></span>
                  <span className="mini-link-text">calup.in/book/yourname</span>
                  <span className="mini-copy-pill">Copy</span>
                </div>
                <div className="mini-channels-row">
                  <span className="mini-channel-badge"><InstagramIcon size={14} /> Instagram Bio</span>
                  <span className="mini-channel-badge"><WhatsAppIcon size={14} /> WhatsApp</span>
                </div>
              </div>
            </div>

            {/* Connector 2 -> 3 */}
            <div className={`step-connector-desktop ${howVisible ? 'is-animated' : ''}`} aria-hidden="true">
              <svg width="48" height="24" viewBox="0 0 48 24" fill="none" className="connector-svg">
                <path
                  d="M 2 12 H 38"
                  stroke="#0E0E0E"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                  className="connector-line"
                />
                <polyline
                  points="34,7 42,12 34,17"
                  stroke="#0E0E0E"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="connector-arrow"
                />
              </svg>
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
                    <span className="mini-green-check" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Check size={12} strokeWidth={2.5} /> Paid
                    </span>
                  </div>
                  <div className="mini-meet-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <GoogleMeetIcon size={13} />
                    <span>Google Meet Link Attached</span>
                  </div>
                </div>
                <div className="mini-approve-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <span>1-Tap Approve</span>
                  <Check size={14} strokeWidth={2.5} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 4. FEATURES ---------------- */}
      <section className="landing-features-section reveal-on-scroll" id="features">
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
                    {item.icon === 'calendar' && <Calendar size={20} strokeWidth={1.75} />}
                    {item.icon === 'upi' && <UpiFlashIcon size={20} />}
                    {item.icon === 'video' && <Video size={20} strokeWidth={1.75} />}
                    {item.icon === 'mail' && <Mail size={20} strokeWidth={1.75} />}
                    {item.icon === 'link' && <Link2 size={20} strokeWidth={1.75} />}
                    {item.icon === 'dashboard' && <LayoutDashboard size={20} strokeWidth={1.75} />}
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
      <section className="landing-audience-section reveal-on-scroll" id="who-its-for">
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
                <div className="audience-icon-tile">
                  {cat.icon === 'dumbbell' && <Dumbbell size={24} strokeWidth={1.75} />}
                  {cat.icon === 'briefcase' && <Briefcase size={24} strokeWidth={1.75} />}
                  {cat.icon === 'graduation-cap' && <GraduationCap size={24} strokeWidth={1.75} />}
                </div>
                <div className="audience-badge">{cat.badge}</div>
                <h3 className="audience-title">{cat.title}</h3>
                <p className="audience-desc">{cat.desc}</p>

                {/* Example Snippet */}
                {cat.snippet && (
                  <div className="audience-snippet-box">
                    <span className="snippet-bullet">●</span>
                    <span className="snippet-text">{cat.snippet}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- 6. LIVE DEMO ---------------- */}
      <section className="landing-demo-section reveal-on-scroll">
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
              <div className="demo-pill-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Zap size={12} strokeWidth={2} /> Instant preview
              </div>
              <PhoneMockup style={{ maxWidth: 220 }} />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 7. FAQ (ACCORDION) ---------------- */}
      <section className="landing-faq-section reveal-on-scroll" id="faq">
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
                    <span className="faq-toggle-icon">
                      {isOpen ? <Minus size={18} strokeWidth={2} /> : <Plus size={18} strokeWidth={2} />}
                    </span>
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
      <section className="landing-final-cta-section reveal-on-scroll">
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
              <a href={`mailto:${SUPPORT_EMAIL}`} className="footer-email-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Mail size={15} strokeWidth={1.75} />
                <span>{SUPPORT_EMAIL}</span>
              </a>
              <div className="footer-direct-note">
                Early access support for verified coaches & tutors.
              </div>
            </div>
          </div>

          <div className="footer-bottom-row">
            <p>© {new Date().getFullYear()} Calup. All rights reserved.</p>
            <div className="footer-legal">
              <span>0% Commission Booking</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
