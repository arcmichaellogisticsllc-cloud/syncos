# SyncOS engineering continuation — October 5, 2026

## Candidate and scope

Local worktree: `/Users/User/.codex/worktrees/syncos-financial-completion/syncos`, branch `codex/financial-completion-20260930`, starting checkpoint `ff54d9d`, migration ceiling **102**. This report covers the current continuation, not a staging activation or unrestricted production release. Existing operational and shared demo records were not reseeded, repriced or deleted. Tests use isolated synthetic localhost databases. No live email or payment was sent.

## Changes delivered

1. **Offline recovery:** saved supplemental forms and never-attempted production drafts can be edited after cold offline navigation. Durable production queues recover interrupted in-flight state, retain mutation identities, serialize tab replay where supported and revalidate the session and server authorization. Manual retry resets the retry budget without changing an ambiguous request. Material requests are stored before transmission and restored unchanged after reload. Expired or changed sessions cannot use saved offline context.
2. **Assigned forms/materials:** both Sync and partner foremen receive assignment-scoped published forms, their own submitted records, current-crew custody and assigned-work-order movements. Safety stops and current assignment checks apply to new writes. Existing recorded material retries remain recoverable during a stop. Inventory receipts/transfers/adjustments retain separate operator authority.
3. **Public inquiry intake:** deliberate channel configuration, active authorized routing owners, bounded validation, consent, honeypot handling, durable IP/email throttles and concurrent request deduplication. The public receipt states review only and does not claim email, work approval or commercial acceptance.
4. **Operational notices:** durable inquiry assignment/follow-up and workflow assignment/overdue/recorded-escalation queues; five-attempt bounded retries; protected retry controls; delivery attempt history; current recipient/ownership/deadline checks; safe error messages. Delivery switches default off. Provider acceptance is recorded separately from task completion and is not a read receipt.
5. **History/performance:** twenty core directories have tenant-authorized literal search and deterministic keyset paging. Forms, inquiries, material records and scoped field histories expose older entries. Tests exercise equal-timestamp volume and concurrent resumable uploads.
6. **Recovery email readiness:** existing password-reset behavior remains regression-tested, and enabled delivery configurations are checked. Live sender/link delivery still requires provider configuration and deployed acceptance.
7. **Priority preparation:** a disabled-by-default refresh runner composes an injected reader/normalized decoder with a durable leased inbox. Observation, exception and job acknowledgment are atomic. Simulated reconciliation covers duplicates, concurrent events, partial payments, changed amounts, returns/reversals and unmatched review. This is not a verified Passport wire decoder or enabled financial posting.
8. **Permissions/training:** role-based controls, tenant/crew/assignment boundaries and both workforce workflows are exercised. Updated in-app click-by-click guides explain normal actions, save confirmation, failed delivery, offline recovery and exact-request retries.
9. **Release/recovery:** migration-102 activation preparation, coordinated backup expectations, rollback limits and a reusable local recovery rehearsal. Old manifests are not assumed compatible with a 102 database. Recovery preserves source records and failure artifacts.
10. **Backlog:** SSO, magic-link login and optional automatic prime document delivery remain visible and are not mislabeled as controlled-pilot prerequisites.

## Verification evidence

