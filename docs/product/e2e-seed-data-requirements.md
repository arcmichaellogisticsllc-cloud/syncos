# E2E Seed Data Requirements

## Purpose

The E2E seed must create a deterministic, tenant-isolated Cedar Ridge demo path that browser tests can use from any major checkpoint without relying on prior test order.

Current state: `packages/database/scripts/seed.js` seeds a Jackson Telcom baseline. `seed:e2e-demo` does not exist yet.

## Required Seed Command

Future canonical command:

```bash
DATABASE_URL=postgres:///syncos_operator_demo npm run seed:e2e-demo
```

This command is not implemented in this clarification sprint.

## Tenant

Required:

* Tenant name: ARC SyncOS Demo Tenant
* Deterministic slug: `arc-syncos-demo`
* Deterministic tenant identifier strategy: product must confirm whether fixed UUIDs are allowed or whether deterministic lookup by slug is preferred.
* Isolation: no E2E seeded record may reference another tenant.

## Territories

Required:

* Cedar Ridge North
* Cedar Ridge South

## Organizations

Required:

* Cedar Ridge Utility Authority
* Cedar Ridge Broadband Office
* Blue Splice Fiber Services
* ARC SyncOS Demo Operations

## Contacts

Required:

* Dana Lewis, customer program manager
* Morgan Ellis, broadband office contact
* Luis Moreno, provider crew coordinator

## Capacity / Crew / Worker

Required:

* Capacity Provider: Blue Splice Fiber Services
* Crew: Blue Splice Crew A
* Worker: Alex Rivera

Optional:

* Equipment, only if existing schema and routes support it without new business objects.

## Financial Basics

Required:

* Currency: USD
* Payment terms: net_30
* Demo rate: 10.00 per foot
* Demo contractor rate: 7.00 per foot
* Demo payroll rate: 30.00 per hour
* Bank account: ARC Operating Account with masked account only

Forbidden:

* full bank account number
* online banking credentials
* API tokens
* external accounting credentials

## Checkpoint Records

Checkpoint records let E2E tests start independently at any major module.

| Object type | Deterministic name | Minimum valid state | Required related objects | Persona | Lifecycle action available |
| --- | --- | --- | --- | --- | --- |
| Signal | Cedar Ridge Fiber Expansion RFP Discovered | detected or verified variant | Cedar Ridge org context | Growth Operator | add evidence / verify |
| Organization | Cedar Ridge Utility Authority | active/qualified variant | Territory | Growth Operator | qualify / assign owner |
| Contact | Dana Lewis | active/verified variant | Cedar Ridge Utility Authority | Growth Operator | verify / mark contacted |
| Relationship Map | Cedar Ridge Access Map | active | customer/stakeholder/provider contacts | Growth Operator | add/rank path |
| Opportunity Candidate | Cedar Ridge Phase 1 Candidate | investigated or qualified variant | signal, org, relationship map | Growth Operator | qualify / convert |
| Opportunity | Cedar Ridge Phase 1 Fiber Build | approved/awarded variant | candidate/org | Growth Operator/Ops Manager | submit / approve / award |
| Coverage Plan | Cedar Ridge Phase 1 Coverage Plan | draft and approval-ready variants | opportunity | Ops Manager | approve for handoff |
| Project Handoff | Cedar Ridge Phase 1 Handoff | checklist-ready variant | opportunity/coverage | Ops Manager | approve / create project |
| Project | Cedar Ridge Phase 1 Fiber Build | ready/in progress variants | handoff | Ops Manager | start / hold / complete |
| Work Order | WO-CR-001 Underground Fiber Segment A | scheduled/ready variant | project, crew | Ops Manager | assign / start / submit |
| Production Record | PRD-CR-001 Daily Production Segment A | draft/submitted variant | work order | Field Supervisor | submit / add evidence |
| QC Review | QC-CR-001 Internal QC Segment A | pending review variant | production | QC Reviewer | start / approve / reject |
| Billable Item | BILL-CR-001 Segment A Billable | draft/ready variant | QC/production | Finance User | mark ready |
| Settlement | SET-CR-001 Cedar Ridge Settlement | draft/approved variant | billable item | Finance User | add item / approve |
| Invoice | INV-CR-001 Cedar Ridge Invoice | draft/sent/ready for cash variants | settlement | Finance User | approve / mark sent / ready for cash |
| Cash Receipt | RCPT-CR-001 Cedar Ridge Partial Payment | received/unapplied variant | invoice/customer | Finance User | apply to invoice |
| Payment Application | Cedar Ridge Partial Application | applied variant | cash receipt, invoice | Finance User | void/archive variant |
| Collection Case | COLL-CR-001 Cedar Ridge Balance Follow-Up | open variant | unpaid invoice | Collections Specialist | add action / close |
| Contractor Payable | PAY-CR-001 Blue Splice Payable | approved/payment-ready variant | settlement/provider | Payables Admin | mark payment ready |
| Payroll Run | PR-CR-001 Weekly Payroll | approved/payroll-ready variant | worker | Payables Admin | mark payroll ready |
| Payment Batch | PB-CR-001 Payment Batch | approved/scheduled variant | payable/payroll items | Payables Admin | submit execution status-only |
| Bank Transaction | BTX-CR-001 Manual Bank Clearing | unreconciled variant | bank account | Accounting Manager | match / approve |
| Reconciliation Match | Cedar Ridge Bank Match | proposed/reviewed variant | bank transaction, payment/cash | Accounting Manager | approve/reject |
| Accounting Export Batch | AEX-CR-001 Accounting Export | draft/generated variant | source financial facts | Accounting Manager | generate / approve / mark submitted |

## State Variants

For reliable modal tests, each major lifecycle should have either:

* one seed record per state, or
* a test-specific copy created from a checkpoint before mutation.

Recommended state variants:

* draft
* ready for review
* under review
* approved
* ready/downstream handoff state
* failed/rejected/void/archive target where applicable

## Reset Strategy

Default CI strategy:

1. Create fresh database.
2. Run migrations/db verify.
3. Run canonical E2E seed.
4. Run tests.
5. Drop database.

Local reset pattern:

```bash
dropdb syncos_operator_demo --if-exists
createdb syncos_operator_demo
DATABASE_URL=postgres:///syncos_operator_demo npm run db:verify
DATABASE_URL=postgres:///syncos_operator_demo npm run seed:e2e-demo
```

## Snapshot Strategy

* Seed script is source of truth.
* Snapshot is optional after the seed stabilizes.
* Snapshot must be regenerated from seed.
* Snapshot must not be manually maintained.

## Run-ID Namespacing

* Canonical seed records use deterministic names.
* Test-created records append `E2E-<run_id>`.
* Tests should avoid mutating canonical shared records unless the database is fresh for that test.
* Parallel test runs must use separate databases.

## Open Confirmations

* Should fixed UUIDs be used for canonical objects, or should tests discover records by deterministic slugs/names?
* Should all checkpoint state variants be seeded up front, or should browser tests create copies as needed?
* Should seed include all 10 personas in the first sprint or minimum four first?
* Should `db:verify` remain coupled to baseline seed, or should E2E use migrate-only plus `seed:e2e-demo` in the future?
