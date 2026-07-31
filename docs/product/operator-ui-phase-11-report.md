# Operator UI Phase 11 Report: Account Onboarding Workbench

## Baseline

- Baseline commit: `1e0694b472268190084d125262e81555ad61ce1d`
- Branch: `main`
- Scope: Growth / Intelligence operator UI only.
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

Fields requested by product but not explicit first-class onboarding fields yet:

- Explicit account onboarding stage.
- Required document summary by account.
- Missing document summary by account.
- Customer program membership.
- Rate sheet readiness summary.
- Onboarding deadline.
- Probability of receiving work as a dedicated field.

## Files Changed

- `apps/web/app/intelligence/account-onboarding/page.tsx`
- `apps/web/app/intelligence/account-onboarding/account-onboarding-workbench.tsx`
- `apps/web/app/intelligence/intelligence-shell.tsx`
- `tests/e2e/operator-phase11.spec.ts`
- `tests/e2e/fixtures/route-matrix.ts`
- `docs/product/operator-ui-phase-11-report.md`
- `docs/product/operator-ui-implementation-roadmap.md`
- `docs/product/operator-ui-gap-backlog.md`

## Workbench Summary

The new `/intelligence/account-onboarding` workbench:

- Adds an Account Onboarding Workbench inside the Intelligence shell.
- Shows the approved onboarding stage sequence as queue cards and accessible tabs.
- Supports Prime / Customer and Contractor / Vendor lanes.
- Computes counts from existing tenant-scoped API data.
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
- Adds explicit schema gap cards where current APIs cannot support exact fields.

## Boundary Copy

Added:

> Account onboarding tracks internal relationship, compliance, commercial, market, and mobilization readiness. It does not create contracts, payables, payroll, invoices, tax filings, insurance verification, customer assignments, or guaranteed work unless a separate supported workflow exists.

## Prime Target Context

The approved prime target list should be created through staging/demo data or operator-entered records, not hardcoded into the UI:

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

- The onboarding stage is inferred, not persisted.
- Dedicated document checklist fields do not exist yet.
- Customer program fields do not exist yet.
- Dedicated rate sheet readiness and payment terms summary fields are partial.
- Deadline is only available where candidate/opportunity review dates exist.
- Probability of receiving work is approximated from existing scores.
- No lifecycle mutation buttons were added because backend onboarding transitions do not exist yet.

## Tests Added

- `tests/e2e/operator-phase11.spec.ts`
  - Verifies the workbench title, purpose, boundary copy, stage tabs, hidden developer UI, tab interaction, lane filtering, search, and schema gap callouts.
- Route matrix updated for `/intelligence/account-onboarding`.

## Validation Results

Pending current sprint validation.

## Recommended Next Sprint

Account Onboarding Backend Contract Sprint: add an explicit account onboarding model, document checklist summary, customer program membership, rate sheet readiness, deadline, owner/persona assignment, and probability fields without changing financial execution behavior.
