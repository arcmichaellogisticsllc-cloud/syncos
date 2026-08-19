# SyncOS P14 - Partner Performance, Reputation, and Capacity Intelligence

## 1. Baseline Branch / Commit

Branch: `feat/partner-performance-capacity-p14`

Baseline HEAD: `c1133b1d27811a0c06c54e7110a82820add9f9f5`

## 2. Existing Performance Capability Audit

PARTIALLY SUPPORTED: P9 through P13 provide canonical production, Customer QC, correction, financial exception, settlement, payable, and payment facts. No existing object provided immutable Partner performance snapshots, dimensional components, confidence, trend, or lifecycle recommendation history.

## 3. Existing Reputation Capability Audit

MISSING: existing score/readiness concepts are tied to signals, coverage, projects, handoffs, settlements, or learning. They are not a canonical Partner reputation model and were not reused as Partner performance truth.

## 4. Existing Capacity Capability Audit

PARTIALLY SUPPORTED: `capacity_providers`, `crews`, `workers`, `capacity_records`, territories, compliance documents, and mobilization readiness are canonical capacity/readiness facts. P14 adds derived capacity-intelligence snapshots only.

## 5. Canonical Source Ownership

P14 reads canonical facts from organizations, capacity providers, crews, capacity records, daily production reports, daily JSAs, production records, Customer QC decisions/cycles, production corrections, work orders, financial exceptions, contractor payables, and payment instructions. It does not copy those facts into editable operational truth.

## 6. Performance Score Architecture

Scores are derived through an internal recalculation endpoint. The persisted output is immutable score snapshots plus metric components. Recalculation with identical source fingerprint returns the existing snapshot.

## 7. Scoring Policy Version

Policy version: `partner_performance_v1`.

## 8. Dimension Weights

Weights total 100:

- QUALITY: 25
- PRODUCTION / THROUGHPUT: 15
- DOCUMENTATION: 10
- SAFETY / COMPLIANCE: 15
- MOBILIZATION / RELIABILITY: 10
- CORRECTION / REWORK: 10
- COMMERCIAL RELIABILITY: 5
- CAPACITY RELIABILITY: 10

## 9. Quality Dimension

Quality uses current effective Customer QC decisions, first-pass acceptance, partial acceptance, correction-required, rejection, and accepted/reported quantity ratio. Pending Customer QC and administrative completeness returns are not treated as Customer QC failures.

## 10. Production Dimension

Production uses Customer-accepted production, with LF aerial work measured against the documented 3,000 LF/day operating target only when comparable aerial/LF data exists.

## 11. Documentation Dimension

Documentation uses Daily Production submission timing and completed/certified Daily JSAs. P14B evaluates the Daily Production deadline at 21:00 in the canonical operational timezone from the applicable `production_start_authorizations.timezone` for the Work Order version, Partner, and Crew context. Missing or invalid canonical timezone makes report timeliness `not evaluated`; it does not count late and does not penalize the Partner.

## 12. Safety Dimension

Safety uses JSA completion and active severe safety/compliance risk flags. Severe safety risk is represented separately as a critical risk flag and is not hidden inside the weighted average.

## 13. Mobilization Dimension

Mobilization v1 uses Crew active/suspended lifecycle facts. Deeper planned-date miss attribution remains deferred until canonical planned mobilization failure facts are available.

## 14. Correction/Rework Dimension

Correction/rework uses Customer correction-required decisions and open production corrections. Field `REWORK` and Customer correction-required remain distinct source concepts.

## 15. Commercial Reliability Dimension

Commercial reliability is low-weight and counts only Partner-attributable financial exceptions such as recovery required or payment destination not ready. Customer late payment and Sync payment delay do not penalize Partner score.

## 16. Capacity Reliability Dimension

Capacity reliability compares active non-suspended Crews with verified/compliant deployable capacity records. Small dependable Partners can score well.

## 17. Score Range / Bands

Master score range is 0-100. Bands: `excellent`, `strong`, `acceptable`, `watch`, `high_risk`.

## 18. Sample Size

Minimum sample for medium confidence starts at 5 reviewed records and 3 production days. High confidence starts at 25 reviewed records and 10 production days.

## 19. Confidence

Confidence is `low`, `medium`, or `high` from reviewed records and production-day sample size. Missing data does not become a perfect or zero score.

## 20. Recency

P14 stores sample window dates and immutable snapshot history. Scheduled recalculation includes an `asOf` date bucket in the source fingerprint so recency, decay/recovery, capacity horizons, and last-active aging can create a new snapshot when time materially changes the derived result even when source rows do not change.

## 21. Decay / Recovery

Minor operational issues influence current snapshots through current source facts and the scheduled `asOf` evaluation. They can recover as good performance changes the source mix or as time moves them through the v1 daily recency bucket. Unresolved critical risks remain active until canonical resolution; they do not decay away merely because time advances.

## 22. Trend

