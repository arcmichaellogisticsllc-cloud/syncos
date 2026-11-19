CREATE TABLE IF NOT EXISTS syncfield_design_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  map_document_id UUID NOT NULL,
  map_version_id UUID NOT NULL,
  map_page_id UUID NOT NULL,
  work_zone_id UUID,
  production_code_id UUID,
  from_asset_identifier TEXT,
  to_asset_identifier TEXT,
  design_label TEXT,
  design_quantity NUMERIC(14,2),
  design_unit TEXT,
  design_length_ft NUMERIC(14,2),
  geometry_type TEXT NOT NULL DEFAULT 'pdf_polyline' CHECK (geometry_type IN ('pdf_point', 'pdf_line', 'pdf_polyline')),
  geometry JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'imported', 'derived')),
  source_reference TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'void')),
  created_by_user_id UUID REFERENCES users(id),
  superseded_by_segment_id UUID REFERENCES syncfield_design_segments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT syncfield_design_segments_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT syncfield_design_segments_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT syncfield_design_segments_tenant_document_fk
    FOREIGN KEY (tenant_id, map_document_id) REFERENCES syncfield_map_documents(tenant_id, id),
  CONSTRAINT syncfield_design_segments_tenant_version_fk
    FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id),
  CONSTRAINT syncfield_design_segments_tenant_page_fk
    FOREIGN KEY (tenant_id, map_page_id) REFERENCES syncfield_map_pages(tenant_id, id),
  CONSTRAINT syncfield_design_segments_tenant_zone_fk
    FOREIGN KEY (tenant_id, work_zone_id) REFERENCES syncfield_map_work_zones(tenant_id, id),
  CONSTRAINT syncfield_design_segments_tenant_code_fk
    FOREIGN KEY (tenant_id, production_code_id) REFERENCES syncfield_production_codes(tenant_id, id),
  CONSTRAINT syncfield_design_segments_geometry_object_check
    CHECK (jsonb_typeof(geometry) = 'object'),
  CONSTRAINT syncfield_design_segments_design_quantity_check
    CHECK (design_quantity IS NULL OR design_quantity >= 0),
  CONSTRAINT syncfield_design_segments_design_length_check
    CHECK (design_length_ft IS NULL OR design_length_ft >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_design_segments_tenant_id_uidx ON syncfield_design_segments(tenant_id, id);
CREATE INDEX IF NOT EXISTS syncfield_design_segments_project_idx ON syncfield_design_segments(tenant_id, project_id, status);
CREATE INDEX IF NOT EXISTS syncfield_design_segments_work_order_idx ON syncfield_design_segments(tenant_id, work_order_id, status);
CREATE INDEX IF NOT EXISTS syncfield_design_segments_version_page_idx ON syncfield_design_segments(tenant_id, map_version_id, map_page_id, status);
CREATE INDEX IF NOT EXISTS syncfield_design_segments_assets_idx ON syncfield_design_segments(tenant_id, work_order_id, upper(from_asset_identifier), upper(to_asset_identifier)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS syncfield_asset_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
  design_segment_id UUID,
  asset_identifier TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('pole', 'pedestal', 'handhole', 'vault', 'cabinet', 'splice_point', 'terminal', 'riser', 'anchor', 'other')),
  pdf_x NUMERIC(8,6) NOT NULL CHECK (pdf_x >= 0 AND pdf_x <= 1),
  pdf_y NUMERIC(8,6) NOT NULL CHECK (pdf_y >= 0 AND pdf_y <= 1),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  accuracy_m NUMERIC(10,2),
  input_tick NUMERIC(14,2),
  output_tick NUMERIC(14,2),
  tick_unit TEXT NOT NULL DEFAULT 'ft',
  reel_cable_id TEXT,
  fiber_type TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'void')),
  daily_report_id UUID,
  submitted_revision_id UUID,
  created_by_user_id UUID REFERENCES users(id),
  client_mutation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT syncfield_asset_observations_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_assignment_fk
    FOREIGN KEY (tenant_id, assignment_id) REFERENCES syncfield_map_assignments(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_foreman_fk
    FOREIGN KEY (tenant_id, foreman_worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_document_fk
    FOREIGN KEY (tenant_id, map_document_id) REFERENCES syncfield_map_documents(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_version_fk
    FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_page_fk
    FOREIGN KEY (tenant_id, map_page_id) REFERENCES syncfield_map_pages(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_segment_fk
    FOREIGN KEY (tenant_id, design_segment_id) REFERENCES syncfield_design_segments(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_report_fk
    FOREIGN KEY (tenant_id, daily_report_id) REFERENCES daily_production_reports(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tenant_revision_fk
    FOREIGN KEY (tenant_id, submitted_revision_id) REFERENCES daily_production_report_revisions(tenant_id, id),
  CONSTRAINT syncfield_asset_observations_tick_check
    CHECK ((input_tick IS NULL OR input_tick >= 0) AND (output_tick IS NULL OR output_tick >= 0)),
  CONSTRAINT syncfield_asset_observations_gps_check
    CHECK ((latitude IS NULL OR (latitude >= -90 AND latitude <= 90)) AND (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)) AND (accuracy_m IS NULL OR accuracy_m >= 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_asset_observations_tenant_id_uidx ON syncfield_asset_observations(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_asset_observations_client_mutation_uidx
  ON syncfield_asset_observations(tenant_id, created_by_user_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS syncfield_asset_observations_assignment_idx ON syncfield_asset_observations(tenant_id, assignment_id, production_date, status);
CREATE INDEX IF NOT EXISTS syncfield_asset_observations_work_order_idx ON syncfield_asset_observations(tenant_id, work_order_id, production_date);
CREATE INDEX IF NOT EXISTS syncfield_asset_observations_asset_idx ON syncfield_asset_observations(tenant_id, work_order_id, upper(asset_identifier), production_date);
CREATE INDEX IF NOT EXISTS syncfield_asset_observations_design_segment_idx ON syncfield_asset_observations(tenant_id, design_segment_id);

CREATE TABLE IF NOT EXISTS syncfield_span_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  foreman_worker_id UUID NOT NULL,
  production_date DATE NOT NULL,
  design_segment_id UUID,
  production_record_id UUID NOT NULL,
  daily_report_id UUID,
  submitted_revision_id UUID,
  map_document_id UUID NOT NULL,
  map_version_id UUID NOT NULL,
  map_page_id UUID NOT NULL,
  from_asset_observation_id UUID,
  to_asset_observation_id UUID,
  from_asset_identifier TEXT NOT NULL,
  to_asset_identifier TEXT NOT NULL,
  redline_geometry JSONB NOT NULL,
  completion_status TEXT NOT NULL DEFAULT 'draft' CHECK (completion_status IN ('draft', 'completed', 'submitted', 'void')),
  design_deviation BOOLEAN NOT NULL DEFAULT false,
  deviation_reason TEXT CHECK (deviation_reason IS NULL OR deviation_reason IN ('field_obstruction', 'customer_direction', 'engineering_change', 'pole_unavailable', 'make_ready_condition', 'route_change', 'other')),
  deviation_notes TEXT,
  created_by_user_id UUID REFERENCES users(id),
  client_mutation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT syncfield_span_completions_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_assignment_fk
    FOREIGN KEY (tenant_id, assignment_id) REFERENCES syncfield_map_assignments(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_foreman_fk
    FOREIGN KEY (tenant_id, foreman_worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_segment_fk
    FOREIGN KEY (tenant_id, design_segment_id) REFERENCES syncfield_design_segments(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_record_fk
    FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_report_fk
    FOREIGN KEY (tenant_id, daily_report_id) REFERENCES daily_production_reports(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_revision_fk
    FOREIGN KEY (tenant_id, submitted_revision_id) REFERENCES daily_production_report_revisions(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_document_fk
    FOREIGN KEY (tenant_id, map_document_id) REFERENCES syncfield_map_documents(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_version_fk
    FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_page_fk
    FOREIGN KEY (tenant_id, map_page_id) REFERENCES syncfield_map_pages(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_from_observation_fk
    FOREIGN KEY (tenant_id, from_asset_observation_id) REFERENCES syncfield_asset_observations(tenant_id, id),
  CONSTRAINT syncfield_span_completions_tenant_to_observation_fk
    FOREIGN KEY (tenant_id, to_asset_observation_id) REFERENCES syncfield_asset_observations(tenant_id, id),
  CONSTRAINT syncfield_span_completions_geometry_object_check
    CHECK (jsonb_typeof(redline_geometry) = 'object'),
  CONSTRAINT syncfield_span_completions_deviation_required_check
    CHECK (design_deviation = false OR deviation_reason IS NOT NULL),
  CONSTRAINT syncfield_span_completions_other_deviation_notes_check
    CHECK (deviation_reason <> 'other' OR NULLIF(trim(deviation_notes), '') IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_span_completions_tenant_id_uidx ON syncfield_span_completions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_span_completions_client_mutation_uidx
  ON syncfield_span_completions(tenant_id, created_by_user_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS syncfield_span_completions_assignment_idx ON syncfield_span_completions(tenant_id, assignment_id, production_date, completion_status);
CREATE INDEX IF NOT EXISTS syncfield_span_completions_work_order_idx ON syncfield_span_completions(tenant_id, work_order_id, production_date);
CREATE INDEX IF NOT EXISTS syncfield_span_completions_design_segment_idx ON syncfield_span_completions(tenant_id, design_segment_id, completion_status);
CREATE INDEX IF NOT EXISTS syncfield_span_completions_record_idx ON syncfield_span_completions(tenant_id, production_record_id);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_span_completions_segment_assignment_draft_uidx
  ON syncfield_span_completions(tenant_id, assignment_id, design_segment_id)
  WHERE design_segment_id IS NOT NULL AND deleted_at IS NULL AND completion_status IN ('draft', 'completed');

ALTER TABLE field_mutation_receipts DROP CONSTRAINT IF EXISTS field_mutation_receipts_operation_check;
ALTER TABLE field_mutation_receipts ADD CONSTRAINT field_mutation_receipts_operation_check CHECK (operation IN (
  'create_daily_report',
  'create_production',
  'update_draft_production',
  'delete_draft_production',
  'submit_daily_report',
  'batch_sync',
  'create_asset_observation',
  'create_span_completion'
));
