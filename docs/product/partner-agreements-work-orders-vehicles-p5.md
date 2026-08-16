# Partner Agreements, Work Orders, Rate Schedules, and Vehicle Assignments - P5

## 1. Baseline Branch and Commit

- Branch: `feat/partner-agreements-work-orders-vehicles-p5`
- Baseline HEAD: `5b2e8006faf4d119709784713e6c5f4a2b3ffe4e`

## 2. Existing Objects Reused

P5 reuses canonical `organizations`, `capacity_providers`, `contracts`, `projects`, `work_orders`, `rate_schedules`, `rate_codes`, `crews`, `workers`, `equipment`, `partner_restricted_file_objects`, events, audit logs, SyncOS users, tenant users, roles, permissions, and Organization scope enforcement.

## 3. Canonical Partner Agreement Model

The Partner master agreement is represented by `contracts` with P5 Partner extension fields for Partner Organization, capacity provider, lifecycle, effective date, and termination metadata.

## 4. Agreement Version / Amendment Model

`partner_agreement_versions` stores immutable version/amendment facts, prior-version linkage, execution status, effective date, artifact reference, and machine-readable standing commercial terms.

## 5. Authorized Representative Model

`partner_document_signatories` stores required signers for master agreements, Work Orders, and vehicle agreements. Partner signatories require explicit Partner Organization contact linkage; signer identity is not inferred from email, title, or typed name alone.

## 6. Signature / Manual Execution Model

P5 records manual signature metadata in `partner_document_signatures`. It does not implement cryptographic e-signatures, PDF generation, or e-sign vendor integration.

## 7. Effective-Date Rules

Execution requires two distinct Partner representatives, one Sync representative, verified signatures for all required roles, and a verified restricted PDF artifact. Effective date is the latest verified required signature date.

## 8. Agreement Standing Commercial Terms

Machine-readable MSA terms are stored on agreement versions: pay-when-paid, no separate Partner invoice required, three business-day payout lag after cleared customer funds, pro-rata partial payments, retainage pass-through, ten-day settlement dispute window, twelve-month workmanship warranty, and no guaranteed work.

## 9. Restricted Executed-Artifact Architecture

Executed MSA, amendment, Work Order, and vehicle agreement PDFs reuse P4 `partner_restricted_file_objects` with server-generated storage keys, SHA-256 checksums, MIME/content validation, and request-time authorization.

## 10. Agreement Access Matrix

Partner Admin may read its own safe agreement status, terms, signature status, and verified artifact. Partner Foreman cannot read MSA artifacts. Internal users require P5 review/artifact permissions.

## 11. Canonical Work Order Mapping

P5 uses canonical `work_orders` and adds Partner Organization, governing agreement version, Partner rate schedule, and execution status references.

## 12. Work Order Version / Revision Model

`partner_work_order_versions` preserves versioned commercial and scope terms. Material commercial changes are represented as new versions rather than destructive updates.

## 13. Work Order Activation Rules

Activation requires an effective governing MSA version, assigned Partner Organization, capacity provider, Project, Crew, map/work package, scope, Partner rate schedule/rate item, verified signatures, and verified executed artifact. P5 activation does not authorize mobilization or production.

## 14. Partner Rate Schedule Model

Partner rates use canonical `rate_schedules` and `rate_codes`, tied to the Partner Organization and Work Order version. The test Toledo example uses `accepted_foot` as the rate code and `feet` as the existing unit equivalent.

## 15. Rate Security / Redaction Rules

Partner Admin sees only its own Partner amount/unit when permissioned. Partner Foreman does not receive rates. Customer rates, internal rates, margin, invoice values, and other Partner rates are not returned by P5 Partner routes.

## 16. Crew Assignment Model

`partner_work_order_crew_assignments` links one active Crew to the initial Work Order model and preserves assignment history. Crew readiness remains an input/warning for later mobilization, not a production authorization.

## 17. Equipment / Vehicle Model

P5 reuses canonical `equipment`; no duplicate Partner equipment table is created.

## 18. Rental and Custody Assignment Model