Trend compares current score with the prior current snapshot. Changes of 3 or more points are improving/declining; smaller moves are stable. First snapshot is insufficient data.

## 23. Critical Risk Flags

`partner_risk_flags` stores separate derived/governed risk flags with tenant, Partner, risk type, severity, source type/id, status, and external visibility. These flags can force lifecycle review even when numeric score remains high.

## 24. Score Snapshot

`partner_performance_snapshots` stores score, policy version, confidence, all dimension scores, trend, lifecycle recommendation, sample counts, critical risk count, source fingerprint, and current marker.

## 25. Score Components

`partner_performance_score_components` stores dimension, metric code/value, normalized score, weight, weighted contribution, sample size, reason code, and safe source summary JSON for explainability.

## 26. Crew Performance

Crew performance is exposed as derived drill-in data from Crew, production, JSA, and Customer QC facts. Crew score is separate from Partner master score.

## 27. Worker-Scoring Boundary

P14 does not rank Workers or publish Worker performance scores. Worker data is used only as readiness context through existing Crew/Partner facts.

## 28. Lifecycle Recommendation

P14 computes `promote`, `maintain`, `review`, `demote`, `suspend_review`, or `insufficient_data`. Recommendations are evidence-backed and do not mutate organization lifecycle.

## 29. Lifecycle Governance

Lifecycle recommendations set `governance_required = true`. P14 does not automatically promote, demote, suspend, change rates, withhold payment, or award work.

## 30. Capacity Intelligence

P14 converts canonical capacity data into decision-support snapshots by Partner, territory, capability, Crew type, and horizon.

## 31. Deployable Capacity

Deployable capacity excludes suspended Crews and capacity records that are missing compliance/insurance readiness. Active committed capacity is tracked separately.

## 32. Capacity Horizons

Supported and populated horizons: `now_24h`, `72h`, `1_week`, `2_weeks`, `30_days`, `60_days`.

## 33. Capacity Confidence

Confidence is high/medium when verified capacity exists and low when stated capacity is unverified or missing compliance/insurance.

## 34. Territory

Territory is read only from explicit capacity records and project/work-order context. P14 does not infer territory from corporate address.

## 35. Capability Fit

Capability fit uses explicit capacity type/capability records. Historical production is supporting evidence, not automatic certification of a capability.

## 36. Capacity Recommendation

Recommendations include best fit, qualified, available but low confidence, capacity constrained, performance watch, and not ready. P14 does not award work automatically.

## 37. Opportunity/Capacity Read Interface

The `GET /partner-performance/capacity` read endpoint exposes Partner, territory, capability, horizon, capacity confidence, and performance context for future opportunity/capacity candidate matching.

## 38. Executive Partner Ranking

The internal `/partner-performance` page shows active Partners, lifecycle, score, confidence, trend, critical risks, ready Crews, 30-day capacity, territories, and capabilities with filters.

## 39. Internal Partner Detail UX

The detail panel shows score, confidence, trend, recommendation, components, capacity rows, Crew performance, and risk flags.

## 40. Partner Admin Visibility

Partner Admin receives only its own safe operational summary through `/partner/performance` and `GET /partner-performance/partner/summary`.

## 41. Partner Foreman Boundary

Partner Foreman has no master Partner score, ranking, payment, settlement, rate, or margin visibility.

## 42. Permissions

Added permissions: `partner_performance.read`, `partner_performance.recalculate`, `partner_reputation.read`, `partner_lifecycle_recommendation.read`, `partner_capacity_intelligence.read`, `partner_risk_flags.read`, and `partner_performance.read_own`.

## 43. Security

All reads and recalculations are tenant scoped. Partner summary uses existing organization-scoped Partner role resolution. Responses redact source fingerprints, rates, margin, bank/provider data, Worker ranking, and internal investigation content.

## 44. Events

Recalculation emits safe `partner_performance.recalculated` and `partner_performance.changed` events with Partner, score, confidence, trend, and recommendation metadata.

## 45. Audit

Manual recalculation uses `executeWriteAction`, preserving actor, tenant, event, and safe before/after state. Background recalculation uses the Worker scheduler and shared P14 evaluator; it emits the same safe Partner performance events without rates, margin, Worker PII, bank/provider data, or raw evidence payloads.

## 46. Worker/Scheduled Recalculation

P14B adds Worker scheduled recalculation using `runPartnerPerformanceRecalculationScan(client, { asOf, batchSize })` from `@syncos/shared`. The Worker starts the scan automatically when active unless `SYNCOS_P14_PERFORMANCE_SCAN_DISABLED=true`.

Runtime controls:

- Interval: `SYNCOS_P14_PERFORMANCE_SCAN_INTERVAL_MS`, default 3,600,000 ms.
- Minimum interval guard: 300,000 ms.
- Batch size: `SYNCOS_P14_PERFORMANCE_BATCH_SIZE`, default 50, clamped to 1-250.
- Lock: PostgreSQL advisory lock `syncos.p14.partner_performance_recalculation_scan`.
- Overlap control: in-process `running` guard plus DB lock for multi-worker safety.
- Candidate scope: active/relevant subcontractor/capacity-provider organizations with current snapshots, production/QC activity, active risk, capacity, or lifecycle recommendation.

