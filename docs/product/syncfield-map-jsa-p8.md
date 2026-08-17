# SyncField Map Foundation, Work Package Preparation, and Daily JSA - P8

## 1. Baseline Branch / Commit

- Branch: `feat/syncfield-map-jsa-p8`
- Baseline P7 HEAD: `11d9e584200b0d80bbddc3826be097724e2a1489`
- Repository root: `/Users/User/syncos`

## 2. Existing Capabilities Reused

Implementation plan before coding:

- Reuse `organizations`, `capacity_providers`, `projects`, `work_orders`, P5 `partner_work_order_versions`, P5 Crew/vehicle assignments, P4 Worker/Crew/Foreman links, P6 Notice/start authorization, events, audit logs, and `executeWriteAction`.
- Reuse P4/P5 `partner_restricted_file_objects` for private PDF bytes by extending its category/type constraints.
- Reuse existing Next.js Partner Portal shell and same-origin proxy backed by `SYNCOS_API_BASE_URL`.
- Do not create ProductionRecord, MapAnnotation, Customer QC, Settlement, Payable, Payment, PDF generation, OCR, GIS, or offline production mutation schema.

## 3. File Storage Audit

- Private byte storage: SUPPORTED by `partner_restricted_file_objects` and local server-owned restricted storage.
- Server-generated storage keys: SUPPORTED.
- Content hashing: SUPPORTED.
- Request-time authorization: SUPPORTED in P4/P5 routes; P8 will add map-specific authorization.
- PDF content validation: PARTIALLY SUPPORTED by magic-byte checks; P8 adds malformed PDF structure checks and page-count extraction without a new dependency.
- Temporary/signed URLs: MISSING; P8 returns authorized bytes through API only.
- Public/static storage: DUPLICATE - DO NOT BUILD.

## 4. PDF Infrastructure Audit

- Existing PDF upload validation: PARTIALLY SUPPORTED in P5 legal artifact upload.
- Existing PDF rendering library: MISSING.
- Existing server rasterization/thumbnail pipeline: MISSING.
- P8 decision: do not add PDF.js, pdf-lib, sharp, canvas, or native rasterization dependency for the MVP. Store original PDF privately, extract page count with conservative structural parsing, create `MapPage` metadata, and use browser-native PDF embedding for read-only viewing through authorized bytes.

## 5. Field Web/PWA Audit

- Responsive Partner shell: SUPPORTED by P7.
- Tablet/phone field layout: PARTIALLY SUPPORTED; P8 extends the Foreman shell.
- Service worker/PWA/offline authenticated file cache: MISSING / UNSAFE TO INFER.
- IndexedDB offline production queue: MISSING and excluded.
- P8 decision: no secure offline PDF caching is implemented. The UI shows online availability and documents P9 offline-map hardening as a prerequisite.

## 6. Domain Ownership Audit

- Project and Work Order ownership: canonical P5/P1-P7 records.
- Crew and Foreman ownership: canonical P4/P5 records.
- Map logical document/version/page/work-zone/field assignment: new P8-owned facts.
- Daily JSA operational safety record: new P8-owned fact.
- Daily production, map annotation, and Customer QC: explicitly excluded.

## 7. MapDocument Model

Planned table: `syncfield_map_documents`.

Owns the logical construction print for one Project/Work Order. It does not own the PDF version itself.

## 8. MapVersion Model

Planned table: `syncfield_map_versions`.

Owns immutable uploaded customer PDF revision metadata, original restricted file object, hash, page count, processing status, lifecycle status, uploader, and supersession.

## 9. MapPage Model

Planned table: `syncfield_map_pages`.

Owns page-number metadata and processing status. P8 does not persist raster preview blobs.

## 10. Map Assignment Model

Planned table: `syncfield_map_assignments`.

Owns exact operational assignment of a MapVersion to Project, Work Order version, Partner Organization, Crew, and Foreman. One current active assignment per Work Order version/Crew is enforced.

## 11. Work Zone Model

Planned table: `syncfield_map_work_zones`.

Owns normalized PDF navigation bookmarks for an exact MapVersion. It is not a crop, production mark, or annotation.

## 12. PDF Storage Security

