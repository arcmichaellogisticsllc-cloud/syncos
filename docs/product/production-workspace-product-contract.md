# Production Workspace Product Contract

Production Workspace exposes the hardened Production backend as an operator control surface for field-truth records.

Production answers: "What actually happened in the field?"

Production Workspace must not create settlement, invoice, AR, payment, cash, payroll, or tax records.

Routes:

- `/production`
- `/production/new`
- `/production/:id`
- `/production/:id/edit`

## Directory

The directory shows:

- Production record directory
- Summary cards for status, billable state, evidence gaps, and open corrections
- Filters for project, Work Order, production type, status, QC status, billable status, production date, provider, crew, foreman, submitter, territory, work type, evidence, corrections, archived, and text search
- Table columns for production type, status, QC status, billable status, production date, project, Work Order, customer, territory, work type, provider, crew, foreman, submitter, quantities, unit, evidence count, location, next action, and updated date

## Create / Edit

Create posts to `POST /production-records`.

Edit patches `PATCH /production-records/:id`.

The forms expose backend-supported field-truth fields including production type, date, quantity/unit, location, notes, performer context, route/node/segment/address data, correction links, and override reason JSON.

Status changes remain lifecycle actions and are not editable through the form.

## Detail

The detail view shows:

- Field truth scorecard
- Work Order context
- Project context
- Performer context
- Evidence metadata
- Quantity summary
- QC summary
- Billable summary
- Timeline
- Audit
- Future QC Workspace placeholder
- Future Billable Workspace placeholder

## Lifecycle Actions

Actions use backend routes only:

- Submit
- Start review
- Approve
- Reject
- Request correction
- Mark corrected
- Mark billable
- Void
- Archive
- Add evidence metadata
- Archive evidence metadata

The UI hides or disables actions when the current permission set does not include the backend permission used by the route.

## Evidence Metadata

Evidence uses the backend metadata routes:

- `POST /production-records/:id/evidence`
- `POST /production-evidence/:id/archive`

The workspace does not implement binary upload storage.

## Boundaries

The workspace displays:

- "Claimed is not approved."
- "Approved is not automatically billable."
- "Billable is not settlement."

Foreman mobile experience, full QC Workspace, Billable Workspace, file upload storage, settlement, invoice, AR, payment, cash, payroll, and tax workflows remain deferred.

## Backend Endpoints

The UI consumes:

- `GET /production-records`
- `GET /production-records/:id/detail`
- `POST /production-records`
- `PATCH /production-records/:id`
- `POST /production-records/:id/submit`
- `POST /production-records/:id/start-review`
- `POST /production-records/:id/approve`
- `POST /production-records/:id/reject`
- `POST /production-records/:id/request-correction`
- `POST /production-records/:id/mark-corrected`
- `POST /production-records/:id/mark-billable`
- `POST /production-records/:id/void`
- `POST /production-records/:id/archive`
- `GET /production-records/:id/timeline`
- `GET /production-records/:id/audit-summary`
- Evidence metadata routes

The backend remains the source of truth for permissions, tenant isolation, validation, events, audit, and system actions.
