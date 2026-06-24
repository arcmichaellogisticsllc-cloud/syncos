# Browser E2E Seeded Demo Rules Clarification

## 1. Current Test / QA Inventory

Current validated commit: `dedda819a0ed51ba179c1feba5b2b6777577c12d`.

| Area | Current state | Classification | Notes |
| --- | --- | --- | --- |
| Root `package.json` scripts | Typecheck, build, test, db migrate/seed/verify, release validation, security and domain smoke scripts are present. | Supported | No browser E2E script exists. |
| `apps/api/package.json` scripts | API build/start/typecheck and all smoke script entries through accounting export are present. | Supported | API smoke layer is mature, but not browser driven. |
| Existing smoke scripts | Domain smoke scripts cover permissions, tenant isolation, write events/audit, timelines, search, and boundary checks. | Supported | Browser interaction and screenshots are missing. |
| Release validation | `scripts/release-validation.sh` builds API/worker/web, runs unit tests, verifies migrations, starts API, and runs all smokes. | Supported | Does not start web or run browser tests. |
| Regression tests | `tests/regression.test.js` verifies script wiring, route/permission coverage, migration order, write-action helper, and forbidden artifacts. | Supported | No browser route/modal tests. |
| Browser dependencies | No Playwright, Puppeteer, Cypress, or browser automation dependency found. | Missing | Do not install in this clarification sprint. |
| Browser test folders | No browser E2E folder found. | Missing | Future coding sprint only. |
| Route-load scripts | No committed route-load script found; physical QA used an ad hoc local HTTP probe. | Partially supported | Route-load method is documented, not repo-owned. |
| Seed scripts | `packages/database/scripts/seed.js` seeds Jackson Telcom baseline roles/users/permissions. | Partially supported | No Cedar Ridge canonical demo seed. |
| DB verification | `verify-migrations.js` requires an empty database, runs migrations and seed, and checks core tables. | Supported | Future E2E must use fresh DB per run. |
| Permissions seed | Large permission list is seeded, including payment execution, bank reconciliation, and accounting export families. | Supported | Named E2E persona bundles are not confirmed. |
| Test users | Seed creates an admin user and roles, but no confirmed 10-persona E2E matrix. | Partially supported | Persona seed is a future requirement. |
| Auth/token pattern | Smokes create HMAC JWTs from `AUTH_JWT_SECRET` and use limited tokens for denial checks. | Supported | Browser storage-state strategy is missing. |
| Physical QA report | `physical-operator-qa-report.md` documents 93/93 route-load pass and browser automation gap. | Supported | Explicitly not E2E certified. |
| Hardening backlog | `operator-workflow-hardening-backlog.md` lists browser automation, demo seed, persona, and search UI gaps. | Supported | This clarification turns those gaps into policy. |
| Physical test docs | Domain physical test docs exist for major workspaces. | Supported | Not executable browser specs. |
| Workspace product contracts | Workspace contracts exist for current governed domains. | Supported | Browser selector policy is not yet documented. |

Implementation options:

* Option A: Manual-only checklist. Useful for operator review, but not repeatable CI certification.
* Option B: Playwright browser automation. Strong fit for multi-browser, storage state, traces, videos, screenshots, and CI.
* Option C: Puppeteer browser automation. Capable for Chromium-only testing, but weaker for multi-browser certification and trace ergonomics.
* Option D: Hybrid deterministic seeded demo path + Playwright automation + manual certification checklist.

Recommendation: use Hybrid Option D. Manual QA remains useful, but SyncOS should not be called browser E2E-certified until deterministic seed, persona login, browser click paths, backend assertions, and CI artifacts all pass.

## 2. Browser E2E Definition

Browser E2E is a deterministic browser-driven certification process that provisions a fresh database, seeds a canonical operator demo path, logs in as named personas, clicks through required workflows, verifies UI state, verifies backend side effects, asserts forbidden downstream creations did not occur, captures screenshots/videos/traces, and runs in CI.

Browser E2E represents:

* route-load certification
* click-through workflow certification
* persona/permission certification
* lifecycle modal certification
* boundary regression certification
* timeline/audit certification
* seeded data certification
* CI artifact certification

Browser E2E does not represent:

