# Workflow completion candidate — 2026-09-25

Baseline: `161eeee` on `codex/passport-preparation`. This report covers the local candidate in `/private/tmp/syncos-passport-preparation`; it is not a staging deployment or physical-phone certification.

## Preserved scope

Both Sync employee crews and partner crews remain supported. Company approval, crew readiness, mobilization and daily production authorization remain separate. Customer acceptance controls financial truth; employee work does not create partner debt. Passport preparation remains disconnected pending sandbox approval. Existing staging, operational and demo records were not modified.

## Changes

| Audit area | Candidate change |
| --- | --- |
| Qualification integrity | Named partner selector; inquiry-scoped resets; individual verification flags; failed notes retained; duplicate-click guard. |
| Field evidence/incidents | Private JPEG/PNG/PDF uploads/downloads, 2 MB decoded limit, report/crew/tenant scope, explicit incident entry and internal pre-submission visibility. |
| Daily customer QC | Dedicated completeness/inspection/decision/reinspection UI, authorized controls, preserved inputs/retry IDs. |
| Corrections | Authorized quantity/code/map/evidence revisions; original facts preserved; same-unit/location code requirements; unknown fields rejected. |
| QC/finance consistency | Targeted reinspection retains unrelated decisions; general or same-record reinspection blocks stale acceptance; unresolved corrections remain blockers; report/export totals avoid correction-history double-counting. |
| Financial handoff | Named conversion, invoice, receipt, clearance, application, partner settlement/payable and eligibility forms; employee exclusion; duplicate/concurrent-write safeguards. |
| Payment adjustments | Exact section permissions, retainage request/authorization, controlled credit/rebill review request. No money is sent. |
| Partner onboarding | Company, private documents, worker/photo/credential and crew/member/foreman forms; worker private fields preserved on partial edit; declarations reviewed separately from verified capacity/custody. |
| Project handoff | Approved coverage through checklist/risk/readiness/approval to explicit planning project; generic edits cannot approve or weaken gates. |
| Exports | Scoped report selection, generation and private downloads for internal/partner/foreman contexts as permitted. |
| Other usability | Design entry uses explicit measured coordinates instead of sample geometry; performance/Command Center errors and busy feedback; accessible form labels and phone control sizing. |
| Training | Three regenerated in-app guides, route inventory and physical-phone acceptance worksheet. |

## Data and migrations

Applied additive migrations 066–068 only to the isolated localhost database `syncos_ui_training_test_20260924`, after a custom-format local backup at `/private/tmp/syncos-before-completion-20260925.dump`. The migration manifest contains 68 entries. A separate fresh database, `syncos_completion_validation_20260925`, was created for the full regression run because prior tests had advanced the original fixtures. The complete migration chain also passed in the separate empty database `syncos_completion_migrations_20260925`. Existing test/demo databases were retained. No shared reseed/reset, external invitation, payment, push or deployment was performed. A local backup is not offsite recovery evidence.

## Verification record

Completed local verification (not a staging or crew-release certification):

- Full E2E coverage: 833 unique scenarios covered. Three isolated groups initially produced 817 passes, 9 failures and 7 serial follow-on tests not run. All 16 affected scenarios are covered by 30 passing corrective rechecks (20 portal/persona/release-readiness, 7 database-guarded QC/scope, 3 coil-policy). No unresolved failed or unexecuted scenario remains in this suite. This was not a single uninterrupted green run.
- Focused production-mode UI suite: 20 passed.
- Unit/control checks: 190 passed, zero skipped, including role migration validation.
- Customer QC database/browser workflow after repair: 12 passed.
- Production web and worker builds, API compilation and workspace type checks passed.
- Full and production-only dependency audits: zero reported vulnerabilities.
- Empty-database migration verification passed for all 68 manifest entries.
- CI certification hygiene check passed for 68 action states.
- Local startup check: HTTP 200, all 68 migrations present, no missing/unexpected migrations, all required tables/permissions/roles present. Redis was not configured in this local test environment; worker runtime and live infrastructure were not certified.
- Final training bundle regenerated from the authoritative guides; final production rebuild passed; search, guide selection, download, keyboard focus and phone/tablet/desktop overflow check passed (1 final training test). Route inventory covers all 153 page files.

