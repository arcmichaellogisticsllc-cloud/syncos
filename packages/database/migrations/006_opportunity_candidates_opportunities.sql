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
  territory_id UUID REFERENCES territories(id),
  owner_user_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  work_type TEXT,
  evidence_summary TEXT,
  scope_summary TEXT,
  next_action TEXT,
  proposal_submitted_at TIMESTAMPTZ,
  award_evidence TEXT,
  customer_confirmation TEXT,
  loss_reason TEXT,
  deferral_reason TEXT,
  review_date DATE,
  stage TEXT NOT NULL DEFAULT 'qualified',
  status TEXT NOT NULL DEFAULT 'qualified' CHECK (status IN ('qualified', 'pursuit_approved', 'pursuing', 'bid_proposal', 'negotiation', 'awarded', 'lost', 'deferred', 'archived')),
  estimated_value NUMERIC(14,2),
  signal_strength_score INTEGER CHECK (signal_strength_score IS NULL OR (signal_strength_score >= 0 AND signal_strength_score <= 100)),
  relationship_access_score INTEGER CHECK (relationship_access_score IS NULL OR (relationship_access_score >= 0 AND relationship_access_score <= 100)),
  capacity_fit_score INTEGER CHECK (capacity_fit_score IS NULL OR (capacity_fit_score >= 0 AND capacity_fit_score <= 100)),
  margin_potential_score INTEGER CHECK (margin_potential_score IS NULL OR (margin_potential_score >= 0 AND margin_potential_score <= 100)),
  strategic_fit_score INTEGER CHECK (strategic_fit_score IS NULL OR (strategic_fit_score >= 0 AND strategic_fit_score <= 100)),
  payment_risk_score INTEGER CHECK (payment_risk_score IS NULL OR (payment_risk_score >= 0 AND payment_risk_score <= 100)),
  pursuit_score NUMERIC(8,4),
  recommendation TEXT CHECK (recommendation IS NULL OR recommendation IN ('Avoid', 'Monitor', 'Pursue', 'Priority Pursuit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE opportunity_capacity_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id),
  capacity_type TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  unit TEXT NOT NULL,
  territory_id UUID REFERENCES territories(id),
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX opportunity_candidates_tenant_id_idx ON opportunity_candidates(tenant_id);
CREATE INDEX opportunities_tenant_id_idx ON opportunities(tenant_id);
CREATE INDEX opportunity_capacity_requirements_tenant_id_idx ON opportunity_capacity_requirements(tenant_id);
