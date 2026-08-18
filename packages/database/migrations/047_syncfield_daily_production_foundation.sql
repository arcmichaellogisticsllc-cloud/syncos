CREATE TABLE IF NOT EXISTS syncfield_production_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'field' CHECK (category IN ('field', 'labor', 'equipment', 'admin')),
  unit_of_measure TEXT NOT NULL,
  location_type TEXT NOT NULL CHECK (location_type IN ('asset', 'route', 'daily')),
  requires_asset BOOLEAN NOT NULL DEFAULT false,
  requires_route BOOLEAN NOT NULL DEFAULT false,
  requires_photo BOOLEAN NOT NULL DEFAULT false,
  requires_notes BOOLEAN NOT NULL DEFAULT false,
  requires_quantity BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_production_codes_tenant_id_uidx ON syncfield_production_codes(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_production_codes_code_uidx
  ON syncfield_production_codes(tenant_id, upper(code))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS syncfield_work_order_production_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  work_order_version_id UUID NOT NULL,
  production_code_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT syncfield_wopc_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT syncfield_wopc_tenant_code_fk
    FOREIGN KEY (tenant_id, production_code_id) REFERENCES syncfield_production_codes(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_wopc_tenant_id_uidx ON syncfield_work_order_production_codes(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_wopc_active_uidx
  ON syncfield_work_order_production_codes(tenant_id, work_order_version_id, production_code_id)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS daily_production_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  foreman_worker_id UUID NOT NULL,
  foreman_user_id UUID NOT NULL REFERENCES users(id),
  work_date DATE NOT NULL,
  map_document_id UUID,
  map_version_id UUID,
  daily_jsa_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'void')),
  start_time TIME,
  end_time TIME,
  weather TEXT,
  general_notes TEXT,
  submitted_at TIMESTAMPTZ,
  submitted_by_user_id UUID REFERENCES users(id),
  revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0),
  current BOOLEAN NOT NULL DEFAULT true,
  client_mutation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT daily_production_reports_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT daily_production_reports_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT daily_production_reports_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT daily_production_reports_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT daily_production_reports_tenant_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT daily_production_reports_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT daily_production_reports_tenant_foreman_fk
    FOREIGN KEY (tenant_id, foreman_worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT daily_production_reports_tenant_map_document_fk
    FOREIGN KEY (tenant_id, map_document_id) REFERENCES syncfield_map_documents(tenant_id, id),
  CONSTRAINT daily_production_reports_tenant_map_version_fk
    FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id),
  CONSTRAINT daily_production_reports_tenant_jsa_fk
    FOREIGN KEY (tenant_id, daily_jsa_id) REFERENCES daily_jsas(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_production_reports_tenant_id_uidx ON daily_production_reports(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS daily_production_reports_current_day_uidx
  ON daily_production_reports(tenant_id, work_order_version_id, crew_id, work_date)
  WHERE current = true AND deleted_at IS NULL AND status <> 'void';
CREATE UNIQUE INDEX IF NOT EXISTS daily_production_reports_client_mutation_uidx
  ON daily_production_reports(tenant_id, foreman_user_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS daily_production_report_id UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS work_order_version_id UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS partner_organization_id UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS foreman_worker_id UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS map_document_id UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS map_version_id UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS syncfield_production_code_id UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS syncfield_location_type TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS syncfield_status TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS asset_type TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS asset_identifier TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS from_asset_identifier TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS to_asset_identifier TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS map_page INTEGER;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS duplicate_reason TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS client_mutation_id TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_syncfield_status_check;
ALTER TABLE production_records ADD CONSTRAINT production_records_syncfield_status_check CHECK (
  syncfield_status IS NULL OR syncfield_status IN ('partial', 'complete', 'blocked', 'rework')
);
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_syncfield_location_type_check;
ALTER TABLE production_records ADD CONSTRAINT production_records_syncfield_location_type_check CHECK (
  syncfield_location_type IS NULL OR syncfield_location_type IN ('asset', 'route', 'daily')
);
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_syncfield_quantity_positive_check;
ALTER TABLE production_records ADD CONSTRAINT production_records_syncfield_quantity_positive_check CHECK (
  daily_production_report_id IS NULL OR quantity_submitted > 0
);
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_daily_report_fk;
ALTER TABLE production_records ADD CONSTRAINT production_records_daily_report_fk
  FOREIGN KEY (tenant_id, daily_production_report_id) REFERENCES daily_production_reports(tenant_id, id) NOT VALID;
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_work_order_version_fk;
ALTER TABLE production_records ADD CONSTRAINT production_records_work_order_version_fk
  FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id) NOT VALID;
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_partner_org_fk;
ALTER TABLE production_records ADD CONSTRAINT production_records_partner_org_fk
  FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id) NOT VALID;
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_syncfield_foreman_worker_fk;
ALTER TABLE production_records ADD CONSTRAINT production_records_syncfield_foreman_worker_fk
  FOREIGN KEY (tenant_id, foreman_worker_id) REFERENCES workers(tenant_id, id) NOT VALID;
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_syncfield_map_document_fk;
ALTER TABLE production_records ADD CONSTRAINT production_records_syncfield_map_document_fk
  FOREIGN KEY (tenant_id, map_document_id) REFERENCES syncfield_map_documents(tenant_id, id) NOT VALID;
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_syncfield_map_version_fk;
ALTER TABLE production_records ADD CONSTRAINT production_records_syncfield_map_version_fk
  FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id) NOT VALID;
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_syncfield_code_fk;
ALTER TABLE production_records ADD CONSTRAINT production_records_syncfield_code_fk
  FOREIGN KEY (tenant_id, syncfield_production_code_id) REFERENCES syncfield_production_codes(tenant_id, id) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS production_records_syncfield_client_mutation_uidx
  ON production_records(tenant_id, foreman_user_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL AND daily_production_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS production_records_daily_report_idx ON production_records(tenant_id, daily_production_report_id, status);
CREATE INDEX IF NOT EXISTS production_records_syncfield_duplicate_asset_idx ON production_records(tenant_id, work_order_version_id, syncfield_production_code_id, upper(asset_identifier));
CREATE INDEX IF NOT EXISTS production_records_syncfield_duplicate_route_idx ON production_records(tenant_id, work_order_version_id, syncfield_production_code_id, upper(from_asset_identifier), upper(to_asset_identifier));

CREATE TABLE IF NOT EXISTS map_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  production_record_id UUID NOT NULL,
  map_version_id UUID NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  annotation_type TEXT NOT NULL CHECK (annotation_type IN ('asset_point', 'route_line', 'status_mark')),
  x_ratio NUMERIC(8,6) CHECK (x_ratio IS NULL OR (x_ratio >= 0 AND x_ratio <= 1)),
  y_ratio NUMERIC(8,6) CHECK (y_ratio IS NULL OR (y_ratio >= 0 AND y_ratio <= 1)),
  start_x_ratio NUMERIC(8,6) CHECK (start_x_ratio IS NULL OR (start_x_ratio >= 0 AND start_x_ratio <= 1)),
  start_y_ratio NUMERIC(8,6) CHECK (start_y_ratio IS NULL OR (start_y_ratio >= 0 AND start_y_ratio <= 1)),
  end_x_ratio NUMERIC(8,6) CHECK (end_x_ratio IS NULL OR (end_x_ratio >= 0 AND end_x_ratio <= 1)),
  end_y_ratio NUMERIC(8,6) CHECK (end_y_ratio IS NULL OR (end_y_ratio >= 0 AND end_y_ratio <= 1)),
  label_x_ratio NUMERIC(8,6) CHECK (label_x_ratio IS NULL OR (label_x_ratio >= 0 AND label_x_ratio <= 1)),
  label_y_ratio NUMERIC(8,6) CHECK (label_y_ratio IS NULL OR (label_y_ratio >= 0 AND label_y_ratio <= 1)),
  display_status TEXT NOT NULL DEFAULT 'complete' CHECK (display_status IN ('partial', 'complete', 'blocked', 'rework')),
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT map_annotations_tenant_record_fk
    FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records(tenant_id, id),
  CONSTRAINT map_annotations_tenant_version_fk
    FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS map_annotations_tenant_id_uidx ON map_annotations(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS map_annotations_record_uidx
  ON map_annotations(tenant_id, production_record_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS map_annotations_version_page_idx ON map_annotations(tenant_id, map_version_id, page_number);

CREATE TABLE IF NOT EXISTS daily_production_report_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  daily_report_id UUID NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  snapshot_json JSONB NOT NULL,
  reason TEXT NOT NULL DEFAULT 'submitted',
  submitted_by_user_id UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT daily_production_revisions_tenant_report_fk
    FOREIGN KEY (tenant_id, daily_report_id) REFERENCES daily_production_reports(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_production_revisions_tenant_id_uidx ON daily_production_report_revisions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS daily_production_revisions_number_uidx
  ON daily_production_report_revisions(tenant_id, daily_report_id, revision_number);

CREATE TABLE IF NOT EXISTS field_mutation_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  mutation_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create_daily_report', 'create_production', 'update_draft_production', 'delete_draft_production', 'submit_daily_report', 'batch_sync')),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  status TEXT NOT NULL DEFAULT 'synced' CHECK (status IN ('syncing', 'synced', 'failed')),
  safe_error TEXT,
  payload_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS field_mutation_receipts_mutation_uidx
  ON field_mutation_receipts(tenant_id, actor_user_id, mutation_id, operation);
CREATE INDEX IF NOT EXISTS field_mutation_receipts_actor_idx ON field_mutation_receipts(tenant_id, actor_user_id, status);