The scan is bounded, tenant scoped, safe to retry, and idempotent for identical `asOf`/source facts. It does not mutate lifecycle, contracts, rates, payments, settlements, Work Orders, assignments, or Worker-level scores.

## 47. Migration

Migration `052_partner_performance_capacity_intelligence.sql` adds score snapshots, score components, risk flags, lifecycle recommendations, and capacity-intelligence snapshots.

## 48. Fresh DB Result

CERTIFIED. Disposable fresh databases were used. Migrations 001-052 applied successfully, seed completed, seed rerun remained idempotent, and `db:verify` passed on a separate disposable verification database.

## 49. P13->P14 Upgrade Result

CERTIFIED. Disposable upgrade validation databases migrated cleanly through current migration 052 with P14 structures initialized safely, seed rerun idempotent, and no duplicate P14 permissions. The current migration runner applies all pending migrations rather than stopping at an isolated 051 cutoff; rich representative P13 operational and financial state was exercised by P12, P13, and P14/P14B targeted E2E fixtures.

## 50. P9 Offline Regression

CERTIFIED. Targeted P9 offline suite passed. Global certification executed P9 at positions 617-624 and all 8 tests passed.

## 51. P10 QC Regression

CERTIFIED. Targeted Customer QC regression passed. Global certification executed P10 at positions 607-616 and all 10 tests passed.

## 52. P11 Export/Dashboard Regression

CERTIFIED. Targeted P11 export/dashboard regression passed. Global certification executed P11 at positions 629-632 and all 4 tests passed.

## 53. P12 Financial Regression

CERTIFIED. Targeted P12 accepted-production financial regression passed. Global certification executed P12 and all 6 targeted tests passed.

## 54. P13 Payment Regression

CERTIFIED. Targeted P13 payment/retainage/adjustment regression passed. Global certification executed P13 and all 4 targeted tests passed.

## 55. P1-P13 Regression

CERTIFIED. P1-P8 targeted regression passed 125/125. P9-P13 targeted regression passed 32/32. Hydration passed 27/27, boundaries passed 22/22, personas passed 4/4, action-state personas passed 140/140, and lifecycle passed 4/4. Security, organization, project, work-order, production, QC, billable, settlement, invoice, cash-application, contractor-payable, payment-execution, intelligence, and sprint14 smokes passed; `organization:smoke` was rerun alone after a parallel smoke collision and passed.

## 56. P14 Targeted E2E

CERTIFIED. `tests/e2e/partner-performance-capacity.spec.ts` passed 6/6 and covered score creation/idempotency, policy version, dimensional explainability, confidence/sample behavior, operational-timezone report timeliness, DST handling, missing-timezone non-penalty, quality lineage, mixed-unit separation, one-bad-day resilience, critical-risk separation, lifecycle recommendation, scheduled scan idempotency, time-sensitive capacity horizons, Crew score separation, capacity horizons/confidence, territory/capability fit, Partner scope, Foreman denial, Worker-ranking boundary, and no automatic commercial action.

## 57. Global Certification

CERTIFIED. `npm run e2e:certification` completed 646/646 with exit code 0 on a fresh certification database. P14/P14B executed globally at positions 490-495 and passed all 6 P14 tests.

## 58. Files Changed

P14 changes are limited to the API route/module registration, permissions, seed permissions, Partner/internal UI, additive migration, targeted E2E, regression registration, package certification script, and this document.

## 59. Dependencies Added

None.

## 60. Known Limitations

- P14B uses `production_start_authorizations.timezone` as the certified operational timezone source. If future Product requires Project-level or Work Order-level timezone ownership, that broader canonical field can be added without changing the missing-timezone non-penalty rule.
- Scheduled recalculation uses a daily `asOf` fingerprint bucket; finer intra-day decay windows are deferred until a policy requires them.
- Mobilization scoring uses available Crew lifecycle/readiness facts and does not infer missed deployments without canonical planned-date failure facts.
- Incident-specific safety scoring depends on future canonical incident/severity tables; P14 supports separate critical risk flags now.
- External Partner score visibility is limited to own-company operational feedback.
- The current migration runner applies all pending migrations, so the P13->P14 upgrade proof validates schema initialization, seed idempotency, permissions, and representative P13 facts through targeted E2E rather than a manually isolated 051-only cutoff.

## 61. Explicit P15+ Exclusions

No automatic contractor awards, Work Order assignment, Partner suspension, rate changes, financial penalties, Worker ranking, black-box AI scoring, opportunity assignment automation, or P15 scope is implemented.

## 62. P14 Certification

CERTIFIED

## 63. GO / NO-GO for P15

NO-GO. P14 is certified, but P15 was not requested to begin in this sprint gate.
