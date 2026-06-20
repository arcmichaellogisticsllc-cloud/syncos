# Contact Management Product Contract

## Scope

Product Sprint 3 exposes SyncOS contact capability as a Contact Directory and Contact Detail Workspace. The workspace uses backend APIs only and does not add relationship mapping, outreach, enrichment integrations, AI research, campaigns, new backend objects, or new workflow categories.

## Frontend Routes

- `/intelligence/contacts`
- `/intelligence/contacts/new`
- `/intelligence/contacts/:id`
- `/intelligence/contacts/:id/edit`

## Backend Endpoints Used

- `GET /contacts`
- `GET /contacts/:id/detail`
- `GET /contacts/:id/timeline`
- `GET /contacts/:id/audit-summary`
- `POST /contacts`
- `PATCH /contacts/:id`
- `POST /contacts/:id/verify`
- `POST /contacts/:id/assign-owner`
- `POST /contacts/:id/mark-invalid`
- `POST /contacts/:id/mark-contacted`
- `POST /contacts/:id/mark-engaged`
- `POST /contacts/:id/mark-relationship-active`
- `POST /contacts/:id/mark-dormant`
- `POST /contacts/:id/archive`

## Contact Directory Fields

The directory displays backend-truthful name, title, organization, organization type, contact role, email, phone, influence score, decision authority score, relationship strength, verification status, status, owner, last contacted, last verified, stale status, completeness, related counts where available, and recommended next action.

## Contact Roles

The approved role taxonomy is persisted by the backend. UI labels may be human-readable, but stored values remain stable machine values.

## Verification Flow

Verification requires at least one contact method, verification method, and verification source or note. The backend persists method, source, note, verifier, verified timestamp, and last verified timestamp.

## Detail Tabs

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

## Unsupported Sections / Deferred Gaps

- Relationship Mapping Workspace remains deferred.
- Direct candidate/opportunity contact linkage remains deferred unless a safe backend relationship exists.
- Project and finance slices are shown only where safely available, with finance relevance limited to approved finance contact roles.
- Authority categories are not yet captured as structured backend fields.

## Physical Test Expectations

The physical test validates that a non-developer can create, edit, verify, assign, lifecycle-update, audit-review when authorized, and archive contacts through the UI while tenant boundaries and backend event/audit/system_action standards remain enforced.
