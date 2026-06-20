# Opportunity Pipeline Rules Clarification

Current validated commit: `4e78c0d09c2392467260efbb479476a6dde41b84`

This document is a rules clarification artifact only. It does not approve implementation, migrations, routes, UI, workflow categories, finance records, project creation, capacity deployment, estimating, pricing, or AI automation.

## Files Inspected

- `packages/database/migrations/006_opportunity_candidates_opportunities.sql`
- `packages/database/migrations/016_tenant_fk_hardening.sql`
- `packages/database/migrations/020_relationship_contract_hardening.sql`
- `packages/database/migrations/021_opportunity_candidate_contract_hardening.sql`
- `apps/api/src/routes/opportunities.controller.ts`
- `apps/api/src/routes/opportunity-candidates.controller.ts`
- `apps/api/src/routes/relationship-maps.controller.ts`
- `apps/api/src/routes/constraints.controller.ts`
- `packages/permissions/src/index.ts`
- `packages/database/scripts/seed.js`
- `docs/product/opportunity-candidate-backend-contract.md`

## 1. Current Backend Inventory

| Item | Classification | Current state |
|---|---|---|
| `opportunity_candidates` table | supported | Stores tenant, organization, territory, title/name, work type, owner, evidence/summary, status, confidence, candidate score, estimated value, relationship map, relationship access, rejection/archive metadata, lifecycle metadata, and timestamps. |
| Candidate routes | supported | List/detail/timeline/audit, create/update, owner assignment, relationship map link/unlink, monitor, investigate, qualify, reject, archive, score, signal attach/update/archive. |
| Candidate readiness | supported | Backend calculates readiness, completeness, missing items, `candidate_ready_for_opportunity`, and deterministic next action. |
| Candidate-to-opportunity relationship | partially supported | `opportunities.candidate_id` exists and `POST /opportunities` accepts `candidate_id`, but there is no explicit conversion route and candidate status is not automatically changed to converted. |
| `opportunities` table | partially supported | Stores candidate, organization, territory, owner, title, work type, evidence/scope, next action, proposal/award/loss/deferral fields, status/stage, estimated value, score components, pursuit score, recommendation. Missing explicit `relationship_map_id`, `source_type`, `source_candidate_id` alias, expected dates, probability, archive reason/note, and product `draft`/`pursuit_review`. |
| Opportunity routes | partially supported | Supports list, get by id, create, patch, pursuit approve, pursue, proposal, negotiation, award, lost, defer, archive, score, score summary, capacity requirement CRUD. No enriched detail, timeline, or audit summary endpoint. |
| Opportunity list read model | partially supported | Uses generic tenant list; not enriched for pipeline board/detail needs. |
| Opportunity lifecycle | partially supported | Backend statuses are `qualified`, `pursuit_approved`, `pursuing`, `bid_proposal`, `negotiation`, `awarded`, `lost`, `deferred`, `archived`. Product-proposed `draft` and `pursuit_review` do not exist. Product `proposal` maps to backend `bid_proposal`. |
| Opportunity lifecycle enforcement | supported but mismatched | Backend enforces strict transitions: `qualified -> pursuit_approved -> pursuing -> bid_proposal -> negotiation -> awarded`; lost/deferred are broad status updates. Product-proposed transitions differ and need approval. |
| Pursuit approval authority | partially supported | Requires `opportunity.pursuit_approve`, role `Executive` or `Growth Director`, pursuit score >= 70, a relationship path, positive capacity fit, and positive margin potential. Proposed roles/thresholds differ. |
| Opportunity scoring | supported but requires confirmation | Backend has deterministic score route using signal strength, relationship access, capacity fit, margin potential, strategic fit, and payment risk. This is an existing scoring formula, not newly approved for Product Sprint 6 changes. |
| `opportunity_capacity_requirements` table/routes | supported | Supports list/create/update/archive under existing opportunity routes. Does not allocate crews, create projects, or deploy capacity. |
| Relationship map linkage | partially supported | Relationship maps can link to `related_candidate_id` and `related_opportunity_id`. Candidates have `relationship_map_id`. Opportunities do not have `relationship_map_id`; opportunity approval checks relationship maps by target organization or candidate object. |
| Constraints/recommendations linkage | partially supported | Constraint/recommendation routes support related object patterns, including opportunity and opportunity candidate object types. Product-specific opportunity slices need confirmation of safe query scope. |
| Permissions seeded | supported | Opportunity permissions include read/create/update/pursuit_approve/pursue/proposal/negotiation/award/lost/defer/archive/score. Capacity requirement permissions exist. No opportunity timeline/audit permissions found. |
| Events approved/used | partially supported | Opportunity and capacity requirement writes create events through `executeWriteAction`. Existing event names include opportunity created/updated/pursuit_approved/pursuing/proposal/negotiation/awarded/lost/deferred/archived/scored and capacity requirement created/updated/archived. Conversion, owner assignment, timeline/audit events for opportunities are not separately approved. |
| Audit behavior | supported for writes | Opportunity writes use the write-action helper, producing event, event payload, audit log, and system action. Read endpoints for opportunity audit summary are missing. |
| Owner fields | supported | `opportunities.owner_user_id` exists and is validated on create/update/pursue. No dedicated opportunity owner assignment route exists. |
| Tenant-safe relationships | supported/partially supported | Tenant FKs exist from hardening migrations. Controllers validate organization, territory, owner, candidate, and capacity requirement tenant ownership. Relationship access checks are tenant-scoped. |
| Finance/settlement boundary | unsafe to infer | Finance tables reference opportunities, but Product Sprint 6 should not create contracts, settlements, invoices, payments, AR, or payroll records. |
| Project execution boundary | unsafe to infer | Project/production routes can reference awarded opportunities, but Product Sprint 6 must not create projects or production records automatically. |

