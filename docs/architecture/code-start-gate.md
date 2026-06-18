# Code Start Gate

The first implementation code must be backend foundation code, not screens.

## Required First Code

- Tenant model
- Users
- Roles
- Permissions
- Events
- Audit logs
- Base database migrations

## Current Implementation

- Base migration: `packages/database/migrations/001_base_identity_events_audit.sql`
- Event helper contract: `packages/events/src/index.ts`
- Permission helper contract: `packages/permissions/src/index.ts`
- Audit helper contract: `packages/shared/src/audit.ts`

## Gate Rule

Frontend screens should not start until the base identity, authorization, event, and audit foundations are present and usable by write endpoints.