- API, worker and production web builds passed; web build contains 113 routes.
- Final regression: **259 passed, zero failed, zero skipped** with every database variable supplied, including the scoped-header, deleted-role and stale-reminder cases.
- Integrated crew/field checks: **24 passed** against the real local API and production web build. Includes employee/partner production, safety/evidence/quantity, forms/materials, recovery of in-flight queue state and manual retry after exhausted automatic attempts.
- Focused workspace UI: **14 passed**, covering hidden unauthorized actions, save/failure/retry, form scope, cold-offline edits, history and pending material recovery.
- In-app training browser check: **1 passed**, covering guide selection/search, download and four viewport sizes. This is not a physical-phone test.
- Full application certification: **707 passed, zero failed, zero skipped**, against the final API and web build after the reminder, scope and deleted-role repairs (10.0 minutes). The earlier stable build also passed 707/707. An intermediate rerun was deliberately interrupted after 48 passes to finish deleted-role revocation; it is preserved separately and is not presented as certification.
- Production dependency audit: **zero reported vulnerabilities** (164 production dependencies at this checkpoint).
- Repository staging-readiness and implementation-plan checks passed. These static checks do not activate or certify the live VPS.
- Fresh synthetic install: all **102 migrations**, canonical and E2E fixture setup; startup reports `ok:true`, not just HTTP 200.
- Core history: **1,206 records in 13 pages**, no duplicates/missing rows, equal timestamps, literal search, resource/tenant/scope denial; observed local traversal about 504 ms. This is an observation, not a production latency guarantee.
- Upload concurrency: **eight simultaneous 4 MiB originals (32 MiB total)** with stored checksum verification; observed local completion about 6.7 seconds and process RSS increase about 23 MiB. The prior maximum-size 100 MiB acceptance remains separately recorded in the October 4 continuation.
- Coordinated local recovery: **221 table counts matched and three actual restricted originals matched by size/SHA-256**, restored into a fresh synthetic target in about ten seconds. This is local evidence, not independent offsite or total-server-loss acceptance.

Saved console logs normalize trailing whitespace only; result text and failed attempts are preserved. Evidence and SHA-256 manifest: `docs/acceptance/evidence-20261005-continuation/`. Counts overlap. Do not add focused checks to the full suite and call the sum unique tests.

An initial invocation of the fresh-install migration verifier against an already populated synthetic database was refused by its empty-database guard, without mutations. It was then run successfully against a new empty database. One intermediate regression invocation omitted the legacy-role test database variable and skipped that check; the final 259-pass run supplies it and has no skips.

## Findings preserved and corrected

- An earlier full run produced 705 passes and two failures: one test loaded an authorization helper while an API rebuild had removed the compiled directory; another new fixture omitted canonical role grants. The fresh full run uses stable build artifacts and canonical fixture setup on an empty synthetic database. No operational database was reseeded to resolve the fixture.
- One focused UI check initially selected a button inside a collapsed details element incorrectly. The locator was repaired; all thirteen then passed; a subsequent scoped-role visibility check brings the final focused suite to fourteen.
- Permission review found that caller-supplied scope headers could satisfy a scoped role on tenant-wide administration routes. Those routes now require tenant-wide grants, the identity response omits unauthorized administrative UI capabilities, and history/notification controls use explicit tenant permissions. The shared guard also excludes deleted roles and enforces tenant provenance on role-permission joins. HTTP and browser regressions cover these boundaries.
- A new notification regression reproduced an overdue inquiry notice sending after its deadline had moved into the future. The source repair rechecks the exact current escalation generation and recipient immediately before delivery and bounds scheduling batches. The isolated repaired regression passed; the final regression suite repeats it.
- The first coordinated restore attempt correctly failed on a fixture's missing original file. The tool was not weakened and missing files were not fabricated. A dedicated synthetic source with three real originals passed the rehearsal.

## Limits and next release gates

The work is not application-wide full completion. Cold-start creation of new daily reports and cached maps, some legacy child/audit list limits, company-admin field form/material overview and the verified Passport wire/posting adapter remain implementation boundaries. See `docs/product/deferred-work-20261004.md` for the current register.

External acceptance still needs real phones and both crew leads; the selected email sender; Priority sandbox/product/authentication/finality evidence; actual executed agreements and prime invoice requirements; authorized disposition of historical exceptions; independent offsite recovery/retention ownership; and fresh controlled staging activation plus supervised pilot. None of these is replaced by synthetic test success.

Deployment procedure: `docs/deployment/candidate-102-readiness.md`. Training: `docs/training/field-and-partner.md`, `docs/training/demand-operations-and-quality.md`, and the existing finance guide.
