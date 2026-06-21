CREATE TABLE coverage_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'requirements_defined', 'sources_identified', 'partially_covered', 'fully_covered', 'covered_with_risk', 'gap_exists', 'blocked', 'approved_for_handoff', 'archived')),
  coverage_readiness_score NUMERIC(8,4),
  capacity_readiness_score NUMERIC(8,4),
  compliance_readiness_score NUMERIC(8,4),
  economic_readiness_score NUMERIC(8,4),
  coverage_readiness_band TEXT CHECK (coverage_readiness_band IS NULL OR coverage_readiness_band IN ('not_ready', 'needs_coverage_work', 'covered_with_risk', 'ready_for_handoff')),
  operations_owner_user_id UUID REFERENCES users(id),
  approved_for_handoff_by UUID REFERENCES users(id),
  approved_for_handoff_at TIMESTAMPTZ,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_note TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  archived_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE coverage_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  coverage_plan_id UUID NOT NULL REFERENCES coverage_plans(id),
  work_type TEXT NOT NULL,
  territory_id UUID REFERENCES territories(id),
  quantity NUMERIC(14,2) NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('feet', 'miles', 'drops', 'addresses', 'passings', 'splice_cases', 'nodes', 'poles', 'permits', 'inspections', 'restoration_items', 'days', 'crews', 'workers', 'equipment_units')),
  required_crew_type TEXT,
  required_equipment_type TEXT,
  required_start_date DATE,
  required_end_date DATE,
  production_rate_assumption NUMERIC(14,4),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  archived_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE coverage_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  coverage_plan_id UUID NOT NULL REFERENCES coverage_plans(id),
  coverage_requirement_id UUID REFERENCES coverage_requirements(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('internal_workforce', 'approved_subcontractor', 'preferred_contractor', 'strategic_partner', 'recruitable_contractor', 'partner_workforce', 'vendor_equipment_source', 'staffing_source', 'mixed_coverage', 'unknown')),
  organization_id UUID REFERENCES organizations(id),
  capacity_provider_id UUID REFERENCES capacity_providers(id),
  crew_id UUID REFERENCES crews(id),
  equipment_id UUID REFERENCES equipment(id),
  covered_quantity NUMERIC(14,2) NOT NULL CHECK (covered_quantity >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('feet', 'miles', 'drops', 'addresses', 'passings', 'splice_cases', 'nodes', 'poles', 'permits', 'inspections', 'restoration_items', 'days', 'crews', 'workers', 'equipment_units')),
  confidence_score NUMERIC(5,2) CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  commitment_status TEXT NOT NULL DEFAULT 'identified' CHECK (commitment_status IN ('identified', 'contacted', 'interested', 'verbally_committed', 'committed', 'unavailable', 'rejected', 'needs_activation')),
  activation_steps TEXT,
  estimated_cost NUMERIC(14,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  expected_margin_amount NUMERIC(14,2),
  expected_margin_percent NUMERIC(8,4),
  margin_confidence TEXT CHECK (margin_confidence IS NULL OR margin_confidence IN ('unknown', 'low', 'medium', 'high', 'verified')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  archived_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE coverage_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  coverage_plan_id UUID NOT NULL REFERENCES coverage_plans(id),
  coverage_requirement_id UUID REFERENCES coverage_requirements(id),
  gap_type TEXT NOT NULL CHECK (gap_type IN ('no_capacity_source', 'insufficient_crew_count', 'insufficient_worker_count', 'equipment_gap', 'compliance_gap', 'schedule_gap', 'territory_gap', 'production_rate_gap', 'subcontractor_not_active', 'contractor_not_verified', 'insurance_gap', 'safety_gap', 'permit_or_row_gap', 'material_or_vendor_gap', 'economic_gap', 'low_margin_gap', 'negative_margin_gap', 'margin_unknown_gap', 'payment_risk_gap', 'unknown_scope_gap')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  required_quantity NUMERIC(14,2) CHECK (required_quantity IS NULL OR required_quantity >= 0),
  covered_quantity NUMERIC(14,2) CHECK (covered_quantity IS NULL OR covered_quantity >= 0),
  gap_quantity NUMERIC(14,2) CHECK (gap_quantity IS NULL OR gap_quantity >= 0),
  unit TEXT CHECK (unit IS NULL OR unit IN ('feet', 'miles', 'drops', 'addresses', 'passings', 'splice_cases', 'nodes', 'poles', 'permits', 'inspections', 'restoration_items', 'days', 'crews', 'workers', 'equipment_units')),
  owner_user_id UUID REFERENCES users(id),
  due_date DATE,
  recommended_action TEXT,
  override_allowed BOOLEAN NOT NULL DEFAULT true,
  hard_stop BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'action_assigned', 'in_progress', 'resolved', 'overridden', 'hard_blocked', 'archived')),
  resolution_note TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  archived_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX coverage_plans_tenant_id_id_uidx ON coverage_plans(tenant_id, id);
CREATE UNIQUE INDEX coverage_requirements_tenant_id_id_uidx ON coverage_requirements(tenant_id, id);
CREATE UNIQUE INDEX coverage_sources_tenant_id_id_uidx ON coverage_sources(tenant_id, id);
CREATE UNIQUE INDEX coverage_gaps_tenant_id_id_uidx ON coverage_gaps(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_tenant_id_id_uidx ON equipment(tenant_id, id);

ALTER TABLE coverage_plans ADD CONSTRAINT coverage_plans_tenant_opportunity_fk
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id) NOT VALID;

ALTER TABLE coverage_requirements ADD CONSTRAINT coverage_requirements_tenant_plan_fk
  FOREIGN KEY (tenant_id, coverage_plan_id) REFERENCES coverage_plans(tenant_id, id) NOT VALID;
ALTER TABLE coverage_requirements ADD CONSTRAINT coverage_requirements_tenant_territory_fk
  FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id) NOT VALID;

