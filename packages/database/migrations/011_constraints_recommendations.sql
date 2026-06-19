CREATE TABLE constraints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  constraint_type TEXT NOT NULL,
  affected_object_type TEXT,
  affected_object_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES users(id),
  due_date DATE,
  resolution_summary TEXT,
  verification_summary TEXT,
  escalated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('detected', 'open', 'assigned', 'in_progress', 'blocked', 'resolved', 'verified', 'closed', 'archived')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  constraint_id UUID REFERENCES constraints(id),
  related_object_type TEXT,
  related_object_id UUID,
  recommendation_type TEXT,
  title TEXT NOT NULL,
  evidence_summary TEXT,
  risk_level TEXT,
  expected_impact TEXT,
  rejection_reason TEXT,
  defer_reason TEXT,
  review_date DATE,
  approved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'pending_review', 'approved', 'rejected', 'deferred', 'converted_to_workflow', 'completed', 'measured', 'archived')),
  confidence_score NUMERIC(5,2),
  confidence NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE recommendation_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  recommendation_id UUID NOT NULL REFERENCES recommendations(id),
  evidence_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_entity_type TEXT,
  source_entity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recommendation_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  recommendation_id UUID NOT NULL REFERENCES recommendations(id),
  expected_impact TEXT,
  actual_impact TEXT,
  success BOOLEAN,
  measured_at TIMESTAMPTZ,
  notes TEXT,
  outcome TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