## 2. Proposed Candidate To Opportunity Conversion Rules

A candidate may become an opportunity only when all approved conditions are satisfied:

- Candidate belongs to tenant.
- Candidate product status is `qualified` (`qualified_candidate` in current storage).
- Candidate has `organization_id`.
- Candidate has `territory_id`.
- Candidate has at least one active candidate signal.
- Candidate has `candidate_score >= 60` or `confidence_score >= 60`.
- Candidate has no unresolved critical constraint, if safely measurable.
- Candidate has `relationship_map_id` or an explicit override reason.
- Candidate has `relationship_access_score >= 50` or an explicit override reason.
- Actor has `opportunity.create`.
- Actor has pursuit authority if approval is required at conversion time.

### Conversion Route Options

| Option | Assessment |
|---|---|
| Option A: `POST /opportunity-candidates/:id/convert-to-opportunity` | Safest product contract for an auditable conversion. It can validate candidate readiness, copy approved fields, create the opportunity, optionally mark the candidate converted, and emit a conversion event. Requires new route approval. |
| Option B: `POST /opportunities` with `candidate_id` | Current backend supports this partially. It copies organization, territory, work type, evidence summary, and owner from a `qualified_candidate`. It does not enforce all Sprint 6 conversion requirements, does not copy relationship map linkage, does not mark candidate converted, and does not emit a conversion-specific event. |
| Option C: Manual opportunity creation and later link | Safest operationally if conversion semantics are not approved, but weakest product experience and highest risk of inconsistent data. |

Recommendation: approve Option A for Product Sprint 6 backend hardening, or use Option B only as a temporary compatibility path with explicit product warnings. Do not proceed with Product Sprint 6 UI conversion until this is confirmed.

### Fields Approved To Copy From Candidate

