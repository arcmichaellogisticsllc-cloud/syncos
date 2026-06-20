# Opportunity Pipeline Product Contract

## Opportunity Definition

An Opportunity is work Jackson has decided is worth pursuing. It is downstream from an Opportunity Candidate and upstream from any future project, production, capacity deployment, or finance workflow.

Opportunity Pipeline does not create projects, work orders, production records, settlements, invoices, payments, payroll, contracts, or cash records.

## Candidate-To-Opportunity Behavior

Preferred future backend route:

- `POST /opportunity-candidates/:id/convert-to-opportunity`

Current Product Sprint 6 UI behavior:

- Uses existing `POST /opportunities` with `candidate_id` when a qualified candidate is selected.
- Copies only fields accepted by the current opportunity create API.
- Requires current backend-safe opportunity fields including title, organization, territory, owner, work type, estimated value, and evidence summary.
- Does not mark the candidate converted because the current backend does not expose an explicit conversion route.
- Does not copy candidate rejection/archive metadata.
- Does not create signal, project, production, capacity deployment, or finance records.

Backend gap:

- No explicit candidate conversion endpoint.
- No conversion event such as `opportunity.converted_from_candidate`.
- No automatic candidate converted status update.

## Pipeline Statuses

Product labels:

- `draft`
- `pursuit_review`
- `pursuit_approved`
- `pursuing`
- `proposal`
- `negotiation`
- `awarded`
- `lost`
- `deferred`
- `archived`

Current backend mapping:

- Backend `qualified` is displayed as product `draft`.
- Backend `bid_proposal` is displayed as product `proposal`.
- Backend does not currently support `draft` or `pursuit_review` as stored statuses.

The UI does not destructively rename backend statuses.

## Lifecycle Actions

Supported through existing backend routes:

- `POST /opportunities/:id/pursuit-approve`
- `POST /opportunities/:id/pursue`
- `POST /opportunities/:id/proposal`
- `POST /opportunities/:id/negotiation`
- `POST /opportunities/:id/award`
- `POST /opportunities/:id/lost`
- `POST /opportunities/:id/defer`
- `POST /opportunities/:id/archive`
- `POST /opportunities/:id/score`

Unsupported or partial:

- Submit for Pursuit Review is shown disabled because backend `pursuit_review` is missing.
- Archive reason is documented as unsupported because current backend archive route does not persist reason/note.
- Value-based approval thresholds are not implemented.

## Relationship Access Rule

Relationship access is not an opportunity creation blocker.

If relationship access is missing or weak:

- The opportunity remains visible.
- The UI shows a warning.
- The recommended next action becomes relationship-focused.
- The relationship panel explains that weak access increases risk and should create an action path.

Current backend conflict:

- `POST /opportunities/:id/pursuit-approve` currently hard-blocks unless a relationship path exists.
- The UI does not bypass this backend rule.

## Pursuit Approval Behavior

The pursuit approval modal displays:

- Estimated value
- Relationship access score
- Capacity requirements status
- Open constraints
- Pursuit score
- Backend authority warnings

Current backend rules:

- Requires `opportunity.pursuit_approve`.
- Requires backend authority role currently enforced by API.
- Requires pursuit score >= 70.
- Requires a relationship path.
- Requires positive capacity fit and margin potential.

Future proposed thresholds are documented but not implemented:

- Under $50,000: Growth Director or above
- $50,000-$250,000: Regional Director or Executive
- Over $250,000: Executive

## Capacity Requirement Boundary

Allowed:

- View opportunity capacity requirements.
- Create opportunity capacity requirements.
- Edit opportunity capacity requirements when route supports it.
- Archive opportunity capacity requirements.

Not allowed:

- Deploy crews.
- Assign workers.
- Allocate equipment.
- Create work orders.
- Create projects.
- Create production records.

Capacity is planning only in this sprint.

## Awarded Opportunity Boundary

When an opportunity is marked awarded:

- Backend status changes to `awarded`.
- Event/audit/system_action are created through the backend.
- UI shows future project handoff placeholder.

No project, work order, contract, settlement, invoice, payment, payroll, or cash record is created.

## Backend Endpoints Used

- `GET /opportunities`
- `GET /opportunities/:id`
- `POST /opportunities`
- `PATCH /opportunities/:id`
- `POST /opportunities/:id/pursuit-approve`
- `POST /opportunities/:id/pursue`
- `POST /opportunities/:id/proposal`
- `POST /opportunities/:id/negotiation`
- `POST /opportunities/:id/award`
- `POST /opportunities/:id/lost`
- `POST /opportunities/:id/defer`
- `POST /opportunities/:id/archive`
- `POST /opportunities/:id/score`
- `GET /opportunities/:id/score-summary`
- `GET /opportunities/:id/capacity-requirements`
- `POST /opportunities/:id/capacity-requirements`
- `GET /opportunity-candidates`
- `GET /organizations`
- `GET /relationship-maps`
- `GET /constraints`
- `GET /recommendations`
- `GET /auth/me/permissions`

## Unsupported Sections

- Opportunity timeline endpoint.
- Opportunity audit summary endpoint.
- Explicit candidate conversion route.
- Direct `relationship_map_id` on opportunities.
- Stored `draft` and `pursuit_review` statuses.
- Opportunity archive reason.
- Value-threshold approval authority.
- Relationship-access override reason.
- Full Pursuit Management workspace.

## Deferred Gaps

- Opportunity backend contract hardening for enriched list/detail.
- Candidate conversion event and status update.
- Opportunity relationship map linkage.
- Opportunity timeline/audit endpoints.
- Project handoff workflow.
- Proposal document generation.
- Pricing/estimating.
- Contract/finance/settlement/cash workflows.
- Capacity deployment.
- AI pursuit automation.

## Physical Test Expectations

The tester must complete the pipeline workflow through UI only:

- Open the pipeline.
- Create or convert an opportunity where backend supports it.
- Open detail.
- Exercise supported lifecycle actions.
- Add capacity requirement.
- Confirm weak relationship access displays as warning and does not hide opportunity.
- Confirm awarded status does not create execution or finance records.
- Confirm unsupported timeline/audit states are honest.
