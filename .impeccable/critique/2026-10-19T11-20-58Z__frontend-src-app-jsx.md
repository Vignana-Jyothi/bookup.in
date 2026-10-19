---
target: frontend/src/App.jsx
total_score: 24
p0_count: 0
p1_count: 5
timestamp: 2026-10-19T11-20-58Z
slug: frontend-src-app-jsx
---
# Complete website and application UI/UX review

Method: dual-agent (A: /root/subscription_design; B: /root/subscription_evidence), supplemented by primary-agent browser and isolated-component checks.

Reviewed current local source on 19 October 2026. No application implementation was changed for this review. This is a complete route-family source assessment with representative browser verification, not certification that every authenticated workflow or financial outcome was exercised.

## Overall assessment

**24/40. Calup has a recognizable identity and substantially clearer customer payment recovery. The largest remaining problems are trust in merchant actions, financial feedback, and inconsistent accessibility across operational screens.** Fix those before a visual redesign.

The recent public-page and recovery fixes are present. Selected merchants receive free early access under issued terms; otherwise the public price is INR299 plus applicable tax per30days. The original configured booking example is restored at the owner's request. Blank business address and named grievance contact are deliberate. None of those decisions is reported as a new defect. Previously disabled navigation enhancements remain outside the recommendations.

## Evidence and boundaries

- Assessment A independently reviewed current route components, shared components and relevant state/action handlers. Assessment B independently reviewed technical evidence and ran the detector; its findings were held until A finished.
- Bundled detector scanned64 markup files and returned6 warnings across5 files. Observed process exit1; valid JSON was returned. Automated scan does not establish accessibility or design quality.
- Public browser checks covered30 route/viewport combinations: landing, subscription, login, signup, password recovery, invalid reset-link entry, contact and standalone sandbox at1440/390/320px; six additional policies at390px. No document horizontal overflow or JavaScript page errors in those checks.
- Fresh-browser keyboard checks confirmed mobile FAQ activation, native public-menu Tab containment, Escape closure and focus return. A subscription/footer FAQ link returned to the corresponding homepage section after scroll completed.
- Existing isolated production-component browser suite passed26 interaction groups with no page errors. Data/service adapters were stubbed and external requests blocked. These are interaction groups, not26 whole application screens.
- An isolated production Subscription component reproduced unknown subscription information displaying zero price after GET failure, and a separate fixture reproduced renewal-success feedback from an existing entitlement without order-specific payment verification.
- Authenticated production merchant/admin accounts were not used: the owner chose isolated test screens. No real booking, payment, cancellation, refund, message, SMS, calendar change or account creation was submitted. Live deployments may differ from the reviewed local source.

## Design health

| Nielsen heuristic | Score /4 | Finding |
|---|---:|---|
| Visibility of system status | 2 | Customer recovery improved; merchant saves still overstate success. |
| Match with the real world | 3 | Clearer pricing and stages; some prototype/legacy language remains. |
| User control and freedom | 2 | Retry/cancel paths exist; dialog and drawer boundaries inconsistent. |
| Consistency and standards | 2 | Good shared patterns are not applied throughout settings/billing. |
| Error prevention | 2 | Local-only appointment creation and unverified defaults create mistakes. |
| Recognition rather than recall | 3 | Labelled steps, explicit prices, filters and data alternatives. |
| Flexibility and efficiency | 3 | Consolidated merchant filters and useful specialist operations. |
| Aesthetic and minimalist design | 2 | Public pricing restrained; operational screens retain card/style repetition. |
| Error recovery | 2 | Checkout recovery good; merchant write/load failures often weak. |
| Help and documentation | 3 | Useful policies/support; operational help sometimes misleading. |
| **Total** | **24/40** | **Important trust and accessibility fixes remain.** |

## What works

