# Backlog continuation — October 4, 2026

Latest status: `docs/acceptance/product-workspaces-20261004.md` and `docs/product/deferred-work-20261004.md` supersede the remaining-work status below. This document preserves the earlier checkpoint.
Candidate: `codex/financial-completion-20260930`, working changes on `7927b1dab2df1b971ab9f07dcc5f7c01cbe9e26c`. These changes are not deployed. Earlier staging or browser certification does not certify this candidate.

## Implemented in this candidate

- Explicit, immutable retained-fund release terms, completed-trigger evidence, business-day calendars and original accepted-work links. Separate payable schedules preserve retained history. Duplicate authorization returns the existing payable; source holds and competing releases block unsafe advancement.
- Retained-fund term approval is available to contract reviewers without granting release or payment authority. The UI route and choices endpoint respect this separation.
- Contact, relationship-map, candidate and opportunity constraint actions; contact relationship-path creation. Tenant checks, stable request IDs and changed-retry rejection preserve one audited operation.
- Self-service password-recovery preparation: generic requests, durable rate limits, hash-only expiring tokens, encrypted delivery payload, bounded mail retries, password reset, session-version revocation and recovery audit. Disabled recovery and removed membership reject reset. Delivery recovers from connection failures. Email integration is still disabled and unverified.
- In-app training describes these candidate workflows and their limitations.

## Observed verification

A new local PostgreSQL database, `syncos_remaining_test`, was created on localhost port 55439. All 92 migrations applied successfully. No staging database, demo records or live email was used.

- API compilation and web typecheck passed.
- General regression run without database flags: 230 passed, nine skipped, zero failed (239 total at that point).
- Expanded run with database flags: 240 passed, one fixture failure, zero skipped (241 total). The failed legacy demo-repair test assumed seed rows existed. It now uses temporary synthetic tables; its targeted rerun passed. This is a combined result, not a claim of a subsequent all-green full run.
- Recovery database checks: three passed, including disabled recovery, removed membership, reused/expired links, session invalidation, bounded delivery retries and reconnection after database failure.
- Focused retained-fund/workflow-action/recovery run: five passed.
- Financial API end-to-end checks: seven passed, including full retained payment and overpayment rejection after partial payment, duplicate records, holds, competing releases, agreement validation and cross-role boundaries.
- Production web build completed successfully, including 106 static pages. Training text was subsequently regenerated; no browser or physical-device certification is inferred from this build.

Raw focused evidence is in `docs/acceptance/evidence/20261004/` and contains only synthetic test identifiers.

## Not completed by these changes

Engineering still requiring implementation or final coverage:

- Customer/service inquiry intake and its complete assignment, attachment, deduplication and downstream-link workflow.
- Published/versioned configurable form templates and consistent UI/API validation.
- Material/reel custody, movement, consumption and reconciliation ledger.
- Offline cold-start application and larger/resumable evidence upload transport.
- Remaining Passport automatic-recording preparation, alert delivery and optional prime delivery work.
- Candidate-specific browser verification, complete updated training coverage and full release checks.

External/physical acceptance remains distinct: executed pilot contract verification, historical reconciliation decisions, real-phone interruptions/restarts, independent offsite disaster recovery, configured email delivery, Passport sandbox, fresh deployment backups, controlled staging activation and both supervised crew workflows. No physical-phone, offsite recovery, provider or pilot completion is claimed.

Preserve both Sync employee and partner workflows. Employee work must not create partner settlements. Internal QC is not customer acceptance. Do not reprice historical records or reseed staging. Keep automatic money movement disabled.
