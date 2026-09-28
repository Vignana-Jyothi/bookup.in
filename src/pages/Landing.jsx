import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useStore } from '../data/store';
import { ACTIONS } from '../data/actions';
import BrandLogo from '../components/ui/BrandLogo';
import PillButton from '../components/ui/PillButton';
import './Landing.css';

const PARTNERS = ['Layers', 'Intercom', 'Segment', 'Notion', 'Linear', 'Vercel', 'Stripe'];

const TESTIMONIALS = [
  {
    quote: "CalUp feels friendly and lightweight. It didn't need a tutorial and my clients love it.",
    author: "Nina Linda",
    role: "Yoga Studio Owner",
    bg: "lime-soft",
  },
  {
    quote: "The dashboard is clean and calming. I instantly know what today looks like in 2 seconds.",
    author: "Andi Pratama",
    role: "Auto Detailing Specialist",
    bg: "white",
  },
  {
    quote: "No more endless WhatsApp messages to book appointments. Clients simply pick a time and confirm.",
    author: "Rizky Kayansyah",
    role: "Barbershop Founder",
    bg: "lime-soft",
  },
  {
    quote: "Google Meet link generation and instant confirmation emails saved me 10 hours every week.",
    author: "Dr. Arjun Patel",
    role: "Consulting Physician",
    bg: "white",
  },
];

const ARTICLES = [
  {
    tag: "Product Update",
    title: "Instant Confirmation & Reminders are Live",
    desc: "Clients get instant calendar invites with Google Meet links, completely eliminating no-shows.",
    date: "Sep 2026",
  },
  {
    tag: "Business Guide",
    title: "Weekly Schedule Overview for Busy Owners",
    desc: "How service professionals organize their daily client capacity with zero stress.",
    date: "Aug 2026",
  },
  {
    tag: "Workflow",
    title: "Why Single-Link Booking Converts 3x Higher",
    desc: "Removing friction from appointment scheduling keeps your clients returning.",
    date: "Jul 2026",
  },
];

/* ---- Feature highlights data ---- */
const FEATURES = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E0E0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
      </svg>
    ),
    title: "Share Your Link",
    desc: "Give clients one simple booking link.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E0E0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    title: "Get Booked",
    desc: "Clients choose a time that works for them.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E0E0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
    ),
    title: "Stay Organized",
    desc: "Manage everything in one place.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E0E0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    title: "Grow Your Business",
    desc: "Less back-and-forth. More clients.",
  },
];