- `organization_id`
- `territory_id`
- `work_type`
- `estimated_value`
- source candidate id, using existing `candidate_id` unless a future `source_candidate_id` is approved
- `relationship_map_id`, only if opportunity schema is approved to add it
- `relationship_access_score`
- `summary` or existing `evidence_summary`
- `owner_user_id`
- `confidence_score`/`candidate_score` only into approved opportunity score fields, not blindly

### Fields Not Approved To Copy

- Candidate lifecycle status as opportunity status.
- Candidate rejection/archive fields.
- Signal records as opportunity records.
- Project records.
- Production records.
- Capacity allocation records.
- Contract, settlement, invoice, AR, payment, retainage, or payroll records.

## 3. Opportunity Required Fields

Recommended required opportunity creation fields:

- `opportunity_name`/current `title`
- `organization_id`
- `territory_id`
- `work_type`
- `estimated_value`
- `source_type`
- `status`
- `owner_user_id`

Strongly recommended fields:

- `candidate_id` or approved `source_candidate_id`
- `relationship_map_id`
- `relationship_access_score`
- `pursuit_score`
- `expected_start_date`
- `expected_decision_date`
- `probability`
- `summary`
- `risk_notes`

Optional fields:

- `customer_organization_id` if different from `organization_id`
- `prime_organization_id`
- `engineering_firm_organization_id`
- `bid_due_date`
- `scope_summary`
- `location_summary`

Stop point: `organization_id` is ambiguous. It could mean customer/work creator, prime/work distributor, target account, or a generic related organization. Product Sprint 6 should either confirm one meaning or approve future explicit role fields. Do not infer organization role from organization type or actor roles during opportunity creation.

## 4. Opportunity Lifecycle

Proposed product statuses:

- `draft`
- `pursuit_review`
- `pursuit_approved`
- `pursuing`
- `proposal`
- `negotiation`
- `awarded`
- `lost`
- `deferred`
- `archived`

Current backend mapping:

| Product label | Current backend status | Status |
|---|---|---|
| `draft` | none | missing |
| `pursuit_review` | none | missing |
| `pursuit_approved` | `pursuit_approved` | supported |
| `pursuing` | `pursuing` | supported |
| `proposal` | `bid_proposal` | supported with naming mismatch |
| `negotiation` | `negotiation` | supported |
| `awarded` | `awarded` | supported |
| `lost` | `lost` | supported |
| `deferred` | `deferred` | supported |
| `archived` | `archived` | supported |
| current initial backend status | `qualified` | supported but not in proposed Product Sprint 6 lifecycle |

Recommendation: do not use UI-only lifecycle labels. Product Sprint 6 should harden the backend lifecycle first if `draft` and `pursuit_review` are approved. Otherwise Product Sprint 6 should use current backend statuses only and document the mismatch.

## 5. Opportunity Lifecycle Transition Rules

Proposed product transitions:

- `draft -> pursuit_review | archived`
- `pursuit_review -> pursuit_approved | deferred | lost | archived`
- `pursuit_approved -> pursuing | deferred | archived`
- `pursuing -> proposal | negotiation | lost | deferred | archived`
- `proposal -> negotiation | awarded | lost | deferred`
- `negotiation -> awarded | lost | deferred`
- `awarded -> archived` only in Product Sprint 6
- `lost -> archived`
- `deferred -> pursuit_review | pursuing | archived`
- `archived` is view-only unless restore is later approved

Current backend enforcement:

- Create always starts opportunity at `qualified`.
- Pursuit approval requires current status `qualified`.
- Pursue requires `pursuit_approved`.
- Proposal requires `pursuing`.
- Negotiation requires `bid_proposal`.
- Award requires `negotiation`.
- Lost/deferred currently do not enforce a narrow source status.
- Archive can archive any opportunity.

Mismatch: current backend has `qualified`, not `draft` or `pursuit_review`; current proposal value is `bid_proposal`; current lost/deferred transitions are broader than proposed product rules.

## 6. Pursuit Approval Authority

Proposed authority:

