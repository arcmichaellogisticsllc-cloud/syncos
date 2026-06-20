# Contact Backend Contract

## Scope

This hardening sprint strengthens the existing `contacts` object for Contact Directory and Contact Detail. It does not add Relationship Mapping, outreach, enrichment integrations, AI research, campaigns, new workflow categories, or new business engines.

## Schema Fields

The contact contract now supports organization, name, title, department, contact role, email, secondary email, phone, mobile, LinkedIn, territory, status, verification status, verification method/source/note, verifier metadata, relationship owner, influence score, decision authority score, relationship strength score, preferred contact method, best time to contact, source/source URL/source confidence, notes, do-not-contact flag, archive metadata, invalid metadata, last contacted, and last verified.

## Approved Values

Contact roles: `decision_maker`, `executive_sponsor`, `economic_buyer`, `technical_buyer`, `procurement_contact`, `vendor_manager`, `construction_manager`, `project_manager`, `field_supervisor`, `field_inspector`, `qc_contact`, `safety_contact`, `engineering_contact`, `design_contact`, `permitting_contact`, `row_contact`, `ap_contact`, `billing_contact`, `contract_manager`, `subcontractor_owner`, `subcontractor_foreman`, `equipment_contact`, `staffing_contact`, `gatekeeper`, `relationship_bridge`, `influencer`, `unknown`.

Statuses: `discovered`, `enriched`, `verified`, `contacted`, `engaged`, `relationship_active`, `dormant`, `invalid`, `archived`.

Verification statuses: `unverified`, `partially_verified`, `verified`, `invalid`, `stale`.

Verification methods: `direct_confirmation`, `email_validated`, `phone_validated`, `linkedin_confirmed`, `organization_website`, `public_source`, `relationship_source`, `internal_note`.

Archive reasons: `duplicate`, `left_company`, `not_relevant`, `bad_data`, `inactive`, `other`.

Invalid reasons: `bad_email`, `bad_phone`, `left_company`, `wrong_person`, `duplicate`, `not_relevant`, `other`.

## Rules

Scores must be integers from 0 to 100. Null means not captured.

Verification requires at least one contact method, an approved verification method, and a verification source or note. Verification persists `verified_by`, `verified_at`, and `last_verified_at`.

Archive requires an approved `archive_reason` and soft-archives the contact.

Mark invalid requires an approved `invalid_reason`.

Stale is calculated when `last_verified_at` is older than 180 days, `last_contacted_at` is missing or older than 180 days, and the contact is not archived or invalid. Manual `verification_status = stale` also returns stale.

## APIs

Changed:

- `GET /contacts`
- `GET /contacts/:id`
- `POST /contacts`
- `PATCH /contacts/:id`
- `POST /contacts/:id/verify`
- `POST /contacts/:id/archive`

Added:

- `GET /contacts/:id/detail`
- `GET /contacts/:id/timeline`
- `GET /contacts/:id/audit-summary`
- `POST /contacts/:id/assign-owner`
- `POST /contacts/:id/mark-invalid`
- `POST /contacts/:id/mark-contacted`
- `POST /contacts/:id/mark-engaged`
- `POST /contacts/:id/mark-relationship-active`
- `POST /contacts/:id/mark-dormant`

## Enriched List

`GET /contacts` returns core contact fields, organization context, owner name, related signal count, open constraint count, recommendation count, stale status, completeness score/band, missing contact items, and recommended next action.

Supported filters include organization, organization type, organization actor role, contact role, territory, status, verification status, score ranges, owner, missing contact method, stale, last contacted range, last verified range, archived, and text search.

Supported sorting includes `name_asc`, `updated_desc`, `influence_desc`, `decision_authority_desc`, `relationship_strength_desc`, `last_contacted_asc`, `last_verified_asc`, `strategic_first`, and `default`.

## Enriched Detail

`GET /contacts/:id/detail` returns the enriched contact, organization context, related signals through signal contact links, direct contact constraints/recommendations, organization-level project and finance relevance where safe, completeness, stale, and endpoint availability flags.

Contact-specific candidate, opportunity, project, and finance relationships remain deferred unless a safe direct relationship exists.

## Completeness

Completeness uses: organization attached, name present, title present, contact role assigned, at least one contact method, verification complete, owner assigned, influence score captured, decision authority score captured, and relationship strength score captured.

Bands: incomplete `0-39`, partial `40-69`, usable `70-89`, complete `90-100`.

## Recommended Next Action

Deterministic order: `view_only`, `replace_or_archive`, `attach_organization`, `assign_role`, `add_contact_method`, `verify_contact`, `assign_owner`, `reverify_contact`, `strengthen_relationship`, `review_contact`.

No recommendation records are created automatically.

## Timeline And Audit

`GET /contacts/:id/timeline` returns direct contact events and safely joinable signal-entity, constraint, and recommendation events.

`GET /contacts/:id/audit-summary` returns direct contact audit records and requires `contact.audit.read`.

## Deferred Gaps

- Full Relationship Mapping Workspace.
- Contact-specific candidate and opportunity linkage where no safe table exists.
- Contact-specific project and finance linkage beyond safe organization-level relevance.
- Authority categories as durable structured data.
- AI/web research automation.
