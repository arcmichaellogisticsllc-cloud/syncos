# Relationship Mapping Product Contract

## Scope

Product Sprint 4 exposes the existing Relationship Map and Relationship Path backend through an operator workspace. It does not add new backend business objects, workflow categories, automation, outreach, AI research, or graph engines.

## Frontend Routes

- `/intelligence/relationship-maps`
- `/intelligence/relationship-maps/new`
- `/intelligence/relationship-maps/:id`
- `/intelligence/relationship-maps/:id/edit`

## Backend Endpoints Used

- `GET /relationship-maps`
- `GET /relationship-maps/:id`
- `POST /relationship-maps`
- `PATCH /relationship-maps/:id`
- `POST /relationship-maps/:id/status`
- `POST /relationship-maps/:id/archive`
- `GET /relationship-maps/:id/paths`
- `POST /relationship-maps/:id/paths`
- `PATCH /relationship-paths/:id`
- `POST /relationship-paths/:id/rank`
- `POST /relationship-paths/:id/archive`
- `GET /organizations`
- `GET /contacts`
- `GET /opportunity-candidates`
- `GET /opportunities`
- `GET /constraints`
- `GET /recommendations`
- `GET /workflow-tasks`

## Directory Fields

The directory displays:

- Map name
- Target organization
- Target contact
- Map type
- Objective
- Status
- Owner
- Priority
- Best path strength
- Best path confidence
- Relationship access score
- Related candidate
- Related opportunity
- Recommended next action
- Last activity

Current backend does not persist map type, objective, owner, priority, strategic flag, desired outcome, or due date. The UI displays unsupported states for these fields and derives map type/objective from existing target object fields where possible.

## Map Types

Approved product map types:

- `organization_access`
- `opportunity_access`
- `customer_access`
- `prime_access`
- `engineering_access`
- `capacity_access`
- `billing_access`
- `field_access`
- `executive_access`

Backend does not currently persist map type. The UI derives `opportunity_access` when `target_object_type = opportunity_candidate`; otherwise it displays `organization_access`.

## Map Statuses

Approved product statuses:

- `no_path`
- `weak_path`
- `identified_path`
- `introduction_requested`
- `conversation_opened`
- `relationship_active`
- `strategic_access`
- `dormant`
- `archived`

The current backend status route accepts:

- `no_path`
- `weak_path`
- `identified_path`
- `introduction_requested`
- `conversation_opened`
- `relationship_active`
- `archived`

The UI does not attempt unsupported `strategic_access` or `dormant` transitions.

## Path Fields

The path form uses existing backend fields:

- `from_contact_id`
- `to_contact_id`
- `intermediary_contact_ids`
- `strength_score`
- `confidence_score`
- `rank`
- `status`
- `path`

Path summary is stored in the existing `path` JSON payload as a simple summary entry.

## Relationship Access Score

The UI calculates:

`(best active path strength * 0.60) + (best active path confidence * 0.40)`

If no active path exists, the UI uses the best non-archived path for comparison but reports zero active paths. No pursuit or workflow action is automatically triggered from this score.

## Gap Logic

Deterministic gaps shown by the UI:

- No target organization
- No target contact
- No verified contact method
- No active path
- Weak path only
- Low confidence path
- No decision-maker
- No AP contact for billing map
- No field validator for field map
- No related candidate or opportunity for opportunity access map

The UI never auto-creates constraints from gaps.

## Unsupported Sections

The following are intentionally shown as unsupported or not captured:

- Relationship map timeline endpoint
- Relationship map audit summary endpoint
- Owner assignment
- Priority
- Strategic flag
- Due date
- Desired outcome persistence
- Archive reason persistence
- Workflow task linkage to relationship maps
- Introduction workflow records
- Conversation records
- Live AI relationship analysis

## Permissions Surfaced

- `relationship_map.read`
- `relationship_map.create`
- `relationship_map.update`
- `relationship_map.archive`
- `relationship_map.status`
- `relationship_path.read`
- `relationship_path.create`
- `relationship_path.update`
- `relationship_path.rank`
- `relationship_path.archive`
- `organization.read`
- `contact.read`
- `opportunity_candidate.read`
- `opportunity.read`
- `constraint.read`
- `constraint.create`
- `recommendation.read`
- `workflow_task.read`

Backend remains the source of truth for authorization.

