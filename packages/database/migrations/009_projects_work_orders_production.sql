CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  opportunity_id UUID REFERENCES opportunities(id),
  customer_organization_id UUID REFERENCES organizations(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  assigned_capacity_provider_id UUID REFERENCES capacity_providers(id),
  assigned_crew_id UUID REFERENCES crews(id),
  title TEXT NOT NULL,
  work_type TEXT NOT NULL,
  location_description TEXT,
  gps_lat NUMERIC(10,7),
  gps_lng NUMERIC(10,7),
  expected_units NUMERIC(12,2) NOT NULL,
  unit_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'assigned', 'in_progress', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE production_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  work_order_id UUID NOT NULL REFERENCES work_orders(id),
  capacity_provider_id UUID NOT NULL REFERENCES capacity_providers(id),
  crew_id UUID REFERENCES crews(id),
  foreman_user_id UUID REFERENCES users(id),
  foreman_contact_id UUID REFERENCES contacts(id),
  submitted_by_user_id UUID REFERENCES users(id),
  production_date DATE NOT NULL,
  quantity_submitted NUMERIC(12,2) NOT NULL CHECK (quantity_submitted >= 0),
  unit_type TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  unit TEXT NOT NULL,
  correction_reason TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'correction_required', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE production_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  production_record_id UUID NOT NULL REFERENCES production_records(id),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('photo', 'video', 'gps', 'daily_report', 'safety_form', 'inspection_note', 'material_ticket', 'other')),
  summary TEXT NOT NULL,
  description TEXT,
  source_url TEXT,
  file_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX projects_tenant_id_idx ON projects(tenant_id);
CREATE INDEX work_orders_tenant_id_idx ON work_orders(tenant_id);
CREATE INDEX production_records_tenant_id_idx ON production_records(tenant_id);
