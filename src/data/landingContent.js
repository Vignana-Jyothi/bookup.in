/**
 * CalUp — Canonical Landing Page Content
 * Shared across both Desktop and Mobile layouts to ensure zero copy drift.
 */

export const SUPPORT_EMAIL = 'support@calup.in';

export const LANDING_CONTENT = {
  nav: {
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Features", href: "#features" },
      { label: "Who it's for", href: "#who-its-for" },
      { label: "FAQ", href: "#faq" },
    ],
    login: "Login",
    cta: "Start free",
  },

  hero: {
    headlineBold: "Share one link.",
    headlineItalic: "Get booked and paid.",
    subline: "Calup is the booking page for coaches, consultants and tutors. Clients pick a time, pay you directly on UPI, and get a Google Meet link. No WhatsApp back-and-forth.",
    primaryCta: "Start free",
    secondaryCta: "See a live booking page",
    demoUrl: "/book/dr-arjun-patel",
    badges: "Free during early access · No client sign-up · 0% commission",
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
    resolution: "Calup handles all three, automatically.",
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
        desc: "They pick a slot, pay by UPI and upload the screenshot. You approve in one tap, and they get a Google Meet link.",
      },
    ],
  },

  features: {
    headline: "Everything that exists. Nothing that doesn't.",
    items: [
      {
        title: "Smart availability",
        desc: "Set working hours and buffers. Booked slots disappear so you never get double-booked.",
        icon: "calendar",
      },
      {
        title: "Direct UPI payments",
        desc: "Money goes straight to you. Calup takes 0% commission.",
        icon: "upi",
      },
      {
        title: "Google Calendar + Meet",
        desc: "Bookings land on your calendar with a Meet link attached.",
        icon: "video",
      },
      {
        title: "Instant emails",
        desc: "You and your client both get confirmation and payment updates.",
        icon: "mail",
      },
      {
        title: "Client self-service",
        desc: "Clients track, reschedule or cancel from a private link. No account needed.",
        icon: "link",
      },
      {
        title: "One dashboard",
        desc: "All bookings, payment approvals and clients in one place.",
        icon: "dashboard",
      },
    ],
    comingSoon: "Coming soon: WhatsApp reminders, online card payments.",
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
    desc: "See how smooth and simple booking feels from your client's perspective.",
    cta: "See a live booking page",
    demoUrl: "/book/dr-arjun-patel",
  },

  faq: {
    headline: "Frequently asked questions",
    items: [
      {
        question: "Do my clients need an account?",
        answer: "No. They book with a link and track it with a private link.",
      },
      {
        question: "How do I get paid?",
        answer: "Clients pay you directly by UPI or QR. You confirm each payment.",
      },
      {
        question: "Does it work with Google Calendar?",
        answer: "Yes, and every booking gets a Meet link.",
      },
      {
        question: "What does it cost?",
        answer: "Free during early access.",
      },
    ],
  },

  finalCta: {
    headline: "Give your clients a link that just works.",
    cta: "Start free",
  },

  footer: {
    tagline: "The friendly booking page for coaches, consultants and tutors.",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Features", href: "#features" },
      { label: "Who it's for", href: "#who-its-for" },
      { label: "FAQ", href: "#faq" },
      { label: "Login", href: "/login" },
      { label: "Start free", href: "/signup" },
    ],
    contactEmail: SUPPORT_EMAIL,
  },
};