* external integration certification
* QuickBooks certification
* bank-feed certification
* ACH/payment processing certification
* payroll provider certification
* tax filing certification
* accounting close certification
* performance/load testing
* security penetration testing
* full accessibility audit unless future scope

## 3. Core Certification Principle

SyncOS should not be called E2E-certified because routes load.

SyncOS should be called E2E-certified only when the browser can complete canonical operator workflows using seeded data and required personas while proving permissions, timelines, audits, and boundary assertions.

Route-load QA is necessary but not sufficient. Smoke tests are necessary but not sufficient. Manual operator QA is useful but not sufficient for CI certification. Browser E2E certification requires repeatability.

Core rule:

Fresh DB -> Deterministic Seed -> Persona Login -> Browser Click Path -> Backend Assertion -> Artifact Capture -> CI Pass

## 4. Canonical Demo Story

The default proposed story is **Cedar Ridge Fiber Expansion**.

ARC SyncOS Demo Tenant discovers a Cedar Ridge fiber opportunity. Cedar Ridge Utility Authority is the customer. Cedar Ridge Broadband Office is the public/program stakeholder. Blue Splice Fiber Services is the capacity provider/subcontractor. Blue Splice Crew A performs field work. Alex Rivera is a worker.

The work moves from signal to opportunity to coverage to project to work order. Production is submitted. QC approves part or all of production. Approved QC becomes billable. Billable becomes settlement. Settlement becomes invoice. Invoice becomes cash application. Remaining balance creates collections follow-up. Settlement also creates contractor payable. Payroll run is prepared for worker earnings. Contractor payable and payroll become payment execution instructions. Payment execution is matched in bank reconciliation. Bank reconciliation and financial facts are prepared for accounting export.

Canonical object names:

* Signal: Cedar Ridge Fiber Expansion RFP Discovered
* Organization: Cedar Ridge Utility Authority
* Contact: Dana Lewis
* Relationship Map: Cedar Ridge Access Map
* Opportunity Candidate: Cedar Ridge Phase 1 Candidate
* Opportunity: Cedar Ridge Phase 1 Fiber Build
* Coverage Plan: Cedar Ridge Phase 1 Coverage Plan
* Project Handoff: Cedar Ridge Phase 1 Handoff
* Project: Cedar Ridge Phase 1 Fiber Build
* Work Order: WO-CR-001 Underground Fiber Segment A
* Production Record: PRD-CR-001 Daily Production Segment A
* QC Review: QC-CR-001 Internal QC Segment A
* Billable Item: BILL-CR-001 Segment A Billable
* Settlement: SET-CR-001 Cedar Ridge Settlement
* Invoice: INV-CR-001 Cedar Ridge Invoice
* Cash Receipt: RCPT-CR-001 Cedar Ridge Partial Payment
* Collection Case: COLL-CR-001 Cedar Ridge Balance Follow-Up
* Contractor Payable: PAY-CR-001 Blue Splice Payable
* Payroll Run: PR-CR-001 Weekly Payroll
* Payment Batch: PB-CR-001 Payment Batch
* Bank Account: ARC Operating Account
* Bank Transaction: BTX-CR-001 Manual Bank Clearing
* Accounting Export Batch: AEX-CR-001 Accounting Export

See `canonical-demo-path.md` for the step-by-step object path.

## 5. Seeded Data Requirements

Required seed data categories:

* Tenant: ARC SyncOS Demo Tenant with deterministic identifier and clean tenant isolation.
* Territories: Cedar Ridge North and Cedar Ridge South.
* Organizations: Cedar Ridge Utility Authority, Cedar Ridge Broadband Office, Blue Splice Fiber Services, ARC SyncOS Demo Operations.
* Contacts: Dana Lewis, Morgan Ellis, Luis Moreno.
* Capacity/crew/worker: Blue Splice Fiber Services, Blue Splice Crew A, Alex Rivera, and optional equipment only if existing schema supports it.
* Financial basics: USD, net_30, demo customer rate 10.00 per foot, demo contractor rate 7.00 per foot, demo payroll rate 30.00 per hour, ARC Operating Account with masked account only.
* Checkpoint records: every major module must have a deterministic entry point record.

