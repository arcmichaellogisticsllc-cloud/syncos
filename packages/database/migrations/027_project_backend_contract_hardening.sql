ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS prime_organization_id UUID REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS contractor_organization_id UUID REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS project_phase TEXT,
  ADD COLUMN IF NOT EXISTS planned_start_date DATE,
  ADD COLUMN IF NOT EXISTS planned_end_date DATE,
  ADD COLUMN IF NOT EXISTS actual_start_date DATE,
  ADD COLUMN IF NOT EXISTS actual_end_date DATE,
  ADD COLUMN IF NOT EXISTS field_supervisor_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS coverage_readiness_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS compliance_readiness_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS financial_readiness_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS project_readiness_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS project_readiness_band TEXT,
  ADD COLUMN IF NOT EXISTS billing_package_requirements JSONB,
  ADD COLUMN IF NOT EXISTS documentation_requirements JSONB,
  ADD COLUMN IF NOT EXISTS customer_validation_requirements JSONB,
  ADD COLUMN IF NOT EXISTS risk_notes TEXT,
  ADD COLUMN IF NOT EXISTS hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS hold_note TEXT,
  ADD COLUMN IF NOT EXISTS hold_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hold_release_note TEXT,
  ADD COLUMN IF NOT EXISTS previous_status TEXT,
  ADD COLUMN IF NOT EXISTS closeout_notes TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT;

UPDATE projects
SET
  project_phase = COALESCE(project_phase, CASE WHEN status = 'created' THEN 'intake' ELSE 'planning' END),
  planned_start_date = COALESCE(planned_start_date, expected_start_date),
  planned_end_date = COALESCE(planned_end_date, expected_end_date)
WHERE deleted_at IS NULL;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN ('created', 'planning', 'ready_for_work', 'active', 'on_hold', 'completed', 'closed', 'archived'));
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_phase_check;
ALTER TABLE projects ADD CONSTRAINT projects_phase_check CHECK (project_phase IS NULL OR project_phase IN ('intake', 'planning', 'pre_construction', 'construction', 'closeout', 'complete'));
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_readiness_band_check;
ALTER TABLE projects ADD CONSTRAINT projects_readiness_band_check CHECK (project_readiness_band IS NULL OR project_readiness_band IN ('not_ready', 'needs_planning', 'ready_with_risk', 'ready_for_work'));

ALTER TABLE projects ADD CONSTRAINT projects_tenant_prime_organization_fk
  FOREIGN KEY (tenant_id, prime_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE projects ADD CONSTRAINT projects_tenant_contractor_organization_fk
  FOREIGN KEY (tenant_id, contractor_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE projects ADD CONSTRAINT projects_tenant_territory_fk
  FOREIGN KEY (tenant_id, territory_id) REFERENCES territories(tenant_id, id) NOT VALID;

CREATE INDEX IF NOT EXISTS projects_tenant_status_idx ON projects(tenant_id, status);
CREATE INDEX IF NOT EXISTS projects_tenant_customer_org_idx ON projects(tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS projects_tenant_territory_idx ON projects(tenant_id, territory_id);
CREATE INDEX IF NOT EXISTS projects_tenant_project_manager_idx ON projects(tenant_id, project_manager_user_id);
CREATE INDEX IF NOT EXISTS projects_tenant_source_handoff_idx ON projects(tenant_id, source_project_handoff_id);
CREATE INDEX IF NOT EXISTS projects_tenant_archived_at_idx ON projects(tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS projects_tenant_planned_start_idx ON projects(tenant_id, planned_start_date);
CREATE INDEX IF NOT EXISTS projects_tenant_planned_end_idx ON projects(tenant_id, planned_end_date);
