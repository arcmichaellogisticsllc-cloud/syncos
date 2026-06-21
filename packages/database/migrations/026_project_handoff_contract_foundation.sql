CREATE TABLE project_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id),
  coverage_plan_id UUID NOT NULL REFERENCES coverage_plans(id),
  project_id UUID REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'readiness_review', 'ready_for_project', 'approved', 'rejected', 'project_created', 'blocked', 'archived')),
  handoff_readiness_score INTEGER CHECK (handoff_readiness_score IS NULL OR (handoff_readiness_score >= 0 AND handoff_readiness_score <= 100)),
  handoff_readiness_band TEXT CHECK (handoff_readiness_band IS NULL OR handoff_readiness_band IN ('not_ready', 'needs_handoff_work', 'ready_with_risk', 'ready_for_project')),
  operations_owner_user_id UUID REFERENCES users(id),
  project_manager_user_id UUID REFERENCES users(id),
  field_supervisor_user_id UUID REFERENCES users(id),
  customer_organization_id UUID REFERENCES organizations(id),
  prime_organization_id UUID REFERENCES organizations(id),
  territory_id UUID REFERENCES territories(id),
  work_type TEXT,
  scope_summary TEXT,
  location_summary TEXT,
  expected_start_date DATE,
  expected_end_date DATE,
  handoff_notes TEXT,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  rejection_note TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_project_by UUID REFERENCES users(id),
  created_project_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  archived_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE project_handoff_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_handoff_id UUID NOT NULL REFERENCES project_handoffs(id),
  category TEXT NOT NULL CHECK (category IN ('core_identity', 'operations_ownership', 'coverage', 'capacity', 'compliance', 'customer_contract', 'financial_readiness', 'documentation', 'risk_review')),
  checklist_key TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'complete', 'overridden', 'blocked', 'not_applicable', 'archived')),
  required BOOLEAN NOT NULL DEFAULT true,
  hard_stop BOOLEAN NOT NULL DEFAULT false,
  override_allowed BOOLEAN NOT NULL DEFAULT true,
  owner_user_id UUID REFERENCES users(id),
  due_date DATE,
  completed_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  override_reason TEXT,
  override_note TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  archived_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE project_handoff_risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_handoff_id UUID NOT NULL REFERENCES project_handoffs(id),
  risk_type TEXT NOT NULL CHECK (risk_type IN ('coverage_gap', 'capacity_gap', 'compliance_gap', 'safety_gap', 'contract_gap', 'customer_requirement_gap', 'financial_gap', 'margin_gap', 'documentation_gap', 'schedule_gap', 'ownership_gap', 'scope_gap', 'location_gap', 'po_ntp_gap', 'billing_gap', 'ap_contact_gap', 'hard_stop_constraint', 'executive_hold', 'other')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  source_object_type TEXT,
  source_object_id UUID,
  message TEXT NOT NULL,
  recommended_action TEXT,
  hard_stop BOOLEAN NOT NULL DEFAULT false,
  override_allowed BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'overridden', 'hard_blocked', 'archived')),
  owner_user_id UUID REFERENCES users(id),
  due_date DATE,
  override_reason TEXT,
  override_note TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  archived_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE project_handoff_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_handoff_id UUID NOT NULL REFERENCES project_handoffs(id),
  approval_type TEXT NOT NULL CHECK (approval_type IN ('handoff_approval', 'project_creation_approval')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  approval_note TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  readiness_score INTEGER CHECK (readiness_score IS NULL OR (readiness_score >= 0 AND readiness_score <= 100)),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX project_handoffs_tenant_id_id_uidx ON project_handoffs(tenant_id, id);
CREATE UNIQUE INDEX project_handoff_checklist_tenant_id_id_uidx ON project_handoff_checklist_items(tenant_id, id);
CREATE UNIQUE INDEX project_handoff_risks_tenant_id_id_uidx ON project_handoff_risks(tenant_id, id);
CREATE UNIQUE INDEX project_handoff_approvals_tenant_id_id_uidx ON project_handoff_approvals(tenant_id, id);

ALTER TABLE project_handoffs ADD CONSTRAINT project_handoffs_tenant_coverage_plan_fk
  FOREIGN KEY (tenant_id, coverage_plan_id) REFERENCES coverage_plans(tenant_id, id) NOT VALID;
ALTER TABLE project_handoffs ADD CONSTRAINT project_handoffs_tenant_opportunity_fk
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities(tenant_id, id) NOT VALID;
ALTER TABLE project_handoffs ADD CONSTRAINT project_handoffs_tenant_project_fk
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) NOT VALID;
ALTER TABLE project_handoff_checklist_items ADD CONSTRAINT project_handoff_checklist_tenant_handoff_fk
  FOREIGN KEY (tenant_id, project_handoff_id) REFERENCES project_handoffs(tenant_id, id) NOT VALID;
