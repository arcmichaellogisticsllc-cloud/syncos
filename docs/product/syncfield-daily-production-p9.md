# SyncField Daily Production, Map Annotation, Offline Queue, and Submission - P9

## 1. Baseline Branch / Commit

- Branch: `feat/syncfield-daily-production-p9`
- Baseline HEAD: `301c00c3195920a21c47a750684d99ed63a52fc3`
- P9 starts from certified P8 SyncField map/JSA foundation.

## 2. Existing Production Capability Audit

- `production_records`: SUPPORTED as the canonical production ledger, but extended carefully for SyncField. Existing QC/billable fields remain untouched by P9.
- `rate_codes` / `rate_schedules`: PARTIALLY SUPPORTED for commercial scope, but not reused as field-visible production code storage because rate exposure would couple field entry to pricing.
- P8 `map_documents`, `map_versions`, `map_pages`, `map_work_zones`, `map_assignments`, and `daily_jsas`: SUPPORTED and reused.
- Offline/PWA: PARTIALLY SUPPORTED. P9A adds browser-side IndexedDB mutation persistence and automatic replay while the field app is open. It does not add secure offline PDF byte caching or closed-browser background sync.

## 3. Domain Reuse Decisions

P9 reuses P1-P8 canonical tenant, Partner Organization, capacity provider, Crew, Foreman, Work Order version, P6 production-start authorization, P8 exact MapVersion assignment, and P8 Daily JSA. It adds only the daily production facts that did not exist canonically.

## 4. DailyProductionReport Model

`daily_production_reports` owns the daily field report context: tenant, Project, Work Order/version, Partner Organization, capacity provider, Crew, Foreman worker/user, work date, exact MapDocument/MapVersion, Daily JSA, status, weather/notes, submission metadata, revision number, and audit timestamps.

Status is limited to `draft`, `submitted`, and `void`.

## 5. ProductionCode Model / Reuse

`syncfield_production_codes` owns field-safe production codes without pricing. Seeded defaults include asset, route, and daily codes such as `TRANSFER`, `FIBER`, and `LABOR`.

## 6. Work Order Production-Code Authorization

`syncfield_work_order_production_codes` authorizes codes by exact Work Order version. Field responses return code, description, category, unit, location type, and requirement flags only. No customer rate, Partner pay rate, internal rate, or margin is serialized.

## 7. ProductionRecord Model

P9 extends canonical `production_records` with SyncField report, Partner, Foreman, exact map, production code, location type, field status, asset/route fields, map page, duplicate reason, client mutation ID, and lock timestamp.

`production_records` remains authoritative. Totals derive from records, not map annotations.

## 8. Production Status Semantics

Field statuses are `partial`, `complete`, `blocked`, and `rework`. `complete` means Foreman-reported field completion only. It does not mean customer accepted, billable, payable, or QC-approved.

## 9. Asset Production Workflow

Authorized Foreman can create asset production on a draft report with asset type, identifier, code, positive quantity, status, map page, normalized point coordinates, notes, and optional duplicate reason.

## 10. Route Production Workflow

Authorized Foreman can create route production with from/to identifiers, code, manually reported quantity, status, map page, and normalized start/end coordinates. P9 does not calculate distance from the PDF or GIS.

## 11. Daily Production Workflow

Daily/non-map records support codes such as labor and equipment hours without requiring a `map_annotations` row.

## 12. MapAnnotation Model

`map_annotations` is subordinate to `production_records` through a unique production-record FK. Asset records create `asset_point`; route records create `route_line`. P9 does not support freehand drawing or annotation-only production.

## 13. Normalized Coordinate Rules

All map coordinates are normalized ratios in the range `0..1`. Server validation rejects out-of-range point and route coordinates.

## 14. Daily Totals

Daily totals aggregate `production_records` by production code and count records by field status. Map annotations cannot independently affect totals.

## 15. Historical Submitted Layer

P9 stores submitted report records and locked annotations as read-only history. It does not expose Customer Accepted, pending Customer QC, or QC issue layers.

## 16. Duplicate Production Warning

Prior submitted same-code asset or route production on the same Work Order creates a duplicate warning condition. The second overlapping record requires `duplicate_reason`; legitimate rework/additional work is traceable instead of hard-blocked.

## 17. Production Photo Model

Photo storage was not implemented in P9. Existing secure file storage is preserved, but no field photo route was added. Default P9 codes are configured with `requires_photo = false`.

## 18. Offline Architecture

