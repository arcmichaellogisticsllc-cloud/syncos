# Work set aside — October 4, 2026

The user authorized recording work that cannot be completed now separately. This register is not a statement that all engineering is complete. It distinguishes unfinished implementation from unavailable external acceptance. No item is silently removed from scope.

## Unfinished engineering

| Item | Current boundary | Closure needed |
| --- | --- | --- |
| Offline cold start | No complete offline application shell with a scoped assignment snapshot and safe session-expiry handling has been implemented. Existing queue/retry behavior remains. | Implement persisted field context, cold-start navigation, pending-work visibility, logout cleanup, expiry/revocation handling and server revalidation before replay; then test actual devices. |
| Resumable large uploads | Existing field-evidence size limit and upload transport remain. Inquiry attachments deliberately use a separate bounded 5 MiB path. | Persist upload sessions/chunks, resumable client state, integrity verification, quota/expiry cleanup and final authorization; test interruption, duplicate completion and shutdown rejection. |
| Offline supplemental form drafts | Published schemas and submitted snapshots are implemented; the new form-answer screen does not persist unfinished offline responses. | Add user/tenant/version-scoped drafts and replay protection, resolve template changes explicitly, and clear device data at logout. |
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
