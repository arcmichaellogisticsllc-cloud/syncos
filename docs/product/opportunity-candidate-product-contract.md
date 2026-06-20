# Opportunity Candidate Product Contract

## Scope

Product Sprint 5 exposes the Opportunity Candidate layer only: Candidate Board, Candidate Create/Edit, Candidate Detail, signal attachment, relationship access visibility, lifecycle actions, score display, timeline, and audit where authorized.

This sprint does not build the full Opportunity Pipeline, pursuit management, estimating, pricing, capacity deployment, project creation, or finance execution.

## Frontend Routes

- `/opportunities`
- `/opportunities/candidates`
- `/opportunities/candidates/new`
- `/opportunities/candidates/:id`
- `/opportunities/candidates/:id/edit`

## Backend Endpoints Used

- `GET /opportunity-candidates`
- `GET /opportunity-candidates/:id/detail`
- `GET /opportunity-candidates/:id/timeline`
- `GET /opportunity-candidates/:id/audit-summary`
- `GET /opportunity-candidates/:id`
- `POST /opportunity-candidates`
- `PATCH /opportunity-candidates/:id`
- `POST /opportunity-candidates/:id/assign-owner`
- `POST /opportunity-candidates/:id/link-relationship-map`
- `POST /opportunity-candidates/:id/unlink-relationship-map`
- `POST /opportunity-candidates/:id/monitor`
- `POST /opportunity-candidates/:id/investigate`
- `POST /opportunity-candidates/:id/qualify`
- `POST /opportunity-candidates/:id/reject`
- `POST /opportunity-candidates/:id/archive`
- `GET /opportunity-candidates/:id/signals`
- `POST /opportunity-candidates/:id/signals`
- `POST /candidate-signals/:id/archive`
- `POST /opportunity-candidates/:id/score`
- `GET /opportunity-candidates/:id/score-summary`
- `GET /signals`
- `GET /organizations`
- `GET /relationship-maps`
- `GET /constraints`
- `GET /recommendations`
- `GET /auth/me/permissions`

No direct database access is used by the web app.

## Candidate Board Fields

The board/table displays backend-truthful:

- Candidate name
- Normalized product status
- Related organization
- Territory
- Work type
- Estimated value
- Confidence score
- Candidate score
- Relationship map
- Relationship access score
- Active signal count
- Owner
- Created date
- Updated date
- Readiness/completeness
- Recommended next action

## Candidate Statuses

Product statuses are `created`, `monitoring`, `investigating`, `qualified`, `rejected`, and `archived`.

The backend preserves the legacy stored value `qualified_candidate` and exposes `normalized_status = qualified` in enriched read models. Product UI sends `qualified` and the API maps it safely where accepted.

## Lifecycle Actions

The UI uses backend lifecycle routes:

- Monitor stores `monitored_by` and `monitored_at`.
- Investigate stores `investigated_by` and `investigated_at`.
- Qualify stores `qualified_by` and `qualified_at`.
- Reject requires and stores `rejection_reason`; `rejection_note` is optional.
- Archive requires and stores `archive_reason`; `archive_note` is optional.

No opportunity is created by this sprint.

## Signal Attachment

Candidate signals are attached through `POST /opportunity-candidates/:id/signals`.

The API validates tenant ownership, rejects duplicate active links, stores optional `contribution_score` and `contribution_note`, and supports soft archive through `POST /candidate-signals/:id/archive` with required archive reason.

## Scoring Display

The UI uses `GET /opportunity-candidates/:id/score-summary` and `POST /opportunity-candidates/:id/score`.

The API persists `candidate_score` alongside the legacy `score` field. The UI does not define or override backend scoring logic.

## Relationship Access

Candidate relationship access is backend-truthful:

- `relationship_map_id` is first-class on candidates.
- Linking uses `POST /opportunity-candidates/:id/link-relationship-map`.
- Unlinking uses `POST /opportunity-candidates/:id/unlink-relationship-map`.
- `relationship_access_score` is copied from the linked relationship map access score.
- Cross-tenant relationship maps are rejected.

The UI does not infer the “best possible” map for persistence.

## Recommended Next Action

The API returns deterministic `recommended_next_action`:

- `view_only`
- `review_rejection`
- `attach_organization`
- `attach_territory`
- `attach_signal`
- `link_relationship_map`
- `build_relationship_access`
- `score_candidate`
- `monitor_or_investigate`
- `investigate`
- `qualify_candidate`
- `ready_for_opportunity_later`
- `continue_review`

No recommendation records are created automatically.

## Unsupported Sections

The UI still shows honest deferred states for:

- Full Opportunity Pipeline
- Project creation from opportunity
- Capacity deployment
- Estimating/pricing engines
- Finance execution
- AI pursuit automation

## Permissions Surfaced

- `opportunity_candidate.read`
- `opportunity_candidate.create`
- `opportunity_candidate.update`
- `opportunity_candidate.monitor`
- `opportunity_candidate.investigate`
- `opportunity_candidate.qualify`
- `opportunity_candidate.reject`
- `opportunity_candidate.archive`
- `opportunity_candidate.score`
- `opportunity_candidate.assign_owner`
- `opportunity_candidate.link_relationship_map`
- `opportunity_candidate.timeline.read`
- `opportunity_candidate.audit.read`
- `candidate_signal.read`
- `candidate_signal.create`
- `candidate_signal.update`
- `candidate_signal.archive`
- `signal.read`
- `organization.read`
- `contact.read`
- `relationship_map.read`
- `constraint.read`
- `constraint.create`
- `recommendation.read`

Backend authorization remains the source of truth.

## Deferred Backend Gaps

- No full opportunity conversion pipeline in this sprint.
- Capacity fit remains score/placeholder only unless future Capacity Workspace endpoints provide a richer summary.
- Constraint/recommendation summaries are limited to safely joinable direct candidate relationships.
