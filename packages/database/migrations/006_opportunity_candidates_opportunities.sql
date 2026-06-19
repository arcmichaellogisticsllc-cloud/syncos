CREATE TABLE opportunity_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  organization_id UUID REFERENCES organizations(id),
  territory_id UUID REFERENCES territories(id),
  title TEXT NOT NULL,
  name TEXT,
  work_type TEXT,
  unknown_work_type_reason TEXT,
  owner_user_id UUID REFERENCES users(id),
  evidence_summary TEXT,
  rejection_reason TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'monitoring', 'investigating', 'qualified_candidate', 'converted_to_opportunity', 'rejected', 'archived')),
  score NUMERIC(8,4),
  confidence_score INTEGER CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  relationship_access_score INTEGER CHECK (relationship_access_score IS NULL OR (relationship_access_score >= 0 AND relationship_access_score <= 100)),
  capacity_fit_score INTEGER CHECK (capacity_fit_score IS NULL OR (capacity_fit_score >= 0 AND capacity_fit_score <= 100)),
  strategic_fit_score INTEGER CHECK (strategic_fit_score IS NULL OR (strategic_fit_score >= 0 AND strategic_fit_score <= 100)),
  risk_score INTEGER CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE candidate_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  candidate_id UUID NOT NULL REFERENCES opportunity_candidates(id),
  signal_id UUID NOT NULL REFERENCES signals(id),
  contribution_score INTEGER CHECK (contribution_score IS NULL OR (contribution_score >= 0 AND contribution_score <= 100)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (candidate_id, signal_id)
);

CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  candidate_id UUID REFERENCES opportunity_candidates(id),
  organization_id UUID REFERENCES organizations(id),
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'open',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'won', 'lost', 'archived')),
  estimated_value NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE opportunity_capacity_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id),
  requirement_type TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  unit TEXT NOT NULL,
  needed_by DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX opportunity_candidates_tenant_id_idx ON opportunity_candidates(tenant_id);
CREATE INDEX opportunities_tenant_id_idx ON opportunities(tenant_id);
