# Mobile / Tablet Review Checklist

Status values: PASS, PARTIAL, FAIL, NOT REVIEWED.

| Page / area | Viewport | Expected behavior | Current status | Issue notes | Priority | Blocks UAT | Blocks staging |
|---|---|---|---|---|---|---|---|
| Global shell | 390x844 | Body does not horizontally overflow; top navigation stacks/wraps; main content remains reachable. | PASS | Covered by Phase 10 E2E smoke. | P0 | No | No |
| Global shell | 430x932 | Workspace and subnav links are touch-sized and readable. | PARTIAL | Admin planned item still consumes mobile space; acceptable for UAT but should be revisited. | P2 | No | No |
| Navigation | 768x1024 | Workspace nav and subnav wrap without clipping. | PASS | Shared CSS now wraps and constrains navigation. | P0 | No | No |
| Command Center | 1440x900 | Priority cards and queues use desktop grid. | PASS | Existing desktop layout retained. | P1 | No | No |
| Command Center | 390x844 | Cards stack without clipping. | PARTIAL | Requires manual review for final copy density. | P2 | No | No |
| Workbench pages | 768x1024 | Queue cards, queue tabs, and tables remain visible. | PASS | Signal, Production, Invoices, Payments, and Bank Reconciliation covered by Phase 10 E2E. | P0 | No | No |
| Detail pages | 768x1024 | Next-action cards and read-only banners remain readable. | PASS | Production read-only detail covered by Phase 10 E2E. | P0 | No | No |
| Create/edit forms | 430x932 | Form grids collapse to one column; submit/cancel remain reachable. | PASS | Create Signal mobile modal covered. Additional forms need manual UAT. | P1 | No | No |
| Modals | 430x932 | Modal content scrolls inside viewport; actions visible. | PASS | Shared modal max-height/overflow and Create Signal smoke test added. | P0 | No | No |
| Tables/lists | 390x844 | Wide tables scroll in their own container without body overflow. | PASS | Shared `.wide-table` now constrains overflow and uses touch scrolling. | P0 | No | No |
| Queue tabs | 390x844 | Tabs are keyboard/touch reachable and selected state remains visible. | PASS | Tabs now have larger min-height and horizontal containment. | P0 | No | No |
| Finance boundary notices | 390x844 | Boundary notices wrap and remain readable. | PARTIAL | Shared padding is responsive; copy density needs user review. | P2 | No | No |
| Danger zones | 390x844 | Danger zone remains visually separated. | PARTIAL | Invoice Detail has visual separation; broader rollout remains open. | P2 | No | No |
| Read-only banners | 768x1024 | Banner is visible and plain-language. | PASS | Covered by Phase 10 E2E on Production detail. | P0 | No | No |

## Findings Summary

- Navigation, queue tabs, forms, wide tables, and modals received shared responsive fixes.
- No screenshots, traces, videos, or reports are required or committed for this checklist.
- Remaining mobile work is mostly content-density review and broader manual UAT across every secondary detail/edit route.
