# Operator UI Phase 11 Report: Account Onboarding Workbench

## Baseline

- Baseline commit: `1e0694b472268190084d125262e81555ad61ce1d`
- Branch: `main`
- Scope: Growth / Intelligence operator UI and Account Onboarding backend contract.
- Deployment status: not deployed.
- Staging status: Hostinger VPS architecture approved directionally; SSH execution not approved in this sprint.

## Sprint Purpose

Create a simple account onboarding view for both prime/customer accounts and contractor/vendor accounts.

The operator-readable onboarding spine is:

1. Identified
2. Contact Discovered
3. Initial Outreach
4. Application Submitted
5. Documents Requested
6. Compliance Review
7. Operational Interview
8. Rate Negotiation
9. Approved
10. Market Assigned
11. Mobilized

## Audit Findings

Existing supported surfaces:

- `/intelligence/organizations`
- `/intelligence/contacts`
- `/opportunities/candidates`
- `/opportunities/pipeline`
- `/opportunities/coverage`

Existing data usable for account onboarding:

- Organization name, type, actor roles, status, territory, state, owner, trust, influence, work relevance, capacity relevance, and payment relevance.
- Contact title, role, status, verification status, relationship strength, last contacted date, and updated date.
- Opportunity candidate status, owner, score, confidence, relationship access, capacity fit, work type, and review context.
- Capacity provider status, verification status, contract status, provider type, and primary contact.
- Contract status and payment terms.
- Rate schedule name, effective date, and status.

Fields requested by product that were not explicit first-class onboarding fields before the backend contract sprint:

- Explicit account onboarding stage.
- Required document summary by account.
- Missing document summary by account.
- Customer program membership.
- Rate sheet readiness summary.
- Onboarding deadline.
- Probability of receiving work as a dedicated field.

## Files Changed

- `apps/api/src/routes/account-onboarding.controller.ts`
- `apps/api/scripts/account-onboarding-smoke.js`
- `apps/web/app/intelligence/account-onboarding/page.tsx`
- `apps/web/app/intelligence/account-onboarding/account-onboarding-workbench.tsx`
- `apps/web/app/intelligence/intelligence-shell.tsx`
- `packages/database/migrations/041_account_onboarding_contract_foundation.sql`
- `packages/database/scripts/seed.js`
- `packages/database/scripts/seed-e2e-demo.js`
- `apps/api/package.json`
- `package.json`
- `tests/e2e/operator-phase11.spec.ts`
- `tests/e2e/fixtures/route-matrix.ts`
- `docs/api/routes.md`
- `docs/product/account-onboarding-backend-contract.md`
- `docs/product/operator-ui-phase-11-report.md`
- `docs/product/operator-ui-implementation-roadmap.md`
- `docs/product/operator-ui-gap-backlog.md`

## Workbench Summary

The new `/intelligence/account-onboarding` workbench:

- Adds an Account Onboarding Workbench inside the Intelligence shell.
- Shows the approved onboarding stage sequence as queue cards and accessible tabs.
- Supports Prime / Customer and Contractor / Vendor lanes.
- Prefers the contract-backed `/account-onboarding` read model and falls back to existing tenant-scoped API data when the contract is unavailable.
- Shows core account readiness fields:
  - Account owner
  - Relationship strength
  - Contact title
  - Last interaction
  - Next action
  - Deadline
  - Required documents
  - Missing documents
  - Market availability
  - Customer programs
  - Rate sheet
  - Payment terms
  - Approval status
  - Probability of receiving work
- Keeps organization and candidate links navigable.
- Removes schema gap cards when contract-backed onboarding profiles are present.

## Backend Contract Summary

Added `account_onboarding_profiles` as a tenant-scoped profile for onboarding state. The model stores explicit stage, lane, account owner, relationship strength, primary contact, last interaction, next action, deadline, required/missing documents, market availability, customer programs, rate sheet status, rate schedule link, payment terms, approval status, probability of receiving work, notes, and archive metadata.

Added `GET /account-onboarding`, `GET /account-onboarding/:id`, `POST /account-onboarding`, `PATCH /account-onboarding/:id`, and `POST /account-onboarding/:id/archive`.

The API read model joins organization, territory, owner, primary contact, rate schedule, contract, contacts, candidates, opportunities, capacity providers, and compliance document summaries without creating downstream work or external integrations.

## Boundary Copy

Added:

> Account onboarding tracks internal relationship, compliance, commercial, market, and mobilization readiness. It does not create contracts, payables, payroll, invoices, tax filings, insurance verification, customer assignments, or guaranteed work unless a separate supported workflow exists.

## Prime Target Context

The approved prime target list is now seeded as E2E/demo data only and should be created in staging through approved staging/demo data or operator-entered records, not hardcoded into the UI:

- Underground Contractors Inc. — MI/OH
- Danella — OH
- Mears Group — Midwest
- Sellenriek Construction — Midwest
- Edison Power Constructors — OH
- Henkels & McCoy — National
- NorthStar Group Services — Midwest
- Irby Construction — Midwest
- Michels Corporation — National
- W.A. Chester — Midwest

## Known Gaps

- Account onboarding detail pages are not implemented yet.
- Lifecycle stage-transition buttons are not yet added to the web app.
- Customer programs are currently onboarding profile summary values, not first-class customer program records.
- Required/missing document fields are profile summary arrays; document-type policy per program remains future work.
- Rate sheet readiness is status-only unless tied to existing rate schedules.
- Staging/customer onboarding records still require an approved controlled data-entry process.

## Tests Added

- `tests/e2e/operator-phase11.spec.ts`
  - Verifies the workbench title, purpose, boundary copy, stage tabs, hidden developer UI, tab interaction, lane filtering, search, and contract-backed prime onboarding fields.
- Route matrix updated for `/intelligence/account-onboarding`.
- `apps/api/scripts/account-onboarding-smoke.js`
  - Verifies auth, permission denial, tenant isolation, create/update/archive event/audit behavior, and enriched read-model fields.

## Validation Results

Pending current sprint validation.

## Recommended Next Sprint

Account Onboarding Lifecycle UX Sprint: add guarded detail pages and modalized stage actions for account onboarding profiles, keeping every action internal-only and preserving no downstream contract/payment/work creation boundaries.
