CREATE TABLE capacity_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  organization_id UUID REFERENCES organizations(id),
  primary_contact_id UUID REFERENCES contacts(id),
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('subcontractor', 'crew_provider', 'equipment_provider', 'staffing_partner', 'vendor')),
  verification_status TEXT NOT NULL DEFAULT 'prospect' CHECK (verification_status IN ('prospect', 'qualified', 'verification_pending', 'verified', 'suspended', 'archived')),
  contract_status TEXT NOT NULL DEFAULT 'not_started' CHECK (contract_status IN ('not_started', 'contract_pending', 'contracted')),
  suspended_reason TEXT,
  status TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect', 'qualified', 'verification_pending', 'verified', 'contract_pending', 'contracted', 'activated', 'suspended', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE crews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  capacity_provider_id UUID NOT NULL REFERENCES capacity_providers(id),
  name TEXT NOT NULL,
  crew_type TEXT NOT NULL CHECK (crew_type IN ('bore', 'trench', 'aerial', 'splicing', 'drop', 'restoration', 'inspection', 'project_management')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  capacity_provider_id UUID NOT NULL REFERENCES capacity_providers(id),
  crew_id UUID REFERENCES crews(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  capacity_provider_id UUID REFERENCES capacity_providers(id),
  crew_id UUID REFERENCES crews(id),
  name TEXT NOT NULL,
  equipment_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX capacity_providers_tenant_id_idx ON capacity_providers(tenant_id);
CREATE INDEX crews_tenant_id_idx ON crews(tenant_id);
CREATE INDEX workers_tenant_id_idx ON workers(tenant_id);
CREATE INDEX equipment_tenant_id_idx ON equipment(tenant_id);
