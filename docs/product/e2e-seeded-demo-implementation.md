# E2E Seeded Demo Implementation

## Implemented Command

```bash
npm run seed:e2e-demo
```

The command runs `packages/database/scripts/seed-e2e-demo.js`.

## Seed Strategy

The seed runs after `npm run db:verify`, which creates the baseline migrated database and Jackson Telcom seed. The E2E seed then adds a second tenant:

* `ARC SyncOS Demo Tenant`
* slug: `arc-syncos-demo`

No migrations are added.

## Canonical Story

The seed implements the Cedar Ridge Fiber Expansion story:

* Cedar Ridge Utility Authority
* Cedar Ridge Broadband Office
* Blue Splice Fiber Services
* Blue Splice Crew A
* Alex Rivera
* Signal through Accounting Export checkpoint records

## Seeded Personas

The seed creates all 10 documented personas:

* System Admin
* Growth Operator
* Operations / Project Manager
* Field Supervisor
* QC Reviewer
* Billing / Finance User
* Collections Specialist
* Payables / Payroll Admin
* Accounting Manager
* Read-Only Auditor

Roles are tenant-scoped and assigned from existing permission keys. No permission checks are weakened.

Current limitation: the existing `/auth/me/permissions` endpoint is guarded by `signal.read`. The E2E seed therefore grants `signal.read` to every E2E persona so Playwright auth setup can verify the runtime permission payload without adding a new auth route or changing backend policy. This should be revisited if the permission endpoint receives a dedicated self-read permission.

## Generated Manifest

The seed writes:

```text
tests/e2e/fixtures/e2e-demo-records.json
```

The manifest contains:

* tenant ID
* persona user IDs/emails
* seeded object IDs
* object names
* canonical routes
* recommended persona per route

IDs are deterministic UUIDv5-style values generated from a local seed namespace.

## Auth Approach

Playwright global setup reads the manifest, creates HMAC JWTs using `AUTH_JWT_SECRET`, verifies each persona through `/auth/me/permissions`, and writes runtime storage states under:

```text
tests/e2e/.auth/
```

The `.auth` directory is gitignored. No real tokens are committed.

## Scope Boundary

The seed creates data only. It does not:

* create migrations
* create production routes
* create production UI
* integrate external systems
* move money
* post GL entries
* file taxes
* import bank feeds or statements

Direct seed inserts follow the existing baseline seed pattern. Browser E2E action-created records remain future certification work.