- Under $50,000: Growth Director or above
- $50,000-$250,000: Regional Director or Executive
- Over $250,000: Executive

Current backend authority:

- Requires `opportunity.pursuit_approve`.
- Requires role `Executive` or `Growth Director`.
- Does not include `Regional Director` for opportunity approval.
- Does not enforce value thresholds.
- Requires pursuit score >= 70.
- Requires at least one tenant-safe relationship path.
- Requires positive capacity fit.
- Requires positive margin potential.

Required clarification: is `opportunity.pursuit_approve` sufficient, or must role/value authority also be enforced? If value thresholds are approved, the backend must be hardened before UI can rely on them.

## 7. Relationship Access Boundary

Recommended Product Sprint 6 rule:

- `relationship_map_id` is recommended.
- `relationship_access_score >= 50` is recommended.
- No or weak relationship access should warn and require override reason, not hard block draft creation.
- Pursuit approval should warn when relationship access is weak.
- Relationship access may influence pursuit score only through approved backend scoring.

Current backend:

- Opportunity schema does not store `relationship_map_id`.
- Candidate schema stores `relationship_map_id`.
- Relationship maps can store `related_opportunity_id`.
- Pursuit approval hard-blocks unless a relationship path exists for the opportunity organization or candidate.

Required clarification: should weak/no relationship access block pursuit approval? Default recommendation: no hard block yet; require warning plus override reason. This conflicts with current hard-block behavior and needs backend decision before Sprint 6 coding.

## 8. Capacity Requirement Boundary

Approved safe scope for Product Sprint 6:

- View existing opportunity capacity requirements.
- Create capacity requirement records only through existing approved route.
- Edit/archive capacity requirement records only through existing approved routes.
- Show capacity coverage summary only if backend provides it.

Do not build:

- Capacity deployment.
- Crew assignment.
- Project creation.
- Work orders.
- Production records.
- Capacity allocation automation.

Current backend:

- Proposal transition hard-blocks without an active capacity requirement.
- Pursuit approval hard-blocks unless `capacity_fit_score > 0`.

Default recommendation: opportunity creation should not require capacity requirements. Capacity requirements may be required for proposal/award only if approved. Product must confirm whether current hard blocks remain correct.

## 9. Finance / Settlement Boundary

Product Sprint 6 must not create:

- Contracts.
- Rate schedules.
- Settlements.
- Settlement items.
- Invoices.
- AR.
- Payments.
- Cash receipts.
- Retainage.
- Payroll.

Awarded opportunity must not automatically create project, contract, settlement, or invoice records in Product Sprint 6.

## 10. Opportunity Scoring

Current backend scoring exists:

- `signal_strength_score * 0.20`
- `relationship_access_score * 0.20`
- `capacity_fit_score * 0.20`
- `margin_potential_score * 0.15`
- `strategic_fit_score * 0.15`
- `(100 - payment_risk_score) * 0.10`

The result is `pursuit_score` with recommendation `Avoid`, `Monitor`, `Pursue`, or `Priority Pursuit`.

Required clarification:

- Is this formula approved for full Opportunity Pipeline?
- Should `pursuit_score` be manually entered, calculated, or both?
- Should score route remain as-is for Sprint 6?

Default recommendation: use existing backend score where available, but do not invent new scoring components or formulas in Sprint 6.

## 11. Constraints And Recommendations Boundary

Allowed:

- Show constraints related to opportunity when safely filtered.
- Create constraints manually only through existing route.
- Show recommendations related to opportunity when safely filtered.
- Approve/reject/defer recommendations only through existing routes.

Not allowed:

- Auto-create constraints.
- Auto-generate recommendations.
- Auto-convert recommendations into opportunity actions unless an existing workflow explicitly supports that exact action.

## 12. Events

Current opportunity/capacity events used by routes:

