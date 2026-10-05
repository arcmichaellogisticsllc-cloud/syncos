# Independent engineering completion — candidate through migration 106

Status: independently executable engineering in the approved eight-area outline is complete and locally verified through migration 106. This is a local release candidate, not a deployed or field-certified release.

This report covers the eight independently executable areas in the user's approved attachment. It preserves Sync employee and partner workforce paths, demo records, customer acceptance before billing, and recorded external payments. Live Passport posting, transfers and outbound email are not enabled.

## Implemented behavior

1. **Cold-offline reports and maps.** Prepare assignment context while connected. Cache verified PDF map originals up to 25 MiB each and 75 MiB per device cache. Show version, preparation time, session expiry and unavailable downloads. Create and edit a new local daily report after opening offline; persist through reopening. Explicit reconciliation keeps one request identity and the original attempted payload. Reconnection checks the user, assignment, current map and safety/shutdown gates. Server draft confirmation is separate from production submission, QC and customer acceptance. Signing out removes device data; account changes hide it and revoke open map URLs. An interrupted replacement cannot leave the old map presented as the current map.
2. **Company forms.** Company administrators can search their authorized assignments, see assigned form versions, response counts and submitted answers, and delegate an already assigned published form to another active assignment in the same company when explicitly permitted. Delegation cannot reactivate an operator-disabled assignment, acknowledge safety for workers or grant tenant-wide form access. Internal Sync operators retain their authorized internal workspaces; both workforce types retain foreman access.
3. **Company materials.** Company administrators see crew custody balances and movement lineage. A discrepancy request records the physical count, ledger balance at the time, evidence reference and stable request identity. It does not alter inventory. Authorized inventory operators resolve it with an existing matching adjustment or an explicit documented no-adjustment decision. Cross-company/assignment requests are denied.
4. **Accessible history.** Record history covers 31 separately authorized record families, with full legacy audit/timeline pages where those routes exist. Equal timestamps use record IDs as a tie-breaker; activity cursors preserve timestamp precision and bind to the authorized query. Financial, onboarding, customer-QC, partner safety/production/payment, field setup and work-safety views have search/paging. Large selectors have a searchable continuation path. The route-query inventory is in `independent-completion-20261005/query-bounds.json`. Dashboard/contextual previews and explicit processing batches remain bounded; they are not represented as complete histories. Export selection above the supported ceiling fails explicitly rather than silently dropping work. Daily production and annotation-summary PDFs retain all selected detail with line wrapping and multiple pages; the export selector retains all reports in the bounded result. Rendering version 2 preserves older files and marks them for regeneration rather than reusing a truncated original. Opening an older QC report preserves the selected report and loaded history.
5. **Resilience and volume.** Repeatable synthetic checks cover 12,006 history records, equal timestamps, additions between pages, restricted records, concurrent original uploads, abandoned refresh leases, failed finalization and duplicate offline report replay. Results are specific to those workloads, not a production capacity guarantee.
6. **Prepared financial posting.** Internal, deliberately synthetic-only transaction seams exercise normalized outgoing partner payments and incoming customer receipts through the existing financial controls. Approved mappings, accepted-work lineage, approved agreement terms, currency, outstanding balances and holds are checked. Partials remain distinct; duplicate/reordered observations cannot post twice. Changed, unmatched, over-balance, returned and reversed observations remain review items instead of rewriting prior money records. Financial entries and integration observations have audit lineage. An injected crash before posting acknowledgment rolls back the complete financial transaction. No HTTP route or live worker enables this rehearsal seam.
7. **Training and release preparation.** In-app training covers preparation, device-only drafts, reconciliation, missing maps, company delegation, discrepancy routing and history navigation. The candidate-106 runbook covers coordinated backup, migration, health, restore verification and the rollback boundary.
8. **External evidence preparation.** `scripts/acceptance/check-external-evidence.js` checks an evidence packet's required fields and file hashes. Its result is either incomplete or ready for human verification; it cannot certify contracts, devices, email, provider behavior or disaster recovery merely from a filled form.

## Evidence and limits

Raw results, including original failures and their superseding passing reruns, and candidate source hashes are collected in `independent-completion-20261005/`. Earlier interrupted runs are diagnostic history, not certification. All identified failures have passing whole-workflow reruns. This was not one uninterrupted green run: the original main run had 709 passes, two failures and one serial test not run; the supplemental run had 139 passes, four fixture failures and three serial tests not run. The final 18-test rerun passed every repaired workflow, including the previously blocked tests and a new production error-message assertion. Original logs remain available.

