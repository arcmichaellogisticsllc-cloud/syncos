# Intelligence Backend Contract

This contract supports the Product Sprint 1 Signal Feed and Signal Detail workspace. Backend authorization, tenant isolation, events, audit logs, and system actions remain the source of truth.

## Signal Feed

`GET /signals` returns tenant-scoped enriched signal rows.

Core fields include:

- `id`
- `title`
- `summary`
- `category`
- `type`
- `source_name`
- `source_type`
- `source_url`
- `source_note`
- `status`
- `confidence_score`
- `trust_level`
- `owner_user_id`
- `owner_name`
- `date_discovered`
- `created_at`
- `updated_at`
- `archived_at`
- `archive_reason`
- `estimated_value`
- `estimated_scope`
- `work_type`

Linked and derived fields include:

- `primary_organization_id`
- `primary_organization_name`
- `primary_territory_id`
- `primary_territory_name`
- `contact_count`
- `evidence_count`
- `active_evidence_count`
- `candidate_count`
- `opportunity_candidate_ids`
- `candidate_ready`
- `missing_readiness_items`
- `converted`
- `stale`
- `recommended_next_action`

## Feed Filters

Supported query parameters:

- `status`
- `category`
- `type`
- `territory_id`
- `organization_id`
- `source_name`
- `source_type`
- `confidence_min`
- `confidence_max`
- `trust_level`
- `owner_user_id`
- `date_discovered_from`
- `date_discovered_to`
- `has_evidence`
- `has_organization`
- `has_contact`
- `converted`
- `archived`
- `stale`
- `q`
- `sort`
- `limit`
- `offset`

Supported sort values:

- `default`
- `newest`
- `oldest`
- `confidence_desc`
- `confidence_asc`
- `trust_desc`
- `updated_desc`

Default sort is confidence descending, date discovered descending, then created date descending.

## Signal Detail

`GET /signals/:id/detail` returns:

- `signal`
- `evidence`
- `entities`
- `primary_organization`
- `primary_territory`
- `contacts`
- `candidates`
- `opportunities`
- `readiness`
- `constraints`
- `recommendations`
- `workflow_tasks`
- `timeline_summary`

`GET /signals/:id/timeline` returns signal-scoped event history.

`GET /signals/:id/audit-summary` returns signal-scoped audit rows and requires `signal.audit.read`.

## Readiness Rules

`GET /signals/:id/readiness` calculates candidate readiness.

A signal is candidate-ready only when:

- status is `verified`
- confidence score is at least 60
- primary organization exists
- active evidence exists
- primary territory exists

This endpoint never creates a candidate and never changes signal status.

## Verification Rule

`POST /signals/:id/verify` requires:

- signal belongs to tenant
- signal is not archived
- actor has `signal.verify`
- at least one active evidence record exists

Verifier notes cannot replace active evidence.

## Archive Rule

`POST /signals/:id/archive` requires an approved `archive_reason`.

Approved reasons:

- `duplicate`
- `stale`
- `false_signal`
- `out_of_territory`
- `not_telecom_work`
- `insufficient_evidence`
- `no_longer_relevant`
- `other`

Archive stores `archive_reason`, optional `archive_note`, `archived_by`, and `archived_at`.

## Signal Entity Links

Signal links use `signal_entities`.

Supported entity types:

- `organization`
- `territory`
- `contact`

Routes:

- `GET /signals/:id/entities`
- `POST /signals/:id/entities`
- `POST /signal-entities/:id/archive`

Rules:

- linked records must belong to the same tenant
- contacts may be multiple
- primary organization and primary territory are selected by `is_primary`, then earliest active link
- setting a new primary unsets other active primary links of the same type for that signal

## Effective Permissions

`GET /auth/me/permissions` returns the authenticated user's tenant-scoped roles and permissions. UI action visibility may use this response, but backend guards remain authoritative.

## Candidate Conversion Visibility

Signal feed and detail expose candidate linkage through active `candidate_signals`.

`converted` is true when an active candidate-signal link exists.

`POST /signals/:id/create-candidate` atomically creates an opportunity candidate and candidate-signal link when readiness passes. It does not create an opportunity.

## Deferred Items

- Full organization profile workspace
- Full contact directory workspace
- Relationship mapping workspace
- Automated signal research
- External scraping
- AI-driven next action logic
