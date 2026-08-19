# SyncOS P15 — Opportunity Capacity Matching

## 1. Baseline Branch / Commit

Branch: `feat/opportunity-capacity-matching-p15`

Baseline committed HEAD: `b0741c24a1ead3ba485a8a5c46ccc27f8e75f35a`

## 2. Existing Opportunity Capability Audit

PARTIALLY SUPPORTED. Existing `opportunities`, `opportunity_candidates`, and `opportunity_capacity_requirements` provide pipeline and coarse capacity requirements. They do not preserve versioned structured matching requirements or recommendation snapshots.

## 3. Existing Capacity-Matching Audit

PARTIALLY SUPPORTED. P14 owns derived deployable capacity through `partner_capacity_intelligence_snapshots`. P15 consumes those snapshots and does not duplicate `capacity_records`, `capacity_providers`, or Crew truth.

## 4. Existing Recommendation Capability Audit

MISSING for opportunity-to-partner matching. P14 reputation and capacity intelligence are reused as inputs; P15 adds opportunity-specific match snapshots and coverage options.

## 5. Canonical Source Ownership

P15 reads canonical Opportunity, Partner, Crew, territory, capacity, P14 performance, P14 capacity intelligence, and P14 risk facts. It owns only derived requirement versions, match snapshots, coverage options, shortlists, and decision notes.

## 6. Opportunity Requirement Model

`opportunity_requirement_profiles` stores explicit territory, capability, Crew type, required Crew count, start date/window, optional end date/duration, equipment, compliance, customer clearance, minimum performance, confidence, risk policy, notes, creator, and version.

## 7. Requirement Versioning

Material requirement changes create a new profile version. Prior match snapshots remain tied to the old requirement profile.

## 8. Capacity Gap

Capacity gap = required Crew count minus verified recommended Crew coverage from eligible Partner matches. Low-confidence/unverified capacity is displayed separately and not treated as guaranteed verified coverage.

## 9. Hard Eligibility

Hard blockers include ineligible Partner status, missing territory, missing capability, missed start-window verified capacity, mandatory equipment not represented, and active critical risk.

## 10. Soft Ranking Factors

Soft factors are availability, capability, territory, readiness, P14 performance fit, capacity confidence, and risk/reliability.

## 11. Matching Policy Version

Policy version: `opportunity_capacity_match_v1`

## 12. Match Weights

AVAILABILITY FIT 25; CAPABILITY FIT 20; TERRITORY FIT 10; READINESS FIT 15; PERFORMANCE FIT 15; CAPACITY CONFIDENCE 10; RISK / RELIABILITY 5. Total: 100.

## 13. Partner Match Model

`opportunity_partner_match_snapshots` stores current/historical partner fit, hard blockers, dimension scores, confidence, risk summary, recommended Crew contribution, source fingerprint, and policy version.

## 14. Crew Match Model

`opportunity_crew_match_snapshots` stores Crew-level fit for the matched Partner. It does not score or rank individual Workers.

## 15. Partner vs Crew Capacity

Partner match and Crew match are separate. A Partner can have strong overall fit while only some Crews contribute to verified coverage.

## 16. Start-Window Fit

P15 maps explicit start windows to P14 capacity horizons: `now_24h`, `72h`, `1_week`, `2_weeks`, `30_days`, `60_days`. `start_by` and `start_between` derive the nearest horizon from the requirement date and evaluation `asOf`.

## 17. Duration Fit

Duration is stored when supplied. Full future occupancy across a multi-day duration remains a limitation unless canonical future commitments are present.

## 18. Territory Fit

Territory is an exact match against explicit P14 capacity territory data. Address inference is not used.

## 19. Capability Fit

Capability is matched against canonical P14 capacity capability. Historical work alone does not certify capability.

## 20. Equipment Fit

Mandatory equipment currently blocks matching unless canonical equipment fit is represented. Sync-provided equipment distinction is documented as deferred.

## 21. Compliance Fit

Compliance is consumed through P14 capacity/readiness confidence and hard blockers where mandatory requirements cannot be proven.

## 22. Performance Fit

P15 consumes current P14 performance score; it does not recalculate or mutate Partner performance.