`partner_vehicle_assignments` records Work Order version, Partner Organization, Crew, equipment, rental provider, Sync possession, Partner custody start, return/release, daily allocation amount, odometer/fuel state, and restricted vehicle agreement artifact.

## 19. Partner Allocation Calculation

Allocation preview includes start and end calendar dates, same-day custody as one day, requires explicit `period_end` for open assignments, rejects end-before-start, and does not create settlement or payable records.

## 20. Operator Authorization Model

`partner_vehicle_operator_authorizations` requires the Worker to belong to the same tenant, Partner Organization, Crew, and active membership, with verified unexpired driver/operator credential before authorization.

## 21. Vehicle Condition / Return Model

`partner_vehicle_condition_records` captures pre-assignment and return condition facts. Return fuel/odometer differences are recorded only; P5 creates no settlement charge.

## 22. Partner Admin Permissions

Partner Admin receives own-Organization read/sign/artifact/allocation permissions only: `partner_agreement.*` safe read/sign keys, `partner_work_order.*` safe read/sign/rate keys, and `partner_vehicle_assignment.*` safe read/sign/artifact/allocation keys.

## 23. Partner Foreman Permissions

Partner Foreman receives only `partner_work_order.foreman_summary.read` for its explicit Foreman-linked Crew, plus prior certified context permissions.

## 24. Internal Permissions

P5 adds internal management/review permissions for agreements, Work Orders, rate management, vehicle assignment, operator authorization, condition records, and restricted legal artifact review.

## 25. API / Route Map

Partner-safe routes live under `/partner-agreements/me/*` and `/partner-agreements/foreman/*`. Internal review and management routes live under `/partner-agreements/organizations/:organizationId/*`.

## 26. Status and Transition Rules

Partner users cannot set executed, effective, active, terminated, verifier, Sync signature, rate, Crew, vehicle, or Work Order status. Internal routes validate required signers/artifacts before activation.

## 27. Events and Audit

P5 uses `executeWriteAction` for writes. Events/audits include safe IDs, categories, status changes, rate references, and actor context. They exclude legal bytes, storage keys, permanent URLs, internal notes, customer/internal rates, margin, and driver-license data.

## 28. Migrations / Database Changes

Migration `044_partner_agreements_work_orders_vehicles_foundation.sql` adds version/signature/assignment tables and Partner extension fields on canonical objects. It is additive and non-destructive.

## 29. Fresh Migration Result

CERTIFIED. Fresh disposable databases were migrated through `044_partner_agreements_work_orders_vehicles_foundation.sql`, seeded, and verified:

- `syncos_partner_agreements_p5_test`: full migration chain, seed, and E2E demo seed passed.
- `syncos_partner_agreements_p5_verify`: `npm run db:verify` passed after applying migrations `001` through `044` and seed.

## 30. P4-to-P5 Upgrade Result

CERTIFIED. Disposable database `syncos_partner_agreements_p5_upgrade` was prepared at the certified P4 schema state through migration `043`, seeded with representative P1-P4 data, upgraded with migration `044`, and reseeded successfully. Existing organizations, capacity providers, Partner personas, compliance records, workforce records, crews, headshots, credentials, roles, permissions, and role mappings survived. P5 structures start empty/safe and no destructive backfill or duplicate role/permission mapping was observed.

## 31. Restricted PDF Artifact Tests

Targeted E2E covers PDF magic validation, client storage reference denial, server-generated restricted file object storage, Partner Admin own-artifact access, Partner Foreman denial, cross-tenant denial, and no permanent public URL response.

## 32. Agreement / Signature Tests

Targeted E2E covers internal MSA creation, ineligible/cross-scope denial, two distinct Partner reps, Sync signature protection, missing-artifact activation denial, effective date calculation, and Partner-safe MSA view.

## 33. Work Order / Rate Tests

Targeted E2E covers Partner create denial, internal Work Order creation, active MSA requirement, Crew binding, map/scope/rate requirements, activation, Partner-only rate response, and no customer/internal rate or margin leakage.

## 34. Vehicle / Allocation Tests

Targeted E2E covers vehicle assignment, operator credential enforcement, condition records, return records, inclusive allocation day calculation, open-period requirement, end-before-start denial, and no settlement/payable creation.

