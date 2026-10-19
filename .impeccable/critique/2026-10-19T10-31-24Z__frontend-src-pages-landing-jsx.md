---
target: frontend/src/pages/Landing.jsx
total_score: 24
p0_count: 0
p1_count: 2
timestamp: 2026-10-19T10-31-24Z
slug: frontend-src-pages-landing-jsx
---
Method: dual-agent (A: /root/subscription_design; B: /root/subscription_evidence).

# Landing page and attached links

Scope: local Landing.jsx, desktop/mobile layouts, shared content/header/footer, linked subscription/auth/policy destinations. Source review, calculated contrast, route/fragment checks and one anonymous read-only configured-provider existence check. No browser visual or interaction evidence. No application changes.

## Design health

| Heuristic | Score /4 | Main finding |
|---|---:|---|
| System status | 2 | Mobile FAQ lacks native control/state. |
| Real-world language | 2 | Relevant audience; conflicting payment explanation. |
| User control | 3 | Shared mobile navigation improved; auth/home/recovery paths exist. |
| Consistency | 2 | Shared layout copy conflicts with subscription/payment surfaces. |
| Error prevention | 2 | Paid access advertised as free; booking example is real. |
| Recognition | 3 | Specific audience and ordered explanation. |
| Efficiency | 2 | Anchors exist; route CTAs use buttons. |
| Minimalist design | 2 | Repeated cards, effects and promises. |
| Error recovery | 3 | Source routes exist; submissions/errors untested. |
| Help | 3 | Detailed policies; obsolete marketing FAQ. |
| Total | 24/40 | Material improvements needed. |

## Anti-pattern verdict

Source suggests a familiar SaaS template: repeated rounded cards, labels, floating status illustrations, italic accent and decorative blobs. Product examples provide useful context; preserve lime/black and brand fonts while simplifying repetition. This is not an authorship claim or screenshot-based verdict. Installed markup detector returned exit0, JSON[], zero findings across desktop/mobile/header/footer/legal JSX, no false positives. Manual checks found CSS/accessibility defects beyond that scan.

## Strengths

The hero describes one concrete mechanism for coaches, consultants and tutors. Shared LANDING_CONTENT limits desktop/mobile drift. The three-step narrative is a justified sequence. Policy pages offer semantic document navigation, table of contents and contact links. The recently fixed shared mobile modal navigation remains in place; earlier drawer defects must not be repeated as current findings.

## Priority issues

1. P1: Financial and product claims conflict. landingContent.js:25,32,35,169,176,187 and LandingMobile.jsx:461 promise free access, contrary to owner-confirmed299 plus tax/30days. ManualUPI/screenshot approval claims and guaranteedMeet/automation statements at landingContent.js:31,76,90-96,115,161,165 differ from enabled-arrangement and integration conditions in policies and Cashfree flow. Update shared copy, independent sticky copy and mockups; distinguish platform commission from gateway charges. Suggested impeccable clarify.
2. P1: Mobile FAQ is not keyboard-operable. LandingMobile.jsx:413-426 uses clickabledivs without button or expanded state; desktop has a nativebutton. Neither landing layout supplies a main landmark or skip link. Use shared native disclosure and add skip/main structure. Suggested impeccable harden/audit.
3. P2: Sections depend on animation setup for visibility. Landing.css:2249-2259 sets opacity0 until IntersectionObserver adds a class. Make content visible by default and progressively enhance motion; retain reduced-motion support. Suggested impeccable harden.
4. P2: The advertised booking example is a real merchant journey. landingContent.js:34,149 selects configuredslug or/book/demo; BookingPage.jsx:52 disables demo mode. Anonymous configured-provider lookup succeeded, so do not call it broken. Protect evaluation with a clearly labelled read-only demonstration or explicitly warn that actual submissions create bookings. Actual deployment configuration/payment behavior unverified; no booking or payment made. Suggested impeccable onboard/harden.
5. P2: Linked policies still depend on incomplete local business configuration. LegalPage.jsx:33-36 displays draftstatus when legalDetailsPending; local environment profiles omit business address and grievancecontact name. Obtain actual business details; do not invent them. LiveVercel configuration not established. Suggested impeccable clarify.

## Link inventory

| Destination | Result |
|---|---|
| /, /login, /signup, /subscriptions | Routes declared; CTA and brand destinations consistent. |
| /#how-it-works, /#features, /#who-its-for, /#faq | Matching IDs in both layouts; shared links correctly return home from subscription/policies; Landing.jsx scroll effect exists. |
| Configured /book/:slug | Route and configured provider exist; real merchant flow, not isolated demo; no submission. |
| /terms-and-conditions, /privacy-policy, /refund-policy, /cancellation-policy | Dynamic legal routes declared. |
| /service-delivery-policy, /cookie-policy, /contact | Dynamic legal routes declared; contact may show draft data. |
| Legal #policy-main and generated #policy-section-N | Source IDs match across all seven documents. |
| mailto support link | Configured/fallback address wired; delivery not tested and no message sent. |

Twelve unique page destinations, four shared home fragments and mailto checked, plus generated policy fragments. Route presence is not a successful browser visit. No broken source destination found. Auth links to password recovery and policy pages are declared; no sign-in/signup submitted. No external HTTP marketing links beyond email were found in landing markup.

## Personas, cognitive load and journey

First-time tutors encounter free claims before paid access. Narrow-layout keyboard users cannot open FAQ answers. Cautious merchants need actual payment conditions and a dependable safe example. Load is moderate: one main conversion but repeated selling content; six feature groups are information, not six purchasing choices. The useful journey is problem, three steps, example, decision. Current financial contradictions create a trust valley and obsolete free wording weakens the ending.

## Minor observations

Footer fineprint #666660 on#0e0e0e calculates3.34:1, below4.5; footer links and main hero body pass. Homepage hash sections lack sticky-header scroll offsets. Mobile sticky CTA lacks safe-area treatment; actual clipping/zoom unverified. PhoneMockup has a nonfunctionalContinuebutton styled as a control and exposed to the accessibility tree. Prefer real links for navigation CTAs. Existing disabled navigation enhancements must stay disabled.

## Recommended sequence and decisions

Clarify pricing/payment/integration copy first, harden FAQ and visible-default sections, provide an explicitly safe example, complete business details, then distill/polish. Confirm which merchant payment arrangements are intended for current launch copy; do not infer all merchants use one arrangement.