## 23. Performance Confidence

LOW performance confidence caps the performance contribution; MEDIUM applies a small confidence reduction; HIGH uses the current P14 score.

## 24. Critical Risk

Active high/critical P14 risk produces `CRITICAL_RISK_ACTIVE`, review required, and ineligible matching. The numeric score remains visible but cannot override the blocker.

## 25. Lifecycle Influence

Lifecycle is not a hard winner. P15 does not auto-promote, demote, suspend, or modify lifecycle status.

## 26. Historical Experience

Historical territory/work experience is not a hard requirement in P15 v1 unless it is represented in P14 capacity/performance evidence.

## 27. Relationship Fit

Existing opportunity/customer relationship data remains outside P15 scoring v1 and is not exposed in generic match payloads.

## 28. Match Explainability

Every match includes hard blockers, reason codes, dimension scores, capacity counts, risk summary, confidence, and policy version.

## 29. Reason Codes

Implemented examples: `TERRITORY_EXACT`, `CAPABILITY_EXACT`, `READY_NOW`, `READY_WITHIN_WINDOW`, `CAPACITY_PARTIAL`, `CAPACITY_CONFIDENCE_LOW`, `CRITICAL_RISK_ACTIVE`, `INSUFFICIENT_DATA`, `CREW_NOT_READY`, `EQUIPMENT_MISSING`, `START_WINDOW_MISS`.

## 30. Multi-Partner Coverage

Coverage options can compose multiple eligible Partners to satisfy a larger Crew count requirement.

## 31. Coverage Algorithm

P15 v1 uses a bounded greedy algorithm over the top eligible Partner matches sorted by fit score. Candidate pool is limited to 20 for composition, and no operational assignment or reservation is made.

## 32. Coverage Options

`opportunity_coverage_options` stores rank, coverage status, covered Crew count, gap, average score, minimum confidence, composition, reason summary, source fingerprint, and current flag.

## 33. Capacity Gap / Recruiting Need

If a gap remains, the coverage reason summary includes a read-only recruiting need with territory, capability, Crew count, and needed-by date.

## 34. Pursue Recommendation

Possible outputs: pursue/full capacity, pursue/partial capacity recruiting required, pursue with risk review, defer capacity gap. This does not change Opportunity stage.

## 35. Shortlist

`opportunity_partner_shortlists` records human shortlist status and notes. It is not assignment.

## 36. Human Decision Record

`opportunity_match_decisions` records human pursue/capacity decisions and reasons. It does not create Work Orders, reserve Crews, or change Opportunity stage.

## 37. Opportunity/Capacity UI

Internal UI route: `/opportunities/capacity-matching`. It shows coverage summary, filters, opportunity detail, partner matches, Crew matches, coverage options, and shortlist state.

## 38. Executive Coverage View

The coverage endpoint and UI expose Opportunity, territory, capability, required Crews, verified coverage, gap, best score, confidence, and pursue recommendation.

## 39. Partner Portal Boundary

Partner users receive no P15 competitive matching routes, shortlist, internal pursuit decisions, or competitor capacity gaps.

## 40. Permissions

Added internal permissions: `opportunity_capacity_match.read`, `opportunity_capacity_match.recalculate`, `opportunity_capacity_match.requirements_manage`, `opportunity_partner_shortlist.manage`, `opportunity_coverage.read`, `opportunity_match_decision.record`.

## 41. Security

Tenant/opportunity/Partner scoping is enforced in queries and FKs. Partner personas are not seeded with P15 permissions. Payload sanitizers omit rates, margin, Worker PII, and internal-sensitive fields.

## 42. Events

Audited write events: `opportunity.requirements_changed`, `opportunity_capacity_match.recalculated`, `opportunity_partner_shortlist.changed`, `opportunity_match_decision.recorded`.

## 43. Audit

Requirement changes, manual recalculation, shortlist changes, and human decisions use the existing `executeWriteAction` event/audit path.

## 44. Scheduled Recalculation

Worker scheduler `startOpportunityCapacityMatchingScheduler` runs a bounded scan using `runOpportunityCapacityMatchingScan`. It uses a P15 advisory lock, configurable interval, configurable batch size, and idempotent source fingerprints.

