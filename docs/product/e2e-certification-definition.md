# E2E Certification Definition

## Definition

SyncOS is E2E-certified when a clean CI run can provision a fresh database, seed the canonical demo path, run all browser-click workflows across required personas, verify permissions, timelines, audits, and boundary assertions, capture required artifacts, and finish with no critical or workflow-blocking failures.

Route-load QA alone is not E2E certification. API smoke success alone is not E2E certification. Manual physical QA alone is not CI certification.

## Certification Requirements

### 1. Route Certification

* 100% of required routes load.
* ID routes use seeded records.
* No dead links from primary tables.
* Missing seeded object makes a must-test route not certified.
* Redirect routes must redirect to expected safe targets.

### 2. Workflow Certification

Required workflow groups:

* Growth to Opportunity
* Opportunity to Project
* Project to QC
* QC to Revenue Cycle
* Settlement to Contractor Payable
* Payroll to Payment Execution
* Payment Execution to Bank Reconciliation
* Accounting Export preparation

Each workflow must complete through browser clicks, not direct API-only calls.

### 3. Permission Certification

Minimum personas:

* System Admin
* Operations / Project Manager
* Finance / Billing User
* Read-Only Auditor

Full personas:

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

Certification must prove:

* authorized actions are available
* unauthorized UI actions are hidden or disabled
* direct unauthorized backend attempts are denied
* audit access is controlled
* tenant isolation is preserved

### 4. Boundary Certification

Every forbidden downstream assertion must pass.

Examples:

* Payment Execution does not move money.
* Bank Reconciliation does not create cash receipts or payment applications.
* Accounting Export does not call QuickBooks, create GL entries, or mutate source records.

### 5. Timeline / Audit Certification

* Timeline events appear after lifecycle actions.
* Event actor, timestamp, object type, and action are understandable.
* Audit summary is visible to authorized personas.
* Audit summary is hidden or denied to unauthorized personas.
* Audit payload is not leaked through UI errors.

### 6. Data Truthfulness Certification

* No fake UI-only data for backend-owned fields.
* Unsupported fields show honest fallback such as "Not captured yet" or "Source detail not available".
* Related context uses real backend reads or clearly displays unavailable state.
* UI must not mask backend contract gaps with invented values.

### 7. CI Certification

* Fresh database is created per run.
* Deterministic seed runs.
* API, worker, and web builds pass.
* Release validation passes.
* Headless browser test suite passes.
* Artifacts are captured according to policy.
* Database is dropped or isolated after run.

### 8. Artifact Certification

Required artifacts:

* screenshots
* videos on failure for PR runs
* certification videos for nightly/release runs
* traces on retry/failure
* test report
* route matrix result
* boundary assertion report

## Certification Tiers

### Route-Load Certified

All required routes load without 500s. This is not enough for E2E certification.

### Critical-Path Browser Certified

Minimum personas and critical workflow groups pass in browser automation. Suitable for PR gating after stabilization.

### Full Browser E2E Certified

All full personas, workflows, modals, route matrix, boundary assertions, timeline/audit checks, and required artifacts pass.

### Release Certified

Full Browser E2E Certified plus release validation. Required before beginning external integration work.

## Failure Severity

Critical failure:

* app crash
* route 500 on must-test route
* tenant leak
* unauthorized audit leak
* forbidden downstream creation
* external integration call
* payment/bank/tax/accounting mutation outside contract

Workflow-blocking failure:

* canonical path cannot proceed
* required modal cannot submit valid payload
* success state does not refresh
* required seeded record missing
* timeline/audit endpoint unusable for certified persona

Warning:

* optional persona not yet in PR tier
* non-critical screenshot missing in PR run
* copy clarity issue that does not alter behavior

## GO / NO-GO Threshold

Recommended threshold:

* GO for PR Critical Path: 100% critical routes/workflows/boundaries pass, no critical failures, no workflow blockers.
* GO for Full Certification: all must-test routes, workflows, personas, modals, boundaries, timeline/audit checks, and artifacts pass.
* NO-GO: any critical failure, any workflow blocker, any forbidden downstream creation, any unauthorized data/audit leak, any missing seeded object for a must-test route.

Product must confirm the official score threshold. Recommended readiness score threshold is 90/100 with zero critical/workflow-blocking failures.