P8 requires server-generated restricted file object rows, sanitized display filenames, SHA-256 checksums, PDF content validation, configured size limits, no raw URLs, no storage-key serialization, and request-time authorization.

## 13. PDF Processing

P8 extracts page count synchronously at upload, creates page metadata, and marks the version `ready` or `failed`. No OCR, GIS, pole detection, thumbnail generation, or rasterization is implemented.

## 14. Worker Job Architecture

No Worker change is planned for the MVP because no background rasterization is needed. P8 remains compatible with future worker processing.

## 15. Field Map Viewer

P8 adds a Partner Foreman read-only field map viewer reached from Partner Today/Assignment when a ready assigned MapVersion exists. It supports exact revision display, PDF page selection, zoom, pan-scroll container, and Work Zone jumping.

## 16. Tablet/Mobile UX

The field viewer uses large controls, sticky operational context, mobile cards, and no hover-only interactions.

## 17. Offline Map Cache Result

Secure offline authenticated document caching is not implemented in P8. P9 must add a Service Worker/IndexedDB design that binds cached bytes to exact MapVersion identity and authorized Partner scope.

## 18. Daily JSA Model

Planned tables: `daily_jsas` and `daily_jsa_participants`.

One current JSA per Crew + Work Order + workDate. Completed JSA records are immutable except controlled void.

## 19. JSA Workflow

Foreman opens Today, sees JSA required, confirms Crew/Work Order/work area, selects hazards, confirms controls, certifies, and completes. Partner Admin can view safe status/history for own crews.

## 20. JSA Hazards

Initial structured hazards include traffic, energized utilities, overhead utilities, fall exposure, bucket/aerial-lift hazards, pole hazards, unsafe pole, guy/anchor hazards, trip hazards, public exposure, weather, equipment movement, blocked access, animals, and other.

## 21. JSA Controls

Initial controls include PPE, traffic-control plan, fall protection, equipment inspection, emergency procedures, rescue procedures, communication method, exclusion/work zone, stop-work authority, utilities review, aerial hazards review, and incident reporting.

## 22. JSA Completion/Attestation

P8 records Foreman certification that crew participated, hazards/controls were reviewed, and information is accurate. Worker login/signatures are not implemented.

## 23. JSA vs Mobilization Boundary

Daily JSA does not alter P6 Mobilization Readiness, mobilization decision, Notice, or production-start authorization.

## 24. JSA vs Production Boundary

P8 exposes `JSA COMPLETE FOR TODAY` only. It does not unlock or create Daily Production.

## 25. Partner Admin Visibility

Partner Admin may read own Map assignment metadata, safe map/version status, Work Zones, and own Crew JSA status/history.

## 26. Partner Foreman Visibility

Partner Foreman may read only its assigned MapVersion, Work Zones, safe assignment context, own Daily JSA draft/status, and own Crew roster context.

## 27. Internal Manager Capability

Internal authorized users may create MapDocuments, upload MapVersions, assign exact versions, create Work Zones, and inspect history.

## 28. Permissions

P8 adds minimum permissions for internal map/JSA management plus Partner Admin and Partner Foreman read/JSA capabilities.

## 29. Tenant / Partner Scope

All P8 routes derive tenant from auth, resolve Partner Organization from P2 scope or internal Organization access, and revalidate Work Order, Crew, Foreman, and MapVersion relationships.

## 30. Events

P8 uses `executeWriteAction` events for map document/version/assignment/work-zone writes and Daily JSA create/update/complete.

## 31. Audit

P8 audits all writes and restricted map PDF byte access. Payloads include safe IDs/statuses only.

## 32. Migration

Planned migration: `packages/database/migrations/046_syncfield_map_jsa_foundation.sql`.

## 33. Fresh DB Result

PASSED.

- `syncos_syncfield_p8_verify_empty` ran migrations `001` through `046`, seed, and `db:verify` successfully.
- `syncos_syncfield_p8_verify` ran the full migration chain and seed successfully for API/web runtime validation.

## 34. P7->P8 Upgrade Result

PASSED.

- `syncos_syncfield_p8_upgrade` was migrated through `045_partner_mobilization_readiness_foundation.sql`, seeded, then upgraded by applying `046_syncfield_map_jsa_foundation.sql`.
- Seed rerun after migration 046 was idempotent.
- Verification queries showed 13 P8 permissions, no duplicate permission keys, no duplicate role-permission mappings, and empty initialized P8 operational tables.

