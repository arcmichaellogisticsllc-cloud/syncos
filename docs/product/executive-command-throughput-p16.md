# SyncOS P16 - Executive Command Center, Throughput KPIs & Daily Decision Support

## 1. Baseline Branch / Commit
Branch: `feat/executive-command-throughput-p16`

Baseline committed HEAD: `07237ca22b56c056b7e4e9153aa3f4146ab2c6fd`

## 2. Existing Executive Dashboard Audit
PARTIALLY SUPPORTED. `DashboardsController` and `/executive` existed as live dashboard surfaces, but did not provide the P16 derived snapshot/action model, deterministic daily action priority, root-cause dedupe, or freshness-aware command read model.

## 3. Existing KPI Audit
PARTIALLY SUPPORTED. Existing KPI definitions and dashboard endpoints support generic KPI snapshots. P16 consumes canonical P1-P15 facts directly where needed and does not treat missing KPI definitions as zero.

## 4. Canonical Source Ownership
P16 does not own Opportunities, capacity, Partner performance, production, Customer QC, billing, cash, payables, payments, lifecycle, Work Orders, or assignments. P16 owns only `executive_command_snapshots`, `executive_actions`, and `executive_blocker_snapshots`.

## 5. Command Center Architecture
The Command Center is a tenant-wide read/decision layer. API route: `/executive-command`. UI route: `/command-center`.

## 6. Throughput Model
The model tracks constraints across Opportunity, Coverage, Work Order, Mobilization, Production, Customer Acceptance, Billing, Cash, Partner Payable, and Payment status. It keeps counts, money, and unit quantities separate.

## 7. Throughput Funnel
Displayed stages: Qualified, Covered, Work Orders, Production, Accepted, Billed, Cash. Production and accepted quantities are unit-aware summaries.

## 8. Growth KPIs
Qualified Opportunity Count, Qualified Opportunity Value, Coverage Ready Count, Capacity Gap Count, Awarded Value where canonical opportunity value exists.

## 9. Opportunity Coverage
Consumes P15 `opportunity_coverage_options` and `opportunity_requirement_profiles`. Coverage actions are recommendation-only and do not mutate Opportunity stage.

## 10. Capacity KPIs
Consumes P14 `partner_capacity_intelligence_snapshots`: ready now, 72h, 1 week, 30-day readiness, committed Crews, and low-confidence claimed capacity.

## 11. Capacity Utilization
CONDITIONALLY CERTIFIED. P16 exposes ready and committed counts separately. It does not calculate a utilization percentage when the verified denominator is ambiguous.

## 12. Execution KPIs
Active Work Orders, submitted Daily Reports, Daily JSA completion, blocked/rework source distinction, and production submitted today.

## 13. Production Today
Production is grouped by production code/unit. LF, EA, HR, and other units are not summed together.

## 14. Customer Acceptance KPIs
Current Customer QC decision facts drive accepted production. Pending QC remains pending, not rejected.

## 15. Customer QC Aging
Awaiting Customer QC over three days produces a Customer-owned aging blocker. No Customer delay is attributed to the Partner.

## 16. Correction Aging
Partner correction aging is separate from Customer reinspection aging and is sourced from `production_corrections` / `customer_qc_cycles`.

## 17. Finance KPIs
Customer side: accepted-not-billed exceptions, outstanding AR, cleared cash, unapplied cash. Partner side: eligible payable, awaiting funds, payments due.

## 18. Days to Cash
Definition: Customer Acceptance timestamp to cleared Customer cash application timestamp through P12 allocation lineage. Unpaid items are excluded. Accepted-to-invoice and invoice-to-cash are exposed separately.

## 19. Billing Velocity
P16 exposes separate velocity buckets rather than one blended finance metric.

## 20. Partner Health
Consumes P14 score/risk/capacity snapshots. Critical risk remains visible outside the aggregate performance score.

## 21. Partner Risk Panel
Internal-safe risk data only: Partner, risk category/severity/count, score metadata, and capacity context. No Worker PII or investigation notes.

## 22. Growth Blockers
Typed blockers include `CAPACITY_GAP`, `MISSING_CUSTOMER_RATE`, `CUSTOMER_QC_AGING`, `PARTNER_CORRECTION_OVERDUE`, `UNAPPLIED_CASH`, `PARTNER_PAYMENT_OVERDUE`, and `CRITICAL_PARTNER_RISK`.