- `opportunity.created`
- `opportunity.updated`
- `opportunity.pursuit_approved`
- `opportunity.pursuing`
- `opportunity.proposal`
- `opportunity.negotiation`
- `opportunity.awarded`
- `opportunity.lost`
- `opportunity.deferred`
- `opportunity.archived`
- `opportunity.scored`
- `capacity_requirement.created`
- `capacity_requirement.updated`
- `capacity_requirement.archived`

Events requiring approval before implementation:

- `opportunity.converted_from_candidate`
- `opportunity.owner_assigned`
- `opportunity.relationship_map_linked`
- `opportunity.relationship_map_unlinked`
- Any `opportunity.draft_created` or `opportunity.pursuit_reviewed` event if those statuses are approved.

## 13. Audit

Every opportunity write must continue to create:

- event
- event payload
- audit log
- system action

Current backend writes use `executeWriteAction`.

Missing for Product Sprint 6:

- `GET /opportunities/:id/detail`
- `GET /opportunities/:id/timeline`
- `GET /opportunities/:id/audit-summary`
- Opportunity audit read permission, if a specific permission is required.

## 14. Recommended Product Sprint 6 Scope

Recommended only after confirmations:

- Opportunity Pipeline page.
- Opportunity Create/Edit.
- Opportunity Detail.
- Candidate conversion flow if Option A or Option B is approved.
- Opportunity lifecycle actions mapped to backend-truthful statuses.
- Relationship access panel.
- Capacity requirements summary/editor only using existing capacity requirement routes.
- Constraints/recommendations slices.
- Timeline/audit only after backend endpoint hardening or if existing endpoints are approved.
- AI pursuit placeholder only, with no live AI or automatic updates.

Recommended non-scope:

- Project creation.
- Awarded-to-project conversion.
- Proposal document generation.
- Contract generation.
- Pricing or estimating engine.
- Finance records.
- Capacity deployment.
- Automated recommendations.
- New workflow categories.

## 15. Required Confirmations

1. Should candidate conversion use `POST /opportunity-candidates/:id/convert-to-opportunity`, `POST /opportunities` with `candidate_id`, or manual opportunity creation/linking?
2. Should no/weak relationship access block pursuit approval, or only warn with override reason?
3. Which roles are approved for pursuit approval?
4. Are value-based approval thresholds approved?
5. Should opportunity creation require capacity requirements?
6. Should awarded opportunity create anything automatically?
7. Should opportunity scoring be manual, calculated, or deferred?
8. Should Product Sprint 6 include opportunity backend hardening first or UI workspace first?
9. What does `organization_id` mean on an opportunity: customer/work creator, prime/work distributor, target account, or generic related organization?
10. Should backend add `relationship_map_id` directly to opportunities, or rely on relationship maps' `related_opportunity_id`?
11. Should Product Sprint 6 add `draft` and `pursuit_review`, or use the current `qualified` starting status?
12. Should archive reason/note be required for opportunities in Sprint 6?

## 16. Ambiguities / Stop Points

- Candidate conversion semantics are not locked.
- Product lifecycle does not match current backend statuses.
- Pursuit authority roles and thresholds do not match current backend authority.
- Relationship access is currently a hard approval dependency, while proposed rules suggest warning plus override.
- Capacity requirement behavior is stricter in current backend than proposed draft creation rules.
- Opportunity organization role is ambiguous.
- Opportunity relationship map storage is incomplete.
- Opportunity audit/timeline read models are missing.
- Opportunity archive reason is not persisted today.
- Awarded opportunity boundaries must be explicitly confirmed so no project/finance side effects are added.

## 17. GO / NO-GO Recommendation

NO-GO for Product Sprint 6 coding until the required confirmations above are answered.

Recommended next step: run an Opportunity Pipeline backend-contract hardening sprint first. That sprint should lock conversion route behavior, lifecycle statuses, opportunity required fields, relationship map linkage, archive reason, detail/timeline/audit endpoints, and pursuit approval authority before building the full Opportunity Pipeline UI.