Checkpoint records are required for Signal, Organization, Contact, Relationship Map, Opportunity Candidate, Opportunity, Coverage Plan, Project Handoff, Project, Work Order, Production Record, QC Review, Billable Item, Settlement, Invoice, Cash Receipt, Payment Application, Collection Case, Contractor Payable, Payroll Run, Payment Batch, Bank Transaction, Reconciliation Match, and Accounting Export Batch.

Each checkpoint must document object type, deterministic name, minimum valid state, required related objects, user/persona able to operate it, and lifecycle action available for test.

See `e2e-seed-data-requirements.md`.

## 6. Data Reset Strategy

Default CI strategy:

* create fresh database per run
* run migrations/db verify
* seed canonical E2E demo data
* run tests
* drop database

Recommended database naming: `syncos_e2e_<run_id>`.

Required local reset command pattern:

```bash
dropdb syncos_operator_demo --if-exists
createdb syncos_operator_demo
DATABASE_URL=postgres:///syncos_operator_demo npm run db:verify
DATABASE_URL=postgres:///syncos_operator_demo npm run seed:e2e-demo
```

`seed:e2e-demo` does not exist today and is a required future coding sprint deliverable.

Snapshot option:

* first source of truth is the seed script
* optional DB snapshot can be restored for speed after seed stabilizes
* snapshot must be regenerated from seed, not manually maintained

Run-id namespacing:

* every test-created object should include E2E run id
* canonical records should be deterministic
* tests should avoid mutating shared seed records unless a test-specific copy is created

## 7. Required Personas

Minimum certification personas:

* System Admin
* Operations / Project Manager
* Finance / Billing User
* Read-Only Auditor

Full certification personas:

* System Admin
* Growth Operator
* Operations / Project Manager
* Field Supervisor
* QC Reviewer
* Billing / Finance User
* Collections Specialist
* Payables / Payroll Admin
* Accounting Manager
* Read-Only Auditor

For each persona, the future seed/test harness must document purpose, allowed workspace access, denied workspace access, permission families, expected UI behavior, expected backend denial behavior, audit visibility expectation, and timeline visibility expectation.

See `e2e-persona-permission-matrix.md`.

## 8. Persona Permission Matrix Summary

System Admin has all permissions.

Growth Operator owns growth/intelligence through early opportunity review and must not have finance, payroll, bank reconciliation, or accounting export write permissions.

Operations / Project Manager owns coverage, handoff, project, work order, and operational production read/submit workflows.

Field Supervisor owns work order visibility and production creation/submission.

QC Reviewer owns production evidence review and QC lifecycle.

Billing / Finance User owns billable, settlement, invoice, cash application, and collections.

Collections Specialist owns collection cases/actions and read context for invoice/cash/payment application.

Payables / Payroll Admin owns contractor payables, payroll, and early payment batch/item preparation without execution approval unless explicitly granted.

Accounting Manager owns bank reconciliation and accounting export.

Read-Only Auditor owns read/timeline and optionally audit-only test variants.

Current gaps: named E2E personas and exact role bundles are not confirmed in seed. This requires product confirmation.

## 9. Canonical Browser Workflow Groups

Group 1: Growth to Opportunity.

* Persona: Growth Operator, System Admin for administrative fallback.
* Starts with seeded Signal and checkpoint Organization/Contact/Relationship Map.
* Certifies signal evidence/verify, organization/contact/relationship map, candidate qualification/conversion, and opportunity submit/approve.

Group 2: Opportunity to Project.

* Persona: Operations / Project Manager.
* Certifies coverage plan requirement/source/gap/approve, handoff approval/create project, project readiness/start/hold/release.

Group 3: Execution.

* Persona: Operations / Project Manager, Field Supervisor, QC Reviewer.
* Certifies work order lifecycle, production evidence/submission/review/approval, and QC review/correction.

Group 4: Revenue.

* Persona: Billing / Finance User and Collections Specialist.
* Certifies billable ready, settlement approval, invoice lifecycle, cash receipt/payment application, and collections case/action.

Group 5: Cost and Labor.

* Persona: Payables / Payroll Admin and Finance approval variant if confirmed.
* Certifies contractor payable, payroll, and payment batch preparation/scheduling/status-only execution.

Group 6: Verification and Accounting Interface.

* Persona: Accounting Manager.
* Certifies bank account, manual bank transaction, debit/credit matches, reconciliation match approval, accounting export generation/review/submit/accept status.