1. Customer payment recovery distinguishes unavailable, unknown, pending, expired, paid and review-required states. Automatic refresh and verified-phone recovery provide useful next actions. These should become the feedback standard for subscription and merchant operations.
2. Public subscription pricing is visibly grouped with period, tax treatment, renewal control, selected early access and account actions. Its desktop/mobile rendering passed the reviewed widths.
3. Service validation, named calendar dates, native modal boundaries and chart data-table alternatives are reusable strengths. The isolated suite verified keyboard/focus, error association and narrow-width examples of these patterns.
4. Merchant header controls and appointment filtering now emphasize useful tasks. Administrator financial review has explicit authorization, reasons, stale-snapshot context and confirmation steps.
5. Product/membership screens visibly identify sandbox limits and pending encrypted delivery rather than claiming delivery has happened.

## Priority issues

### 1. P1 — Manual appointments look saved without durable creation

**Evidence:** Appointments.jsx:650-705 creates a booking-prefixed local ID, dispatches ADD_BOOKING and announces success; the handler does not create a server record. store.jsx:130 only updates React state, while production browser persistence is disabled around275-281. Appointments.jsx:692 sets a calendar-sync flag from connection state without creating an event in that handler.

**User impact:** A merchant can believe an appointment and availability are saved or synchronized when the entry exists only in the current client session. Reload can lose it; authoritative scheduling may not know the slot is occupied.

**Fix:** Await server-owned manual appointment creation and conflict validation. Use the returned record; keep the form and values on failure. Calendar status must represent an actual result or a clearly pending operation. If a local draft is intended, label it a draft rather than confirmed.

**Suggested:** `$impeccable harden`. High-confidence current-source finding; no real appointment submitted.

### 2. P1 — Several merchant changes announce success before persistence

**Evidence:** Appointments.jsx:302-328 reschedule,354-362 completion,434-438 late cancellation and457-461 deletion catch or omit awaiting persistence, then update local state and announce success. These are legacy/non-Cashfree paths, not the gateway finalizer. The cancellation path removes a Google event before the server cancellation succeeds around396-420. Settings.jsx:705-713 removes the QR locally, ignores persistence failure and announces removal.

**User impact:** The visible schedule, deletion, financial label or calendar can disagree with authoritative records. A dialog closing with a success notification gives the merchant no reason to retry.

**Fix:** Await authoritative changes, retain the previous state on failure, keep work available, and provide retry. Report database save separately from calendar/notification completion. Sequence irreversible downstream effects after confirmed state changes or use a recoverable job.

**Suggested:** `$impeccable harden`. Verified in current handlers; failures not submitted against production services.

### 3. P1 — Subscription renewal feedback is not tied to the renewal order

**Evidence:** Subscription.jsx:158 and193 decide success using entitlement.source==='paid' and absence of openOrder. merchantSubscription.js returns the merchant projection for non-PAID results; subscription SQL only projects created/pending orders as open. An older paid entitlement can remain after the new renewal order expires or disappears.

**Reproduction:** Isolated production-component fixture supplied an existing paid entitlement and a refreshed projection without an open order or newly verified renewal. The UI announced **“Payment verified. Your 30-day access is active.”** No gateway or payment was involved.

**User impact:** A returning paid merchant can misread an unverified renewal as successful and may be shown an older billing document.

**Fix:** Return and inspect the requested order's authoritative payment/application status and identity. Show renewal success and that order's receipt only after that renewal is verified and applied. Keep existing access and the attempted renewal as separate facts.

**Suggested:** `$impeccable harden` / `$impeccable clarify`.

### 4. P1 — Failed reads can look like valid financial configuration

**Policies:** Policies.jsx:45-69 logs a failed load, clears loading, and leaves DEFAULT_POLICY editable. Save can then persist those defaults without explaining that the existing policy was unavailable.

**Subscription:** Subscription.jsx:62-82 catches loading failure but renders missing plan/entitlement as an ordinary card. An isolated failed-GET fixture showed **INR0.00**, **Access required**, and the seven-day renewal explanation alongside an error notification.

