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
- `GET /organizations/:id/detail`
- `GET /organizations/:id/timeline`
- `GET /organizations/:id/audit-summary`
- `POST /organizations`
- `PATCH /organizations/:id`
- `POST /organizations/:id/assign-owner`
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
- trust level
- influence score
- work relevance score
- capacity relevance score
- payment relevance score
- completeness score
- contacts count
- signals count
- opportunities count
- recommended next action

Relationship owner, actor roles, trust level, scores, completeness, counts, and recommended next action are returned by the enriched backend list read model. The UI should show `Not captured yet` only when the backend returns a null value or a section remains unsupported.

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
- Events
- Audit

Tabs show organization-specific slices from `GET /organizations/:id/detail` where the backend can safely aggregate tenant-scoped related data. Unsupported slices display honest limitation states.

## Actor-Aware Behavior

Actor roles drive profile emphasis and conditional tabs:

- Work Creator emphasizes signals, work relevance, candidates, and opportunities.
- Work Influencer emphasizes contacts, relationship access, signals, and relationship gaps.
- Work Distributor emphasizes contacts, opportunity routing, onboarding, and relationship gaps.
- Capacity Provider reveals the Capacity tab and emphasizes provider records.
- Work Validator reveals project/production relevance when project data is available.
- Cash Controller reveals Finance and emphasizes invoices, settlements, payments, and AP/Billing contacts.

The backend stores approved actor role values as an array. No new authority model or workflow category is introduced.

## Recommended Next Action

The backend returns a deterministic recommended next action:

1. Archived organizations are view-only.
2. Missing relationship owner recommends owner assignment.
3. Missing actor roles, territory, contacts, verified contacts, work-creator signals, capacity provider profile, or cash-controller billing intelligence are surfaced as missing intelligence items where data is available.
4. If no blocking item applies, the recommendation is profile review.

## Backend Gaps / Unsupported Sections

- Some downstream list endpoints still have limited first-class organization filtering. The detail endpoint aggregates safe slices where practical.
- Relationship maps are not exposed as an organization profile slice.
- Detailed capacity sub-slices for crews, workers, equipment, documents, and capacity records require provider-scoped product work later.
- Organization timeline includes direct events and safely joinable related events; it is not yet a full cross-object activity graph.
- Organization audit summary is direct organization audit only in v1.

## Deferred Work

- Full Contact Directory.
- Full Relationship Mapping Workspace.
- Full Opportunity Workspace.
- Full Capacity Workspace.
- Full Finance Workspace.
- AI-assisted research execution.

## Physical Test Expectations

The physical test should validate that a non-developer can create and open an organization profile, add contacts/signals/candidates where permissions allow, understand actor role meaning, see honest unsupported states, and verify no UI step requires direct API or database access.
