# SyncOS scope preservation reconciliation

Baseline: pre-UI repair `eadeab57364e4c4a1968ee18df6f27f178324c48`; reviewed repair `5f3f15e53b926ac567f8a546111d72b2fd3e59b5`. Requirements also come from the operating model, persona workflow maps, and latest user decisions. This is a local candidate, not a deployment approval or real-device acceptance certificate.

## Capability ledger

| Capability | Before repair | Repaired release | Reconciliation |
| --- | --- | --- | --- |
| Both employee and partner crews | Implemented with distinct readiness models | Retained | Keep both acceptance paths; employee sources never create partner debt |
| Operations dashboard and production/QC visibility | UI visible, legacy grants did not match API | Correct guards exposed missing grants | Exact documented demo grants restored; no QC approval or finance writes added |
| Field Supervisor production create/edit/submit | Legacy permission names | Blocked by correct route guard | Restore matching production_record permissions, retain approval denials |
| QC Reviewer production context | Legacy read permission | Blocked | Add production_record.read only |
| QC reviewer selection, source review, reasons | Raw identifiers/JSON inputs | Inputs removed | Restore named choices and structured supported reasons, tenant-scoped |
| Billing accepted quantity and invoice creation | New API grants absent from legacy Billing Manager bundle | Same missing grants | Restore three matching billing permissions only |
| Field quantity/asset/route/notes corrections | API snapshot supported these fields; UI incomplete | Deliberate editor and retry protection | Retain supported corrections and immutable history |
| Evidence/map/production-code corrections | Accepted inputs could be silently discarded | Explicitly rejected | Pre-existing incomplete requirements remain open, not cancelled |
| Customer acceptance through finance | Implemented with quantity/lineage safeguards | Unchanged | Test actual financial transactions and role handoffs, not just seeded pages |
| Externally completed payment proof | Implemented, automatic payment disabled | Unchanged | Preserve proof/idempotency controls; explicit approver policy still needs resolution |
| Unauthorized actions | Sometimes visible/disabled or failed later | Hidden and guarded | Preserve user-requested access enforcement |
| Planned navigation placeholders | Visible placeholders | Hidden | Backlog remains; no claim of completed features |

## Data and upgrade preservation

Migration 065 is additive and targets only four named demo roles in tenant slug `arc-syncos-demo`. It does not reset accounts, credentials, user-role assignments, operational records or private files. Existing custom grants are retained; unrelated, deleted and other-tenant roles are untouched. Real crew pilot users require reviewed provisioning, not inferred wildcard grants. In particular, employee crew management requires an actual tenant management role accepted by the internal-workforce API; the composite demo Operations / Project Manager name is not automatically such a role. The employee acceptance test provisions an explicit Operations Manager contract in disposable data, so it does not close this live-account setup gap. Fresh disposable seeds match upgraded demo roles. Never rerun the full seed against shared staging. Migration 065 advances the release manifest; a later deployment needs fresh backup/restore evidence and a rollback plan that accounts for the manifest, not a blind switch to code expecting ceiling 064.

## Approval conflicts held open

- Existing API limits legacy QC correction requests to Project Manager / Operations Manager, while older workflow maps describe QC Manager requesting corrections. Do not silently alias the composite demo Operations / Project Manager role into additional lifecycle authority.
- The Payables / Payroll Admin preparation role does not automatically gain settlement approval or external payment confirmation authority. A limited authorized finance test actor demonstrates capability, not shared-user provisioning.

## Verification interpretation

Production controls now check the exact permission required by the endpoint they call; obsolete aliases cannot expose approval buttons. Production and QC creation also open the newly persisted record using the actual API response shape.

Positive acceptance must use intended business actors; administrator authority may prepare disposable fixture data but cannot substitute for operational handoffs. Role contract fixtures with explicit permissions demonstrate enforcement, not automatic provisioning of live users. Connected financial tests begin at customer acceptance fixtures; field/QC suites separately cover upstream work. No browser test can establish actual-phone or cold-start offline acceptance.

## Validation results

- Full Chromium regression: **822 passed, 0 failed, 0 skipped, 0 flaky** (10.9 minutes). Evidence: `/private/tmp/syncos-scope-full.json` and `/private/tmp/syncos-scope-full.log`.
- After that full run, the employee acceptance test was strengthened and rerun: **1 passed**. It now covers employee quantity correction through the narrow-screen UI, idempotent resubmission, immutable report history, customer reinspection, seven accepted hours producing a $700 billable, and no partner debt. Evidence: `/private/tmp/syncos-scope-employee-correction.log`. No application code changed after the full run.
- **148 unit/integration tests passed**, none skipped, including PostgreSQL-backed additive role-upgrade isolation and idempotency.
- Workspace type checks and API, worker and final web builds passed; dependency audit reported zero vulnerabilities; migration verification passed at manifest 065.
- All required release smoke suites passed across initial and resumed runs. A long host execution pause expired one short-lived smoke token; the affected suite was rerun. Migration 065 was added to the explicit migration allowlist before that check passed. This evidence is an aggregate of successful checks, not one uninterrupted successful release-gate invocation.
- New positive tests use Operations, Field Supervisor, QC Manager and limited finance actors; read-only, foreign-tenant and unauthorized mutation denials remain covered. Financial handoffs verify accepted quantities, cleared/allocated cash, external payment proof, duplicate protection and employee/partner debt separation.

## Remaining acceptance gates

1. Resolve the two authority conflicts above, then verify actual pilot-user provisioning against the agreed role matrix. Synthetic role-contract tests do not establish shared pilot account access.
2. Keep evidence/map/production-code correction support as unfinished requirements. Also retain the Field Supervisor raw foreman-ID selection usability gap for repair.
3. Complete supervised tests on actual phones for both crew types, including interrupted connectivity, already-loaded offline use, cold-start offline use and recovery without duplicate records.
4. Before any later staging activation, verify fresh database/private-file backup and recovery evidence and a code/schema-aware rollback plan for migration 065. This candidate has not been activated.

No shared staging/demo records, live accounts, private files or payment-provider settings were changed during this reconciliation. No payments or real communications were sent. Tests used isolated local PostgreSQL databases and synthetic fixtures. No requirements are removed because their implementation or test evidence remains incomplete.
