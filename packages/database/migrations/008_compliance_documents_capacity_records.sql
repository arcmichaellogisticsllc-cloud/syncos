CREATE TABLE capacity_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  capacity_provider_id UUID NOT NULL REFERENCES capacity_providers(id),
  capacity_type TEXT NOT NULL,
  territory_id UUID REFERENCES territories(id),
  availability_start DATE,
  availability_end DATE,
  production_rate NUMERIC(12,2),
  production_unit TEXT,
  compliance_status TEXT NOT NULL DEFAULT 'missing' CHECK (compliance_status IN ('compliant', 'approved', 'pending_review', 'submitted', 'missing', 'rejected', 'expired', 'archived')),
  insurance_status TEXT NOT NULL DEFAULT 'missing' CHECK (insurance_status IN ('active', 'approved', 'expires_within_30_days', 'submitted', 'pending_review', 'missing', 'rejected', 'expired', 'archived')),
  current_utilization NUMERIC(5,2) CHECK (current_utilization IS NULL OR (current_utilization >= 0 AND current_utilization <= 100)),
  readiness_score NUMERIC(8,4),
  quantity NUMERIC(12,2) NOT NULL,
  unit TEXT NOT NULL,
  effective_date DATE,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE compliance_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  capacity_provider_id UUID REFERENCES capacity_providers(id),
  document_type TEXT NOT NULL CHECK (document_type IN ('insurance', 'w9', 'msa', 'rate_schedule', 'safety_document', 'certification', 'equipment_list', 'crew_list', 'reference')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected', 'expired', 'archived')),
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  expires_at DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE capacity_gap_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  opportunity_id UUID REFERENCES opportunities(id),
  territory_id UUID REFERENCES territories(id),
  analysis_name TEXT,
  required_capacity_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  available_capacity_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  gap_summary_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX capacity_records_provider_id_idx ON capacity_records(capacity_provider_id);
CREATE INDEX capacity_records_tenant_id_idx ON capacity_records(tenant_id);
CREATE INDEX compliance_documents_tenant_id_idx ON compliance_documents(tenant_id);
CREATE INDEX capacity_gap_analyses_tenant_id_idx ON capacity_gap_analyses(tenant_id);