**User impact:** An unavailable record can be mistaken for a genuine policy, price or access decision. Saving policy defaults risks changing refund/reschedule rules unintentionally.

**Fix:** Model loading, loaded, explicitly unconfigured, unavailable and stale states separately. Never present unknown price as zero or unknown policy as known defaults. Preserve known data and user work; provide a local retry within the relevant content. This does not require restoring archived navigation enhancements.

**Suggested:** `$impeccable harden`.

### 5. P1 — Accessibility is still inconsistent in important merchant workflows

**Evidence:** Settings.jsx:525-600 has visible labels without input association and errors without programmatic relationships. Policies.jsx:153,171,225,243,258,276 has unnamed or ambiguously grouped financial fields. Subscription.jsx:370 has placeholder-only access-code input. DashboardLayout.jsx:342-405 retains a plain overlay/aside drawer. Subscription.jsx:399-424 uses custom role-dialog overlays; its Escape/scroll-lock effect does not establish focus entry, containment, inert background or restoration.

**User impact:** A keyboard or screen-reader merchant can lose context while editing identity, financial rules, cancellation or billing information. Passing native-dialog tests elsewhere does not establish these screens are accessible.

**Fix:** Apply the existing AccessibleModal and labelled-field/error patterns to these remaining surfaces. Distinguish modal and disclosure navigation, associate each field with its meaning, and verify keyboard behavior in the real layout.

**Suggested:** `$impeccable audit` / `$impeccable harden`. Source-confirmed; these particular authenticated dialogs were not browser-verified. A one-off subscription browser fixture did not render its target, so that attempt is not evidence of a production crash.

### 6. P2 — Some operational controls describe prototype or legacy behavior

**Evidence:** Policies.jsx:276-289 implies an hours-based verification setting controls slot expiry, while Cashfree booking holds use15minutes. Settings.jsx:818-820 exposes a reminder control described as simulated in the prototype; the normal delete-account control around874 reports deletion disabled in demo. Availability copy includes implementation terms such as candidate slots/dynamic calculation.

**Fix:** State precisely which payment arrangement the timeout affects. Make unavailable functionality visibly unavailable with an honest explanation/action. Use booking language rather than implementation language. Do not remove legitimate legacy settings solely because the newer path differs.

**Suggested:** `$impeccable clarify` / `$impeccable distill`.

### 7. P2 — Sharing labels and clipboard feedback are not reliable everywhere

**Evidence:** Onboarding.jsx:949 labels an action Share to WhatsApp but only attempts clipboard write, suppresses failure and announces copying. CustomerBooking.jsx:1229-1234 and1570-1573 similarly announce copy success without awaiting clipboard completion. The corrected merchant booking-link copy flow is not included in this finding.

**Fix:** Match label and action: open an explicit WhatsApp share URL or call it Copy booking link. Await clipboard success; on rejection show selectable text and a useful fallback.

**Suggested:** `$impeccable harden` / `$impeccable clarify`.

### 8. P2 — Visual consistency and a few structural details still need a shared pass

- AdminDashboard.jsx:118 nests BrandLogo's default home link inside an admin Link, producing nested anchors with competing destinations. Use a single link.
- AdminDashboard.css:9 overrides focus outlines with lime. Calculated contrast is approximately1.31:1 on white and1.21:1 on the pale surface; use the existing darker focus token on light surfaces.
- Signup's SetupShell and some customer route roots lack a main landmark; signup absence was confirmed in the public browser checks.
- Settings.jsx:434 uses a4px accent side border. Repeated large-radius bordered/shadowed cards, inline colors, mixed control sizes and tracked labels persist across operational pages. Improve shared tokens/components rather than independently restyling every screen.
- The previous production build's large initial application chunk is a delivery risk worth measuring on mobile; no measured slow-load score is claimed here. Prefer loading specialist/admin/billing features when needed.