ALTER TABLE project_handoff_risks ADD CONSTRAINT project_handoff_risks_tenant_handoff_fk
  FOREIGN KEY (tenant_id, project_handoff_id) REFERENCES project_handoffs(tenant_id, id) NOT VALID;
ALTER TABLE project_handoff_approvals ADD CONSTRAINT project_handoff_approvals_tenant_handoff_fk
  FOREIGN KEY (tenant_id, project_handoff_id) REFERENCES project_handoffs(tenant_id, id) NOT VALID;

CREATE INDEX project_handoffs_tenant_status_idx ON project_handoffs(tenant_id, status);
CREATE INDEX project_handoffs_tenant_coverage_active_idx ON project_handoffs(tenant_id, coverage_plan_id) WHERE archived_at IS NULL AND deleted_at IS NULL AND status <> 'archived';
CREATE INDEX project_handoffs_tenant_opportunity_idx ON project_handoffs(tenant_id, opportunity_id);
CREATE INDEX project_handoff_checklist_tenant_handoff_idx ON project_handoff_checklist_items(tenant_id, project_handoff_id);
CREATE INDEX project_handoff_risks_tenant_handoff_idx ON project_handoff_risks(tenant_id, project_handoff_id);
CREATE INDEX project_handoff_approvals_tenant_handoff_idx ON project_handoff_approvals(tenant_id, project_handoff_id);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS source_opportunity_id UUID REFERENCES opportunities(id),
  ADD COLUMN IF NOT EXISTS source_coverage_plan_id UUID REFERENCES coverage_plans(id),
  ADD COLUMN IF NOT EXISTS source_project_handoff_id UUID REFERENCES project_handoffs(id),
  ADD COLUMN IF NOT EXISTS territory_id UUID REFERENCES territories(id),
  ADD COLUMN IF NOT EXISTS work_type TEXT,
  ADD COLUMN IF NOT EXISTS scope_summary TEXT,
  ADD COLUMN IF NOT EXISTS location_summary TEXT,
  ADD COLUMN IF NOT EXISTS operations_owner_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS project_manager_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS expected_start_date DATE,
  ADD COLUMN IF NOT EXISTS expected_end_date DATE;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN ('created', 'planning', 'ready_for_work', 'active', 'on_hold', 'completed', 'closed', 'archived'));
ALTER TABLE projects ADD CONSTRAINT projects_tenant_source_handoff_fk
  FOREIGN KEY (tenant_id, source_project_handoff_id) REFERENCES project_handoffs(tenant_id, id) NOT VALID;
ALTER TABLE projects ADD CONSTRAINT projects_tenant_source_coverage_fk
  FOREIGN KEY (tenant_id, source_coverage_plan_id) REFERENCES coverage_plans(tenant_id, id) NOT VALID;
ALTER TABLE projects ADD CONSTRAINT projects_tenant_source_opportunity_fk
  FOREIGN KEY (tenant_id, source_opportunity_id) REFERENCES opportunities(tenant_id, id) NOT VALID;
CREATE UNIQUE INDEX projects_tenant_source_handoff_uidx ON projects(tenant_id, source_project_handoff_id) WHERE source_project_handoff_id IS NOT NULL AND deleted_at IS NULL;
