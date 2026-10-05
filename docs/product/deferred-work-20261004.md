# Work set aside — October 4, 2026

The user authorized recording work that cannot be completed now separately. This register is not a statement that all engineering is complete. It distinguishes unfinished implementation from unavailable external acceptance. No item is silently removed from scope.

## Continuation status — current local work

A later local continuation adds a one-hour, same-session offline recovery screen; version/account-scoped form draft save/restore; keyset history navigation and search; resumable originals up to 100 MiB; seven-day temporary upload cleanup; and stronger upload-time stop/assignment checks. Migration 097 is applied only to isolated local test databases. None of these changes are activated on staging. See `docs/acceptance/engineering-continuation-20261004.md` for the exact evidence and limits.

These additions do not complete all eighteen areas. In particular, the recovery screen is read-only: full cold-start offline editing/maps, field-scoped form/inventory actions, public intake, delivery/escalation and the Passport provider adapter remain engineering work.

## Unfinished engineering

| Item | Current boundary | Closure needed |
| --- | --- | --- |
| Offline cold start | A read-only recovery shell now shows expiring, same-session assignment context and saved drafts after a visited SyncField installation loses connectivity. It does not provide complete cold-start offline editing or maps. | Implement persisted field context, cold-start navigation, pending-work visibility, logout cleanup, expiry/revocation handling and server revalidation before replay; then test actual devices. |
| Resumable large uploads | A local resumable transport now accepts originals up to 100 MiB, verifies chunks and original checksums, and rechecks stops/assignment before a new evidence record. Inquiry attachments retain their separate 5 MiB limit. | Browser interruption/resume and duplicate protection now pass. Complete real-phone/background acceptance and production resource-load validation; finalization is bounded to one original per API process, but capacity has not been certified. |
| Offline supplemental form drafts | Explicit device save/restore now preserves account/tenant/version-scoped answers and retry identity for seven days. Submission still requires connectivity; this is not a full offline forms application. | Complete real-device/storage-failure acceptance and field assignment integration; retain explicit review before replay and immutable version matching. |
| Field-specific forms and inventory access | New workspaces initially support authorized internal staff. Registering either crew type as a custody location does not grant a partner/foreman tenant-wide inventory or form access. | Implement explicit assignment/company-scoped field views and actions before granting those personas access. |
| Public customer website intake | Authorized internal capture, assignment, duplicate hints and attachments are implemented. No anonymous public endpoint was exposed. | Confirm the website deployment/channel and tenant routing; implement anti-abuse/rate limits, public acknowledgment semantics and privacy controls. |
| Alert delivery and escalation | Existing workflow events remain; complete operational delivery/escalation acceptance is not established. | Implement/verify owner routing, bounded retries, delivery status, failed-delivery review and escalation with the selected provider. |
| Passport adapter and automatic recording | Durable preparation remains disabled. The new product modules do not complete the provider adapter, governed mapping corrections, scheduling or transactional posting. | Complete against confirmed provider contracts; prove duplicate, partial, returned/reversed and unmatched-event behavior in sandbox before automation. |
| Application-wide certification | New-module database/HTTP/browser checks are separate from complete existing crew/finance certification. | Run the exact final candidate through the complete workflow suite and deployed acceptance. New code is not certified by an older 705-check run. |

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