The first combined workflow run exposed a normal-JSON parsing regression caused by scoped upload parsers; an explicit bounded fallback repaired it. The next run passed 40 checks but exposed missing completeness/outcome fields in the customer-QC detail response; those fields were restored and all 12 customer-QC tests passed. The broad regression was restarted on fresh fixtures after previously advanced practice records caused false state expectations, then partitioned into three independent databases/browser sessions. The additional databases are `syncos_completion_shard2_20260925` and `syncos_completion_shard3_20260925`. The broader run also exposed ambiguous roster text assertions, a navigation assertion made before authentication completed, and an obsolete blanket payment-page denial for a user explicitly granted payment-recording authority. Precise roster assertions, waiting for the expected navigation, and section-specific permission checks passed all 20 affected portal/persona/release-readiness rechecks. All seven database-name-guarded QC and financial/production scope checks passed separately in `syncos_completion_test_20260925`; the safety guards were retained unchanged. The coil-policy mock also needed the grouped response contract for the newly added financial workflow choices; all three coil tests passed after correcting that fixture. No checks were weakened or skipped to hide these failures.

## Remaining boundaries

- Actual iPhone/Safari and Android/Chrome checks require physical devices and a trainer. See `docs/pilot/actual-phone-acceptance-2026-09-25.md`; none are marked passed by browser emulation.
- Passport sandbox approval, credentials and provider verification are external dependencies. Automatic recording is not certified; automatic transfer execution remains disabled.
- Credit/rebill submission creates a controlled review request, not an issued credit note. Accounting review/issuance remains a separate workflow.
- Equipment/capability declarations enter internal review; they do not themselves create verified capacity or vehicle custody.
- Design preparation provides measured-coordinate entry, not a drag-to-trace PDF editor or GPS survey tool.
- Legacy onboarding document uploads prevent rapid double-clicks, but lost-response retries require checking the saved document list; server-side retry deduplication is not certified for those older endpoints.
- Full offline cold start, every screen-reader combination and complete dark-theme contrast are not certified by this pass.
- Existing general constraint/relationship placeholders and generic user/role administration are outside the completed field-to-finance paths and remain documented limits.
- Staging activation still requires current live-state checks, fresh database/private-file backup and restore evidence, exact-release verification and operator acceptance. This candidate has not been deployed.

## Verification evidence

Local logs are retained under `/private/tmp`:

| Check | Evidence file |
| --- | --- |
| Full regression groups | `syncos-completion-shard1.log` (289 passed), `syncos-completion-shard2.log` (266 passed, 2 fixture failures), `syncos-completion-shard3.log` (262 passed, 7 failures, 7 not run) |
| Corrective rechecks | `syncos-completion-regression-rechecks.log` (20 passed), `syncos-completion-safety-rechecks.log` (7 passed), `syncos-completion-coil-rechecks.log` (3 passed) |
| New focused UI | `syncos-completion-ui-all.log` (20 passed) |
| Final training screen | `syncos-completion-training-final.log` (1 passed after the final rebuild) |
| Unit/control | `syncos-completion-unit-final.log` (190 passed) |
| Final web build | `syncos-completion-web-final-build.log` |
| API / worker / types | `syncos-completion-api-final.log`, `syncos-completion-worker-build.log`, `syncos-completion-typecheck.log` |
| Migration chain | `syncos-completion-migrations.log` |
| Dependency checks | `syncos-completion-full-audit.json`, `syncos-completion-dependency-audit.json` |

These logs contain synthetic test references and are local working evidence. The report is the durable summary; preserve any required detailed artifacts before clearing temporary storage.
