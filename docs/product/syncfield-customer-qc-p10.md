# SyncField Customer QC P10

## 1. Baseline Branch / Commit

- Branch: `feat/syncfield-customer-qc-p10`
- Baseline: `fde24526946d5b8b0486b34d8be6122ce7531ed5`

## 2. Existing QC Capability Audit

Existing `qc_reviews` is treated as PARTIALLY SUPPORTED legacy/internal review capability and is not reused as the Customer QC authority record. Its semantics can imply internal approval and includes an approved quantity field, so P10 introduces explicit Customer QC cycles and decisions instead of overloading it.

## 3. Customer-QC Authority Model

Customer or designated upstream QC authority is the construction QC authority. Sync records, relays, and audits the received decision.

## 4. QC Authority Configuration

P10 adds configurable `qc_authority_organization_id` at Project and Work Order level. Work Order overrides Project; Project falls back to customer organization.

## 5. Administrative Completeness Review

Daily reports have `completeness_status`: `not_reviewed`, `complete`, `incomplete`, `returned`. This is Sync administrative completeness only, not technical acceptance.

## 6. CustomerQcCycle Model

`customer_qc_cycles` references the exact tenant, Project, Work Order, submitted Daily Report, submitted revision, Partner, Crew, QC authority organization, source, and cycle number.

## 7. CustomerQcDecision Model

`customer_qc_decisions` records per-ProductionRecord decisions: `accepted`, `partially_accepted`, `correction_required`, `rejected`.

## 8. Reported vs Customer-Accepted Quantity

P9 `quantity_submitted` remains immutable. P10 stores `customer_accepted_quantity` separately on the Customer decision.

## 9. Customer Decision Source

Supported source types include email, customer portal, customer report, spreadsheet, field QC report, API, and manual recorded-from-customer.

## 10. Customer Evidence

P10 adds `customer_qc_evidence_links` using restricted file references. Public URLs and storage keys are not exposed.

## 11. Decision Versioning / History

Prior cycles and decisions are preserved. Current outcome is resolved from current decisions inside exact cycles.

## 12. Report-Level Outcome

Report outcome is derived from ProductionRecord decisions: pending, accepted, partially accepted, correction required, or rejected.

## 13. Partner Correction Model

`production_corrections` links exact Customer decisions to Partner-safe correction instructions, due dates, correction type, and allowed fields.

## 14. Correction Types

P10 supports quantity, production code, location, asset identifier, route endpoint, missing note, missing photo, workmanship, rework, and other.

## 15. Correction Status

Statuses are open, acknowledged, in progress, resubmitted, awaiting Customer reinspection, resolved, and cancelled.

## 16. Controlled Correction Scope

Partner correction submission validates fields against `allowed_fields`. Unrelated field edits are rejected.

## 17. Correction Revision

Revision 1 remains immutable. Correction resubmission creates the next Daily Production report revision snapshot.

## 18. Map/Annotation Correction History

P10 does not destructively move Revision 1 annotations. Corrected values are captured in the correction revision snapshot for Customer reinspection.

## 19. Partner Resubmission

Partner Foreman may resubmit only own Crew corrections. Resubmission creates a new revision and advances status to awaiting Customer reinspection.

## 20. Customer Reinspection

Resubmission creates a new Customer QC cycle tied to the corrected revision. Prior cycles remain intact.

## 21. Multiple QC Cycles

Cycle numbers are monotonic per Daily Report and reference exact report revisions.

## 22. Final Customer-Accepted Production

Customer accepted quantity and decision events are exposed through read/event boundaries for future downstream eligibility. No financial rows are created.

## 23. Downstream Domain Interface

Events include safe identifiers, reported quantity, Customer accepted quantity, unit, QC cycle, and QC authority organization. Rates and storage keys are excluded.

## 24. Internal Sync Workspace

P10 backend supports completeness queue, completeness review, Customer cycle creation, and Customer decision recording.

