CREATE TABLE capacity_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  capacity_provider_id UUID NOT NULL REFERENCES capacity_providers(id),
  record_type TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  unit TEXT NOT NULL,
  effective_date DATE NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE compliance_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  capacity_provider_id UUID REFERENCES capacity_providers(id),
  document_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected', 'expired', 'archived')),
  expires_at DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX capacity_records_provider_id_idx ON capacity_records(capacity_provider_id);
CREATE INDEX compliance_documents_tenant_id_idx ON compliance_documents(tenant_id);
