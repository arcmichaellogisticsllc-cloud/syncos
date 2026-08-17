# Partner Portal Shell, Operational Dashboard, and SyncField Entry Architecture - P7

## 1. Baseline Branch / Commit

- Branch: `feat/partner-portal-shell-p7`
- Baseline P6 commit: `0463614c03661e099e3713d05d017226023cc3ba`
- Repository root: `/Users/User/syncos`

## 2. Existing Web Architecture Reused

Implementation plan before coding:

- Reuse the existing Next.js App Router application in `apps/web`; do not create a second frontend application.
- Reuse the same-origin API proxy at `/api/syncos/[...path]`, backed by `SYNCOS_API_BASE_URL`.
- Reuse the localStorage session convention used by current E2E and operator pages: `syncos.apiToken` and `syncos.permissions`.
- Reuse the established CSS tokens, panel, badge, button, empty, loading, error, and responsive conventions in `apps/web/app/styles.css`.
- Reuse certified P1-P6 Partner APIs as the authorization and serialization boundary. P7 does not add a writable Partner UI shadow model.

Capability classification:

- Root layout: SUPPORTED.
- Command-center layout: SUPPORTED for internal users, but DUPLICATE - DO NOT BUILD for Partner Portal.
- Partner-specific route layer: MISSING.
- Persona/context hydration: SUPPORTED by `/partner-personas/me/context` and `/partner-personas/me/actions`.
- Permission-driven action visibility: PARTIALLY SUPPORTED in frontend via stored permissions and server-side API enforcement.
- P1-P6 Partner APIs: SUPPORTED.
- PWA/offline mutation queue: MISSING for P8 field production.
- Read-only map/work-package reference: PARTIALLY SUPPORTED as P5/P6 string references; no canonical map document/version exists yet.

## 3. Partner Route Architecture

P7 adds `/partner` routes inside the existing web application and backs them with certified Partner APIs only.

## 4. Partner Layout

The Partner layout is a separate authenticated persona shell. It does not expose internal Sync command-center navigation.

## 5. Partner Admin Navigation

Partner Admin navigation exposes Dashboard, Company, Compliance, Workers, Crews, Agreements, Work Orders, Vehicles, and Mobilization. Daily Production is reserved as disabled future SyncField entry.

## 6. Partner Foreman Navigation

Partner Foreman navigation exposes Today, Crew, Assignment, and Mobilization only. Company, Compliance, Agreement administration, rates, and internal Sync workspaces are excluded.

## 7. Partner Admin Dashboard

The dashboard composes Partner Organization, compliance summary, workforce, agreements, work orders, vehicle assignments, and P6 mobilization state into a read-only operational view.

## 8. Foreman Today Dashboard

The Foreman landing page is tablet-first and focuses on the current Crew assignment, Work Order, vehicle, map/work-package reference, mobilization decision, Notice, and production-start authorization.

## 9. Company Workspace

Uses P3 safe company profile data. It does not expose full TIN, bank details, storage keys, or internal notes.

## 10. Compliance Workspace

Uses P3 safe summary, W-9 readiness, payment readiness, and insurance policy summaries. Partner Foreman cannot access this workspace.

## 11. Worker Workspace

Uses P4 Partner Admin worker APIs. Worker lists/details display safe profile, headshot status, credential status, and readiness blockers without restricted PII.

## 12. Crew Workspace

Uses P4 Crew APIs, Crew roster, and Crew readiness. Foreman access is limited to the explicitly linked Crew.

## 13. Agreement Workspace

Uses P5 Partner Agreement APIs and artifact authorization flow. Partner Foreman does not receive Agreement administration.

## 14. Work Order Workspace

Uses P5 Work Order APIs. Partner Admin can see Partner rate only where P5 allows it. Foreman views hide rates.

## 15. Vehicle Workspace

Uses P5 vehicle assignment APIs. The UI does not create finance records or settlement deductions.

## 16. Mobilization Workspace

Uses P6 readiness, mobilization decision, Notice to Proceed, acknowledgment, and production-start authorization APIs. Readiness, approval to mobilize, and authorization to begin production are visually separate.

## 17. Permission-Driven Action Model

Server APIs remain authoritative. The frontend uses session permissions and `/partner-personas/me/actions` to hide unsupported actions, but direct API authorization remains the security boundary.

## 18. Partner-Safe Serialization

P7 renders only safe P1-P6 API fields and intentionally excludes internal review notes, unrestricted file URLs, storage keys, Worker restricted PII, customer/internal rates, margin, W-9 full data, and payment/bank details.

## 19. Responsive / Mobile Strategy

Admin pages use responsive grids and list/card layouts. Foreman pages use larger touch targets, a sticky operational header, compact status bands, and mobile-first cards.

## 20. Accessibility

P7 uses semantic headings, readable status text, visible focus inherited from the existing web CSS, labeled buttons, useful loading/error states, and non-color-only status labels.

## 21. Error / Loading / Empty States

Every P7 route uses explicit loading, permission denied, API error, and empty states. A 403 is shown as denied, not as an empty dataset.

## 22. SyncField Future Entry Point

P7 reserves the field-navigation location but does not implement Daily Production. Future P8 work should add Daily Production after production-start authorization.

## 23. SyncField Domain Boundary

Future SyncField must preserve `ProductionRecord -> MapAnnotation`. P7 does not create DailyProductionReport, ProductionRecord, ProductionCode, MapDocument, MapVersion, or MapAnnotation.

