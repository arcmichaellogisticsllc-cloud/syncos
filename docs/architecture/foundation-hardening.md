# Sprint 0.5 Foundation Hardening

This document records the production-safety gates added before Sprint 1 business modules.

## Authentication

- Protected routes require a signed Bearer token.
- Tokens use HS256 and are verified with `AUTH_JWT_SECRET`.
- `sub` and `tenant_id` claims are required.
- User, tenant, and tenant membership must all be active in the database.
- Header-based auth is restricted to `ALLOW_DEV_HEADER_AUTH=true` outside production and still requires active DB membership.

## Permission Enforcement

- Protected routes fail closed if permission metadata is missing.
- Mutating protected routes without permission metadata return an explicit failure.
- Permission checks support scoped role assignments through `user_roles.scope_type` and `user_roles.scope_id`.

## Tenant Isolation

- Tenant-owned data access must go through tenant-scoped helpers or equivalent `tenant_id` filters.
- Route params must be checked by loading the record in tenant scope before mutation.
- Existing migration FKs are still mostly single-column `id` references. Composite tenant-safe foreign keys are deferred and must be addressed before production data import.

## Write Actions

Future write endpoints must use the shared write action pattern:

1. Permission check.
2. Lifecycle validation.
3. Tenant-scoped object write.
4. Event write.
5. Event payload write.
6. Audit log write.
7. Optional system action write.

## Deferred Tenant-Safe FK Work

The current schema includes `tenant_id` on core tables but does not yet enforce all cross-table relationships as composite `(tenant_id, id)` references. This is acceptable for Sprint 0.5 hardening only because domain write endpoints are not yet implemented. It must be fixed before production use.