Each group must include required click sequence, UI assertions, backend side-effect assertions, screenshots, and forbidden downstream assertions.

## 10. Route Coverage Matrix

The required route matrix is defined in `e2e-route-modal-boundary-matrix.md`.

Rules:

* 100% of must-test routes must load.
* ID routes must use seeded records, not placeholder UUIDs, before E2E certification.
* Missing seeded object makes a route not certified, not merely not tested, if the route is in must-test scope.
* Primary table links must point to existing routes or render plain text where a route is intentionally absent.

## 11. Modal Coverage Matrix

The required modal/action matrix is defined in `e2e-route-modal-boundary-matrix.md`.

Each modal/action must document route, persona, required fields, optional fields, backend route expected, success assertion, failure assertion, forbidden creation assertion, and screenshot requirement.

## 12. Forbidden Downstream Creation Matrix

Browser E2E must include backend-count assertions for intended and forbidden changes.

Required helper pattern:

* capture table/object counts before action
* perform browser action
* capture counts after action
* assert only intended object counts changed
* assert source balances/statuses unchanged unless action explicitly allows mutation

Forbidden assertions are defined in `e2e-route-modal-boundary-matrix.md` and must protect all boundaries from Work Order through Accounting Export.

Open confirmation: boundary assertions should use direct DB helpers in CI unless product requires API count endpoints.

## 13. Required Screenshots / Videos / Traces

Artifact requirements are defined in `e2e-ci-artifact-requirements.md`.

Minimum screenshots per major domain:

* list or queue
* create form
* detail header
* scorecard / summary
* primary action modal
* timeline tab
* audit authorized
* boundary placeholder

Required E2E screenshots:

* `E2E-A-signal-to-opportunity.png`
* `E2E-B-opportunity-to-project.png`
* `E2E-C-project-to-qc.png`
* `E2E-D-qc-to-cash-application.png`
* `E2E-E-settlement-to-payment-execution.png`
* `E2E-F-payroll-to-payment-execution.png`
* `E2E-G-bank-reconciliation.png`
* `E2E-H-accounting-export.png`

## 14. CI Browser Test Rules

Recommended CI job order:

1. Checkout repo.
2. Install dependencies.
3. Start Postgres service.
4. Create fresh database.
5. Run `db:verify`.
6. Run `seed:e2e-demo` if implemented.
7. Build API, worker, web.
8. Start API server.
9. Start web server.
10. Wait for health endpoints.
11. Run smoke tests.
12. Run browser E2E tests.
13. Upload screenshots/videos/traces.
14. Drop database.

Recommended command structure is documented in `e2e-ci-artifact-requirements.md`. Exact commands must be adjusted in the future coding sprint based on actual start scripts and selected browser harness.

CI tiers:

* PR Critical Path: Chromium only, headless, critical workflows only, artifacts on failure.
* Nightly Certification: full canonical path, all personas, full boundary assertions, screenshots/videos/traces.
* Release Certification: full suite required before external integrations.

## 15. Browser Tool Recommendation

Recommended tool: Playwright.

Rationale:

* multi-browser support
* tracing
* video/screenshots
* strong CI support
* reliable selectors
* API request helpers
* storage state support for personas

Puppeteer is acceptable for Chromium-only checks but weaker for full certification. Cypress is not recommended for this repo unless product explicitly prefers it. Manual-only remains insufficient for CI certification.

Tool installation is future coding sprint scope, not this clarification sprint.

## 16. Selectors and Testability Rules

Future selector policy:

* use `data-testid` for stable E2E selectors
* route containers should have page-level `data-testid`
* primary buttons should have action `data-testid`
* modals should have modal `data-testid`
* form fields should have label and test id
* tabs should be selectable by role or `data-testid`
* table rows should expose object id/name safely
* avoid brittle CSS selectors
* prefer accessible roles when stable

Required naming convention:

```text
data-testid="page-<domain>-<view>"
data-testid="action-<domain>-<verb>"
data-testid="modal-<domain>-<action>"
data-testid="field-<domain>-<field>"
data-testid="table-<domain>"
data-testid="row-<domain>-<id-or-slug>"
data-testid="tab-<domain>-<tabname>"
```

No selectors are added in this clarification sprint.

## 17. Persona Authentication Strategy