The Partner field UI uses an IndexedDB-backed queue named `syncos-field-production` for explicit saved production mutations when the page is offline or a network save fails transiently. Each queued record stores mutation ID, operation, scoped report key, local entity ID, canonical server entity ID after sync, safe payload, timestamps, retry count, status, and safe error text.

Queue scope includes authenticated user, tenant claim, Partner Organization, and Daily Production Report/work date. The client does not persist auth tokens in the queue, rates, internal notes, PDF bytes, photo bytes, storage keys, restricted Worker PII, or credential evidence.

Supported offline envelope: the field app must already be open. Pending mutations survive browser storage reinitialization/refresh persistence and replay automatically when the open app detects connectivity. Full cold-start offline application loading after a closed browser remains a later PWA hardening item.

## 19. IndexedDB / Storage Model

P9A uses IndexedDB as the primary persistent browser store with a minimal localStorage fallback only for environments where IndexedDB is unavailable. A legacy P9 `syncos.fieldMutations` localStorage queue is migrated into the scoped IndexedDB queue on load and then removed.

## 20. Client Mutation ID

Every report, production create/update, and submit path requires `client_mutation_id`. Duplicate create and submit attempts return the original canonical result rather than creating duplicate reports, records, annotations, or revisions.

## 21. Mutation Queue

The queue processes mutations deterministically by sequence. P9A currently certifies `CREATE_PRODUCTION` replay for Asset, Route, and Daily/non-map records. The client creates a local entity ID immediately, displays the local record and totals while offline, and preserves dependency order for a single record by not sending later operations before create resolves. Draft update/delete offline operations remain a later workflow because the P9 UI does not expose those offline controls.

## 22. Sync Algorithm

Replay triggers on the browser `online` event, on initial Partner production/review page load when pending mutations exist and `navigator.onLine` is true, and through the explicit safe `Retry Sync` control for failed mutations. The client does not poll aggressively and does not require service-worker background sync.

Server revalidates authentication, Partner scope, Foreman-Crew linkage, report draft state, production-start authorization, Daily JSA completion, map assignment, production-code authorization, quantity, geometry, and `clientMutationId` on every replayed mutation. Successful create replay returns the canonical `ProductionRecord`; the client stores local-to-server ID mapping, marks the mutation `SYNCED`, and reloads canonical report state so local records are not double counted with server records.

## 23. Conflict Rules

If the report is submitted before a queued mutation replays, the mutation becomes `CONFLICT` with safe text: `REPORT ALREADY SUBMITTED - LOCAL CHANGES NOT APPLIED`. The report is not reopened, no ProductionRecord is created, and the submission snapshot is unchanged.

If production-start authorization, JSA, map, code, or scope becomes invalid while offline, replay fails safely, marks the mutation `FAILED`, keeps the local work traceable, blocks submission, and creates no ProductionRecord.

Transient network failures are retried with bounded attempts. Deterministic validation failures do not spin in an infinite retry loop.

## 24. Review Day

`/partner/production/review` displays report status, date, Work Order, Crew, Foreman, exact map revision, JSA status, record counts, annotation count, totals, unsynced mutation count, and submission controls.

## 25. Submission

Submit verifies draft report, Foreman scope, production-start authorization, completed Daily JSA, existing records, and required fields. It transitions the report to `submitted`.

## 26. Immutable Revision Snapshot

`daily_production_report_revisions` creates revision 1 on first submission with a safe JSON snapshot of report context, map, Crew/Foreman IDs, JSA status, production record facts, annotations, and totals. No PDF/photo bytes, rates, restricted Worker PII, or storage keys are stored.

## 27. Submitted Record Immutability

Submission sets `locked_at` on records and annotations. Ordinary update/add routes reject submitted reports.

## 28. Production Start Gate

Report create/open and production mutation require current P6 production-start authorization status `authorized`.

## 29. JSA Gate

Report create/open and production mutation require a completed P8 Daily JSA for the same Crew, Work Order, and work date.

## 30. Partner Foreman UX

P7/P8 Partner shell now exposes `Production` and `Review Day` to Foreman. The field UI is touch-friendly and uses large action targets for `+ Asset`, `+ Route`, `+ Daily`, and Review Day.

## 31. Partner Admin Visibility

Partner Admin can read own organization's draft/submitted daily reports in a safe read-only view. No field edit capability is granted to Partner Admin by default.

## 32. Internal Completeness Visibility

Internal read permissions were defined for future completeness review. P9 does not implement Customer QC or acceptance.

## 33. Security

All server routes derive tenant and Partner scope from authenticated context. Foreman scope is revalidated through P8 assignment context. Direct cross-tenant/cross-Partner access and guessed nested IDs are denied by query predicates and permission guard scope.

