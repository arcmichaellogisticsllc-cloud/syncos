# Staging workflow activation — September 26, 2026

Operator date: September 26, America/New_York; server evidence timestamps are September 27 UTC.

## Scope and release

Authorized staging continuation, preserving existing application and demo records. No production activation, reseeding, external invitations, payment execution or password changes.

- Previous staging release: `5f3f15e53b926ac567f8a546111d72b2fd3e59b5`, migration 064.
- Workflow release activated and checked: `fc0d7737a8985680f39a522b266db403e4883637`, migration 068.
- Final activated release: `ea41c37c876d591213f40a693fef7229a2a2179d`, migration 069.
- Source branch: `codex/staging-release-20260926`. Exact committed revisions were transferred by Git bundle; no GitHub branch push was performed.
- Staging application: https://staging-app.synccommsystems.com
- API: https://staging-api.synccommsystems.com

The previous temporary checkout and detailed September 25 logs had been cleared. The committed candidate was recovered from the canonical repository without changing its checkout or user files. The September 25 report remains historical evidence, not a fresh uninterrupted regression run.

## Fresh verification and recovery

Both candidates passed isolated Hostinger production builds of API, web and worker, workspace type checks and production dependency audits. Both reported zero vulnerabilities.

Database/private-file backups were created before each activation. Checksums and archive contents were validated. Backups were restored into separate databases owned by the same application database role, and upgrades were rehearsed there. The first restoration contained 176 tables and upgraded 064–068; the follow-up contained 179 tables and upgraded 068–069. Existing table row counts were preserved apart from expected migration/permission catalog additions. Restored private storage compared identical to the source.

The follow-up regression test exercised missing demo ownership, idempotent rerun, preservation of an existing non-null owner and preservation of other crew records. It passed in the isolated restored database with zero skipped tests. Test mutations were rolled back.

Staging was quiesced for a final database and file backup immediately before each migration. Earlier releases and protected configuration copies remain available. Recovery instructions explicitly require restoring a compatible database and matching files before old code is reactivated; relinking old code against a newer migration manifest is not a supported rollback.

Recovery evidence is root-protected on the VPS:

- `/opt/syncos/staging/shared/backups/activation-20260927-fc0d773`
- `/opt/syncos/staging/shared/backups/activation-20260927-ea41c37`

These are local VPS backups and demonstrated local recovery. Current offsite recovery coverage was not independently verified. Historical Hostinger weekly backups must not be represented as a newly tested offsite restore.

## Issues found during live verification

1. Protected service environment files contained an obsolete release SHA. Only that non-secret value was updated; ownership and mode 0600 were preserved.
2. The original Blue Splice demo crew lacked `organization_id`, although its existing capacity provider, worker and membership identified Blue Splice. Strict roster authorization correctly rejected that incomplete relationship. Migration 069 fills only the known original synthetic crew's null organization from its exact existing provider/tenant. It does not replace non-null ownership, change tenants, grant permissions, activate workers or reset records. The seed is corrected for future disposable environments; it was not rerun against staging.
3. The foreman summary omitted the work-order number, causing an assigned order to appear unassigned. The safe response now includes that non-financial identifier.
4. The assignment badge depended on a crew query not loaded on every field page. It now also uses the selected, server-authorized assignment's crew identifier.

The initial internal-workforce smoke assertion incorrectly expected demo system/operations roles to have real management authority. Source review confirmed the additional explicit management-role gate, and the corrected boundary check expects 403 for those demo accounts. No authority was widened to make the smoke test pass. This remains a pilot account-provisioning requirement.

## Preserved data and observed workflows

The initial post-activation comparison preserved all-row counts: 2 tenants, 16 users, 16 tenant memberships, 17 organizations, 1 crew, 1 work order, 7 production records, 0 daily reports, 6 invoices, 4 cash receipts and 6 contractor payables. These counts include all rows and do not establish active readiness or actual cash movement. The follow-up intentionally repairs one missing crew relationship while retaining these records.

Observed on the initial activated release: demo administrator sign-in and Command Center; training chapter selection and evidence search; partner administrator dashboard; foreman sign-in, assignment and private PDF rendering. Authenticated read checks covered QC, finance choices, partner map/production/QC and foreman context/history. Foreman finance/management access and unauthenticated field/private-file access were denied. No financial or production workflow was advanced on shared demo records during these checks.

The API, web and worker ran under the existing service account, with API/web on localhost behind HTTPS. Worker startup scans completed successfully. Legacy shared-database services stayed disabled/inactive. Automated partner payments remained disabled. Post-activation database/file backups were tagged with the deployed SHA and verified by checksum.

## Final follow-up verification

Activated at approximately `2026-09-27T02:19:06Z`. Startup health passed with all 69 migrations and no missing/unexpected entries. API/web/worker remained active; the worker completed its four startup scans. Exact current-release path and protected environment release identifiers match `ea41c37`. Legacy services remain inactive.

Nineteen authenticated/read-boundary checks passed, including restored foreman crew/roster access. Twenty-one existing workforce/agreement/organization control tests passed, zero skipped. The one new ownership regression passed during the restore rehearsal. This is focused follow-up evidence, not a repeat of all 833 historical browser scenarios.

Observed in the final browser: foreman sign-in, Today displaying **Crew Assigned**, **Blue Splice Crew A**, one active roster member and **WO-CR-001**; Map retains **Crew Assigned** and renders the authorized PDF. Browser actions did not acknowledge notices, complete JSA, create production or make payments. Initial fast sign-in attempts following navigation did not leave the login page; a separately observed fill and submit succeeded. Routine sign-in is observed, but this is not certification of every browser timing/connectivity condition.

Post-activation backups at `2026-09-27T02:19:31Z` include database and private files tagged `ea41c37c876d`; both checksums passed. The listed operational/demo record counts remained unchanged and private storage still compared identical. Only the deliberately repaired null crew ownership changed among these business relationships.

## Remaining pilot gates

- Provision or select an authorized Sync management account and a dedicated Sync employee crew/assignment. The seeded `e2e.*` role names are not interchangeable with real management authority.
- Complete the partner's required onboarding/readiness items on designated pilot records. Seeded map/start notices alone are not operational approval.
- Run the physical-phone worksheet for both workforce types on actual supported phones, including camera uploads, rotation, loaded-session connection loss, reconnect/retry and offline cold start. None of these physical-device scenarios was performed by this activation.
- Passport sandbox approval, credentials and provider certification remain external dependencies. No live transfer or automatic recording is certified here.
- Retain the functional limitations recorded in `workflow-completion-2026-09-25.md`; staging activation does not turn review requests into issued credits, declarations into verified capacity, or coordinate entry into a drawing editor.

Training is available at `/training`. Use `docs/pilot/actual-phone-acceptance-2026-09-25.md` for the supervised acceptance evidence ledger. Healthy staging is not completed crew acceptance.

## Retained evidence

The non-secret final build log, 21-test control result and 19-check post-activation report are committed under `docs/releases/evidence/2026-09-26/`. Protected dumps, file archives and environment copies remain on the VPS and were not copied into Git.
