# Coverage Planning Backend Contract

Coverage Planning is the backend bridge between Award Acceptance and Project Handoff. It answers whether awarded work can be responsibly covered through capacity, compliance, and economic readiness.

Coverage Planning must not create Project, Work Order, Production, Settlement, Invoice, Payment, Payroll, or Cash records.

## Object Model

First-class objects:

- `coverage_plans`
- `coverage_requirements`
- `coverage_sources`
- `coverage_gaps`

`coverage_plans` are scoped to one awarded opportunity and one tenant. Duplicate active plans for the same opportunity are blocked unless an override reason is supplied.

## Coverage Plans

Statuses:

- `not_started`
- `requirements_defined`
- `sources_identified`
- `partially_covered`
- `fully_covered`
- `covered_with_risk`
- `gap_exists`
- `blocked`
- `approved_for_handoff`
- `archived`

Stored fields include opportunity linkage, status, coverage/capacity/compliance/economic readiness scores, readiness band, operations owner, handoff approval metadata, override reasons, notes, actor metadata, archive metadata, and timestamps.

## Requirements

`coverage_requirements` define required work and capacity:

- `work_type`
- `territory_id`
- `quantity`
- `unit`
- `required_crew_type`
- `required_equipment_type`
- required dates
- production rate assumption
- notes

Approved units are `feet`, `miles`, `drops`, `addresses`, `passings`, `splice_cases`, `nodes`, `poles`, `permits`, `inspections`, `restoration_items`, `days`, `crews`, `workers`, and `equipment_units`.

## Sources

Coverage source types are `internal_workforce`, `approved_subcontractor`, `preferred_contractor`, `strategic_partner`, `recruitable_contractor`, `partner_workforce`, `vendor_equipment_source`, `staffing_source`, `mixed_coverage`, and `unknown`.

Commitment statuses are `identified`, `contacted`, `interested`, `verbally_committed`, `committed`, `unavailable`, `rejected`, and `needs_activation`.

Sources can link to organizations, capacity providers, crews, equipment, and requirements. A source is not a dispatch assignment.

## Gaps

Coverage gaps track unresolved coverage risk with type, severity, quantities, owner, due date, recommended action, override behavior, hard-stop behavior, resolution metadata, and archive metadata.

Severity values are `low`, `medium`, `high`, and `critical`.

Hard-stop gaps block handoff approval. Non-hard-stop gaps warn and require override or resolution.

## Economic Readiness

Economic readiness uses source-level estimated cost, expected margin amount, expected margin percent, and margin confidence.

Initial scores:

- `strong_margin`: 100
- `acceptable_margin`: 85
- `low_margin`: 60
- `negative_margin`: 30
- `unknown`: 40

Margin unknown, low margin, and negative margin are warnings, not automatic hard blocks. A hard block only occurs when an explicit `hard_stop` gap exists.

## Readiness Score

Components:

- `capacity_readiness_score`: required quantity covered by credible active sources
- `compliance_readiness_score`: provider and capacity-record indicators where safely available; otherwise null with warning
- `economic_readiness_score`: deterministic margin readiness score

`coverage_readiness_score` is the rounded average of available component scores.

Bands:

- `not_ready`: 0-39
- `needs_coverage_work`: 40-69
- `covered_with_risk`: 70-84
- `ready_for_handoff`: 85-100

## API Routes

Coverage Plans:

- `GET /coverage-plans`
- `GET /coverage-plans/:id`
- `GET /coverage-plans/:id/detail`
- `GET /coverage-plans/:id/timeline`
- `GET /coverage-plans/:id/audit-summary`
- `POST /coverage-plans`
- `PATCH /coverage-plans/:id`
- `POST /coverage-plans/:id/recalculate`
- `POST /coverage-plans/:id/approve-for-handoff`
- `POST /coverage-plans/:id/archive`

Requirements:

- `GET /coverage-plans/:id/requirements`
- `POST /coverage-plans/:id/requirements`
- `PATCH /coverage-requirements/:id`
- `POST /coverage-requirements/:id/archive`

Sources:

- `GET /coverage-plans/:id/sources`
- `POST /coverage-plans/:id/sources`
- `PATCH /coverage-sources/:id`
- `POST /coverage-sources/:id/archive`

Gaps:

- `GET /coverage-plans/:id/gaps`
- `POST /coverage-plans/:id/gaps`
- `PATCH /coverage-gaps/:id`
- `POST /coverage-gaps/:id/resolve`
- `POST /coverage-gaps/:id/override`
- `POST /coverage-gaps/:id/archive`

## Handoff Approval

`POST /coverage-plans/:id/approve-for-handoff` requires `approval_note` and `override_reasons` when warnings exist.

Approval validates tenant ownership, permission, awarded opportunity state, non-archived plan state, requirements, coverage source presence unless overridden, reviewed capacity/compliance/economic readiness, and absence of unresolved hard-stop or hard-blocked gaps.

Approval sets status to `approved_for_handoff`, stores approval actor/timestamp, stores override reasons, emits `coverage_plan.approved_for_handoff`, and creates audit/system_action records. It does not create a project.

Warnings require matching override fields:

- economic warnings: `economic_override_reason`
- capacity warnings: `capacity_override_reason`
- compliance warnings: `compliance_override_reason`
- open gap warnings: `gaps_override_reason` when no more specific category applies
- missing source or source commitment warnings: `source_override_reason`

