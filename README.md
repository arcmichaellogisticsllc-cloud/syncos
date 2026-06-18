# SyncOS

Repository scaffold for the SyncOS monorepo.

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
