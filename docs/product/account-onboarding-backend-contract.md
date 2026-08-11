# Account Onboarding Backend Contract

## Purpose

Account Onboarding is the backend-truth source for tracking prime/customer and contractor/vendor onboarding readiness from first identification through mobilization.

The contract supports the operator workflow:

Identified -> Contact Discovered -> Initial Outreach -> Application Submitted -> Documents Requested -> Compliance Review -> Operational Interview -> Rate Negotiation -> Approved -> Market Assigned -> Mobilized

It does not create contracts, customer assignments, payables, payroll, invoices, tax filings, insurance verification, payment activity, external submissions, or guaranteed work.

## Schema

`account_onboarding_profiles` stores one active onboarding profile per organization:

- `organization_id`
- `lane`: `prime` or `contractor`
- `onboarding_stage`
- `account_owner_user_id`
- `relationship_strength_score`
- `primary_contact_id`
- `last_interaction_at`
- `next_action`
- `next_action_deadline`
- `required_documents`
- `missing_documents`
- `market_availability`
- `customer_programs`
- `rate_sheet_status`
- `rate_schedule_id`
- `payment_terms_days`
- `approval_status`
- `probability_of_work`
- `status`
- `notes`
- archive metadata
- create/update metadata

## Approved Stages

- `identified`
- `contact_discovered`
- `initial_outreach`
- `application_submitted`
- `documents_requested`
- `compliance_review`
- `operational_interview`
- `rate_negotiation`
- `approved`
- `market_assigned`
- `mobilized`

## Approved Status Fields

Rate sheet status:

- `not_captured`
- `not_required`
- `requested`
- `received`
- `in_review`
- `approved`
- `rejected`

Approval status:

- `not_submitted`
- `submitted`
- `in_review`
- `approved`
- `rejected`
- `blocked`

Profile status:

- `active`
- `archived`

## API Routes

`GET /account-onboarding`

Requires `account_onboarding.read`.

Returns enriched rows with:

- profile fields
- organization name/type/status/state
- territory name/code
- account owner name
- primary contact name/title/status
- rate schedule and contract context
- contact/candidate/opportunity/provider counts
- document count summaries where current compliance document links support them
- stage/lane labels
- field counts and boundary copy

Supported filters:

- `lane`
- `onboarding_stage`
- `approval_status`
- `account_owner_user_id`
- `archived`
- `q`

Supported sorts:

- `default`
- `deadline_asc`
- `probability_desc`
- `relationship_desc`
- `company_asc`

`GET /account-onboarding/:id`

Requires `account_onboarding.read`.

Returns one enriched onboarding profile by profile id.

`POST /account-onboarding`

Requires `account_onboarding.create`.

Creates an internal onboarding profile for a tenant-scoped organization. The route validates tenant ownership for organization, owner, primary contact, and rate schedule references.

`PATCH /account-onboarding/:id`

Requires `account_onboarding.update`.

Updates internal onboarding profile fields only.

`POST /account-onboarding/:id/archive`

Requires `account_onboarding.archive`.

Archives the internal onboarding profile. This does not archive the organization, contact, contract, rate schedule, compliance document, opportunity, payable, payroll, invoice, or customer account.

## Field Ownership

Account Onboarding owns:

- explicit onboarding stage
- onboarding lane
- onboarding next action and deadline
- onboarding required/missing document checklist
- market availability summary for onboarding review
- customer program summary for onboarding review
- rate sheet readiness status
- payment terms summary for onboarding review
- onboarding approval status
- probability of receiving work

Existing records remain source-of-truth for their own domains:

- Organizations own legal identity, taxonomy, actor roles, territory, and relationship owner.
- Contacts own people, titles, verification, contact status, and relationship signal.
- Capacity Providers own contractor/vendor capacity status.
- Compliance Documents own submitted/approved/rejected/expired document records.
- Contracts own contract and payment-term records.
- Rate Schedules own rate schedule records and rate codes.
- Opportunities own pursuit and awarded work.

## Boundary Rules

Account Onboarding updates internal SyncOS readiness state only.

It does not:

- create or execute a contract
- guarantee work from a prime/customer
- assign market work to Sync
- verify insurance externally
- verify tax documents externally
- create contractor payable records
- run payroll
- create invoices
- move money
- submit to a prime portal
- submit to an accounting, payroll, bank, or payment system
- contact people automatically

## Approved Prime Target Seed Policy

The approved prime target list may be seeded only as staging/demo data:

- Underground Contractors Inc. - MI/OH
- Danella - OH
- Mears Group - Midwest
- Sellenriek Construction - Midwest
- Edison Power Constructors - OH
- Henkels & McCoy - National
- NorthStar Group Services - Midwest
- Irby Construction - Midwest
- Michels Corporation - National
- W.A. Chester - Midwest

Rules:

- Use placeholder `.test` or `.example` contact data unless controlled staging contacts are approved.
- Do not seed production customer data.
- Do not seed real bank, payroll, payment, tax, or confidential financial data.
- Do not treat target presence as approval, contract, assignment, or guaranteed work.
- Promote target records to real staging records only through an approved staging data process.

## Deferred Gaps

- Detail pages for onboarding profiles are not yet implemented in the web app.
- Dedicated document-type policy per prime/customer program is not yet modeled.
- Customer program records are stored as onboarding summary text arrays, not first-class program objects.
- Rate negotiation remains status-only unless tied to existing rate schedules.
- Email/password onboarding is not implemented.