export default function Landing() {
  const navigate = useNavigate();
  const { dispatch } = useStore();
  const [activeTab, setActiveTab] = useState('features');

  const handleStartTrial = () => {
    // Demo mode disabled for production — direct users to real signup
    navigate('/signup');
  };

  return (
    <div className="landing-janjiyuk">
      {/* --- TOPBAR / NAVBAR --- */}
      <header className="landing-nav-wrap">
        <div className="landing-nav">
          <BrandLogo size="md" />

          <nav className="landing-nav-links hide-mobile">
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#solutions">Solutions</a>
            <a href="#testimonials">Reviews</a>
            <a href="#articles">Updates</a>
          </nav>

          <div className="landing-nav-actions">
            <Link to="/signup" className="btn btn-ghost hide-mobile">
              Signup
            </Link>
            <PillButton variant="primary" size="sm" arrow onClick={() => navigate('/login')}>
              Login
            </PillButton>
          </div>
        </div>
      </header>

      {/* --- HERO SECTION (Redesigned two-column) --- */}
      <section className="landing-hero-section">
        {/* Organic lime decorative shapes */}
        <div className="hero-blob hero-blob-1" aria-hidden="true" />
        <div className="hero-blob hero-blob-2" aria-hidden="true" />
        <div className="hero-blob hero-blob-3" aria-hidden="true" />

        <div className="hero-two-col">
          {/* LEFT COLUMN — text content */}
          <div className="hero-text-col animate-fade-in-up">
            {/* Social Proof Avatar Pill */}
            <div className="hero-social-proof">
              <div className="avatar-stack">
                <span className="avatar-mini">🧑🏽‍💼</span>
                <span className="avatar-mini">👩🏻‍⚕️</span>
                <span className="avatar-mini">💈</span>
                <span className="avatar-mini">💇🏼‍♀️</span>
              </div>
              <span>Loved by tons of Business Owners</span>
            </div>

            {/* Bold Sans Headline with Italic-Serif Accent Phrase */}
            <h1 className="hero-headline">
              A Friendly Way to <br className="hide-mobile" />
              <em className="headline-accent">Book Your Day</em>
            </h1>

            <p className="hero-subline">
              Simple scheduling for service businesses. Share your personal booking link,
              accept clients in seconds, and stay organized without the back-and-forth.
            </p>

            <div className="hero-cta-row">
              <PillButton variant="primary" size="lg" arrow onClick={handleStartTrial}>
                Start Free Trial
              </PillButton>
              <button className="hero-ghost-btn" onClick={handleStartTrial}>
                ⚡ View Live Demo
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN — mockups */}
          <div className="hero-mockups-col">
            {/* Handwritten annotations */}
            <div className="hero-annotation annotation-top" aria-hidden="true">
              <span>Your bookings.</span>
              <span>One simple link.</span>
            </div>
            <div className="hero-annotation annotation-right" aria-hidden="true">
              <span>Less chaos.</span>
              <span>More clients.</span>
            </div>

            {/* LAPTOP MOCKUP */}
            <div className="laptop-mockup">
              <div className="laptop-screen">
                {/* Browser chrome */}
                <div className="laptop-chrome">
                  <div className="chrome-dots">
                    <span className="dot dot-red" />
                    <span className="dot dot-yellow" />
                    <span className="dot dot-green" />
                  </div>
                  <div className="chrome-address">calup.in/dashboard</div>
                </div>

                {/* Dashboard content */}
                <div className="dash-content">
                  {/* Dashboard top bar */}
                  <div className="dash-topbar">
                    <div className="dash-topbar-left">
                      <div className="dash-logo-sm">
                        <div className="dash-logo-icon" />
                        <span>calup</span>
                      </div>
                      <div className="dash-nav-items">
                        <span className="dash-nav-active">Dashboard</span>
                        <span>Bookings</span>
                        <span>Services</span>
                        <span>Clients</span>
                        <span>Settings</span>
                      </div>
                    </div>
                    <div className="dash-avatar">S</div>
                  </div>

                  {/* Dashboard title */}
                  <div className="dash-title">Dashboard</div>

                  {/* Stat cards row */}
                  <div className="dash-stats-row">
                    <div className="dash-stat-card">
                      <div className="dash-stat-label">Total Bookings</div>
                      <div className="dash-stat-number">24</div>
                      <div className="dash-stat-change positive">▲ +12%</div>
                    </div>
                    <div className="dash-stat-card">
                      <div className="dash-stat-label">Active Clients</div>
                      <div className="dash-stat-number">18</div>
                      <div className="dash-stat-change positive">▲ +8%</div>
                    </div>
                    <div className="dash-stat-card">
                      <div className="dash-stat-label">This Month</div>
                      <div className="dash-stat-number">₹24,500</div>
                      <div className="dash-stat-change positive">▲ +20%</div>
                    </div>
                  </div>

                  {/* Upcoming Appointments table */}
                  <div className="dash-appointments">
                    <div className="appt-header">
                      <span className="appt-title">Upcoming Appointments</span>
                      <span className="appt-view-all">View All &gt;</span>
                    </div>
                    <div className="appt-date-label">● Today, Sep 25</div>
                    <div className="appt-table">
                      <div className="appt-row">
                        <span className="appt-time">10:00 AM</span>
                        <span className="appt-service">1-on-1 Coaching</span>
                        <span className="appt-client">Aarav Sharma</span>
                        <span className="appt-status confirmed">Confirmed</span>
                      </div>
                      <div className="appt-row">
                        <span className="appt-time">11:30 AM</span>
                        <span className="appt-service">Consultation Call</span>
                        <span className="appt-client">Priya Mehta</span>
                        <span className="appt-status confirmed">Confirmed</span>
                      </div>
                      <div className="appt-row">
                        <span className="appt-time">2:00 PM</span>
                        <span className="appt-service">Strategy Session</span>
                        <span className="appt-client">Rohan Verma</span>
                        <span className="appt-status pending">Pending</span>
                      </div>
                      <div className="appt-row">
                        <span className="appt-time">4:00 PM</span>
                        <span className="appt-service">Follow Up</span>
                        <span className="appt-client">Neha Kapoor</span>
                        <span className="appt-status confirmed">Confirmed</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Laptop base */}
              <div className="laptop-base" />
            </div>

            {/* FLOATING BOOKING CARD (dark) — overlapping the laptop */}
            <div className="floating-booking-card animate-scale-in">
              <div className="fbc-header">
                <span className="fbc-badge">Booking page</span>
              </div>
              <div className="fbc-sun-icon">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#C6F135" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              </div>
              <div className="fbc-title">Photo & Studio</div>
              <div className="fbc-desc">Fast, familiar booking<br/>for clients.</div>
            </div>

            {/* PHONE MOCKUP */}
            <div className="phone-mockup animate-scale-in">
              <div className="phone-notch" />
              <div className="phone-url-bar">calup.in/book/marcus-lee</div>
              <div className="phone-content">
                {/* Provider profile */}
                <div className="phone-profile">
                  <div className="phone-avatar-circle">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M20 21a8 8 0 10-16 0" />
                    </svg>
                  </div>
                  <div className="phone-profile-info">
                    <div className="phone-profile-name">Marcus Lee <span className="phone-verified">●</span></div>
                    <div className="phone-profile-role">1-on-1 Coaching</div>
                  </div>
                </div>

                {/* Select a Service */}
                <div className="phone-section-title">Select a Service</div>
                <div className="phone-services">
                  <div className="phone-service selected">
                    <div className="phone-service-radio active" />
                    <div className="phone-service-info">
                      <div className="phone-service-name">1-on-1 Coaching</div>
                      <div className="phone-service-meta">60 min · ₹1,200</div>
                    </div>
                  </div>
                  <div className="phone-service">
                    <div className="phone-service-radio" />
                    <div className="phone-service-info">
                      <div className="phone-service-name">Group Session</div>
                      <div className="phone-service-meta">90 min · ₹1,000</div>
                    </div>
                  </div>
                  <div className="phone-service">
                    <div className="phone-service-radio" />
                    <div className="phone-service-info">
                      <div className="phone-service-name">Nutrition Consultation</div>
                      <div className="phone-service-meta">30 min · ₹800</div>
                    </div>
                  </div>
                </div>

                {/* Select a Date */}
                <div className="phone-section-title">Select a Date</div>
                <div className="phone-calendar">
                  <div className="phone-cal-month">September 2026</div>
                  <div className="phone-cal-grid">
                    <span className="cal-day-header">Sun</span>
                    <span className="cal-day-header">Mon</span>
                    <span className="cal-day-header">Tue</span>
                    <span className="cal-day-header">Wed</span>
                    <span className="cal-day-header">Thu</span>
                    <span className="cal-day-header">Fri</span>
                    <span className="cal-day-header">Sat</span>
                    <span className="cal-day">21</span>
                    <span className="cal-day">22</span>
                    <span className="cal-day">23</span>
                    <span className="cal-day active">24</span>
                    <span className="cal-day today">25</span>
                    <span className="cal-day">26</span>
                    <span className="cal-day">27</span>
                  </div>
                </div>

                {/* Available Slots */}
                <div className="phone-section-title">Available Slots</div>
                <div className="phone-slots">
                  <span className="phone-slot">9:00 AM</span>
                  <span className="phone-slot selected">10:00 AM</span>
                  <span className="phone-slot">11:00 AM</span>
                </div>

                {/* Confirm button */}
                <button className="phone-confirm-btn">Confirm Booking</button>
              </div>
            </div>

            {/* "Built for service businesses." annotation */}
            <div className="hero-annotation annotation-bottom" aria-hidden="true">
              <span>Built for</span>
              <span>service <em>businesses.</em></span>
            </div>
          </div>
        </div>

        {/* Feature Highlights Strip */}
        <div className="hero-features-strip" id="features">
          {FEATURES.map((f, i) => (
            <div key={i} className="hero-feature-item">
              <div className="hero-feature-icon">{f.icon}</div>
              <div className="hero-feature-text">
                <div className="hero-feature-title">{f.title}</div>
                <div className="hero-feature-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* --- FLOATING NUMBERED BADGES SECTION --- */}
      <section className="landing-portal-section" id="how-it-works">
        <div className="container">
          <div className="portal-header text-center">
            <h2 className="portal-title">
              Everything You Need to Manage <br />
              <em className="headline-accent">Appointments</em>
            </h2>
            <p className="portal-sub">No complex setup. No complicated apps. Just easy scheduling.</p>
          </div>

          <div className="portal-graphic-container">
            {/* Center Dark Blob/Portal */}
            <div className="portal-blob">
              <div className="portal-inner-ring" />
            </div>

            {/* Floating Numbered Badges around blob */}
            <div className="portal-badge badge-pos-01">
              <span className="badge-num">01</span>
              <span className="badge-text">Share One Link</span>
            </div>
            <div className="portal-badge badge-pos-12">
              <span className="badge-num">12</span>
              <span className="badge-text">Smart Availability</span>
            </div>
            <div className="portal-badge badge-pos-25">
              <span className="badge-num">25</span>
              <span className="badge-text">Auto Confirmation</span>
            </div>
            <div className="portal-badge badge-pos-31">
              <span className="badge-num">31</span>
              <span className="badge-text">Instant Sync</span>
            </div>
          </div>
        </div>
      </section>

      {/* --- PARTNER LOGO STRIP --- */}
      <section className="landing-partners-section">
        <div className="container">
          <div className="partners-row">
            {PARTNERS.map(p => (
              <span key={p} className="partner-logo-item">
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* --- BUILT FOR SERVICE-BASED BUSINESSES (3-CARD GRID) --- */}
      <section className="landing-solutions-section" id="solutions">
        <div className="container">
          <div className="section-title-wrap text-center">
            <h2>
              Built for Service-Based <em className="headline-accent">Businesses</em>
            </h2>
            <p>From private studios to busy clinics, manage every client effortlessly.</p>
          </div>

          <div className="solutions-3card-grid">
            {/* Card 1: Dark Card */}
            <div className="solution-card card-black">
              <div className="solution-card-tag">Smart Calendar & Time-Slots</div>
              <h3>Automated Slot Management</h3>
              <p>Configure weekly business hours, break buffers, and advance notice rules in 3 clicks.</p>
              <div className="solution-mini-preview dark-preview">
                <div className="preview-row"><span>09:00</span> · Available</div>
                <div className="preview-row"><span>11:30</span> · Available</div>
                <div className="preview-row active"><span>14:00</span> · Booked ✓</div>
              </div>
            </div>

            {/* Card 2: Lime Card */}
            <div className="solution-card card-lime">
              <div className="solution-card-tag">Instant Delivery</div>
              <h3>Automated Notifications</h3>
              <p>Clients receive confirmation emails with Google Meet invites and self-serve reschedule links.</p>
              <div className="solution-mini-preview lime-preview">
                <div className="preview-bubble">
                  <strong>Session Confirmed!</strong>
                  <div>Google Meet link attached 📅</div>
                </div>
              </div>
            </div>

            {/* Card 3: White Card */}
            <div className="solution-card card-white">
              <div className="solution-card-tag">Self-Service</div>
              <h3>Customer Management</h3>
              <p>Zero friction. Clients manage their appointments securely without needing an account or password.</p>
              <div className="solution-mini-preview white-preview">
                <div className="preview-action-pill">📅 Reschedule</div>
                <div className="preview-action-pill">✕ Cancel</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- TRUST & STAT BLOCK --- */}
      <section className="landing-trust-section">
        <div className="container">
          <div className="trust-card">
            <div className="trust-quote-col">
              <p className="trust-quote">
                "Before using CalUp, we struggled with missed appointments and chaotic back-and-forth messaging.
                Now clients book instantly through one link, and our schedule stays 100% full."
              </p>
              <div className="trust-author">
                <strong>Riko & Maya</strong> — Studio Co-founders
              </div>
            </div>

            <div className="trust-video-col">
              <div className="trust-video-thumb">
                <img
                  src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=800&auto=format&fit=crop&q=80"
                  alt="Customer video review"
                  className="trust-img"
                />
                <div className="video-play-btn">▶</div>
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="stats-metric-row">
            <div className="stat-metric-item">
              <div className="stat-num">1,200+</div>
              <div className="stat-label">Appointments Handled</div>
            </div>
            <div className="stat-metric-item">
              <div className="stat-num">98%</div>
              <div className="stat-label">Client Satisfaction</div>
            </div>
            <div className="stat-metric-item">
              <div className="stat-num">3X</div>
              <div className="stat-label">Faster Booking</div>
            </div>
            <div className="stat-metric-item">
              <div className="stat-num">0</div>
              <div className="stat-label">App Downloads Needed</div>
            </div>
          </div>
        </div>
      </section>

      {/* --- TESTIMONIAL GRID --- */}
      <section className="landing-reviews-section" id="testimonials">
        <div className="container">
          <div className="section-title-wrap text-center">
            <h2>
              Loved by Professionals Everywhere
            </h2>
            <p>Here is what service business owners say about using CalUp.</p>
          </div>

          <div className="testimonial-grid">
            {TESTIMONIALS.map((t, idx) => (
              <div key={idx} className={`testimonial-card ${t.bg}`}>
                <p className="testimonial-quote">"{t.quote}"</p>
                <div className="testimonial-meta">
                  <div className="avatar-circle">{t.author.charAt(0)}</div>
                  <div>
                    <div className="testimonial-author">{t.author}</div>
                    <div className="testimonial-role">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- LATEST UPDATES / NEWS --- */}
      <section className="landing-articles-section" id="articles">
        <div className="container">
          <div className="section-title-wrap text-center">
            <h2>
              Latest from <em className="headline-accent">CalUp</em>
            </h2>
            <p>Product improvements and guides to help your service business thrive.</p>
          </div>

          <div className="articles-grid">
            {ARTICLES.map((art, idx) => (
              <div key={idx} className="article-card">
                <span className="article-tag">{art.tag}</span>
                <h4 className="article-title">{art.title}</h4>
                <p className="article-desc">{art.desc}</p>
                <div className="article-footer">
                  <span className="article-date">{art.date}</span>
                  <span className="article-link">Read more →</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- PRE-FOOTER CTA CARD --- */}
      <section className="landing-cta-section">
        <div className="container">
          <div className="prefooter-lime-card">
            <h2>
              Ready to Make Booking Feel <em className="headline-accent">Easy?</em>
            </h2>
            <p>Set up your booking page in 3 minutes. Share one link and get booked today.</p>
            <PillButton variant="primary" size="lg" arrow onClick={handleStartTrial}>
              Get Started with CalUp
            </PillButton>
          </div>
        </div>
      </section>

      {/* --- BLACK FOOTER --- */}
      <footer className="landing-footer">
        <div className="container">
          <div className="footer-top-row">
            <div className="footer-brand-col">
              <BrandLogo size="lg" light />
              <p className="footer-tagline">
                The friendly scheduling platform for modern service businesses.
              </p>
            </div>

            <div className="footer-links-col">
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#solutions">Solutions</a>
              <Link to="/login">Provider Login</Link>
              <Link to="/signup">Create Account</Link>
            </div>

            <div className="footer-links-col">
              <h4>Company</h4>
              <a href="#about">About</a>
              <a href="#testimonials">Reviews</a>
              <a href="#articles">Blog</a>
              <a href="mailto:support@calup.in">Contact Support</a>
            </div>
          </div>

          <div className="footer-bottom-row">
            <p>© {new Date().getFullYear()} CalUp Technologies. All rights reserved.</p>
            <div className="footer-legal">
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
