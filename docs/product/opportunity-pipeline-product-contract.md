# Opportunity Pipeline Product Contract

## Definition

An Opportunity is work Jackson has decided is worth pursuing. It is downstream from Opportunity Candidate and upstream from future project, production, capacity deployment, and finance workflows.

Opportunity Pipeline does not create projects, work orders, production records, contracts, settlements, invoices, payments, payroll, cash, or capacity deployment.

## Candidate Conversion

The UI uses `POST /opportunity-candidates/:id/convert-to-opportunity` for qualified candidate conversion. Conversion preserves source linkage through `source_candidate_id` and `source_type = candidate_conversion`.

Weak or missing relationship access does not block conversion. It creates warning metadata and recommended action `build_relationship_path`.

## Statuses

Product statuses: `draft`, `pursuit_review`, `pursuit_approved`, `pursuing`, `proposal`, `negotiation`, `awarded`, `lost`, `deferred`, `archived`.

Legacy backend normalization remains visible only where older rows exist: `qualified` renders as Draft, and `bid_proposal` renders as Proposal.

## Lifecycle Actions

Supported backend routes:

- `POST /opportunities/:id/submit-for-review`
- `POST /opportunities/:id/pursuit-approve`
- `POST /opportunities/:id/pursue`
- `POST /opportunities/:id/proposal`
- `POST /opportunities/:id/negotiation`
- `POST /opportunities/:id/award`
- `POST /opportunities/:id/lost`
- `POST /opportunities/:id/defer`
- `POST /opportunities/:id/archive`
- `POST /opportunities/:id/score`

Lost, deferred, archive, and pursuit approval warning overrides use modal fields and backend persistence.

## Relationship Access Rule

Relationship access is not an acquisition blocker. If missing or weak, the UI shows risk, backend warnings, and a relationship action path. Pursuit approval requires override reasons for relationship, capacity, margin, constraint, and score warnings.

## Capacity Boundary

Capacity requirements are planning-only. Users may view, create, edit, and archive requirement records. The workspace does not deploy crews, assign workers/equipment, create work orders, or create projects.

## Award Boundary

Award changes opportunity status to `awarded`, persists actor/timestamp metadata, and shows the future handoff message. No downstream execution or finance records are created.

## Backend Endpoints Used

- `GET /opportunities`
- `GET /opportunities/:id/detail`
- `POST /opportunities`
- `PATCH /opportunities/:id`
- `POST /opportunity-candidates/:id/convert-to-opportunity`
- Opportunity lifecycle routes
- Opportunity owner and relationship map linkage routes
- Opportunity score, capacity requirement, timeline, and audit routes
- Existing candidate, organization, relationship map, constraint, recommendation, and permission reads

## Deferred Gaps

Value-threshold pursuit authority, proposal document generation, project handoff, pricing/estimating, contract/finance workflows, capacity deployment, and AI pursuit automation remain outside scope.