## 25. Partner Admin View

Partner Admin can view own Customer QC outcomes and correction history through the Partner Portal Customer QC page.

## 26. Partner Foreman View

Partner Foreman can view own Crew corrections through the Corrections page and resubmit only controlled correction fields.

## 27. Mobile Correction UX

Foreman correction status uses the existing P7-P9 field card layout and large touch controls.

## 28. Permissions

P10 adds internal `customer_qc.*` permissions and Partner-safe `partner_customer_qc.*` / `partner_correction.*` permissions.

## 29. Security / Isolation

All P10 routes derive tenant and Partner scope server-side. Partner users cannot record Customer decisions or broaden correction scope.

## 30. Events

Events include completeness confirmed/returned, Customer QC cycle created, decision recorded, production customer accepted/partial/correction/rejected, and Partner correction resubmitted.

## 31. Audit

P10 writes through `executeWriteAction`, preserving actor, tenant, entity, safe state, and event/audit boundaries.

## 32. Idempotency

Cycle, decision, and resubmission writes support client mutation IDs where applicable.

## 33. Financial Boundary

P10 creates zero Billable, invoice, Settlement, Contractor Payable, Payment, cash receipt, or collections records.

## 34. Migration

Migration `048_syncfield_customer_qc_foundation.sql` is additive and history-preserving.

## 35. Fresh DB Result

PASS. A disposable fresh database migrated through `048_syncfield_customer_qc_foundation.sql`, seeded successfully, and `db:verify` passed on an empty verification database through P10.

## 36. P9→P10 Upgrade Result

PASS. A representative P9 database migrated through `047_syncfield_daily_production_foundation.sql`, seeded, then upgraded with `048_syncfield_customer_qc_foundation.sql`; P9 production, map/JSA, submitted revision, and seed idempotency survived.

## 37. P9 Offline Regression

P10 does not modify the P9 IndexedDB queue or replay algorithm.

## 38. P1–P9 Regression Result

PASS. P1-P9 targeted Partner/SyncField E2E, P9 offline replay regression, hydration, boundaries, personas, action-state personas, lifecycle, and smoke suites passed after P10 changes.

## 39. P10 Targeted Tests

PASS: 10 / 10. `tests/e2e/syncfield-customer-qc.spec.ts` covers completeness review, Customer decisions, partial acceptance, correction relay, Partner views, resubmission, reinspection cycle, P9 offline replay regression, and financial boundary.

## 40. Global Certification

PASS: 626 / 626. P10 is registered in `npm run e2e:certification`; the global run executed `tests/e2e/syncfield-customer-qc.spec.ts` at positions 591-600 and exited 0.

## 41. Files Changed

P10 changed the SyncField API, Partner portal Customer QC/correction views, permission catalog/guard, seed permissions, regression registration, P10 migration, P10 E2E coverage, P8 map/JSA certification proof, package certification registration, and this product document.

## 42. Dependencies Added

None.

## 43. Known Limitations

Source evidence upload UI is not expanded beyond restricted-file link schema. Correction resubmission stores corrected values in a revision snapshot; full correction editing of canonical ProductionRecord geometry is deferred. The P8 certification test now proves original PDF preservation through MapVersion checksum and the authorized byte endpoint instead of assuming the test runner can read the API process's private filesystem root.

## 44. Explicit P11+ Exclusions

Customer invoicing, billing eligibility creation, Billable rows, Settlement, Contractor Payable, Payment, collections, retainage release, pay-when-paid, QuickBooks, Customer Portal login, automated email ingestion, AI QC, computer vision, automatic footage acceptance, GIS, and P11+ are excluded.

## 45. Customer-QC Authority Boundary Confirmation

Sync is the recorder and relay of Customer QC decisions. Sync is not the construction QC authority.

## 46. P10 Certification

CERTIFIED

## 47. GO / NO-GO for P11

NO-GO until P10 is committed.
