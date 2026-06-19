CREATE TABLE territories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  code TEXT,
  parent_territory_id UUID REFERENCES territories(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, name)
);

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  territory_id UUID REFERENCES territories(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'unknown',
  actor_roles TEXT[] NOT NULL DEFAULT '{}'::text[],
  source_name TEXT,
  source_url TEXT,
  trust_level INTEGER,
  status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'researched', 'qualified', 'relationship_opened', 'active', 'strategic', 'dormant', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE organization_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  source_organization_id UUID NOT NULL REFERENCES organizations(id),
  target_organization_id UUID NOT NULL REFERENCES organizations(id),
  relationship_type TEXT NOT NULL,
  strength NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX territories_tenant_id_idx ON territories(tenant_id);
CREATE INDEX organizations_tenant_id_idx ON organizations(tenant_id);