## 35. Security Tests

PASSED.

P8 targeted E2E verifies Partner Foreman cannot upload maps, Partner Foreman cannot read another Partner scope, unauthorized map bytes do not expose storage keys, malformed PDFs and client-supplied storage keys are rejected, and Foreman pages do not expose rates/internal notes.

## 36. Map Upload Tests

PASSED.

Internal Manager can create a MapDocument, upload an immutable PDF MapVersion, store checksum/original bytes, create Work Zones, assign the exact version, upload a second revision without silently replacing the assignment, and preserve the prior version.

## 37. Map Assignment Tests

PASSED.

Assignment is scoped to tenant, Work Order version, Partner Organization, Crew, Foreman, MapDocument, and exact MapVersion. One current active assignment per Work Order version/Crew is enforced by database uniqueness and service-level supersession.

## 38. Field Viewer Tests

PASSED.

Partner Foreman reaches the assigned map from the Partner shell, sees exact revision/work context, page controls, zoom controls, Work Zones, and no Production or annotation controls.

## 39. JSA Tests

PASSED.

Partner Foreman can create and complete today's JSA for the own Crew/Work Order. Duplicate completion is idempotent, completed JSA state is preserved, Partner Admin sees safe history, and completion creates no Production/QC/finance rows and does not alter P6 Mobilization Readiness.

## 40. P1-P7 Regressions

PASSED.

- P1-P8 targeted Partner E2E: `47 / 47 passed`.
- P1-P7 portion of that run: `43 / 43 passed`.
- P6 targeted suite remained green inside the global run.
- P7 Partner Portal shell suite remained green after P8 optional-map/JSA fetch gating.

## 41. Global Certification

PASSED.

- `npm run e2e:certification`: `608 / 608 passed`, exit code `0`.
- Proof P8 executed globally:
  - `tests/e2e/syncfield-map-jsa.spec.ts` internal Manager map/version/assignment test passed.
  - Foreman read-only field map test passed.
  - Foreman Daily JSA completion boundary test passed.
  - Partner Admin JSA history / Production-unavailable test passed.

## 42. Files Changed

- `apps/api/src/modules/app.module.ts`
- `apps/api/src/routes/syncfield.controller.ts`
- `apps/api/src/security/permission.guard.ts`
- `apps/web/app/partner/field/map/page.tsx`
- `apps/web/app/partner/jsa/page.tsx`
- `apps/web/app/partner/partner-shell.tsx`
- `apps/web/app/styles.css`
- `docs/product/syncfield-map-jsa-p8.md`
- `package.json`
- `packages/database/migrations/046_syncfield_map_jsa_foundation.sql`
- `packages/database/scripts/seed.js`
- `packages/permissions/src/index.ts`
- `tests/e2e/syncfield-map-jsa.spec.ts`
- `tests/regression.test.js`

## 43. Dependencies Added

None.

## 44. Known Limitations

- P8 uses lightweight server-side PDF structure validation and page-count extraction; it does not add PDF rasterization, thumbnails/previews, OCR, GIS, pole detection, or AI map interpretation.
- Secure offline authenticated PDF caching is not implemented; P9 should add a scoped Service Worker/IndexedDB cache design before offline field map use is certified.
- Worker login/signatures for individual JSA attendees are not implemented; P8 records Foreman attestation and roster participation.
- No production-entry gate is implemented; P8 exposes only the future-facing `JSA COMPLETE FOR TODAY` indicator.

## 45. Explicit P9+ Exclusions

No DailyProductionReport, ProductionRecord, ProductionCode, MapAnnotation, production marks, pole ticks, route drawing, field photos for production, offline production queue, production totals, Customer QC, customer acceptance, corrections, annotated PDFs, CSV exports, Billable, Settlement, Contractor Payable, Payment, payroll, QuickBooks, Customer Portal, GIS, OCR, AI map interpretation, email ingestion, or public website work.

## 46. P8 Certification

CERTIFIED

## 47. GO / NO-GO for P9

GO after P8 is committed. Do not start P9 before the P8 commit exists.
