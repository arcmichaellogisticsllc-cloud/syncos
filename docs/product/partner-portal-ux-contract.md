# Partner Portal UX Contract

## Canonical Rule

Partner Portal is single-company.

One Partner-side account may have one active Partner organization in a tenant. Multiple roles are allowed only inside that same Partner organization. A Partner Admin plus Partner Foreman account is valid only when both roles resolve to the same Partner company.

## Required Boundaries

1. Partner organization context is server-derived from the authenticated account.
2. Partner Portal must not show an organization selector.
3. Multiple active Partner scopes are a conflict, not a selectable state.
4. Internal Sync users manage multiple Partner companies through Partner Network, Operations, Work Orders, Partner Performance, and Command Center.
5. Partner Portal never displays raw UUIDs, tenant IDs, storage keys, raw file paths, rate schedule IDs, or database IDs where business identifiers exist.
6. Partner Portal never displays raw backend enums.
7. Partner Portal never displays customer rates, Sync margin, other Partner rates, internal notes, full TIN, full bank account data, or provider secrets.
8. Partner Admin gets company oversight, compliance, workforce, crew, work, production, QC, settlement, payment, and performance visibility. Partner Admin does not receive Foreman execution authority by default.
9. SyncField owns Foreman execution: JSA, map, design segments, redlines, pole observations, input/output ticks, coil/slack, evidence, production submission, and correction execution.
10. Every Partner Portal page supports loading, empty, ready, error, action-required, locked, stale, and under-review states as applicable.
11. Reported, accepted, payable, settled, eligible, processing, and paid states remain distinct.
12. Financial calculations are server-authoritative. The frontend formats returned amounts and explanations; it does not calculate settlement money.
13. Partner rate versions and commercial policies must be traceable from Work Order through settlement and payment.
14. Every settlement or payment amount has source lineage.
15. Quantities are unit-aware and must not combine incompatible units.
16. Pages work on desktop, tablet, and mobile without horizontal overflow or narrow desktop content columns.
17. Partner-sensitive cache is scoped to user, tenant, and Partner organization and clears on logout.
18. Partner cannot self-approve, self-authorize mobilization, change Customer QC, mark settlement issued, mark payable eligible, or mark payment paid.

## Conflict State

If a Partner-side account has conflicting company access, fail closed with:

Unable to open Partner Portal

Your account has conflicting company access. Contact Sync Comm Systems support so we can correct your account.

Reference: PARTNER_ACCOUNT_ORGANIZATION_CONFLICT

Do not list the conflicting organizations to the Partner user.

## Financial Truth

The Partner Portal may show Partner rates, accepted quantities, payable basis, settlement lines, retainage, adjustments, eligibility, and payment status for that Partner only.

It must never expose customer rate, Sync margin, customer invoice economics, other Partner economics, or internal shortlist/performance intelligence.
