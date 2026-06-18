# Database Package

The database package owns schema migrations and database-facing contracts.

## Migration Order

Start with:

- `migrations/001_base_identity_events_audit.sql`

This migration creates the first code gate tables:

- tenants
- users
- tenant users
- roles
- permissions
- role permissions
- user roles
- events
- audit logs

No application screens should be built before these backend foundations exist.
