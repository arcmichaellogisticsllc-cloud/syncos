# Opportunity Candidate Backend Contract

## Schema Fields

`opportunity_candidates` supports `name/title`, `summary`, `source_note`, `source_type`, `organization_id`, `territory_id`, `work_type`, `estimated_value`, `confidence_score`, `candidate_score`, `score`, `owner_user_id`, `relationship_map_id`, `relationship_access_score`, `status`, rejection metadata, archive metadata, and lifecycle metadata for monitored, investigated, and qualified states.

`candidate_signals` supports `candidate_id`, `signal_id`, `contribution_score`, `contribution_note`, `status`, `archive_reason`, `archive_note`, `archived_by`, and `archived_at`.

## Status Mapping

Product status `qualified` maps to stored backend value `qualified_candidate`. Enriched reads expose `normalized_status`.

Approved product statuses:

- `created`
- `monitoring`
- `investigating`
- `qualified`
- `rejected`
- `archived`

## Work Types

Approved values are `fiber`, `coax`, `aerial`, `underground`, `directional_bore`, `trenching`, `splicing`, `drops`, `make_ready`, `inspection`, `restoration`, `project_management`, and `unknown`.

The API validates work type on create/update. Legacy rows are not invalidated by a destructive enum migration. For backward compatibility with earlier candidate APIs, legacy input `fiber_build` is normalized to approved value `fiber`.

## Source Types

Approved values are `signal`, `organization_research`, `relationship_map`, `manual_entry`, `customer_request`, `prime_request`, `public_source`, `internal_note`, and `other`.

## Value And Score Rules

- `estimated_value` is nullable and must be greater than or equal to 0 when supplied.
- `confidence_score` is nullable and must be 0-100.
- `candidate_score` is nullable and must be 0-100.
- Existing `score` remains backward compatible and is kept aligned with `candidate_score` when scoring.

## Relationship Map Linkage

Candidates store `relationship_map_id`.

Routes:

- `POST /opportunity-candidates/:id/link-relationship-map`
- `POST /opportunity-candidates/:id/unlink-relationship-map`

Validation:

- Candidate belongs to tenant.
- Relationship map belongs to tenant.
- Cross-tenant map links are rejected.
- If target organization mismatches candidate organization, the route returns warning metadata instead of inventing a hard block.

`relationship_access_score` is backend-truthful from the linked relationship map access score. If no relationship map is linked, it is `null`.

## Read Models

`GET /opportunity-candidates` returns enriched rows with core fields, organization/territory/owner names, relationship map name, signal counts, constraint/recommendation counts, readiness, completeness, and deterministic next action.

`GET /opportunity-candidates/:id/detail` returns:

- `candidate`
- `organization_context`
- `attached_signals`
- `relationship_map_context`
- `related_contacts`
- `constraints_summary`
- `recommendations_summary`
- `score_summary`
- `readiness`
- `completeness`
- `audit_allowed`
- `timeline_available`

## Filters And Sorting

Supported list filters include status, normalized status, organization, territory, work type, estimated value range, confidence range, candidate score range, relationship access range, owner, has signals, has organization, has relationship map, ready for opportunity, archived, created/updated date ranges, and text search.

Supported sorts include updated descending, created descending, candidate score descending, confidence descending, estimated value descending, relationship access descending, status, organization, and default.

## Readiness Logic

Readiness checklist:

- Organization attached
- Territory attached
- At least one active signal attached
- Confidence score captured
- Candidate score captured
- Relationship access available when a relationship map is linked
- No critical constraints when safely available
- Status qualified

`candidate_ready_for_opportunity` is true only when organization, territory, active signal, sufficient score/confidence, qualified status, and linked relationship access requirements are met.

## Recommended Next Action

The backend calculates deterministic next action. It does not create recommendations, opportunities, constraints, or workflow tasks automatically.

## Lifecycle Rules

- Monitor sets status `monitoring`, `monitored_by`, and `monitored_at`.
- Investigate sets status `investigating`, `investigated_by`, and `investigated_at`.
- Qualify stores `qualified_by` and `qualified_at`, while preserving `qualified_candidate` storage compatibility.
- Reject requires approved `rejection_reason`.
- Archive requires approved `archive_reason`.

## Timeline And Audit

`GET /opportunity-candidates/:id/timeline` returns direct candidate events, candidate signal events, and safely related constraint/recommendation events.

`GET /opportunity-candidates/:id/audit-summary` is protected by `opportunity_candidate.audit.read` and returns direct candidate and candidate signal audit rows only.

## Deferred Gaps

- Full opportunity conversion remains deferred.
- Capacity fit is not a planning engine in this sprint.
- Related contacts are limited to safe organization/relationship-map context.
- Constraint/recommendation summaries are direct candidate relationships only.
