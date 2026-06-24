# E2E Certification Gap Backlog

## 1. Missing Modal Coverage

| ID | Title | Area | Severity | Description | Evidence | Recommended next step | Blocks full E2E certification? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-MODAL-001 | Complete full modal matrix certification | Lifecycle modals | High | Only representative high-risk modals are covered in this sprint. | `tests/e2e/lifecycle/high-risk-modals.spec.ts` covers a subset. | Add browser submit/validation tests for every modal listed in `e2e-route-modal-boundary-matrix.md`. | Yes |
| E2E-MODAL-002 | Add deterministic action-created records | Lifecycle modals | Medium | Some modal submissions need safe pre-action record states to avoid mutating canonical checkpoints. | Current tests primarily open/inspect modals. | Extend seed with action-specific copies using existing schema only. | Yes |
| E2E-MODAL-003 | Add Submit Execution modal checkpoint | Payment Execution | High | The canonical payment batch is already `executed_later`, so Submit Execution is correctly disabled and cannot be certified against that record. | `tests/e2e/fixtures/modal-matrix.ts` covers Mark Executed but not Submit Execution. | Add a deterministic payment batch checkpoint in a backend-valid pre-execution state. | Yes |

## 2. Missing Persona Coverage

| ID | Title | Area | Severity | Description | Evidence | Recommended next step | Blocks full E2E certification? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-PERSONA-001 | Certify all 10 personas | Permissions | High | Minimum four personas are covered; all full certification personas are not deeply tested. | `tests/e2e/personas/minimum-personas.spec.ts`. | Add grouped tests for Growth, Field Supervisor, QC Reviewer, Collections, Payables/Payroll, and Accounting Manager. | Yes |

## 3. Missing Boundary Coverage

| ID | Title | Area | Severity | Description | Evidence | Recommended next step | Blocks full E2E certification? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-BOUNDARY-001 | Add action-level forbidden count assertions for every modal | Boundary safety | High | Current expanded tests include route inspection and source snapshots, not every lifecycle modal submit. | `tests/e2e/boundaries`. | Wrap every deterministic browser action with before/after count and source snapshots. | Yes |

## 4. Missing Timeline/Audit Coverage

| ID | Title | Area | Severity | Description | Evidence | Recommended next step | Blocks full E2E certification? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-AUDIT-001 | Expand audit matrix across every major module | Timeline/audit | Medium | Representative audit checks exist for finance/verification/accounting only. | `tests/e2e/timeline-audit/representative-events.spec.ts`. | Add audit allowed/denied checks for growth, coverage, execution, revenue, cost, labor, bank, and accounting domains. | Yes |
| E2E-TIME-001 | Seed or action-create lifecycle event history | Timeline/audit | High | Current deterministic seed opens timeline endpoints but does not guarantee representative lifecycle event rows for every checkpoint. | Timeline tests assert endpoint readability, not event names after browser actions. | Create safe action-specific records and trigger lifecycle actions in browser before asserting event names. | Yes |

## 5. Seed / Demo Data Gaps

| ID | Title | Area | Severity | Description | Evidence | Recommended next step | Blocks full E2E certification? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-SEED-001 | Add action-specific checkpoint copies | Seed data | Medium | Canonical seeded records should remain stable; modal submission tests need disposable records. | Current seed has one canonical path and major checkpoints. | Add deterministic E2E-action records in safe pre-action states. | No |

## 6. Selector / Testability Gaps

| ID | Title | Area | Severity | Description | Evidence | Recommended next step | Blocks full E2E certification? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-SELECTOR-001 | Add stable data-testid selectors where accessible labels are insufficient | Testability | Medium | Current tests use roles, labels, and text. Some complex tables/modals may require stable selectors later. | No production selectors added in this sprint. | Add minimal test IDs only where accessible selectors are unstable. | No |

## 7. CI Artifact Gaps

| ID | Title | Area | Severity | Description | Evidence | Recommended next step | Blocks full E2E certification? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-CI-001 | Add actual CI workflow wiring | CI | Medium | Runbooks exist, but no CI YAML is created. | `docs/product/e2e-ci-runbook.md`. | Add CI workflow after Product approves browser E2E as a CI gate. | No |

## 8. Future Integration Gates

| ID | Title | Area | Severity | Description | Evidence | Recommended next step | Blocks full E2E certification? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-GATE-001 | Require full E2E certification before external integrations | Integration gate | High | Current suite does not certify external integration boundaries beyond placeholders. | Product guardrails. | Keep QuickBooks, ERP, bank feeds, payment processors, payroll providers, tax, GL, and accounting close blocked until full certification passes. | Yes |