ALTER TABLE coverage_sources ADD CONSTRAINT coverage_sources_tenant_plan_fk
  FOREIGN KEY (tenant_id, coverage_plan_id) REFERENCES coverage_plans(tenant_id, id) NOT VALID;
ALTER TABLE coverage_sources ADD CONSTRAINT coverage_sources_tenant_requirement_fk
  FOREIGN KEY (tenant_id, coverage_requirement_id) REFERENCES coverage_requirements(tenant_id, id) NOT VALID;
ALTER TABLE coverage_sources ADD CONSTRAINT coverage_sources_tenant_organization_fk
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE coverage_sources ADD CONSTRAINT coverage_sources_tenant_capacity_provider_fk
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id) NOT VALID;
ALTER TABLE coverage_sources ADD CONSTRAINT coverage_sources_tenant_crew_fk
  FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id) NOT VALID;
ALTER TABLE coverage_sources ADD CONSTRAINT coverage_sources_tenant_equipment_fk
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment(tenant_id, id) NOT VALID;

ALTER TABLE coverage_gaps ADD CONSTRAINT coverage_gaps_tenant_plan_fk
  FOREIGN KEY (tenant_id, coverage_plan_id) REFERENCES coverage_plans(tenant_id, id) NOT VALID;
ALTER TABLE coverage_gaps ADD CONSTRAINT coverage_gaps_tenant_requirement_fk
  FOREIGN KEY (tenant_id, coverage_requirement_id) REFERENCES coverage_requirements(tenant_id, id) NOT VALID;

CREATE INDEX coverage_plans_tenant_opportunity_active_idx ON coverage_plans(tenant_id, opportunity_id) WHERE archived_at IS NULL AND deleted_at IS NULL AND status <> 'archived';
CREATE INDEX coverage_plans_tenant_status_idx ON coverage_plans(tenant_id, status);
CREATE INDEX coverage_plans_tenant_opportunity_idx ON coverage_plans(tenant_id, opportunity_id);
CREATE INDEX coverage_requirements_tenant_plan_idx ON coverage_requirements(tenant_id, coverage_plan_id);
CREATE INDEX coverage_sources_tenant_plan_idx ON coverage_sources(tenant_id, coverage_plan_id);
CREATE INDEX coverage_sources_tenant_requirement_idx ON coverage_sources(tenant_id, coverage_requirement_id);
CREATE INDEX coverage_gaps_tenant_plan_idx ON coverage_gaps(tenant_id, coverage_plan_id);
CREATE INDEX coverage_gaps_tenant_requirement_idx ON coverage_gaps(tenant_id, coverage_requirement_id);
CREATE INDEX coverage_gaps_tenant_hard_stop_idx ON coverage_gaps(tenant_id, hard_stop);
