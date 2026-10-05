# Work set aside — October 4, 2026

The user authorized recording work that cannot be completed now separately. This register is not a statement that all engineering is complete. It distinguishes unfinished implementation from unavailable external acceptance. No item is silently removed from scope.

## Current checkpoint — October 5, candidate through migration 102

The migration-102 continuation supersedes the implementation status below from October 4. It adds editable cold-offline saved forms and never-attempted production drafts, scoped foreman forms and material use for both crew types, public intake, operational notification queues/delivery adapters, searchable core history, a durable Passport refresh runner with an injected normalized decoder, and a coordinated local database/original-file recovery rehearsal. See `docs/acceptance/engineering-continuation-20261005.md` for measured evidence and `docs/deployment/candidate-102-readiness.md` for deployment preparation. This candidate is not deployed.

## Remaining implementation and validation boundaries

| Area | What the candidate now does | What remains |
| --- | --- | --- |
| Offline field work | Durable production replay recovers interrupted in-flight writes, serializes tabs where supported, preserves request identity and rechecks authorization. The expiring cold-offline screen edits saved supplemental forms and production drafts that have never been attempted. | New daily-report capture and map viewing from a cold offline start remain engineering work. Actual-phone suspension, storage loss and restarts remain physical acceptance. Attempted requests intentionally stay immutable until reconciled. |
| Forms and material access | An authorized foreman of either workforce type sees assigned published forms, their submitted records, current-crew material balances and assigned-work-order movements. New writes recheck current assignment and stops. Pending material requests survive reload and retry once. | A company-admin overview and delegation experience is not implemented by these field endpoints. Do not grant tenant-wide form/inventory permissions as a shortcut. |
| Evidence transport | Resumable originals up to 100 MiB retain checksums and retry identity. Eight concurrent 4 MiB synthetic uploads are tested. | Production capacity, real camera formats/readability and phone background behavior require acceptance on the target infrastructure/devices. |
| Public intake | Explicitly configured public channels validate consent/input, apply durable throttles, route to authorized owners, and return an idempotent on-screen receipt. | The live website/channel and approved privacy text need configuration. A receipt does not claim email delivery. No automatic customer email is sent by this flow. |
| Notifications | Inquiry follow-up and workflow assignment/overdue/recorded-escalation queues have bounded retries, safe errors, recipient revalidation and delivery history. Delivery defaults off. | Configure the email provider and verify actual delivery. Escalation follows recorded ownership/roles; the system does not invent an escalation policy. Provider acceptance does not prove the recipient read a message. |
| History and performance | Twenty core directories have authorized tenant-scoped search/keyset paging; forms, inquiries, inventory and scoped field histories have older-record navigation. Equal-timestamp volume and concurrent uploads are tested. | Some older child/audit views and selectors retain fixed limits. The new directory does not prove every legacy view is exhaustive or certify production-scale latency. |
| Password recovery | Existing application behavior and token/delivery configuration checks remain part of regression coverage. | Configure the sender and verify real delivery and link behavior on the deployed candidate. |
| Priority preparation | Normalized simulated reconciliation covers duplicates, partials, adjustments/reversals and unmatched review. Durable refresh intake atomically persists observations/exceptions and acknowledges leased work. The runner accepts injected read/decoder functions and is disabled by default. | Verified provider wire decoding/authentication/finality and live financial posting remain implementation/integration work. Obtain the correct Passport contract and sandbox; do not assume Checkout payment APIs are interchangeable. |
| Permissions and training | Scoped APIs and UI visibility are tested; click-by-click guides cover new paths and failure/retry behavior. | Actual operational role grants, final deployed checks and the supervised two-crew pilot remain. Automated tests are not human operating approval. |
| Recovery and release | A reusable local rehearsal restores a fresh synthetic database and verifies every table count plus actual restricted-original checksums. Activation and rollback boundaries are documented through 102. | Independent offsite/total-loss recovery, retention ownership, fresh operational backup, exact-candidate staging activation and pilot sign-off remain. An old manifest cannot simply run against the 102 schema. |

## External decisions, credentials or physical acceptance

- Current executed customer and partner agreements/addenda, named pilot relationships, and approved rates/triggers/retainage/calendar exceptions.
- Current prime document requirements and an actual billing-package/delivery/acceptance comparison.
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