## 45. Migration

Added `packages/database/migrations/053_opportunity_capacity_matching.sql`.

## 46. Fresh DB Result

CERTIFIED. A disposable database `syncos_p15_verify_20260819` was migrated through `053_opportunity_capacity_matching.sql`, seeded, verified with `npm run db:verify`, and seeded a second time to prove seed idempotency. Migration verification passed.

## 47. P14→P15 Upgrade Result

CERTIFIED. A disposable upgrade database `syncos_p15_upgrade_20260819` was migrated through P14 first, seeded with representative prior-state data, then upgraded by applying migration `053_opportunity_capacity_matching.sql`. P1-P14 data survived, P14 performance/capacity tables were unchanged, six P15 tables initialized safely, and the seed rerun did not duplicate permissions.

## 48. P9 Regression

CERTIFIED. Targeted P9 offline Daily Production regression passed 8/8. Global certification also executed P9 at positions 623-630 and passed, including offline queue replay and Partner-local queue isolation.

## 49. P10 Regression

CERTIFIED. Targeted P10 Customer QC regression passed 10/10. Global certification also executed P10 at positions 613-622 and passed, preserving QC lineage and Partner-safe views.

## 50. P11 Regression

CERTIFIED. Targeted P11 production export/dashboard regression passed 4/4. Global certification executed P11 at positions 635-638 and passed.

## 51. P12 Regression

CERTIFIED. Targeted P12 accepted-production financial regression passed 6/6. Global certification executed P12 at positions 1-6 and passed.

## 52. P13 Regression

CERTIFIED. Targeted P13 payment/retainage/adjustment regression passed 4/4. Global certification executed P13 at positions 511-514 and passed.

## 53. P14 Regression

CERTIFIED. Targeted P14 performance/capacity regression passed 6/6. Global certification executed P14 at positions 496-501 and passed, including operational-timezone timeliness and scheduled recalculation behavior.

## 54. P1–P14 Regression

CERTIFIED. P1-P8 targeted regression passed 47/47. P9-P14 targeted regression passed 38/38. Combined P1-P14 targeted regression passed 85/85.

## 55. P15 Targeted E2E

CERTIFIED. P15 targeted E2E passed 6/6 against a fresh runtime and disposable database.

## 56. Global Certification

CERTIFIED. `npm run e2e:certification` executed 652 tests and exited 0. P15 executed globally at positions 472-477 and passed all six P15 cases.

## 57. Files Changed

Implementation files:

- `apps/api/package.json`
- `apps/api/scripts/sprint14-smoke.js`
- `apps/api/scripts/sprint15-smoke.js`
- `apps/api/src/modules/app.module.ts`
- `apps/api/src/routes/opportunity-capacity-matching.controller.ts`
- `apps/web/app/opportunities/capacity-matching/page.tsx`
- `apps/web/app/opportunities/opportunity-shell.tsx`
- `apps/worker/src/index.ts`
- `docs/product/opportunity-capacity-matching-p15.md`
- `packages/database/migrations/053_opportunity_capacity_matching.sql`
- `packages/database/scripts/seed.js`
- `packages/permissions/src/index.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/opportunity-capacity-matching.ts`
- `tests/e2e/opportunity-capacity-matching.spec.ts`
- `tests/regression.test.js`

## 58. Dependencies Added

None.

## 59. Known Limitations

Full duration occupancy and Sync-provided equipment distinction are stored/blocked conservatively unless canonical future commitment/equipment fit is available. Relationship-sensitive fit remains out of the v1 match score and is not exposed in generic match payloads. Coverage options use a bounded greedy algorithm over the top 20 eligible Partner matches rather than exhaustive optimization.

## 60. Explicit P16+ Exclusions

No automatic award, Partner assignment, Crew reservation, Work Order creation, Opportunity stage change, recruiting campaign, contractor outreach, rate negotiation, black-box AI/ML ranking, geospatial routing optimization, customer-facing matching, Partner-visible competitor ranking, or P16+ work.

## 61. P15 Certification

CERTIFIED

## 62. GO / NO-GO for P16

GO after P15 is committed. P15 itself did not begin P16 work.
