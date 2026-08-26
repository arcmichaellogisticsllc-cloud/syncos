# Partner Portal Product Spec

## Dashboard

Purpose: daily operating overview for the Partner Admin.

Route: `/partner`

Data source: server-derived Partner context, onboarding, compliance, crews, Work Orders, mobilization, production, QC, settlements, payments, and performance summaries.

Actions: link to required Partner tasks. Do not execute Sync-owned approval, QC, settlement, or payment actions.

Sections: fixed company identity, data freshness, company summary, Partner Action Center, Today by Crew, active Work Orders, Production & QC, Settlements & Payments, and Partner-only Performance.

Action ownership: Partner Admin tasks, Crew / Foreman actions, and Waiting / Informational items are separated. Waiting on Sync review, Customer QC, Customer reinspection, Customer funds, or payment processing is not attributed as a Partner failure.

Financial behavior: accepted production awaiting settlement, issued settlements, outstanding payable, eligible amount, awaiting Customer funds, processing amount, and paid-this-month amount are displayed separately from server-returned Partner financial records. The frontend does not calculate settlement line amounts and does not expose customer rate or Sync margin.

Quantity behavior: reported, Customer accepted, and correction quantities are separate and unit-aware.

Mobile: stack summary cards, attention items, work summary, and financial summary.

## Onboarding

Purpose: guide the Partner from invited to ready for Sync review.

Route: `/partner/onboarding`

Actions: complete Partner-owned setup tasks and submit for Sync review only when server readiness allows.

Restrictions: no password fields, no Partner self-approval, no project mobilization task.

## Company

Purpose: manage canonical company profile.

Route: `/partner/company`

Editable fields: only fields supported by current company profile APIs.

Read-only fields: company status and reviewed legal/tax identity state when changes require Sync review.

Security: no raw organization ID.

## Compliance

Purpose: show tax, payment setup, insurance, credential, and document readiness.

Route: `/partner/compliance`

Actions: upload or replace supported Partner documents. Sync review/approval remains Sync-owned.

Security: restricted files are accessed through authorized endpoints only; storage keys and raw paths are hidden.

## Agreements

Purpose: show agreement versions, signatures, countersignature, execution state, and supported downloads.

Route: `/partner/agreements`

Actions: view or complete supported agreement actions. Do not expose raw agreement IDs.

## Workers

Purpose: manage workforce roster and qualification visibility.

Route: `/partner/workers`

Actions: add/edit supported Worker profile data. Ordinary Workers do not automatically receive SyncOS login.

Security: Partner sees only its own Workers.

## Crews

Purpose: show deployable capacity by crew.

Route: `/partner/crews`

Fields: crew name, Foreman, Workers, crew size, capabilities, territories, equipment, availability, current assignment, and readiness components.

Rule: Company Approved, Crew Ready, and Project Mobilization Approved remain separate.

## Vehicles & Equipment

Purpose: track Partner equipment relevant to crew and mobilization readiness.

Route: `/partner/vehicles`

Fields: asset name, type, availability, inspection status, assigned crew, and readiness effect where supported.

## Work Orders

Purpose: show assigned Work Orders and Partner commercial terms.

Route: `/partner/work-orders`

Fields: Work Order number, project context, territory, scope, assigned crew, start window, work package, production codes, Partner rate, Partner rate version, Partner coil/slack policy, retainage, and pay-when-paid terms where supported.

Security: no customer rate, Sync margin, or other Partner rates.

## Mobilization

Purpose: show Work Order and Crew-specific production-start readiness.

Route: `/partner/mobilization`

State: authorized or blocked with server-derived reasons and resolution links.

Restriction: Partner cannot self-authorize production start.

## Production

Purpose: show submitted field production by crew/date/Work Order.

Route: `/partner/production`

Fields: reported quantity, customer-accepted quantity, unit, JSA status, map revision, redline count, pole observations, input/output ticks, coil/slack totals, evidence state, QC state, and correction state.

Restriction: Partner Admin is read-only for submitted field production.

## QC & Corrections

Purpose: show Customer QC outcomes and correction status.

Route: `/partner/customer-qc`

Fields: reported quantity, accepted quantity, partial acceptance, correction required, rejection state, cycle history, affected map/span/pole, assigned Foreman, resubmission, and reinspection state.

Restriction: Partner cannot change accepted quantity.

## Settlements

Purpose: explain issued Partner settlements.

Route: `/partner/settlements`

Fields: period, gross settlement, adjustments, retainage, net settlement, issue date, status, and line source lineage.

Financial invariant: frontend formats server-returned calculations only.

## Payments

Purpose: distinguish payable eligibility from actual payment.

Route: `/partner/payments`

States: Not Yet Eligible, Awaiting Customer Funds, Eligible, Scheduled, Processing, Paid, Failed, Reversed.

Security: never show full banking instructions.

## Performance

Purpose: show Partner-only operating feedback.

Route: `/partner/performance`

Fields: score, confidence, trend, quality, production reliability, documentation, safety, mobilization, correction/rework, commercial reliability, and capacity reliability where supported.

Security: no other Partners, competitive ranking, internal shortlist, confidential customer data, or margin.
