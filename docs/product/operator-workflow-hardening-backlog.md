# Operator Workflow Hardening Backlog

## 1. Critical Defects

No critical defects were found in this QA pass.

## 2. Workflow Blockers

### OWB-001: Add Browser Automation For Operator Click-Through QA

* Area: Global operator QA
* Severity: Medium
* Description: Route-load checks and API smoke suites pass, but the repo does not include Playwright/Puppeteer or an equivalent browser automation harness for modal-level click-through validation.
* Evidence: `package.json` has no browser automation dependency or script; route QA used HTTP GET checks.
* Recommended next step: Add a product-approved browser QA harness in a future QA tooling sprint.
* Safe to fix now? No
* Requires product decision? Yes
* Requires backend contract? No

### OWB-002: Create A Canonical Seeded Cross-Domain Demo Path

* Area: End-to-end operator workflow
* Severity: Medium
* Description: Domain smokes create valid records, but there is no single stable seeded chain from Signal through Accounting Export for repeatable physical operator demos.
* Evidence: QA used per-domain smoke-created records and route render checks.
* Recommended next step: Define demo data requirements and add seed/demo records using existing tables only after product approval.
* Safe to fix now? No
* Requires product decision? Yes
* Requires backend contract? No

## 3. Backend Contract Gaps

No backend contract gaps were found that should be fixed in this sprint.

### OWB-003: First-Class Browser Login / Persona Switching

* Area: Auth/persona testing
* Severity: Medium
* Description: Workspace shells support pasted JWTs and permission strings, while smoke scripts generate tokens. There is no first-class local operator persona switcher for System Admin, Operations, Finance, and Read-Only QA.
* Evidence: Persona QA relied on smoke-token patterns and backend permission checks.
* Recommended next step: Clarify whether a local-only persona switcher belongs in product UI, dev tooling, or test harness.
* Safe to fix now? No
* Requires product decision? Yes
* Requires backend contract? Possibly

## 4. Permission / Role Policy Gaps

### OWB-004: Document Canonical Role-to-Permission Bundles For Operator QA

* Area: Permissions
* Severity: Medium
* Description: Domain permission strings exist and are seeded, but physical QA needs named role profiles for System Admin, Operations/Project Manager, Finance/Billing, and Read-Only.
* Evidence: Smoke suites verify permission enforcement, but browser persona coverage is not role-profile based.
* Recommended next step: Produce a role matrix and then seed/test named personas if approved.
* Safe to fix now? No
* Requires product decision? Yes
* Requires backend contract? No

## 5. Seed / Demo Data Gaps

### OWB-005: Add Stable IDs Or Discoverable Fixtures For Dynamic Route QA

* Area: Route QA
* Severity: Low
* Description: Dynamic route renderability was verified with placeholder UUIDs. Record-specific detail behavior requires discoverable seeded IDs.
* Evidence: Route matrix used `00000000-0000-4000-8000-000000000001` for dynamic paths.
* Recommended next step: Add non-production demo fixture documentation or a test fixture export.
* Safe to fix now? No
* Requires product decision? Yes
* Requires backend contract? No

### OWB-006: Add Finance Demo States For Paid, Partially Paid, Unpaid, Failed, And Reconciled Scenarios

* Area: Revenue/payment verification
* Severity: Low
* Description: Finance QA would be clearer with canonical records for common operator states across invoice, cash application, collections, payment execution, bank reconciliation, and accounting export.
* Evidence: Domain smokes create these states but not as a stable operator demo dataset.
* Recommended next step: Define fixture scenarios and seed them only through existing contracts.
* Safe to fix now? No
* Requires product decision? Yes
* Requires backend contract? No

## 6. UI Clarity / Polish

### OWB-007: Add Browser-Level Assertions For Boundary Placeholder Copy

* Area: UI clarity
* Severity: Low
* Description: Product contracts require clear placeholder/boundary copy across major workspaces. Route and build checks passed, but copy presence was not asserted by browser automation.
* Evidence: No browser automation harness is available.
* Recommended next step: Add browser assertions for boundary text after QA tooling is approved.
* Safe to fix now? No
* Requires product decision? No
* Requires backend contract? No

### OWB-008: Add Global Search Browser QA

* Area: Search
* Severity: Low
* Description: Backend `/search` is smoke-tested, but global search UI behavior was not browser-click tested.
* Evidence: Search QA relied on smoke suite API calls.
* Recommended next step: Add search UI tests once browser tooling exists.
* Safe to fix now? No
* Requires product decision? No
* Requires backend contract? No

## 7. Future Integration Requests

No future integration requests should be implemented from this QA sprint.

Explicitly deferred and still forbidden until separately approved:

* QuickBooks/Sage/NetSuite/ERP integrations
* GL posting and journal creation
* Bank feeds and statement import
* Payment processor settlement import
* ACH, card payout, wire, check, payroll provider, or money movement
* Tax filing, W2, and 1099 generation
* Accounting close and treasury forecasting