Options:

* Option A: UI login for every persona.
* Option B: API-created auth token and storage state.
* Option C: Seeded session cookie.
* Option D: Hybrid: login once per persona, save browser storage state.

Recommendation: Hybrid Option D.

Future harness should create runtime storage state files:

* `.auth/system-admin.json`
* `.auth/growth-operator.json`
* `.auth/ops-manager.json`
* `.auth/field-supervisor.json`
* `.auth/qc-reviewer.json`
* `.auth/finance-user.json`
* `.auth/collections-specialist.json`
* `.auth/payables-payroll-admin.json`
* `.auth/accounting-manager.json`
* `.auth/read-only-auditor.json`

Do not commit sensitive tokens. Generated storage state must be a CI/runtime artifact, not source-controlled secret.

Open ambiguity: the current app often uses pasted JWT and permissions in workspace shells. Product must confirm whether E2E should use real login, token injection, or a test-only auth setup.

## 18. E2E Certification Definition

Formal certification is defined in `e2e-certification-definition.md`.

Short definition: SyncOS is E2E-certified when a clean CI run can provision a fresh database, seed the canonical demo path, run all browser-click workflows across required personas, verify permissions, timelines, audits, and boundary assertions, capture required artifacts, and finish with no critical or workflow-blocking failures.

## 19. Next Coding Sprint Recommendation

Recommended next sprint: Browser E2E Seed + Test Harness Foundation.

Scope:

* add Playwright or approved browser harness
* add `seed:e2e-demo`
* add deterministic canonical demo records
* add seeded personas
* add auth/storage state setup
* add route matrix test
* add critical-path workflow test skeletons
* add boundary assertion helper
* add screenshot/video/trace config
* add CI script wiring
* add docs for running locally

Do not build:

* external integrations
* new product features
* migrations beyond seed support unless explicitly required and approved
* new business objects
* new financial workflow states

## 20. Required Product Confirmations

Recommended answers are included for review.

1. Is Cedar Ridge Fiber Expansion the approved canonical demo story? Recommended: yes.
2. Should Playwright be the browser automation tool? Recommended: yes.
3. Should `seed:e2e-demo` be the canonical seed command? Recommended: yes.
4. Should E2E use fresh database per run? Recommended: yes.
5. Should checkpoint seed records exist for every major module? Recommended: yes.
6. Should all 10 personas be created in seed? Recommended: yes eventually; minimum four for first PR gate.
7. Should PR E2E run only critical path first? Recommended: yes.
8. Should nightly E2E run full persona matrix? Recommended: yes.
9. Should videos be retained only on failure for PR? Recommended: yes.
10. Should traces be retained on retry/failure? Recommended: yes.
11. Should `data-testid` selectors be required before full certification? Recommended: yes.
12. Should boundary assertions use direct DB test helpers or API count endpoints? Recommended: direct DB helpers in CI.
13. Should source mutation assertions be included for Accounting Export and Bank Reconciliation? Recommended: yes.
14. Should manual physical QA remain required before external integration releases? Recommended: yes.
15. Should missing seeded object make a route not certified rather than not tested? Recommended: yes.
16. Should external integrations require E2E certification before starting? Recommended: yes.
17. Should demo seed include both revenue-side and cost-side branches? Recommended: yes.
18. Should payroll and contractor payable both feed payment execution in certification? Recommended: yes.
19. Should accounting export include all supported source object types in certification? Recommended: yes where existing backend supports them safely.
20. What is the official GO / NO-GO threshold for E2E certification? Recommended: GO requires 100% critical route/workflow/boundary pass, no critical or workflow-blocking failures, and at least 90/100 readiness score.

## 21. Validation

Allowed validation for this clarification:

* `git status --short`
* inspect package scripts
* inspect existing tests/smokes
* inspect seed scripts
* inspect permissions seed
* inspect physical QA report
* inspect route/workspace docs
* `git diff --check`

No application code, migrations, routes, UI, package changes, dependency installs, test files, seed scripts, or CI workflow files are created in this sprint.

## GO / NO-GO Recommendation

GO for product review of these rules and confirmations.

NO-GO for implementing Browser E2E until the required confirmations are approved, especially Playwright selection, seed command, persona matrix, boundary assertion method, and certification threshold.
