# Organization Profile Product Contract

## Scope

Product Sprint 2 exposes the existing SyncOS organization capability as a telecom actor dossier. It does not add new backend business objects, workflow categories, engines, scraping, AI research, or standalone contact/relationship/opportunity/capacity/finance workspaces.

## Frontend Routes

- `/intelligence/organizations`
- `/intelligence/organizations/new`
- `/intelligence/organizations/:id`
- `/intelligence/organizations/:id/edit`

## Backend APIs Used

- `GET /organizations`
- `GET /organizations/:id`
- `POST /organizations`
- `PATCH /organizations/:id`
- `POST /organizations/:id/qualify`
- `POST /organizations/:id/archive`
- `GET /territories`
- `GET /contacts`
- `POST /contacts`
- `GET /signals`
- `POST /signals`
- `GET /opportunity-candidates`
- `POST /opportunity-candidates`
- `GET /opportunities`
- `GET /capacity-providers`
- `POST /capacity-providers`
- `GET /projects`
- `GET /settlements`
- `GET /invoices`
- `GET /payments`
- `GET /constraints`
- `GET /recommendations`
- `GET /learning-scores`
- `GET /auth/me/permissions`

All writes go through backend APIs. The web app does not direct-query the database.

## Organization List Fields

The list displays:

- organization name
- backend organization type
- actor roles
- territory
- status
- relationship owner state
- strategic flag
- trust score
- influence score
- work relevance score
- capacity relevance score
- payment relevance score
- contacts count
- signals count
- opportunities count
- recommended next action

Relationship owner is shown as `Unassigned` because the current organization schema has no owner field. Counts are derived from tenant-scoped list APIs and client-side organization filtering where backend organization filters are unavailable.

## Organization Profile Tabs

- Overview
- Contacts
- Relationships placeholder
- Signals
- Candidates
- Opportunities
- Capacity, conditional
- Projects, conditional
- Finance, conditional
- Constraints
- Recommendations
- Learning
- Documents placeholder
- Events placeholder
- Audit placeholder

Tabs show organization-specific slices where existing backend APIs expose enough tenant-scoped data. Unsupported slices display honest limitation states.

## Actor-Aware Behavior

Actor roles drive profile emphasis and conditional tabs:

- Work Creator emphasizes signals, work relevance, candidates, and opportunities.
- Work Influencer emphasizes contacts, relationship access, signals, and relationship gaps.
- Work Distributor emphasizes contacts, opportunity routing, onboarding, and relationship gaps.
- Capacity Provider reveals the Capacity tab and emphasizes provider records.
- Work Validator reveals project/production relevance when project data is available.
- Cash Controller reveals Finance and emphasizes invoices, settlements, payments, and AP/Billing contacts.

The backend stores `actor_roles` as text values. No new authority model or workflow category is introduced.

## Recommended Next Action

The current UI follows the approved deterministic order, with one important backend limitation:

1. Archived organizations are view-only.
2. Relationship owner is treated as missing because the backend has no organization owner field.
3. Actor role, territory, contacts, signals, relationship map, capacity provider, and finance-contact checks are displayed in the profile checklist.

Because relationship owner is not stored yet, `Assign Owner` is the most common recommendation. This is a documented backend gap, not an inferred hidden owner.

## Backend Gaps / Unsupported Sections

- Organization schema lacks legal name, DBA/trade names, website, phone, email, address, description, strategic boolean, relationship owner, and manual relevance-score fields.
- Backend organization type enum is limited to `unknown`, `carrier`, `contractor`, `customer`, `vendor`, `partner`, and `agency`; the product taxonomy is richer.
- `GET /contacts`, `GET /opportunity-candidates`, `GET /opportunities`, and several later-module list endpoints do not expose explicit organization filters. The UI filters tenant-scoped rows client-side when permitted.
- No organization-scoped timeline endpoint exists.
- No organization-scoped audit-summary endpoint exists.
- Relationship maps are not exposed as an organization profile slice.
- Detailed capacity sub-slices for crews, workers, equipment, documents, and capacity records require provider-scoped product work later.
- Customer payment stats are not exposed through an organization profile API.
- Organization archive API does not currently persist an archive reason.

## Deferred Work

- Backend organization contract hardening for owner, product taxonomy, durable profile metadata, organization timeline, and organization audit summary.
- Full Contact Directory.
- Full Relationship Mapping Workspace.
- Full Opportunity Workspace.
- Full Capacity Workspace.
- Full Finance Workspace.
- AI-assisted research execution.

## Physical Test Expectations

The physical test should validate that a non-developer can create and open an organization profile, add contacts/signals/candidates where permissions allow, understand actor role meaning, see honest unsupported states, and verify no UI step requires direct API or database access.