**Suggested:** `$impeccable extract`, `$impeccable typeset`, `$impeccable polish`; measure before `$impeccable optimize`.

## Detector interpretation

| Warning | Location | Assessment |
|---|---|---|
| Overused font | Notifications.css:2 | Inter is committed identity; no font change recommended for novelty. |
| Width transition | Onboarding.css:44 | Definition appears unused; do not prioritize without runtime use. |
| Accent side border | Settings.jsx:434 | Current4px side accent; replace during shared visual pass. |
| Width transition | Settings.jsx:453 | Current progress indicator; lower priority than trust/accessibility. |
| Height transition | styles/components.css:2219 | Current weekly chart styling; review reduced-motion/performance in context. |
| Spring easing | variables.css:113 | Token appears unused; not evidence that users see bounce motion. |

The detector missed the financial truth, policy fallback, label and dialog problems. Its6 warnings are not the total number of UX findings.

## Route and state coverage

Source reviewed means current component, relevant visible states and handlers were examined. Browser means representative current rendering or isolated interaction was exercised; it does not mean every state was exercised.

| Surface | Source scope | Browser evidence |
|---|---|---|
| Landing desktop/mobile and shared shell | CTAs, sections, pricing, FAQ, links, navigation/footer |1440/390/320; keyboard FAQ/menu and cross-page anchor |
| Public subscription | Price/tax/early access, comparison, FAQ, account/code paths |1440/390/320 screenshots |
| Seven policies/contact pages | Content, draft status, section links, support | Contact1440/390/320; other six390 |
| Login/signup | Fields, validation, password controls, verification and policy paths |1440/390/320; no authentication submitted |
| Password request/reset | Request, invalid/checking/ready/success states and recovery actions | Entry states1440/390/320; no email/reset submitted |
| Eight-stage onboarding | Identity, biography, services, hours, rules, integration, review; load/save/version conflict | Source only |
| Merchant shell | Desktop/mobile navigation, restriction banner, support entry | Isolated header/navigation interaction group |
| Overview | Metrics, unavailable/loading/empty, date and upcoming appointments | Source only |
| Appointments | Filters, search, empty/list/details, manual creation, edits, proof/refund restrictions | Isolated render/filter/modal groups; no real writes |
| Services/instructors | Load/retry, creation/edit validation, delivery, days, toggle/delete | Isolated validation/focus and320/390 modal reflow |
| Availability | Working hours, rules, instructors, calendar/save states | Isolated render; existing failure-feedback patterns inspected |
| Booking-page management | Copy/share, preview, service prerequisites, commerce entries | Source only |
| Policies | Load/defaults/validation/save and refund/reschedule/no-show/timeout settings | Source only |
| Analytics | Ready/unavailable/stale, data definitions, canvas/table alternatives | Isolated chart tables and320/390 reflow |
| Settings | Profile, avatar/QR, payment, integration, reminders, password/delete | Source only |
| Merchant subscription | Access states, billing/renewal, codes, history, receipt/cancel dialogs | Isolated component financial-feedback fixtures; dialog browser attempt inconclusive |
| Merchant support/TicketPanel | List/loading/retry/filter/create, thread/reply, state transitions/escalation | Source only |
| Customer booking | Provider loading/error/empty, service/date/time/contact/policy, owned holds/recovery | Isolated real-component labels, recovery and lost-response behavior |
| Customer tracking/manage aliases | Lookup/verification/notfound, statuses, reschedule/cancel/refund/disputes | Isolated reschedule/cancel/dispute dialog groups and render |
| Customer payment status | Missing access, unknown/pending/expired/paid/review, retry, closure, receipt/polling | Current source plus existing isolated recovery checks; no gateway payment |
| Pending-payments modal | Phone/code/cooldown, unavailable/empty/list, retry/cancel/review | Isolated native modal/keyboard and narrow fixture evidence |
| Public marketplace/membership | Verification/eligibility, sandbox consent, orders, payment/access/delivery states | Source only |
| Merchant commerce | Setup/vault/encryption, pricing/publication, requests and access | Source only |
| Admin and support-admin alias | Verification, queue/filter/pagination/stale data, record/support/reconciliation, refund authorization | Source only; no authenticated admin account used |
| Standalone booking simulator | Example selection, success/failure/retry/cancel/reset |1440/390/320 entry; existing isolated transition tests |

