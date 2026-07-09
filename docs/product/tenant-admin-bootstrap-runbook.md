# Tenant and Admin Bootstrap Runbook

## Purpose

Tenant bootstrap creates the first real staging tenant. Admin bootstrap creates the first staging administrator without committing secrets or default passwords.

## Tenant Schema

Current schema fields:

- `tenants.name`
- `tenants.slug`
- `tenants.status`
- `tenants.created_at`
- `tenants.updated_at`
- `tenants.deleted_at`

Operational metadata not currently modeled and requiring schema/product verification before use:

- owner/contact
- environment marker
- created by
- allowed domains
- notes

## Recommended First Tenant

- Tenant name: `Jackson Telcom Staging`
- Slug: `jackson-telcom-staging`
- Environment: staging, tracked operationally until a schema field exists.
- Status: `active`

## Admin Schema

Current schema fields:

- `users.email`
- `users.display_name`
- `users.password_hash`
- `users.status`
- `tenant_users.tenant_id`
- `tenant_users.user_id`
- `tenant_users.status`
- `user_roles.tenant_id`
- `user_roles.tenant_user_id`
- `user_roles.role_id`
- `user_roles.scope_type`
- `user_roles.scope_id`

## Recommended First Admin

- Email placeholder: `admin@jacksontelcom.staging.example`
- Display name: `Jackson Telcom Staging Admin`
- Role: `System Admin`
- Password/auth method: set out-of-band through the approved auth mechanism. Do not commit or document real passwords.

## Role Assignment Plan

Create or verify users for:

- Executive
- Growth Operator
- Operations Manager
- Field Supervisor
- QC Manager
- Billing / Finance User
- Collections Specialist
- Payables / Payroll Admin
- Accounting Manager
- Read-only Auditor
- System Admin

## Permission Validation

For each role:

- Can log in.
- Sees expected workspaces and navigation.
- Can view expected pages.
- Can mutate only expected workflows.
- Read-only auditor cannot mutate and receives read-only messaging.

## Bootstrap Methods

Available today:

- `db:seed` creates Jackson Telcom baseline roles, permissions, tenant, and a local-development admin. This is useful for local validation and schema reference, not final real staging admin bootstrap.
- Manual SQL can create a staging tenant/admin if no admin CLI/UI exists. This is temporary and must be reviewed by engineering and security.

Future preferred:

- Admin CLI requiring explicit env vars, strong password input or invite flow, and fail-closed environment checks.
- Admin UI after authentication and permission model are approved.

Do not create admin users with default passwords.

## Tenant Isolation Smoke

1. Create or use tenant A.
2. Create or use tenant B.
3. Log in as a tenant A user.
4. Try to access tenant B records by direct URL/API request.
5. Expected: tenant B data is not returned, mutation is denied, and audit/event behavior remains intact.

## Demo Data Policy

Do not run `seed:e2e-demo` against shared staging unless staging is explicitly marked demo-only and all testers know the data is fake. Destructive E2E must target an isolated staging certification database.
