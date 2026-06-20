# Opportunity Pipeline Backend Contract

## Schema Fields

Opportunities persist product-facing pursuit fields including `summary`, `source_type`, `source_candidate_id`, organization role references, `territory_id`, `work_type`, `estimated_value`, `pursuit_score`, `probability`, `relationship_map_id`, `relationship_access_score`, `capacity_readiness_score`, `margin_potential_score`, owner, expected dates, bid date, scope/location/risk notes, pursuit review metadata, pursuit approval override reasons, lost/deferred/archive reasons and actor timestamps, award metadata, and standard timestamps.

Capacity requirements remain planning records only. They support work type, required crew type, estimated quantity, unit, required date range, notes, archive reason, and archive metadata.

## Status Mapping

New opportunity records use product statuses: `draft`, `pursuit_review`, `pursuit_approved`, `pursuing`, `proposal`, `negotiation`, `awarded`, `lost`, `deferred`, `archived`.

Legacy read normalization:

- `qualified` -> `draft`
- `bid_proposal` -> `proposal`

Legacy statuses remain accepted so existing records and smoke tests are not broken.

## Candidate Conversion

`POST /opportunity-candidates/:id/convert-to-opportunity` creates a distinct opportunity from a qualified candidate. It validates tenant scope, `opportunity.create`, qualified candidate status, organization, territory, active signal evidence, score/confidence >= 60, and duplicate active conversion unless an override reason is supplied.

Conversion copies only approved candidate fields into opportunity source fields. It does not copy candidate lifecycle, rejection/archive metadata, signal rows, project records, production records, or finance records. It emits `opportunity.created` and `opportunity.converted_from_candidate`.

## Manual Creation

`POST /opportunities` requires opportunity name, organization, territory, work type, estimated value, owner, and status defaulting to `draft`. Relationship access is optional. Weak or missing relationship access returns warning metadata instead of blocking creation.

## Relationship Access

`relationship_map_id` is first-class on opportunity. Link/unlink routes update `relationship_access_score` from the relationship map backend score. Missing or weak relationship access is a warning and recommended action path, not a hard acquisition blocker.

## Pursuit Approval

`POST /opportunities/:id/pursuit-approve` hard-blocks only true integrity or permission failures: wrong tenant, missing permission, archived record, missing core fields, invalid status, or explicit critical constraints without review. Relationship, capacity, margin, constraint, and pursuit-score risks require override reasons and are persisted.

## Reasons

Lost requires `lost_reason`. Deferred requires `deferred_reason`. Archive requires `archive_reason`. Capacity requirement archive also requires an approved archive reason.

## Read Models

`GET /opportunities` returns enriched rows with normalized status, organization, territory, owner, source candidate, relationship map, scores, counts, readiness, warnings, blockers, and backend deterministic recommended next action.

`GET /opportunities/:id/detail` returns opportunity, source candidate context, organization context, relationship map context, capacity requirements, constraints, recommendations, score summary, readiness, warnings, blockers, and audit/timeline availability flags.

## Filters And Sorting

Supported filters include status, normalized status, organization, customer organization, territory, work type, estimated value range, pursuit score range, relationship access range, owner, source candidate, source-candidate presence, relationship-map presence, capacity-requirement presence, open-constraint presence, expected decision date range, archived, and text search.

Supported sorting includes updated, created, estimated value, pursuit score, relationship access, expected decision, status, organization, and default.

## Timeline And Audit

`GET /opportunities/:id/timeline` returns opportunity and capacity requirement events scoped to the tenant.

`GET /opportunities/:id/audit-summary` requires `opportunity.audit.read` and returns direct opportunity and capacity requirement audit records scoped to the tenant.

## Boundaries

Awarding an opportunity only changes opportunity status and metadata. It does not create projects, work orders, contracts, settlements, invoices, payments, payroll, cash records, or capacity deployment.

## Deferred Gaps

Value-based approval thresholds and full pursuit management remain deferred. Capacity coverage and margin automation are warnings only unless future backend policy explicitly models hard-stop constraints.