## 24. Map/PDF Existing Capability Assessment

P5 provides artifact authorization for Agreements, Work Orders, and vehicle documents. Current P5/P6 Work Order data provides `map_work_package_ref`, but no canonical map document/version model was found for field map annotation.

## 25. P8 Offline Readiness Assessment

- Service Worker/PWA install: UNSAFE TO INFER from current P7 inspection.
- IndexedDB production mutation queue: MISSING.
- Connectivity indicator location: PARTIALLY SUPPORTED by reserved Foreman shell status area.
- Idempotent backend writes: PARTIALLY SUPPORTED in existing P1-P6 audited write paths.
- Offline Daily Production submission: MISSING and excluded from P7.

## 26. Customer QC Future UI Architecture

Future Partner QC UI must display reported quantity, customer accepted quantity, customer decision, affected location, customer correction instructions, due date, Partner acknowledgment, resubmission, and customer reinspection history. Sync is not represented as construction QC authority.

## 27. Security / Isolation

Every route requires an API-authenticated Partner persona. Partner Admin and Foreman data is resolved by certified backend scope APIs, and direct ID guessing is handled by loading only own authorized records or by backend 403/404 responses.

## 28. E2E Tests

P7 E2E covers Partner Admin/Foreman entry, navigation visibility, safe data rendering, cross-Partner/guessed-ID behavior, mobilization separation, Notice acknowledgment, responsive Foreman views, and absence of restricted terms.

Targeted P7 result:

- `tests/e2e/partner-portal-shell.spec.ts`: 4 / 4 passed.

P1-P6 Partner regression result:

- `partner-domain-scope`, `partner-personas-permissions`, `partner-compliance-onboarding`, `partner-workforce-credentials`, `partner-agreements-work-orders-vehicles`, and `partner-mobilization-readiness`: 39 / 39 passed.

Supporting validation:

- `npm test`: 48 / 48 passed.
- `npm run typecheck`: passed.
- `npm run typecheck -w @syncos/api`: passed.
- `npm run typecheck -w @syncos/web`: passed.
- `npm run build -w @syncos/api`: passed.
- `npm run build -w @syncos/web`: passed.
- Fresh migration/seed verification: migrations 001-045, seed, and `db:verify` passed on disposable local databases.
- `npm run security:smoke`: passed.
- `npm run organization:smoke`: passed.
- `npm run project:smoke`: passed.
- `npm run work-order:smoke`: passed.
- `npm run e2e:hydration`: 27 / 27 passed.
- `npm run e2e:boundaries`: 22 / 22 passed.
- `npm run e2e:personas`: 4 / 4 passed.
- `npm run e2e:action-state-personas`: 140 / 140 passed.
- `npm run e2e:lifecycle`: 4 / 4 passed.

## 29. Global Certification

P7 is registered in `npm run e2e:certification` and regression-protected in `tests/regression.test.js`.

Final global certification:

- `npm run e2e:certification`: 604 / 604 passed.
- Exit code: 0.
- Proof P7 executed: certification output included `tests/e2e/partner-portal-shell.spec.ts` as tests 484-487, all passed.

## 30. Files Changed

- `apps/api/src/routes/partner-mobilization.controller.ts`
- `apps/web/app/partner/partner-shell.tsx`
- `apps/web/app/partner/page.tsx`
- `apps/web/app/partner/company/page.tsx`
- `apps/web/app/partner/compliance/page.tsx`
- `apps/web/app/partner/workforce/page.tsx`
- `apps/web/app/partner/workers/page.tsx`
- `apps/web/app/partner/workers/[id]/page.tsx`
- `apps/web/app/partner/crews/page.tsx`
- `apps/web/app/partner/crews/[id]/page.tsx`
- `apps/web/app/partner/agreements/page.tsx`
- `apps/web/app/partner/agreements/[id]/page.tsx`
- `apps/web/app/partner/work-orders/page.tsx`
- `apps/web/app/partner/work-orders/[id]/page.tsx`
- `apps/web/app/partner/vehicles/page.tsx`
- `apps/web/app/partner/mobilization/page.tsx`
- `apps/web/app/styles.css`
- `tests/e2e/partner-portal-shell.spec.ts`
- `tests/regression.test.js`
- `package.json`
- `docs/product/partner-portal-shell-p7.md`

## 31. Dependencies Added

None.

## 32. Explicitly Excluded P8+ Scope

No DailyProductionReport, ProductionRecord, MapAnnotation, ProductionCode, field annotation, offline mutation queue, customer QC intake, customer QC decision, correction workflow, settlement, payable, payment, PDF generation, e-signature, Customer Portal, or public website work is included.

## 33. Known Limitations

- P7 does not implement Partner-safe edit workflows beyond already certified backend actions; most views are operational read surfaces.
- P7 displays the current P5/P6 map/work-package reference, but there is not yet a canonical `MapDocument` / `MapVersion` field-production model.
- P7 does not implement offline production mutations or an IndexedDB retry queue.
- P7 does not implement Daily Production, production maps, Customer QC, settlements, payables, payments, PDFs, or e-signature.
- Frontend route hiding is convenience only; backend P1-P6 permissions remain the authorization boundary.

## 34. P7 Certification Status

CERTIFIED

## 35. GO / NO-GO for P8

GO for P8 after P7 is reviewed and committed. Do not start P8 from this uncommitted working tree.
