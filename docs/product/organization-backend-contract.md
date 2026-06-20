# Organization Backend Contract

## Purpose

The Organization API is the backend-truth source for the Organization Profile and Actor Intelligence workspace. It stores telecom actor identity, owner, taxonomy, roles, scores, archive metadata, and read-model summaries without adding new business objects or workflow categories.

## Schema Fields

Organizations now support:

- `legal_name`
- `dba_name`
- `website`
- `main_phone`
- `main_email`
- `address_line_1`
- `address_line_2`
- `city`
- `state`
- `postal_code`
- `country`
- `territory_id`
- `organization_type`
- `actor_roles`
- `relationship_owner_user_id`
- `strategic_flag`
- `trust_level`
- `influence_score`
- `work_relevance_score`
- `capacity_relevance_score`
- `payment_relevance_score`
- `description`
- `archive_reason`
- `archive_note`
- `archived_by`
- `archived_at`
- `qualified_by`
- `qualified_at`

The legacy `type` column is retained for compatibility and mirrors `organization_type` for API writes.

## Approved Organization Types

- `utility`
- `isp_carrier`
- `broadband_office`
- `municipality`
- `engineering_firm`
- `prime_contractor`
- `general_contractor_program_manager`
- `subcontractor`
- `vendor`
- `equipment_provider`
- `staffing_partner`
- `customer`
- `internal_company`

Legacy values are normalized on API write:

- `carrier` -> `isp_carrier`
- `contractor` -> `prime_contractor`
- `agency` -> `municipality`
- `partner` -> `vendor`

## Approved Actor Roles

- `work_creator`
- `work_influencer`
- `work_distributor`
- `capacity_provider`
- `work_validator`
- `cash_controller`
- `vendor_enabler`
- `regulatory_public_actor`

Organizations may have multiple actor roles. Roles are validated and returned as an array.

## List Read Model

`GET /organizations` returns enriched rows with core fields, territory name, relationship owner name, counts, completeness, missing intelligence, and recommended next action.

Supported filters:

- `organization_type`
- `actor_role`
- `territory_id`
- `status`
- `strategic_flag`
- `relationship_owner_user_id`
- `trust_level`
- `influence_min`
- `influence_max`
- `work_relevance_min`
- `work_relevance_max`
- `capacity_relevance_min`
- `capacity_relevance_max`
- `payment_relevance_min`
- `payment_relevance_max`
- `has_contacts`
- `has_signals`
- `has_opportunities`
- `archived`
- `q`

Supported sorting:

- `name_asc`
- `updated_desc`
- `influence_desc`
- `work_relevance_desc`
- `capacity_relevance_desc`
- `payment_relevance_desc`
- `strategic_first`
- `default`

Pagination uses `limit` and `offset`; `limit` defaults to 50 and is capped at 200.

## Detail Read Model

`GET /organizations/:id/detail` returns:

- `organization`
- `contacts`
- `signals`
- `candidates`
- `opportunities`
- `capacity`
- `projects`
- `finance`
- `constraints`
- `recommendations`
- `learning`
- `events`
- `audit_allowed`
- `completeness`
- `actor_guidance`

This endpoint is tenant-scoped and permission protected by `organization.read`.

## Completeness Logic

Completeness is deterministic:

- identity complete
- organization type assigned
- actor role assigned
- territory assigned
- relationship owner assigned
- contact exists
- verified contact exists
- signal/candidate/opportunity exists when work-related
- capacity profile exists when capacity provider
- payment stats exist when customer or cash controller

Bands:

- `incomplete`: 0-39
- `partial`: 40-69
- `usable`: 70-89
- `complete`: 90-100

## Recommended Next Action

The backend returns deterministic `recommended_next_action`:

- archived -> `view_only`
- missing owner -> `assign_owner`
- missing actor role -> `assign_actor_role`
- missing territory -> `assign_territory`
- no contacts -> `add_contact`
- no verified contacts -> `verify_contact`
- work creator with no signals -> `add_signal`
- capacity provider with no capacity provider record -> `add_capacity_provider`
- otherwise -> `review_profile`

No AI or automatic decisioning is used.

## Owner Assignment

`POST /organizations/:id/assign-owner`

Requires:

- `organization.assign_owner`
- `owner_user_id`
- owner must be an active user in the same tenant

Creates:

- `organization.owner_assigned`
- `event_payload`
- `audit_log`
- `system_action`

## Qualification Rule

`POST /organizations/:id/qualify`

Requires:

- organization type
- at least one actor role
- territory

Sets:

- `status = qualified`, unless already `active` or `strategic`
- `qualified_by`
- `qualified_at`

Creates `organization.qualified` with audit and system action.

## Archive Rule

`POST /organizations/:id/archive`

Requires `archive_reason`.

Allowed reasons:

- `duplicate`
- `inactive`
- `not_relevant`
- `bad_data`
- `merged`
- `out_of_territory`
- `no_longer_target`
- `other`

Sets:

- `status = archived`
- `archive_reason`
- `archive_note`
- `archived_by`
- `archived_at`
- soft-delete timestamp

Creates `organization.archived` with audit and system action.

## Timeline Endpoint

`GET /organizations/:id/timeline`

Permission: `organization.timeline.read`

Returns direct organization events and safely joinable related contact, signal, candidate, opportunity, capacity provider, constraint, and recommendation events.

## Audit Endpoint

`GET /organizations/:id/audit-summary`

Permission: `organization.audit.read`

Returns direct organization audit rows only. Related object audits are deferred until a broader audit authority model is approved.

## Deferred Gaps

- Full Contact Directory remains deferred.
- Full Relationship Mapping workspace remains deferred.
- Some downstream list endpoints still need first-class organization filters; the detail endpoint provides safe organization slices for the current profile.
- Finance/project provider-side relationships are limited to fields already present in the schema.
