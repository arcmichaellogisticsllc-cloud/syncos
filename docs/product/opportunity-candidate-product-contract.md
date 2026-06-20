# Opportunity Candidate Product Contract

## Scope

Product Sprint 5 exposes the Opportunity Candidate layer only:

- Candidate Board
- Candidate List/Table View
- Candidate Create/Edit
- Candidate Detail
- Candidate signal attachment
- Candidate lifecycle actions supported by the existing backend
- Candidate scoring display supported by the existing backend

This sprint does not build the full Opportunity Pipeline, pursuit management, estimating, pricing, capacity deployment, project creation, or finance execution.

## Frontend Routes

- `/opportunities`
- `/opportunities/candidates`
- `/opportunities/candidates/new`
- `/opportunities/candidates/:id`
- `/opportunities/candidates/:id/edit`

## Backend Endpoints Used

- `GET /opportunity-candidates`
- `GET /opportunity-candidates/:id`
- `POST /opportunity-candidates`
- `PATCH /opportunity-candidates/:id`
- `POST /opportunity-candidates/:id/monitor`
- `POST /opportunity-candidates/:id/investigate`
- `POST /opportunity-candidates/:id/qualify`
- `POST /opportunity-candidates/:id/reject`
- `POST /opportunity-candidates/:id/archive`
- `GET /opportunity-candidates/:id/signals`
- `POST /opportunity-candidates/:id/signals`
- `POST /opportunity-candidates/:id/score`
- `GET /opportunity-candidates/:id/score-summary`
- `GET /signals`
- `GET /organizations`
- `GET /relationship-maps`
- `GET /constraints`
- `GET /recommendations`
- `GET /auth/me/permissions` where available through session permission configuration

No direct database access is used by the web app.

## Candidate Board Fields

The board/table displays:

- Candidate name
- Status
- Related organization
- Territory
- Work type
- Estimated value
- Confidence score
- Candidate score
- Relationship access score
- Signal count
- Owner
- Created date
- Updated date
- Recommended next action

Estimated value is shown as `Not captured yet` because the current candidate backend contract does not persist a candidate estimated value field.

## Candidate Statuses

Product-approved statuses:

- `created`
- `monitoring`
- `investigating`
- `qualified`
- `rejected`
- `archived`

Current backend status mismatch:

- Backend stores qualified candidates as `qualified_candidate`.
- The UI displays that value as `Qualified` and does not invent a new backend status.

## Lifecycle Actions

The UI uses existing backend lifecycle routes:

- Monitor
- Investigate
- Qualify
- Reject
- Archive

Reject sends `rejection_reason` because the backend requires it.

Archive asks for a reason in the UI, but the current backend archive route does not persist `archive_reason`; this is documented as a backend gap.

No opportunity is created by this sprint.

## Signal Attachment

Candidate signals are attached through:

- `POST /opportunity-candidates/:id/signals`

The UI supports selecting an existing signal and entering a contribution score. Attached signals are displayed from:

- `GET /opportunity-candidates/:id/signals`
- `GET /signals`

## Scoring Display

The UI uses:

- `GET /opportunity-candidates/:id/score-summary`
- `POST /opportunity-candidates/:id/score`

When only simple score fields are available, the UI shows simple values. It does not define or override backend scoring logic.

## Relationship Access Behavior

The UI displays relationship access from:

- candidate `relationship_access_score` where present
- safely matched relationship maps by candidate id or target organization

Direct relationship map linking from candidate is not currently exposed by the backend. The UI shows honest empty states and links to existing relationship maps when safely readable.

## Recommended Next Action

The UI displays deterministic next action only:

- `view_only`
- `review_rejection`
- `attach_organization`
- `attach_signal`
- `build_relationship_access`
- `score_candidate`
- `monitor_or_investigate`
- `investigate`
- `qualify_candidate`
- `create_opportunity_later`
- `continue_review`

No recommendation records are created automatically.

## Unsupported Sections

The UI shows honest unsupported states for:

- Candidate-specific timeline endpoint
- Candidate-specific audit summary endpoint
- Candidate estimated value persistence
- Direct candidate relationship map linking
- Full capacity fit planning
- Full opportunity creation

## Permissions Surfaced

The UI surfaces these permissions:

- `opportunity_candidate.read`
- `opportunity_candidate.create`
- `opportunity_candidate.update`
- `opportunity_candidate.monitor`
- `opportunity_candidate.investigate`
- `opportunity_candidate.qualify`
- `opportunity_candidate.reject`
- `opportunity_candidate.archive`
- `opportunity_candidate.score`
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

- Persist candidate `estimated_value`.
- Add enriched `GET /opportunity-candidates/:id/detail`.
- Add candidate timeline endpoint.
- Add candidate audit summary endpoint.
- Persist candidate archive reason.
- Add first-class candidate relationship map link route if approved.
- Add backend-truthful candidate relationship access read model.
- Add candidate-related constraint/recommendation filtering if not already supported by schema.

