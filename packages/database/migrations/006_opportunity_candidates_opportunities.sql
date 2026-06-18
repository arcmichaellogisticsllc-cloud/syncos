CREATE TABLE opportunity_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  organization_id UUID REFERENCES organizations(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'scored', 'converted', 'rejected', 'archived')),
  score NUMERIC(8,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE candidate_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  candidate_id UUID NOT NULL REFERENCES opportunity_candidates(id),
  signal_id UUID NOT NULL REFERENCES signals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
