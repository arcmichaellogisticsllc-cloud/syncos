CREATE TABLE IF NOT EXISTS syncfield_coil_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  foreman_worker_id UUID NOT NULL,
  production_date DATE NOT NULL,
  map_document_id UUID NOT NULL,
  map_version_id UUID NOT NULL,
  map_page_id UUID NOT NULL,
  asset_observation_id UUID NOT NULL,
  design_segment_id UUID,
  span_completion_id UUID,
  production_record_id UUID,
  daily_report_id UUID,
  submitted_revision_id UUID,
  asset_identifier TEXT NOT NULL,
  easement_type TEXT NOT NULL DEFAULT 'unknown' CHECK (easement_type IN ('front','rear','unknown','not_applicable')),
  coil_type TEXT NOT NULL CHECK (coil_type IN ('front_easement','rear_easement','express_splice','butt_splice','riser_slack','general_slack','customer_required','field_condition','other')),
  required_length_ft NUMERIC(12,2),
  actual_length_ft NUMERIC(12,2),
  variance_ft NUMERIC(12,2) GENERATED ALWAYS AS (
    CASE
      WHEN required_length_ft IS NULL OR actual_length_ft IS NULL THEN NULL
      ELSE actual_length_ft - required_length_ft
    END
  ) STORED,
  variance_status TEXT NOT NULL DEFAULT 'unknown' CHECK (variance_status IN ('within_expectation','variance','unknown')),
  tolerance_ft NUMERIC(12,2) NOT NULL DEFAULT 5,
  rule_source TEXT NOT NULL DEFAULT 'manual' CHECK (rule_source IN ('project_rule','work_order_rule','customer_design','customer_direction','field_requirement','manual','other')),
  rule_source_reference TEXT,
  reel_cable_id TEXT,
  fiber_type TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','void')),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  client_mutation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT syncfield_coil_observations_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_assignment_fk
    FOREIGN KEY (tenant_id, assignment_id) REFERENCES syncfield_map_assignments(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_foreman_fk
    FOREIGN KEY (tenant_id, foreman_worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_document_fk
    FOREIGN KEY (tenant_id, map_document_id) REFERENCES syncfield_map_documents(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_version_fk
    FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_page_fk
    FOREIGN KEY (tenant_id, map_page_id) REFERENCES syncfield_map_pages(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_asset_observation_fk
    FOREIGN KEY (tenant_id, asset_observation_id) REFERENCES syncfield_asset_observations(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_segment_fk
    FOREIGN KEY (tenant_id, design_segment_id) REFERENCES syncfield_design_segments(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_span_fk
    FOREIGN KEY (tenant_id, span_completion_id) REFERENCES syncfield_span_completions(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_record_fk
    FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_report_fk
    FOREIGN KEY (tenant_id, daily_report_id) REFERENCES daily_production_reports(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_tenant_revision_fk
    FOREIGN KEY (tenant_id, submitted_revision_id) REFERENCES daily_production_report_revisions(tenant_id, id),
  CONSTRAINT syncfield_coil_observations_required_length_check
    CHECK (required_length_ft IS NULL OR required_length_ft >= 0),
  CONSTRAINT syncfield_coil_observations_actual_length_check
    CHECK (actual_length_ft IS NULL OR actual_length_ft >= 0),
  CONSTRAINT syncfield_coil_observations_tolerance_check
    CHECK (tolerance_ft >= 0),
  CONSTRAINT syncfield_coil_observations_other_notes_check
    CHECK (coil_type <> 'other' OR length(trim(COALESCE(notes, ''))) > 0),
  CONSTRAINT syncfield_coil_observations_other_source_check
    CHECK (rule_source <> 'other' OR length(trim(COALESCE(rule_source_reference, ''))) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS syncfield_coil_observations_tenant_id_uidx ON syncfield_coil_observations(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_coil_observations_client_mutation_uidx
  ON syncfield_coil_observations(tenant_id, created_by_user_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS syncfield_coil_observations_asset_idx ON syncfield_coil_observations(tenant_id, asset_observation_id, status);
CREATE INDEX IF NOT EXISTS syncfield_coil_observations_assignment_idx ON syncfield_coil_observations(tenant_id, assignment_id, production_date, status);
CREATE INDEX IF NOT EXISTS syncfield_coil_observations_work_order_idx ON syncfield_coil_observations(tenant_id, work_order_id, production_date);
CREATE INDEX IF NOT EXISTS syncfield_coil_observations_record_idx ON syncfield_coil_observations(tenant_id, production_record_id);
CREATE INDEX IF NOT EXISTS syncfield_coil_observations_crew_date_idx ON syncfield_coil_observations(tenant_id, crew_id, production_date);
CREATE INDEX IF NOT EXISTS syncfield_coil_observations_asset_identifier_idx ON syncfield_coil_observations(tenant_id, work_order_id, upper(asset_identifier), production_date);

ALTER TABLE field_mutation_receipts DROP CONSTRAINT IF EXISTS field_mutation_receipts_operation_check;
ALTER TABLE field_mutation_receipts ADD CONSTRAINT field_mutation_receipts_operation_check CHECK (operation IN (
  'create_daily_report',
  'create_production',
  'update_draft_production',
  'delete_draft_production',
  'submit_daily_report',
  'batch_sync',
  'create_asset_observation',
  'create_span_completion',
  'create_coil_observation'
));