## 34. Permissions

Added minimal P9 permissions:

- Partner Foreman: daily production read/create/update draft/delete draft/submit, production record create/update/delete draft, production photo create, field sync submit.
- Partner Admin: organization daily production/production read.
- Internal: daily production read all and completeness read.

## 35. Events

P9 emits safe events for `daily_report.created`, `production.recorded`, `production.updated`, `daily_report_revision.created`, and `daily_report.submitted`.

## 36. Audit

P9 writes audit records for report creation, production record creation/update, revision creation, and submission with safe IDs/status/quantity metadata only.

## 37. Migration

Added `047_syncfield_daily_production_foundation.sql`. The migration is additive, preserves migrations 001-046, and adds tenant-safe indexes, idempotency keys, current report uniqueness, revision uniqueness, and annotation-record consistency.

## 38. Fresh DB Result

Fresh `npm run db:verify` on disposable database `syncos_p9a_migration_verify` applied migrations 001-047, seeded, and passed. A separate disposable seeded runtime database `syncos_p9a_verify2` also migrated through 047, seeded successfully, and supported the targeted and global E2E runs.

## 39. P8->P9 Upgrade Result

Disposable upgrade database `syncos_p9a_upgrade_verify` was migrated through 046, then upgraded through 047. P9 migration applied cleanly, the current seed ran twice without error, P9 tables existed after upgrade, and duplicate permission names remained `0`.

## 40. Offline Tests

Runtime tests now cover real browser offline behavior:

- Asset, Route, and Daily production save locally while the browser context is offline.
- IndexedDB persistence is inspected directly to prove storage survives outside React memory.
- Reconnect dispatches browser online behavior and automatically replays the queue.
- Duplicate replay with the same `clientMutationId` creates one ProductionRecord, one MapAnnotation set, and one successful business effect.
- Local temporary records reconcile to canonical server records and the UI returns to `synced`.
- Review Day unsynced count becomes 0 and submission becomes enabled after sync.
- Lost production-start authorization fails safely without creating production.
- Submitted-report conflict is retained locally and does not reopen or mutate the report.
- Partner/account switch does not expose another Partner's queued field work.

## 41. P1-P8 Regression Result

Final global certification re-ran P1-P8 Partner, portal, map/JSA, hydration, boundary, persona, lifecycle, workflow, and action-state coverage after P9A. All registered P1-P8 regression coverage passed. A transient combined targeted Partner Portal load timeout did not reproduce in the isolated P7 rerun or in final global certification.

## 42. P9 Targeted Result

`tests/e2e/syncfield-daily-production.spec.ts`: 8/8 passed in P9A targeted validation.

## 43. Global Certification

Post-P9A `npm run e2e:certification`: 616/616 passed, exit 0. The global run included `tests/e2e/syncfield-daily-production.spec.ts` and executed all eight P9 tests, including automatic offline replay, lost authorization replay failure, submitted-report conflict, Partner queue isolation, and idempotent authoritative record/annotation creation.

## 44. Files Changed

See final git status. Primary changes are SyncField controller, Partner shell/routes/styles, P9 migration, seed/permissions, P9 E2E, certification registration, and this document.

## 45. Dependencies Added

None.

## 46. Known Limitations

- Closed-browser cold-start offline app loading is not implemented; P9A supports automatic replay when the field app is open and connectivity returns.
- Offline update/delete draft production controls are not exposed in the P9 UI; server-side draft update idempotency remains available online.
- Production photo capture is not implemented; default codes do not require photos.
- Internal completeness queue is represented by permissions and submitted read data only; no separate P10 queue workflow was created.
- Delete/void draft production route is permissioned but not exposed as a P9 UI workflow.

## 47. Explicit P10+ Exclusions

P9 does not implement Customer QC, Sync technical QC approval, customer acceptance, accepted quantity, correction request, customer reinspection, Billable, Settlement, Contractor Payable, Payment, payroll, QuickBooks, Customer Portal, GIS, OCR, AI map interpretation, production PDFs, or production CSV export.

## 48. Customer-QC Boundary

P9 stops at Partner submission. It creates no QC review, no customer acceptance, no accepted/approved quantity, and no finance records. Customer QC remains P10.

## 49. P9 Certification

CERTIFIED

Reason: P9A targeted offline replay validation passed and the post-P9A full global certification exited 0 with 616/616 tests passed.

## 50. GO / NO-GO for P10

GO for committing P9. NO-GO for starting P10 in this sprint; P10 may begin only after P9 is committed and explicitly authorized.
