# October 6 full-completion continuation

The user has superseded the earlier pilot-first boundary: every agreed feature, required provider, historical backlog item, device/security/recovery/deployment check and engineering blocker must be resolved before proposing an operational pilot. No pilot is authorized by a test result alone.

Current work adds SSO/OIDC account linking, single-use magic-link sign-in, and controlled generic HTTPS prime-package delivery through migration 109. These are local engineering implementations under verification, not activated integrations. Refer to `historical-backlog-register.json` for retained historical IDs and `../deployment/engineering-completion-gate.json` for the blocking completion gate. The records below remain historical evidence; their earlier “future capability” and “not needed for pilot” wording no longer defines the current completion scope.

# Work set aside — updated October 5, 2026

The user authorized recording work that cannot be completed now separately. This register is not a statement that all engineering is complete. It distinguishes unfinished implementation from unavailable external acceptance. No item is silently removed from scope.

## User release gate — October 6, 2026

The user has put all crew pilots on hold until end-to-end engineering is complete. Earlier statements that broader capabilities are not pilot prerequisites do not authorize proceeding with a pilot. Keep SSO, magic-link login and automatic prime-package delivery visible in the full engineering scope; do not silently defer them to declare completion. Separate confirmed unimplemented features, unfinished provider/environment integration, and validation or business-evidence requirements. Reconcile historical backlog entries against current code and tests before claiming application-wide closure. Physical-device engineering acceptance may precede an operational crew pilot, but requires actual devices and must not be represented by browser emulation. No staging activation or pilot is authorized by this backlog-outline request.

## Latest candidate — October 5, through migration 106

This checkpoint supersedes the older implementation gaps below. Cold-offline new reports and PDF maps, company-admin forms/delegation and material discrepancy routing, expanded accessible history, and synthetic transaction-safe incoming/outgoing posting are implemented in the isolated candidate. The approved eight-area independent engineering scope is complete and locally verified at checkpoint `f94719a`; see `docs/acceptance/independent-completion-20261005.md` for passing evidence and rerun details. This does not claim staging deployment, actual-phone acceptance, configured delivery, provider acceptance or offsite disaster recovery.

The remaining external evidence is tracked in `docs/deployment/external-evidence-template.json`. SSO, magic-link login and optional automated prime delivery remain future product capabilities. Self-service password recovery, public inquiry intake, configurable forms and the inventory ledger exist in the candidate; delivery configuration, real stock counts and operational acceptance remain distinct.

## Historical checkpoint — October 5, candidate through migration 102

The migration-102 continuation supersedes the implementation status below from October 4. It adds editable cold-offline saved forms and never-attempted production drafts, scoped foreman forms and material use for both crew types, public intake, operational notification queues/delivery adapters, searchable core history, a durable Passport refresh runner with an injected normalized decoder, and a coordinated local database/original-file recovery rehearsal. See `docs/acceptance/engineering-continuation-20261005.md` for measured evidence and `docs/deployment/candidate-102-readiness.md` for deployment preparation. This candidate is not deployed.

## Current implementation and external validation boundaries — candidate 106

