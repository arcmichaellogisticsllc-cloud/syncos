# Accessibility Review Checklist

Severity values: LOW, MEDIUM, HIGH, BLOCKER.

| Area | Status | Pages checked | Notes | Severity | Recommended fix | Blocks UAT | Blocks staging |
|---|---|---|---|---|---|---|---|
| Keyboard navigation | PASS | `/intelligence/signals` | Focus reaches nav, queue tab, primary action, and modal control in Phase 10 smoke. | LOW | Continue manual tab-order review during UAT. | No | No |
| Focus visibility | PASS | Shared styles | `:focus-visible` exists for links, buttons, inputs, selects, and textareas. | LOW | Verify contrast manually on dark nav and danger buttons. | No | No |
| Nav landmarks | PASS | Global shell | Workspace nav has `aria-label="Workspace navigation"`. | LOW | Keep labels stable for UAT scripts. | No | No |
| Button/link semantics | PASS | Workbenches and Signal modal | Actions are buttons; route changes are links in representative surfaces. | LOW | Continue cleanup in older opportunity/growth detail pages. | No | No |
| Modal semantics | PASS | Create Signal, finance action modals | Representative modal uses `role="dialog"`, `aria-modal`, and labelled title. | MEDIUM | Older opportunity modals should be audited later. | No | No |
| Error/status semantics | PASS | Shared operator components | `ErrorBanner` uses `role="alert"` and success/read-only banners use status patterns. | LOW | Confirm page-specific custom errors use shared banners. | No | No |
| Tabs/queue semantics | PASS | Production, Signal Feed, finance workbenches | Queue tabs use tablist/tab and `aria-selected`; Phase 10 verifies active tab state. | LOW | Add consistent tab panel relationships in a later accessibility pass. | No | No |
| Filter drawer accessibility | PASS | Production | Filter drawer summary now has an accessible drawer label. | LOW | Add expanded-state testing if custom drawer replaces details later. | No | No |
| Form labels and required fields | PASS | Create Signal, representative Phase 9 forms | Inputs are wrapped in visible labels; required notes exist on representative forms. | MEDIUM | Full edit-form cleanup remains future work. | No | No |
| Read-only banners | PASS | Production detail | Plain-language read-only banner appears for read-only persona. | LOW | Roll banner to remaining secondary details as they are touched. | No | No |
| Disabled reasons | PARTIAL | Signal Feed, Production detail | Representative disabled reasons are visible; not every lifecycle button has state-specific copy. | MEDIUM | Continue rollout with detail/form cleanup backlog. | No | No |
| Color/contrast | PARTIAL | Shared styles | Danger and boundary notices do not rely only on color; full contrast audit not yet performed. | MEDIUM | Run manual contrast review before production readiness. | No | No |
| Mobile touch targets | PASS | Shared styles | Buttons, links, tabs, and nav get 40-44px minimum heights in responsive styles. | LOW | Confirm on physical tablet during UAT. | No | No |

## Findings Summary

- Phase 10 improves keyboard reachability, focus visibility, modal sizing, queue tab semantics, filter drawer labels, and touch target sizing.
- Remaining accessibility work is a deeper manual audit across older opportunity/growth pages, complete contrast review, and full tab-panel association semantics.
