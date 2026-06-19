# SyncOS Testing Framework

Sprint 14 uses Node.js built-in `node:test`.

## Choice

`node:test` was selected instead of adding Vitest/Jest because SyncOS already runs on Node 20, the framework is dependency-free, works in CI with `npm test`, and avoids registry/network dependency risk during release hardening.

## Categories

- Unit: shared contracts and deterministic helpers.
- Integration: database migration verification through `npm run db:verify`.
- API: smoke suites exercise API routes against a local database/API.
- Permission: security smoke and regression tests verify explicit permission metadata.
- Tenant isolation: smoke suites verify cross-tenant access is blocked.
- Lifecycle: sprint smokes validate approved lifecycle transitions.

## Commands

- `npm test`
- `npm run security:smoke`
- `npm run sprint1:smoke` through `npm run sprint14:smoke`
- `DATABASE_URL=<db> npm run db:verify`

## Regression Scope

The regression suite checks that completed sprint route surfaces, permissions, migration ordering, write-action guarantees, and forbidden Sprint 14 business artifacts remain intact.