## Cognitive load, personas and emotional journey

**Busy merchant:** Consolidated appointment filtering and useful next actions reduce effort. A success notification after a failed write destroys the confidence gained by the layout. Manual appointment creation is the first task to harden.

**Keyboard/screen-reader merchant:** Service forms and native modals provide good patterns, then settings labels and custom billing dialogs require a different interaction model. Consistency here is functional, not cosmetic.

**Customer recovering payment:** Explicit unknown/pending/review states, owned checkout recovery and phone verification reduce panic. Product purchase eligibility, phone verification, merchant approval and sandbox consent are legitimate stages, but should continuously explain what is complete and what remains.

**Support administrator:** Dense queues and financial review controls are justified. The default next action, record ownership, stale data and focus visibility matter more than a blanket limit on button counts.

Overall cognitive load is moderate. One purchase offer and progressive FAQ disclosure work. Six informational features are not six competing purchase choices. Merchant billing puts identity, access, renewals, codes, documents and future periods on one screen; prioritize the current task and progressively disclose history without hiding obligations.

The improved journey is promise, verified setup, confident daily work and recoverable payments. The current emotional valley lies in merchant operations and renewal feedback: the interface can sound certain when the underlying change is not certain. Fixing that produces more value than adding decoration.

## Visual assessment

The public subscription screen now has a clear offer and readable hierarchy. Landing retains more repetitive cards/labels and a long mobile narrative, but its controls and disclosures have improved. Existing lime/black and font identity should be retained.

Operational familiarity is desirable. The remaining issue is uneven execution: independent inline styling, oversized soft cards, divergent modal patterns and tiny supporting labels. Reuse the strongest working components across routes. Isolated fixture screenshots verify layout/interactions with fake data and may not reproduce the complete shell or external font loading; they are not the basis for a font redesign.

## Screenshots and evidence

- [Public subscription desktop](ui-ux-review-20261019/subscriptions-1440.png)
- [Public subscription mobile](ui-ux-review-20261019/subscriptions-390.png)
- [Landing mobile](ui-ux-review-20261019/landing-390.png)
- [Login desktop](ui-ux-review-20261019/login-1440.png)
- [Public mobile navigation](ui-ux-review-20261019/public-mobile-navigation.png)
- [Isolated appointments](accessibility-browser-evidence/appointments-desktop.png)
- [Isolated service validation](accessibility-browser-evidence/service-validation-desktop.png)
- [Public render results](ui-ux-review-20261019/public-checks.json)
- [Public keyboard results](ui-ux-review-20261019/public-keyboard-checks.json) and [completed anchor check](ui-ux-review-20261019/anchor-check.json)
- [Subscription false-success fixture](ui-ux-review-20261019/subscription-feedback-check.json)
- [26 isolated browser groups](accessibility-browser-evidence/component-results.json)

## Recommended order

1. Harden manual appointment creation and merchant mutation feedback, including calendar sequencing and QR changes.
2. Make subscription confirmation order-specific and distinguish failed financial reads from valid defaults.
3. Apply the existing accessible field/dialog/navigation patterns to settings, policies and subscription.
4. Clarify unavailable controls, payment-timeout scope and sharing labels/fallbacks.
5. Extract consistent form/status/focus/card tokens and polish the visual hierarchy. Measure initial mobile loading before performance work.

Do not re-enable archived navigation enhancements, change the restored configured demo, invent legal details, or replace the established brand as part of these fixes.