## 23. Blocker Severity
Policy version: `executive_action_priority_v1`. Critical safety risk and overdue eligible Partner payment are CRITICAL/P0. Imminent capacity gaps and missing Customer rates are HIGH. Customer QC aging, Partner correction aging, and unapplied cash are deterministic medium/high by age/impact.

## 24. Blocker Ownership
Ownership values are `sync`, `partner`, `customer`, `capacity`, `compliance`, `finance`, or `unknown`. Unknown is never defaulted to Partner.

## 25. Executive Daily Actions
Daily Actions are derived from blockers and canonical facts. Each action includes type, priority, severity, owner, reason code, source object, drill-through route, and recommended next step.

## 26. Action Priority Policy
Policy version: `executive_action_priority_v1`. Base scores: critical safety 98, overdue payment 92, imminent capacity gap 90, missing Customer rate 86, Partner correction overdue 80, Customer QC aging 78, unapplied cash 68, ready-to-invoice 66.

## 27. Action Deduplication
Actions are deduped by reason code + source object type + source object id. Downstream symptoms do not create duplicate current actions for the same root issue.

## 28. Action Status
Actions are derived. Current actions can be acknowledged, but source truth is not mutated. Superseded open actions move to `resolved_by_source_change` on refresh.

## 29. Daily Brief
The snapshot stores a concise JSON brief with what changed, top actions, production summaries, cash/payable amounts, and blocker summary.

## 30. Change Detection
P16 uses source fingerprints and hourly `asOf` buckets. Identical material state does not create uncontrolled duplicates.

## 31. Executive Snapshot
New table: `executive_command_snapshots`. It stores tenant, snapshot date, as-of time, policy version, KPI summaries, freshness, source fingerprint, and immutable history.

## 32. Executive Action Snapshot
New table: `executive_actions`. Actions belong to a snapshot and preserve source object linkage, priority, route, status, and source fingerprint.

## 33. Source Fingerprint
Fingerprint includes P16 policy versions, as-of bucket, metrics, blockers, and deduped actions.

## 34. Refresh Model
Manual recalculation is available to authorized internal users. Worker scheduled refresh keeps aging/time-window metrics current.

## 35. Scheduled Refresh
Worker function: `startExecutiveCommandScheduler`. Shared run-once function: `runExecutiveCommandRefreshScan`. Default interval: 3,600,000 ms. Minimum interval: 300,000 ms. Batch default: 25 tenants. Batch cap: 100. Lock: Postgres advisory lock `syncos.p16.executive_command_refresh_scan`.

## 36. Tenant Scope
All P16 queries filter by `tenant_id`. Partner users do not receive Command Center permissions.

## 37. Permissions
New permissions: `executive_command.read`, `executive_command.actions_read`, `executive_command.snapshot_recalculate`, `executive_command.action_acknowledge`.

## 38. Command Center UI
Route `/command-center` shows freshness, primary KPIs, Top Actions, KPI groups, throughput funnel, and billing velocity.

## 39. Top Actions UI
Top 10 actions are shown above secondary panels, ordered by deterministic priority score.

## 40. Throughput Funnel UI
The funnel uses separate stage labels and does not imply one-to-one conversion between unlike objects.

## 41. Territory View
CONDITIONALLY CERTIFIED. Territory drill-through is supported through Opportunity matching and Partner performance routes. Dedicated territory filter is a P17+ expansion.

## 42. Drill-Through
Routes link to `/opportunities/capacity-matching`, `/partner-performance`, `/production-dashboard`, `/partner/customer-qc`, `/accepted-production-financials`, and `/payment-retainage-adjustments`.

## 43. KPI Freshness
Snapshots expose `as_of`, `calculated_at`, and stale threshold metadata. UI flags stale snapshots over 120 minutes.

## 44. Performance / Pagination
API returns top 10 actions by default and caps actions at 100. Source queries are bounded and aggregate server-side.

## 45. Security
Tenant isolation, internal-only permission checks, no Partner access, no Worker PII, no bank/provider secrets, no rates, and no margin details.

## 46. Events
Manual recalculation emits `executive_command.snapshot_recalculated`; action acknowledgment emits `executive_action.acknowledged`.

## 47. Audit
Manual recalculation and action acknowledgment use `executeWriteAction`, events, and audit logs. Scheduled derived refresh does not fake a human actor.

## 48. Migration
Added `packages/database/migrations/054_executive_command_throughput.sql`.

## 49. Fresh DB Result
CERTIFIED. Fresh disposable DB `syncos_p16_fresh_verify_20260819_2` migrated through 054, seeded, and passed `npm run db:verify`. A second `npm run db:seed` completed cleanly, proving seed idempotency and no duplicate permissions.