| Area | Implemented in the local candidate | What remains outside independent certification |
| --- | --- | --- |
| Offline field work | Prepared assignment context, new daily reports from a cold offline start, verified cached PDF maps, editable never-attempted drafts, durable replay and server-side assignment/safety checks. Attempted requests retain their original identity. | Actual-phone suspension, storage loss, camera behavior, network transitions and restarts. Offline context intentionally expires and never establishes current permission to work. |
| Forms and materials | Scoped foreman forms/material use for both workforce types; company assignment/form coverage, submitted answers, explicit within-company delegation, custody/movement history and duplicate-safe discrepancy routing to authorized inventory operators. | Actual stock counts, count sheets, discrepancy evidence and operational reconciliation. Delegation does not acknowledge safety for another person or grant tenant-wide powers. |
| Evidence transport | Resumable originals, checksum verification, bounded finalization and repeatable concurrent-upload/retry tests. The measured load used 32 concurrent 4 MiB originals. | Capacity acceptance on the intended server and physical camera/readability/background tests. Synthetic measurements are not a production capacity guarantee. |
| Public intake | Configurable public channels validate input/consent, throttle abuse, route to authorized owners and return an idempotent on-screen receipt. | Configure the actual public channel and approved privacy text. The receipt does not claim email delivery. |
| Notifications | Ownership/deadline/escalation queues, retry limits, recipient revalidation and delivery history; adapters remain disabled until configured. | Verified email sender, recipient allowlist, actual delivery and the approved operational escalation policy. |
| History and exports | Search/keyset paging across 31 record families and legacy activity, expanded selectors and scoped financial/field histories. Export PDFs retain all selected detail across pages; older files remain preserved. | Target-server volume/latency acceptance. Intentional dashboard previews and processing batches remain bounded; oversize exports reject explicitly rather than truncate. |
| Password recovery | Application behavior, token expiry, delivery preparation and regression checks. | Configure and verify real email delivery and the recovery link on the deployed candidate. |
| Priority preparation | Durable event/refresh preparation plus synthetic-only transactional incoming receipts and outgoing partner payment posting, partials, duplicate protection, exception review, accepted-work/approved-terms checks and audit lineage. | Actual provider product/authentication, wire decoder, event/finality semantics, account/party mapping and sandbox acceptance before wiring or enabling live posting. No live transfers or automatic posting are enabled. |
| Permissions and training | Role/scope checks, action visibility, both crew workflow tests and updated click-by-click guides including failure/recovery paths. | Reviewed real-user grants, deployed acceptance and supervised operation by both crew types. |
| Recovery and release | Fresh migration verification, synthetic 102→106 business-row preservation, coordinated local database/private-original restore and restored HTTP access/hash/audit checks. Activation/rollback instructions cover 106. | Independent offsite/total-server-loss recovery, retention ownership, actual staging backup/activation and pilot sign-off. An older code manifest is not an automatic schema rollback. |

The final candidate test status is maintained in `docs/acceptance/independent-completion-20261005.md`; this table records implementation and acceptance boundaries, not an independent release certificate.

## External decisions, credentials or physical acceptance

- Current executed customer and partner agreements/addenda, named pilot relationships, and approved rates/triggers/retainage/calendar exceptions.
- Current prime document requirements and an actual billing-package/delivery/acceptance comparison.
- Physical stock counts and signed custody/count sheets; only approved ledger adjustments may resolve confirmed differences.
- Finance disposition or source documents for preserved, blocked historical records. No automatic repricing or invented accepted-work links.
- Configured and verified email sender/delivery for recovery, notifications and any optional automatic prime delivery. No live messages sent in this continuation.
- Priority sandbox approval, accounts/payees, authentication/signature and finality semantics. No money movement enabled.
- Independent offsite destination, retention and recovery owner; a restore without the original VPS and measured recovery objectives.
- Actual phones for both crew types, including camera originals, background suspension, restarts, interruption, offline replay and shutdown enforcement.
- Fresh coordinated backups, migration/rollback rehearsal, controlled staging deployment, both supervised crew workflows and operational sign-off.
- Deliberate role grants for the new modules. Existing system administrators and the original demo administrator receive initial grants through migrations; other operators need reviewed assignments.

SSO and magic-link login remain future enhancements. Automatic prime document delivery remains optional integration scope. Both Sync employee and partner workflows, customer acceptance before finance, and preservation of demo records remain mandatory.

## Wider product backlog — not required for the controlled crew pilot

| Capability | Engineering remaining | External dependency / acceptance |
| --- | --- | --- |
| SSO | Approved identity-provider binding, account linking, tenant selection, role provisioning/revocation, logout and recovery policy; implementation and security tests. Existing password login remains available. | Select the identity provider and supply its protected application configuration; verify real authentication and deprovisioning. |
| Magic-link login | Separate, single-use expiring sign-in tokens, anti-enumeration/throttling, safe return routes, session revocation and recovery rules. A password-reset link must not silently become a login link. | Verified email delivery and an approved account/login policy. |
| Optional automatic prime delivery | Per-prime package adapter, authorized recipients/destination, queued retries, durable delivery receipts and explicit rejection/resubmission/acceptance state. Sending a package must not imply customer acceptance. | Each prime's approved channel, credentials, package requirements and observed delivery/acceptance receipts. Manual documented delivery remains usable. |

These items must not displace unresolved safety, accepted-work lineage, financial controls, operational recovery or actual-device pilot acceptance.
