# Contact Management Product Contract

## Scope

Product Sprint 3 exposes existing SyncOS contact capability as a Contact Directory and Contact Detail Workspace. It does not add relationship mapping, outreach, enrichment integrations, AI research, campaigns, new backend objects, or new workflow categories.

## Frontend Routes

- `/intelligence/contacts`
- `/intelligence/contacts/new`
- `/intelligence/contacts/:id`
- `/intelligence/contacts/:id/edit`

## Backend Endpoints Used

- `GET /contacts`
- `GET /contacts/:id`
- `POST /contacts`
- `PATCH /contacts/:id`
- `POST /contacts/:id/verify`
- `POST /contacts/:id/archive`
- `GET /organizations`
- `GET /signals`
- `GET /opportunity-candidates`
- `GET /opportunities`
- `GET /projects`
- `GET /settlements`
- `GET /invoices`
- `GET /payments`
- `GET /constraints`
- `GET /recommendations`
- `GET /auth/me/permissions`

The web app does not direct-query the database. All writes use existing backend APIs.

## Contact Directory Fields

The directory displays:

- name
- title
- organization
- organization type
- contact role when backend exposes it
- email
- phone
- influence score when backend exposes it
- decision authority score when backend exposes it
- relationship strength when backend exposes it
- verification status
- status
- owner when backend exposes it
- last contacted when backend exposes it
- last verified
- recommended next action

Filters and quick filters are applied to loaded tenant-scoped rows. Contact role, owner, scores, and last contacted are shown as `Not captured yet` where the backend does not expose durable fields.

## Contact Roles

Approved product roles:

- `decision_maker`
- `executive_sponsor`
- `economic_buyer`
- `technical_buyer`
- `procurement_contact`
- `vendor_manager`
- `construction_manager`
- `project_manager`
- `field_supervisor`
- `field_inspector`
- `qc_contact`
- `safety_contact`
- `engineering_contact`
- `design_contact`
- `permitting_contact`
- `row_contact`
- `ap_contact`
- `billing_contact`
- `contract_manager`
- `subcontractor_owner`
- `subcontractor_foreman`
- `equipment_contact`
- `staffing_contact`
- `gatekeeper`
- `relationship_bridge`
- `influencer`
- `unknown`

Current backend does not persist `contact_role`. The UI does not infer or fake stored role data from title; it shows `unknown` until backend support exists.

## Scoring Displays

Influence score, decision authority score, and relationship strength are displayed only if returned by the backend. Current backend does not persist these fields, so the workspace shows `Not captured yet`.

Bands:

- Influence and decision authority: 0-24 Low, 25-49 Moderate, 50-74 Strong, 75-100 Strategic.
- Relationship strength: 0-19 Unknown, 20-39 Weak, 40-59 Known, 60-79 Active, 80-100 Strategic.

## Verification Flow

`POST /contacts/:id/verify` is used when available.

UI validation:

- at least one contact method exists
- verification method is selected
- verification source or note is supplied

Backend persistence:

- current backend persists verification status and last verified timestamp
- verification method/source/note are not persisted yet

## Contact Detail Tabs

- Overview
- Organization Context
- Contact Methods
- Role & Authority
- Relationship Context placeholder
- Related Signals
- Related Candidates
- Related Opportunities
- Related Projects conditional
- Finance Relevance conditional
- Constraints
- Recommendations
- Events
- Audit

Relationship, events, and audit tabs show explicit unsupported states where contact-specific backend endpoints are not available.

## Deterministic Next Action

The workspace calculates display-only next action in this order:

1. archived contacts: `view_only`
2. invalid contacts: `replace_or_archive`
3. missing organization: `attach_organization`
4. missing contact role: `assign_role`
5. no contact method: `add_contact_method`
6. unverified contact: `verify_contact`
7. missing owner: `assign_owner`
8. stale contact: `reverify_contact`
9. missing or weak relationship strength: `strengthen_relationship`
10. otherwise: `review_contact`

No recommendation records are automatically created.

## Unsupported Sections / Deferred Gaps

- Backend does not persist contact role.
- Backend does not persist contact owner.
- Backend does not persist influence, decision authority, or relationship strength scores.
- Backend does not persist verification method/source/note.
- Backend does not persist archive reason.
- No contact timeline endpoint exists.
- No contact audit summary endpoint exists.
- Contact-specific candidate/opportunity/project/finance links are limited; organization-level slices are shown where safely available.
- Relationship Mapping Workspace remains deferred.

## Physical Test Expectations

The physical test validates a non-developer can open the directory, create/edit a contact, verify a contact, understand organization context, see honest unsupported states, and confirm all writes go through backend APIs with existing event/audit/system_action behavior.
