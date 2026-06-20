# Relationship Mapping Product Contract

## Scope

Product Sprint 4 exposes Relationship Map and Relationship Path capability through an operator workspace. The hardened backend contract now persists map type, objective, desired outcome, owner, priority, strategic flag, due date, archive reasons, path metadata, backend access score, relationship gaps, recommended next action, timeline, and audit summary.

No Opportunity Workspace, outreach automation, AI analysis, external scraping, graph engine, or new workflow category is included.

## Frontend Routes

- `/intelligence/relationship-maps`
- `/intelligence/relationship-maps/new`
- `/intelligence/relationship-maps/:id`
- `/intelligence/relationship-maps/:id/edit`

## Backend Endpoints Used

- `GET /relationship-maps`
- `GET /relationship-maps/:id/detail`
- `GET /relationship-maps/:id/timeline`
- `GET /relationship-maps/:id/audit-summary`
- `POST /relationship-maps`
- `PATCH /relationship-maps/:id`
- `POST /relationship-maps/:id/status`
- `POST /relationship-maps/:id/archive`
- `GET /relationship-maps/:id/paths`
- `POST /relationship-maps/:id/paths`
- `PATCH /relationship-paths/:id`
- `POST /relationship-paths/:id/rank`
- `POST /relationship-paths/:id/archive`
- Existing organization, contact, candidate, opportunity, constraint, recommendation, and workflow read endpoints where safely available.

## Directory Fields

The directory displays backend-truthful map name, target organization, target contact, map type, objective, status, owner, priority, best path strength, best path confidence, relationship access score, related candidate, related opportunity, recommended next action, and last activity.

Filters and sorting are backed by the relationship read model, with client-side filtering retained only as a UI convenience over returned rows.

## Map And Path Taxonomy

Approved map types:

- `organization_access`
- `opportunity_access`
- `customer_access`
- `prime_access`
- `engineering_access`
- `capacity_access`
- `billing_access`
- `field_access`
- `executive_access`

Approved map statuses:

- `no_path`
- `weak_path`
- `identified_path`
- `introduction_requested`
- `conversation_opened`
- `relationship_active`
- `strategic_access`
- `dormant`
- `archived`

Approved path statuses:

- `proposed`
- `active`
- `inactive`
- `archived`

## Relationship Scoring

Backend relationship access score:

`(best active path strength * 0.60) + (best active path confidence * 0.40)`

If no active path exists, score is `0`. Scores are display-only and do not auto-approve pursuit.

## Gap Logic

Backend gaps include missing target organization/contact, missing target contact method, no active path, weak path, low confidence path, missing decision-maker, map-type specific missing roles, stale relationship, and missing candidate/opportunity for opportunity access maps.

The UI may offer a disabled or permission-aware Create Constraint action, but it never auto-creates constraints.

## Unsupported Or Deferred

Workflow task linkage appears only when existing workflow records safely reference a relationship map. Introduction requests, conversation tracking, and AI relationship analysis remain status/action placeholders unless supported by approved backend routes.

## Permissions Surfaced

- `relationship_map.read`
- `relationship_map.create`
- `relationship_map.update`
- `relationship_map.archive`
- `relationship_map.status`
- `relationship_map.assign_owner`
- `relationship_map.timeline.read`
- `relationship_map.audit.read`
- `relationship_path.read`
- `relationship_path.create`
- `relationship_path.update`
- `relationship_path.rank`
- `relationship_path.archive`
- Related read permissions for organization, contact, opportunity candidate, opportunity, constraint, recommendation, and workflow task slices.

Backend authorization remains the source of truth.