## 35. Security / Isolation Tests

Targeted P5 E2E covers unauthenticated denial, cross-tenant artifact denial, cross-Partner creation denial, Partner management denial, Foreman commercial denial, and event/audit redaction.

## 36. Global Certification Registration

`npm run e2e:certification` includes `tests/e2e/partner-agreements-work-orders-vehicles.spec.ts`, and `tests/regression.test.js` asserts registration.

## 37. Exact Validation Results

Final clean validation results:

- `npm test`: 37/37 passed.
- `npm run typecheck`: passed.
- `npm run typecheck -w @syncos/api`: passed.
- `npm run build -w @syncos/api`: passed.
- `npm run build -w @syncos/web`: passed.
- Fresh migration and seed on `syncos_partner_agreements_p5_test`: passed.
- `npm run db:verify` on `syncos_partner_agreements_p5_verify`: passed.
- P4-to-P5 upgrade validation on `syncos_partner_agreements_p5_upgrade`: passed.
- `npm run security:smoke`: passed.
- `npm run organization:smoke`: passed.
- `npm run project:smoke`: passed.
- `npm run work-order:smoke`: passed.
- `npm run smoke:sprint4 -w @syncos/api` on isolated smoke DB: passed.
- Partner P1-P5 targeted E2E command: 31/31 passed.
- `npx playwright test tests/e2e/partner-agreements-work-orders-vehicles.spec.ts`: 5/5 passed.
- `npm run e2e:hydration`: 27/27 passed.
- `npm run e2e:boundaries`: 22/22 passed.
- `npm run e2e:personas`: 4/4 passed.
- `npm run e2e:action-state-personas`: 140/140 passed.
- `npm run e2e:lifecycle`: 4/4 passed.
- `npm run e2e:certification`: 592/592 passed on fresh disposable DB `syncos_partner_agreements_p5_cert`.

The full certification command explicitly executed `tests/e2e/partner-agreements-work-orders-vehicles.spec.ts` before the prior certified Partner, route matrix, workflow, lifecycle, persona, hydration, boundary, timeline/audit, and action-state suites.

## 38. Files Changed

- `apps/api/src/modules/app.module.ts`
- `apps/api/src/security/permission.guard.ts`
- `apps/api/src/routes/partner-agreements.controller.ts`
- `packages/database/migrations/044_partner_agreements_work_orders_vehicles_foundation.sql`
- `packages/database/scripts/seed.js`
- `packages/permissions/src/index.ts`
- `tests/e2e/partner-agreements-work-orders-vehicles.spec.ts`
- `tests/partner-agreements-work-orders-vehicles.test.js`
- `tests/regression.test.js`
- `package.json`
- `docs/product/partner-agreements-work-orders-vehicles-p5.md`

## 39. Explicitly Excluded P6+ Scope

No Partner Portal UI, PDF generation, e-sign vendor, Change Order workflow beyond version foundations, Mobilization Readiness, Notice to Proceed, Daily JSA, production, QC, corrections, incidents, settlement, Contractor Payable, Priority Passport transfer, ACH payment, payroll, closeout, or Partner performance scoring is implemented.

## 40. Risks and Limitations

P5 uses manual execution metadata and uploaded synthetic/real PDFs; generated document templates and external e-sign are later scope. Vehicle allocation is a preview/fact foundation only. Crew/company compliance readiness is not promoted to mobilization authorization.

Implementation defects found and corrected during validation:

- Corrected `executeWriteAction` integration and event payload shape for P5 writes.
- Corrected Organization scope-service usage and Partner scope revalidation.
- Corrected date serialization and final-signature effective-date normalization.
- Corrected inclusive vehicle allocation date parsing and end-before-start handling.
- Corrected P5 event/audit redaction regression test to inspect P5 event JSON keys precisely instead of overbroad substring matches against unrelated pre-existing events.

## 41. P5 Certification Status

CERTIFIED

## 42. GO / NO-GO Recommendation for P6

GO after P5 is committed. Do not begin P6 from an uncommitted P5 working tree.
