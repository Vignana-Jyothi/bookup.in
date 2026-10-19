---
target: frontend/src/pages/SubscriptionHero.jsx
total_score: 27
p0_count: 0
p1_count: 1
timestamp: 2026-10-19T10-08-22Z
slug: frontend-src-pages-subscriptionhero-jsx
---
Method: dual-agent (A: /root/subscription_design; B: /root/subscription_evidence).

# Subscription page review

Scope: current local public /subscriptions page, SubscriptionHero.jsx and CSS, with shared header observations. Source review and calculated contrast, not a rendered visual or interaction audit. No application code changed.

## Design health

| Heuristic | Score /4 | Main finding |
|---|---:|---|
| System status | 3 | Mobile menu lacks expanded state. |
| Real-world language | 3 | Clear duration; some financial language is technical. |
| User control | 3 | Browsing and FAQ work structurally; drawer exit behavior needs verification. |
| Consistency | 2 | Independent page typography, colors and buttons. |
| Error prevention | 2 | Tax basis unclear; optional price and fixed FAQ can diverge. |
| Recognition | 3 | Features visible, but price and terms split across sections. |
| Efficiency | 3 | Useful anchors, skip link and sign-in path. |
| Minimalist design | 2 | Repeated slogans, labels and decorations dilute hierarchy. |
| Error recovery | 3 | Provisional: no local payment operation; support in footer. |
| Help | 3 | Useful renewal/expiry/code FAQ; weak terms near price. |
| Total | 27/40 | Acceptable structure; material improvements needed. |

## Anti-pattern verdict

Source suggests a generic editorial pricing template: repeated tiny tracked uppercase labels, numbered sections, italic slogans, glyph ornaments and equal benefit columns. This is a composition diagnosis, not an authorship claim. Preserve the established lime/black identity. Bundled markup detector returned zero findings (exit 0, JSON []); it missed the manually identified CSS contrast and typography issues. No detector false positives.

## Overall impression and strengths

The offer is understandable once reached. The strongest opportunity is to lead with price and readable conditions. One plan avoids tier comparison; adjacent price/duration and manual renewal are useful. Specific booking/payment/calendar features explain the product. Native FAQ disclosure, table headings/caption, keyboard-scrollable comparison region, visible focus and reduced-motion support are sound foundations.

## Priority issues

1. P1: Important copy is too small and faint. SubscriptionHero.css:41 hero reassurance is 9px and 2.98:1; lines65/71 pricing note 9px and 3.23:1; line82 side copy 3.02:1; line124 FAQ answers 3.13:1. These small text colors fail WCAG AA 4.5:1. Make essential terms and supporting text at least14px, preferably16px for paragraphs, and darken to4.5:1. Suggested: impeccable audit/typeset.
2. P2: The price does not establish whether tax is included. SubscriptionHero.jsx:37,45 default price is INR299; only optional live-plan branch states tax included. FAQ fixes299/30days while optional plan can override them. App.jsx:136 currently supplies no plan, so future mismatch is latent. Confirm tax basis, state it beside price, derive FAQ and card from one source. Suggested: impeccable clarify/harden.
3. P2: Price appears after a generic hero and separate introduction. SubscriptionHero.jsx:42-45; CSS:172 stacks intro before plan on mobile. Lead with Calup access,299/30days,tax and renewal terms; one primary create-account action and secondary sign-in. Actual fold depth unmeasured. Suggested: impeccable distill/layout.
4. P2: Decorative scaffolding competes with offer. JSX:42-55 repeats labels, numbers and glyphs; CSS:58 combines border/35px shadow; heading tracking at35/167 and price67 exceeds skill floor of-.04em. Remove repetitive ornaments/labels, use border alone, relax tracking and make copy specific to merchant work. Suggested: impeccable quieter/distill.
5. P2 shared header: PublicSiteHeader.jsx:44-59 toggle lacks aria-expanded/controls; drawer lacks explicit dialog/disclosure focus and Escape behavior. Choose accessible disclosure or modal drawer semantics and verify keyboard behavior. Preserve disabled navigation enhancements. Suggested: impeccable harden.

## Cognitive load and personas

Moderate load: focus, hierarchy and repetitive content need improvement; one purchase choice and progressive FAQ disclosure help. Six features are information, not six competing purchasing decisions. Low-vision merchants face unreadable terms. First-time tutors must pass generic introduction before price and still cannot establish final tax treatment. Returning merchants have a sign-in-to-redeem path, but it is a secondary note.

## Emotional journey

Calm opening gives way to delayed commercial detail; tax uncertainty undermines the promise of no surprises. The clear plan CTA is the high point. The ending should repeat the concrete offer and renewal control rather than another generic slogan.

## Minor observations

The620px comparison table intentionally scrolls in a labelled focusable region; mobile discoverability remains unverified. Skip link comes after shared header. Old local-header/footer CSS remains unused. A real product example could replace ornament, without requiring a wholesale rebrand.

## Decisions and recommended sequence

Confirm whether299 includes tax. Then improve readability, simplify price hierarchy, harden mobile navigation and finish with impeccable polish. Prioritize new-merchant evaluation while retaining the existing sign-in/redeem path.
