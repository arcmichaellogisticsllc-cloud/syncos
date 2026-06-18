# SyncOS

SyncOS is a telecom intelligence and execution operating system built to maximize telecom work throughput by eliminating constraints between opportunity and cash.

Core flow:

```text
Signal -> Organization -> Contact Network -> Relationship Map -> Opportunity Candidate -> Opportunity -> Capacity -> Production -> Settlement -> Cash
```

Supporting flow:

```text
Constraint -> Recommendation -> Workflow -> Outcome -> Learning
```

## Structure

- `apps/web` - web application
- `apps/api` - API service
- `apps/worker` - background worker service
- `packages/database` - database schema and data access
- `packages/auth` - authentication utilities
- `packages/events` - event contracts and messaging
- `packages/workflows` - workflow orchestration logic
- `packages/permissions` - authorization and permissions
- `packages/shared` - shared types and utilities
- `packages/ui` - shared UI components
- `docs` - architecture, API, migration, and workflow documentation
- `infra` - Docker and infrastructure scripts

## Platform Rules

- Every write endpoint follows the documented [write endpoint contract](docs/architecture/write-endpoint-contract.md).
- No status change without an event.
- No event without audit context.
- No recommendation without evidence.
- No approval without authority.
- No financial correction by overwrite.
- No contractor self-activation.
- No production billable without QC/Billing authority.
- No customer portal access to internal cost data.
- No AI approval of high-risk actions.
- No hard delete of core records; use archive/soft delete.

## Planning

- Delivery sequencing is tracked in the [sprint plan](docs/workflows/sprint-plan.md).

## Code Start Gate

The first code is backend foundation code, not screens:

- Tenant model
- Users
- Roles
- Permissions
- Events
- Audit logs
- Base database migrations

See the [code start gate](docs/architecture/code-start-gate.md).

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create local environment config:

   ```bash
   cp .env.example .env
   ```

3. Start PostgreSQL and set `DATABASE_URL`.

   ```bash
   docker compose -f infra/docker/docker-compose.yml up -d
   ```

4. Run migrations:

   ```bash
   npm run db:migrate
   ```

5. Seed Jackson Telcom tenant, core roles, permissions, and admin user:

   ```bash
   npm run db:seed
   ```

6. Start the API:

   ```bash
   npm run dev
   ```

Health endpoints:

- `GET /health`
- `GET /health/db`

Protected route pattern:

- `POST /test-objects`
- Requires a signed Bearer token and `system.test_object.write`.
- Creates an object change, event payload, audit log, and uses soft-delete-ready records.

Foundation verification:

```bash
npm run typecheck
npm run db:verify
npm run security:smoke
```

`npm run db:verify` requires an empty PostgreSQL database. `npm run security:smoke` requires the API to be running against a migrated and seeded database.
