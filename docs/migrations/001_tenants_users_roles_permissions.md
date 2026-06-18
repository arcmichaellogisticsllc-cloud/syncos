# 001 Tenants, Users, Roles, Permissions

## Purpose

Create the identity and authorization foundation for the platform.

## Tables

- `tenants`: customer account boundary.
- `users`: global user identities.
- `tenant_users`: membership between users and tenants.
- `roles`: tenant-scoped roles.
- `permissions`: canonical permission catalog.
- `role_permissions`: permission grants assigned to roles.
- `user_roles`: role assignments for tenant users.
- `api_keys`: tenant-scoped API credentials.
- `sessions`: authenticated user sessions.

## Key Relationships

- `tenant_users.tenant_id` references `tenants.id`.
- `tenant_users.user_id` references `users.id`.
- `roles.tenant_id` references `tenants.id`.
- `role_permissions.role_id` references `roles.id`.
- `role_permissions.permission_id` references `permissions.id`.
- `user_roles.tenant_user_id` references `tenant_users.id`.
- `user_roles.role_id` references `roles.id`.

## Notes

- Seed default platform permissions in this migration.
- Add unique constraints for tenant slug, user email, role name per tenant, and permission key.
