# Partner Company Readiness

## Purpose

Slice C turns the Partner Portal readiness area into the Partner Admin workspace for becoming and staying deployable. It covers company profile, tax/W-9, payment setup readiness, insurance, agreements, Workers, Foremen, Crews, vehicles/equipment, capabilities, territories, and readiness blockers.

It does not approve the Partner, approve insurance or credentials, authorize mobilization, authorize production start, change Customer QC, issue settlements, execute payments, expose customer rates, or expose Sync margin.

## Readiness Levels

1. Partner onboarding complete: Partner-controlled required items are complete and ready for Sync review.
2. Company approved: Sync has reviewed and approved the Partner company.
3. Crew ready: a specific Crew satisfies company, Foreman, Worker, credential, capability, equipment, active, and compliance facts.
4. Project mobilization authorized: a specific Crew is authorized for a specific Work Order.

Slice C handles levels 1 through 3. Work Order mobilization remains a separate execution domain.

## Read Model

Partner readiness is exposed through:

`GET /partner/readiness`

The endpoint derives tenant and Partner organization from the authenticated account, requires Partner Admin read authority, rejects browser-supplied organization scope, and evaluates the response inside a repeatable-read, read-only database transaction.

Response groups:

- `organization`
- `freshness`
- `onboarding`
- `companyProfile`
- `tax`
- `paymentSetup`
- `insurance`
- `agreements`
- `workers`
- `foremen`
- `crews`
- `vehiclesEquipment`
- `capabilities`
- `territories`
- `companyApproval`
- `blockingReasons`
- `actionRequired`
- `panelStatus`

The frontend displays this server truth and may format labels, dates, and layout. It must not decide whether a W-9 is complete, insurance is valid, an agreement is executed, a Worker credential is valid, a Foreman is eligible, a Crew is ready, the company is approved, or the company is ready for review.

## Reason Codes

Current Partner-facing reason codes include:

- `COMPANY_PROFILE_INCOMPLETE`
- `COMPANY_PROFILE_UNDER_REVIEW`
- `W9_MISSING`
- `W9_UNDER_REVIEW`
- `PAYMENT_PROFILE_INCOMPLETE`
- `GENERAL_LIABILITY_MISSING`
- `AUTO_LIABILITY_MISSING`
- `WORKERS_COMP_MISSING`
- `INSURANCE_EXPIRED`
- `INSURANCE_UNDER_REVIEW`
- `NO_ACTIVE_WORKERS`
- `WORKER_PROFILE_UNAPPROVED`
- `WORKER_CREDENTIAL_EXPIRED`
- `CREW_MISSING_FOREMAN`
- `CREW_MISSING_WORKERS`
- `CREW_INACTIVE`
- `CREW_MISSING_CAPABILITY`
- `AGREEMENT_UNSIGNED`
- `EQUIPMENT_INSPECTION_EXPIRED`

UI maps reason codes to human-readable labels and safe descriptions.

## Page Routes

- `/partner/onboarding`: grouped Partner-controlled checklist and submit-readiness state.
- `/partner/company`: legal identity, contact, capability, territory, and approval status.
- `/partner/compliance`: W-9, payment setup readiness, insurance, credentials, expirations, and action reasons.
- `/partner/agreements`: agreement version, signature, countersignature, execution, and artifact status.
- `/partner/workers`: Worker roster, Foreman designation, credential/headshot/readiness status.
- `/partner/crews`: Crew roster, primary Foreman, staffing, capability, equipment, availability, and blockers.
- `/partner/vehicles`: vehicles and equipment, assignment, inspection, document, and readiness effect.

## Authority

Partner Admins may maintain Partner-owned profile, tax, compliance, workforce, crew, and equipment facts through existing Partner APIs. Sync review remains Sync-owned. Partner Foreman-only users use SyncField and do not manage company readiness.

Partner Admins may not self-approve company status, approve insurance, verify credentials, fabricate executed agreements, authorize mobilization, authorize production start, mark Customer QC accepted, issue settlements, mark payment eligible, or mark payment paid.

Ordinary Workers do not automatically receive SyncOS login, Partner Admin access, or SyncField access merely because a Worker record exists.

## Files And Privacy

W-9, insurance, headshots, credentials, and agreement artifacts remain private. Partner UI may show safe file presence and review state. It must not show raw storage keys, raw paths, permanent public URLs, full TIN, full bank account, routing number, provider secrets, internal review notes, customer rates, or Sync margin.

## Company And Crew Separation

Company approval and Crew readiness are separate. A company can be approved while a Crew remains action-required. A Crew can be generally ready without project-specific mobilization. General Crew readiness does not authorize production start.

## Dashboard Integration

Slice B2 server-derived Dashboard actions route into Slice C workspaces. Correcting source truth removes or rescopes the derived action after refresh. There is no persisted Partner action ledger in Slice C.

## Responsive And Accessibility

Readiness pages use semantic headings, labeled fields, visible focus, text status labels, accessible progress, touch-friendly actions, private file status text, and card/table alternatives on mobile. Desktop uses grouped overview plus workspace sections; tablet and mobile stack cards without horizontal overflow.

## Migration Policy

No migration is expected for Slice C. The slice reuses canonical organizations, capacity providers, compliance profiles, restricted evidence, agreements, Workers, Crew memberships, vehicles/equipment, capability, and territory data. A future migration requires an explicit gap report before creation.
