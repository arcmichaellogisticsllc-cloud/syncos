# Relationship Backend Contract

## Scope

Relationship Map backend hardening persists approved relationship intelligence fields and exposes backend-truthful list, detail, timeline, and audit contracts. It does not add outreach automation, AI analysis, new workflow categories, or Opportunity Workspace behavior.

## Relationship Map Fields

Persisted fields include `map_type`, `objective`, `desired_outcome`, `owner_user_id`, `priority`, `strategic_flag`, `due_date`, `target_organization_id`, `target_contact_id`, `related_signal_id`, `related_candidate_id`, `related_opportunity_id`, `territory_id`, `access_score`, `relationship_gap_summary`, `recommended_next_action`, `archive_reason`, `archive_note`, `archived_by`, and `archived_at`.

Approved map types are `organization_access`, `opportunity_access`, `customer_access`, `prime_access`, `engineering_access`, `capacity_access`, `billing_access`, `field_access`, and `executive_access`.

Approved map statuses are `no_path`, `weak_path`, `identified_path`, `introduction_requested`, `conversation_opened`, `relationship_active`, `strategic_access`, `dormant`, and `archived`.

## Relationship Path Fields

Persisted path fields include `path_name`, `from_contact_id`, `to_contact_id`, `intermediary_contact_ids`, `path_summary`, `status`, `rank`, `strength_score`, `confidence_score`, `recommended_action`, `owner_user_id`, `last_used_at`, `last_successful_outcome`, `risk_notes`, `blocked_reason`, `archive_reason`, `archive_note`, `archived_by`, and `archived_at`.

Approved path statuses are `proposed`, `active`, `inactive`, and `archived`.

Path strength and confidence must be 0-100. Rank must be a positive integer. From, to, and intermediary contacts must belong to the same tenant.

## Backend Calculations

Relationship access score is deterministic:

`(best active path strength_score * 0.60) + (best active path confidence_score * 0.40)`

No active path returns `0`. The best active path is selected by combined score, then lowest rank, then most recent update.

Relationship gaps are deterministic and include missing target organization/contact, missing target contact method, no active path, weak path, low confidence path, missing decision-maker, map-type specific missing roles, stale relationship, and missing candidate/opportunity for opportunity access maps. Gaps are returned as objects with `gap_type`, `severity`, `suggested_action`, and optional related object fields.

Recommended next action is deterministic and display-only. It never executes lifecycle changes automatically.

## API Contract

List:

- `GET /relationship-maps`
- Supports filters for status, map type, target organization/contact, territory, owner, priority, strength/confidence/access score ranges, related candidate/opportunity, strategic flag, dormant, target contact presence, active path presence, archived, and text search.
- Supports sorting by updated date, access score, strength, confidence, priority, strategic first, status, target organization, and default.

Detail:

- `GET /relationship-maps/:id/detail`
- Returns `relationship_map`, `target_organization`, `target_contact`, `paths`, `path_contacts`, `related_candidate`, `related_opportunity`, `constraints_summary`, `recommendations_summary`, `workflow_tasks_summary`, `relationship_gaps`, `recommended_next_action`, `relationship_access_score`, `audit_allowed`, and `timeline_available`.

Write routes:

- `POST /relationship-maps`
- `PATCH /relationship-maps/:id`
- `POST /relationship-maps/:id/assign-owner`
- `POST /relationship-maps/:id/status`
- `POST /relationship-maps/:id/archive`
- `POST /relationship-maps/:id/paths`
- `PATCH /relationship-paths/:id`
- `POST /relationship-paths/:id/rank`
- `POST /relationship-paths/:id/archive`

All writes must continue through the write-action helper and create event, event payload, audit log, and system action records.

## Timeline And Audit

- `GET /relationship-maps/:id/timeline` returns relationship map and relationship path events scoped to the map.
- `GET /relationship-maps/:id/audit-summary` returns direct relationship map/path audit records where authorized.

Audit requires `relationship_map.audit.read`. Timeline requires `relationship_map.timeline.read`.

## Permissions Added

- `relationship_map.assign_owner`
- `relationship_map.timeline.read`
- `relationship_map.audit.read`

Existing relationship permissions remain the source of truth for read, create, update, archive, status, path create/update/rank/archive.

## Archive Rules

Relationship map archive requires `archive_reason` from `no_longer_relevant`, `duplicate`, `target_changed`, `organization_inactive`, `opportunity_lost`, `relationship_no_longer_useful`, or `other`.

Relationship path archive requires `archive_reason` from `no_longer_valid`, `duplicate`, `contact_left_company`, `weak_or_unusable`, `replaced_by_better_path`, `target_changed`, or `other`.

## Deferred Gaps

Workflow task linkage is returned only when existing workflow instances safely reference `relationship_map`. No new workflow categories or automatic tasks were introduced.