## 50. P15->P16 Upgrade Result
CERTIFIED. Upgrade-style disposable DB `syncos_p16_upgrade_verify_20260819_2` migrated through 054, seeded, and passed `npm run db:verify`; a seed rerun was idempotent. P1-P15 source-domain tables were preserved and P16 initialized only derived snapshot/action/blocker tables.

## 51. P9 Regression
CERTIFIED. P9 targeted regression passed in the P9-P15 targeted run.

## 52. P10 Regression
CERTIFIED. P10 targeted regression passed in the P9-P15 targeted run.

## 53. P11 Regression
CERTIFIED. P11 targeted regression passed in the P9-P15 targeted run.

## 54. P12 Regression
CERTIFIED. P12 accepted-production financial regression passed in the P9-P15 targeted run.

## 55. P13 Regression
CERTIFIED. P13 payment/retainage regression passed in the P9-P15 targeted run.

## 56. P14 Regression
CERTIFIED. P14 performance/capacity regression passed in the P9-P15 targeted run.

## 57. P15 Regression
CERTIFIED. P15 opportunity/capacity matching regression passed in the P9-P15 targeted run.

## 58. P1-P15 Regression
CERTIFIED. P1-P8 targeted regression passed 47/47. P9-P15 targeted regression passed 44/44. Combined P1-P15 targeted regression total: 91/91.

## 59. P16 Targeted E2E
CERTIFIED. `tests/e2e/executive-command-throughput.spec.ts` passed 6/6. Coverage included executive access, Partner denial, cross-tenant denial, P15/P14 consumption, unit-aware production, Customer-QC and Partner-correction separation, Customer AR and Partner AP separation, deterministic/deduped routed actions, scheduler lock/idempotency, and no rates/secrets/Worker PII/auto-actions.

## 60. Global Certification
CERTIFIED. `npm run e2e:certification` passed 658/658 with exit code 0. P16 executed globally at tests 468-473.

## 61. Files Changed
P16 changed API module/route/security wiring, worker scheduler wiring, shared executive-command read model code, shared write-action invalidation control, permissions, seed data, migration 054, web Command Center route/navigation/API client, P16 smoke, regression registration, targeted E2E, root package scripts, and this product document.

## 62. Dependencies Added
None.

## 63. Known Limitations
Dedicated territory-filter UI and manual snooze/dismiss governance are deferred. Capacity utilization percentage is not shown until a certified denominator is available. P16 does not generate natural-language executive summaries or automate any operational/commercial action.

## 64. Explicit P17+ Exclusions
No automatic award, Partner assignment, Crew reservation, recruiting campaign, customer follow-up, payment execution, rate change, lifecycle change, AI action ranking, generated executive narrative, Partner Command Center, or P17 work.

## 65. P16 Certification
CERTIFIED.

## 66. GO / NO-GO for P17
GO for committing P16. GO for P17 after P16 is committed.

## Validation Summary
Fast checks passed: `npm test` 64/64, root `npm run typecheck`, API/web/worker typechecks, API/web/worker builds, and `git diff --check`.

Runtime and smoke checks passed: security, organization, project, work-order, opportunity, production, QC, invoice, cash-application, contractor-payable, billable, coverage, payment-execution, sprint14, sprint15, and sprint16 smokes.

Global suites passed: hydration 27/27, boundaries 22/22, personas 4/4, action-state personas 140/140, lifecycle 4/4, and full certification 658/658.

Defects found and corrected:
- P16 E2E fixture used invalid `work_orders.unit = 'LF'`; corrected to canonical `feet` while keeping production/QC units unit-aware.
- P16 E2E fixture duplicated same-day JSA/report packages for one Crew; corrected by adding a second Crew for same-day EA production.
- Correction-aging SQL selected `production_corrections.work_order_id`, which is not canonical; corrected via `daily_production_reports` lineage.
- Missing-rate blocker SQL used an ambiguous `work_order_id`; corrected to `coalesce(fe.work_order_id, aps.work_order_id)`.
- P16 derived events triggered P6 source invalidation through generic `executeWriteAction`; corrected with explicit `skipSourceInvalidation` for P16 derived event/audit calls.
- Partner awaiting-funds KPI missed ineligible amounts on partially eligible/eligible payables; corrected to sum unfunded portions without merging Customer AR and Partner AP.
- E2E leak assertion matched safe boundary flag text; narrowed assertion to actual sensitive JSON keys.