| Verification | Final disposition |
| --- | --- |
| Main application certification | All 712 scenarios have passing evidence across the main run and repaired workflow reruns. |
| Additional E2E coverage outside the main command | All 141 original scenarios have passing evidence; one added error-message scenario also passed (142 total). |
| General regression | 265 passed, zero failed, zero skipped. Final export/evidence-checker delta: two passed. |
| Focused UI/training | 23 passed. |
| Company field oversight browser checks | Three passed. |
| Offline-capture browser checks | Four passed. |
| Final repaired workflow/browser run | 18 passed, zero failed or skipped, 30.6 seconds. |
| API, worker, web builds and workspace type checks | Passed; final web build contains 114 generated pages. |
| Migration, upgrade and coordinated local restore | Passed, with preservation/checksum and restored API authorization evidence below. |

The 854 application scenarios are the union of 712 main, 141 supplemental and one new message check; reruns are not counted as new scenarios. Regression/UI/offline counts are separate test groups and may cover overlapping behavior. Old fixture repairs supplied scoped mobilization, individual acknowledgments, reviewed quantities and approved commercial evidence; application gates were not weakened. The production UI now preserves the actual mobilization denial instead of converting every message containing “active” into a project-status error.

Completed local verification:

- Fresh install and canonical seed through migrations 1–106 passed.
- Synthetic schema upgrade from 102 to 106 preserved every hashed pre-existing business table: 218 tables and 264 fixture rows. Permissions, grants and migration metadata are deliberately allowed to change.
- Coordinated local database/private-original restore passed. Every table count matched; all three synthetic originals matched size and SHA-256. A separately booted API against that restored copy passed startup, authenticated checksum-matching downloads of all three files, unauthenticated/wrong-organization/wrong-tenant denials and download audits. This does not prove independent offsite recovery.
- Production and full dependency audits (including development dependencies) reported zero vulnerabilities.
- Company UI checks passed for read-only visibility, explicit delegation, discrepancy reporting and unchanged retry identity after failure.
- Browser offline tests cover cold navigation, restart, expiration, wrong account, shutdown rejection, corrupt downloads and ambiguous-response retry. These are browser automation, not physical-phone acceptance.

## Reproducible workload baseline

Use only a new localhost database explicitly named `syncos_synthetic_…`. Seed fixtures there, never in staging or operational databases. Set the database/API variables described in the candidate runbook. Run one release candidate without rebuilding its API or web assets while tests execute.

| Workload | Measured earlier in this implementation | Meaning |
| --- | --- | --- |
| 12,006 history records / 121 pages | 857 ms | Database/controller history traversal; not browser or WAN latency. |
| 32 concurrent 4 MiB originals / 128 MiB total | 3,716 ms; 57 MiB process RSS growth | Synthetic chunk transport with bounded finalization and retry; not 32 simultaneous whole-file buffers or real camera acceptance. |
| 1,000 refresh jobs / four consumers / abandoned leases | 2,495 ms test duration | Simulated provider refresh, no real provider traffic or payment transfers. |
| 16 concurrent identical offline-report requests | 428 ms | Must return one report and preserve one original request. |

The history and upload tests support `SYNCOS_HISTORY_VOLUME` and `SYNCOS_UPLOAD_CONCURRENCY`. Their script limits intentionally prevent accidental unbounded load. The workload records should be rerun against the intended server and expected operating volumes before assigning production capacity or recovery objectives.

## Work that cannot be independently certified here

- Executed pilot agreements, correct customer/partner relationships, actual rates, effective dates, holidays, retainage, payment triggers and exceptions.
- Each prime's required package contents, correction policy, delivery method and acceptance evidence; explicit reconciliation decisions for preserved historical exceptions.
- Actual stock counts, signed count sheets and crew-custody reconciliation; physical balances cannot be inferred from the software ledger.
- Actual phones for both crew types: camera originals, background suspension, network transitions, offline replay, shutdown, browser/device restarts and device storage loss.
- Configured email sender, real recovery links, notification delivery and recipient allowlists.
- Priority sandbox approval, actual product/authentication, payer/payee/account mapping, event/version/finality contract and return/reversal behavior.
- Independent offsite destination, retention enforcement and a restore without the original server, followed by authorization checks and measured recovery objectives.
- Controlled deployment with a fresh coordinated backup and supervised sign-off of both crew workflows for that deployed candidate.

These items remain in the external evidence template and product register. SSO, magic-link login and optional automated prime delivery remain visible future capabilities. They have not been silently made crew-pilot prerequisites.

## Candidate identity

Base commit: `3d36537b59ade91278f549d30872f09e42a063cd`. Branch: `codex/financial-completion-20260930`. Source/test/config fingerprint: `358e52efcc24ca1745b1f25ddfb15ed7b5b44f106f3acde7f9d089b9bb916194`. The adjacent manifest lists every included file hash. Documentation and generated build output are excluded from that source fingerprint. This candidate is saved locally; it has not been pushed or activated on staging.
