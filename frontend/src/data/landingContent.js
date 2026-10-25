/**
 * CalUp — Canonical Landing Page Content
 * Shared across both Desktop and Mobile layouts to ensure zero copy drift.
 */

export const SUPPORT_EMAIL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPPORT_EMAIL) ||
  (typeof process !== 'undefined' && (process.env?.VITE_SUPPORT_EMAIL || process.env?.SUPPORT_EMAIL)) ||
  'support@calup.app';

export const DEMO_SLUG =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEMO_SLUG) ||
  (typeof process !== 'undefined' && process.env?.VITE_DEMO_SLUG) ||
  '';

export const LANDING_CONTENT = {
  nav: {
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Features", href: "#features" },
      { label: "Who it's for", href: "#who-its-for" },
      { label: "FAQ", href: "#faq" },
    ],
    login: "Login",
    cta: "Create account",
  },

  hero: {
    headlineBold: "Share one link.",
    headlineItalic: "Get booked and paid.",
    subline: "Calup is the booking page for coaches, consultants and tutors. Clients choose a time and pay through your enabled checkout. Manage bookings and payment updates in one place.",
    primaryCta: "Create account",
    secondaryCta: "See a live booking page",
    demoUrl: DEMO_SLUG ? `/book/${DEMO_SLUG}` : '/book/demo',
    badges: "Free early access for selected merchants. Otherwise ₹299 + applicable tax / 30 days.",
  },

  problem: {
    headline: "Booking a session shouldn't take 20 messages.",
    chatBubbles: [
      {
        text: "What time are you free?",
        time: "10:14 AM",
        sender: "client",
      },
      {
        text: "Did you get my payment?",
        time: "10:28 AM",
        sender: "client",
      },
      {
        text: "Can we move it to Thursday?",
        time: "11:05 AM",
        sender: "client",
      },
    ],
    resolution: "Keep availability, payment status and booking changes together in Calup.",
  },

  howItWorks: {
    headline: "From link to booked in three steps",
    steps: [
      {
        number: "1",
        title: "Set your hours",
        desc: "Add your services, prices and weekly availability.",
      },
      {
        number: "2",
        title: "Share your link",
        desc: "Put it in your Instagram bio or send it on WhatsApp.",
      },
      {
        number: "3",
        title: "Clients book and pay",
        desc: "Clients pick an available slot and use the enabled payment checkout. Confirmation follows verified payment and slot allocation. Connect Google Calendar for supported online sessions.",
      },
    ],
  },

  features: {
    headline: "Tools for bookings, payments and sessions",
    items: [
      {
        title: "Smart availability",
        desc: "Set working hours and buffers. Server-held slots help prevent overlapping bookings.",
        icon: "calendar",
      },
      {
        title: "Cashfree checkout",
        desc: "Offer enabled payment methods through Cashfree. Available methods and provider charges depend on your payment setup.",
        icon: "upi",
      },
      {
        title: "Google Calendar + Meet",
        desc: "Connect Google Calendar to create calendar events and Meet links for supported online services.",
        icon: "video",
      },
      {
        title: "Booking updates",
        desc: "Keep track of booking confirmations and payment updates through enabled notifications.",
        icon: "mail",
      },
      {
        title: "Client self-service",
        desc: "Clients track their booking and request eligible changes through verified booking access. No client account is needed.",
        icon: "link",
      },
      {
        title: "One dashboard",
        desc: "All bookings, payment status and clients in one place.",
        icon: "dashboard",
      },
    ],
    comingSoon: "Payment methods and notifications depend on your enabled integrations.",
  },

  whoItsFor: {
    headline: "Built for people who sell their time",
    categories: [
      {
        title: "Coaches & trainers",
        desc: "Fitness trainers, executive coaches, sports coaches, and life mentors.",
        badge: "1-on-1 & Series",
        snippet: "Fitness coaching · 60 min · ₹1,200",
        icon: "dumbbell",
      },
      {
        title: "Consultants",
        desc: "Business strategists, independent advisors, legal experts, and financial consultants.",
        badge: "Strategy Calls",
        snippet: "Strategy advisory · 45 min · ₹2,500",
        icon: "briefcase",
      },
      {
        title: "Tutors & teachers",
        desc: "Language teachers, academic tutors, music instructors, and test prep coaches.",
        badge: "Hourly Sessions",
        snippet: "Math tutoring · 60 min · ₹800",
        icon: "graduation-cap",
      },
    ],
  },

  liveDemo: {
    headline: "Try it as a client",
    desc: "See how booking feels from your client's perspective.",
    cta: "See a live booking page",
    demoUrl: DEMO_SLUG ? `/book/${DEMO_SLUG}` : '/book/demo',
  },

  faq: {
    headline: "Frequently asked questions",
    items: [
      {
        question: "Do my clients need an account?",
        answer: "No. Clients book from your link and use verified booking access to manage their appointment.",
      },
      {
        question: "How do I get paid?",
        answer: "Cashfree checkout supports the payment methods enabled for your account. A booking is confirmed only after verified payment and slot allocation. Any separately offered merchant payment arrangement must be clearly explained before payment.",
      },
      {
        question: "Does it work with Google Calendar?",
        answer: "Connect your Google Calendar account to create calendar events and Meet links for supported online services. Availability depends on the connected integration.",
      },
      {
        question: "What does it cost?",
        answer: "Early access is free for selected merchants under their issued access terms. Otherwise Calup access costs ₹299 plus applicable tax for 30 days. Review your eligibility, tax and final payable amount in your account before payment.",
      },
    ],
  },

  finalCta: {
    headline: "Give your clients a link that just works.",
    cta: "Create account",
  },

  footer: {
    tagline: "The friendly booking page for coaches, consultants and tutors.",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Features", href: "#features" },
      { label: "Who it's for", href: "#who-its-for" },
      { label: "FAQ", href: "#faq" },
      { label: "Login", href: "/login" },
      { label: "Create account", href: "/signup" },
    ],
    contactEmail: SUPPORT_EMAIL,
  },
};