Hard-stop gaps, hard-blocked gaps, archived plans, and non-awarded opportunities block approval.

## Enriched List Response

`GET /coverage-plans` returns backend-enriched rows with plan, opportunity, organization, territory, owner, approval, readiness, and count fields:

- `requirements_count`, `active_requirements_count`
- `sources_count`, `active_sources_count`
- `gaps_count`, `open_gaps_count`, `hard_stop_gaps_count`
- `overridden_gaps_count`, `resolved_gaps_count`
- `economic_gaps_count`, `compliance_gaps_count`, `capacity_gaps_count`
- `warnings`, `blockers`, `required_override_fields`
- `recommended_next_action`
- `ready_for_handoff`, `has_hard_stop`, `has_economic_risk`, `has_compliance_risk`, `has_capacity_gap`
- `operations_owner_name`, `approved_for_handoff_by_name`

Archived child rows do not count toward active counts.

Filters include status, opportunity, organization, territory, owner, readiness ranges, requirement/source/gap booleans, hard-stop/economic/compliance/capacity risk booleans, approved state, archived state, and text search.

Sorting includes `updated_desc`, `readiness_asc`, `readiness_desc`, `hard_stops_desc`, `open_gaps_desc`, `opportunity_value_desc`, `status`, `approved_at_desc`, and default sorting by hard stops, lowest readiness, and recently updated.

## Recommended Next Action

The backend returns deterministic `recommended_next_action`:

- `view_only` for archived plans
- `define_requirements` when no active requirements exist
- `identify_sources` when no active sources exist
- `resolve_hard_stops` when hard-stop gaps exist
- `resolve_or_override_gaps` when open gaps exist
- `review_margin` when economic readiness is unknown
- `review_margin_risk` when economic readiness is below 70
- `review_compliance` when compliance readiness is unknown
- `review_capacity` when capacity readiness is unknown
- `approve_for_handoff` when readiness is at least 85
- `continue_coverage_planning` otherwise

The backend never auto-approves.

## Enriched Detail Response

`GET /coverage-plans/:id/detail` returns:

- `coverage_plan` with enriched list fields
- `opportunity_context`
- `requirements`
- `sources`
- `gaps`
- `readiness`
- `warnings`
- `blockers`
- `required_override_fields`
- `recommended_next_action`
- `approval_context`
- `economic_summary`
- `capacity_summary`
- `compliance_summary`
- `audit_allowed`
- `timeline_available`

Source rows include safe organization, capacity provider, crew, equipment, and actor names where available. Gap rows include owner and resolver names where available.

## Timeline And Audit

`GET /coverage-plans/:id/timeline` returns tenant-scoped coverage plan, requirement, source, and gap events:

- `coverage_plan.created`, `updated`, `recalculated`, `approved_for_handoff`, `archived`
- `coverage_requirement.created`, `updated`, `archived`
- `coverage_source.created`, `updated`, `archived`
- `coverage_gap.created`, `updated`, `resolved`, `overridden`, `archived`

`GET /coverage-plans/:id/audit-summary` returns direct coverage plan, requirement, source, and gap audit records. It requires `coverage_plan.audit.read` and never exposes cross-tenant audit payloads.

## Compliance Readiness

Compliance readiness uses only safe existing indicators:

- compliance and safety gap types
- sources linked to capacity providers
- capacity provider status
- capacity record compliance and insurance status
- compliance documents linked to provider sources

If compliance data is unavailable, the backend returns a `compliance_unknown` warning instead of fabricating readiness.

## Archive Reasons

Archive routes require `archive_reason` for plans, requirements, sources, and gaps.

Approved reasons:

- `duplicate`
- `no_longer_relevant`
- `replaced`
- `created_in_error`
- `opportunity_cancelled`
- `other`

Archive metadata stores reason, optional note where supported, actor, and timestamp.

## Permissions

Added permissions:

- `coverage_plan.read`
- `coverage_plan.create`
- `coverage_plan.update`
- `coverage_plan.recalculate`
- `coverage_plan.approve_handoff`
- `coverage_plan.archive`
- `coverage_plan.audit.read`
- `coverage_requirement.read`
- `coverage_requirement.create`
- `coverage_requirement.update`
- `coverage_requirement.archive`
- `coverage_source.read`
- `coverage_source.create`
- `coverage_source.update`
- `coverage_source.archive`
- `coverage_gap.read`
- `coverage_gap.create`
- `coverage_gap.update`
- `coverage_gap.resolve`
- `coverage_gap.override`
- `coverage_gap.archive`

## Events

Added events:

- `coverage_plan.created`
- `coverage_plan.updated`
- `coverage_plan.recalculated`
- `coverage_plan.approved_for_handoff`
- `coverage_plan.archived`
- `coverage_requirement.created`
- `coverage_requirement.updated`
- `coverage_requirement.archived`
- `coverage_source.created`
- `coverage_source.updated`
- `coverage_source.archived`
- `coverage_gap.created`
- `coverage_gap.updated`
- `coverage_gap.resolved`
- `coverage_gap.overridden`
- `coverage_gap.archived`

Every write uses the shared write-action helper and creates event, event_payload, audit_log, and system_action records.

## Search

Global search includes `coverage_plan` records and excludes archived plans unless `archived=true`.

## Deferred

- Coverage Planning UI
- Project Handoff object
- Project creation from awarded work
- Crew dispatch
- Work orders
- Production
- Settlement, invoice, payment, payroll, and cash records
- Pricing engine
- AI automation
