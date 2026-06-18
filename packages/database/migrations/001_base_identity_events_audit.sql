-- SyncOS base identity, permission, event, and audit schema.
-- Target database: PostgreSQL 15+

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT tenants_slug_key UNIQUE (slug),
  CONSTRAINT tenants_status_check CHECK (status IN ('active', 'suspended', 'archived'))
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'invited', 'disabled', 'archived'))
);

CREATE TABLE tenant_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT tenant_users_tenant_user_key UNIQUE (tenant_id, user_id),
  CONSTRAINT tenant_users_status_check CHECK (status IN ('active', 'invited', 'disabled', 'archived'))
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permissions_key_key UNIQUE (key)
);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  system_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT roles_tenant_name_key UNIQUE (tenant_id, name),
  CONSTRAINT roles_tenant_system_key UNIQUE (tenant_id, system_key)
);

CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT role_permissions_role_permission_key UNIQUE (role_id, permission_id)
);

CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  tenant_user_id UUID NOT NULL REFERENCES tenant_users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_tenant_user_role_key UNIQUE (tenant_user_id, role_id)
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  idempotency_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT events_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tenant_users_tenant_id_idx ON tenant_users(tenant_id);
CREATE INDEX tenant_users_user_id_idx ON tenant_users(user_id);
CREATE INDEX roles_tenant_id_idx ON roles(tenant_id);
CREATE INDEX role_permissions_tenant_id_idx ON role_permissions(tenant_id);
CREATE INDEX user_roles_tenant_id_idx ON user_roles(tenant_id);
CREATE INDEX events_tenant_aggregate_idx ON events(tenant_id, aggregate_type, aggregate_id);
CREATE INDEX events_tenant_event_type_idx ON events(tenant_id, event_type);
CREATE INDEX audit_logs_tenant_entity_idx ON audit_logs(tenant_id, entity_type, entity_id);
CREATE INDEX audit_logs_tenant_action_idx ON audit_logs(tenant_id, action);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_set_updated_at
BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tenant_users_set_updated_at
BEFORE UPDATE ON tenant_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER roles_set_updated_at
BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION prevent_audit_log_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_prevent_update
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_update();

INSERT INTO permissions (key, name, description) VALUES
  ('tenants.read', 'Read tenants', 'View tenant records.'),
  ('tenants.write', 'Write tenants', 'Create and update tenant records.'),
  ('users.read', 'Read users', 'View user and tenant membership records.'),
  ('users.write', 'Write users', 'Create and update users and tenant memberships.'),
  ('roles.read', 'Read roles', 'View roles and role assignments.'),
  ('roles.write', 'Write roles', 'Create and update roles and role assignments.'),
  ('permissions.read', 'Read permissions', 'View permission grants.'),
  ('events.read', 'Read events', 'View domain event records.'),
  ('audit_logs.read', 'Read audit logs', 'View audit log records.')
ON CONFLICT (key) DO NOTHING;
