ALTER TABLE partner_restricted_file_objects DROP CONSTRAINT IF EXISTS partner_restricted_file_objects_category_check;
ALTER TABLE partner_restricted_file_objects ADD CONSTRAINT partner_restricted_file_objects_category_check CHECK (category IN (
  'worker_headshot',
  'worker_credential_evidence',
  'partner_msa_executed',
  'partner_msa_amendment_executed',
  'partner_work_order_executed',
  'partner_vehicle_agreement_executed',
  'syncfield_map_original_pdf'
));

ALTER TABLE partner_restricted_file_objects DROP CONSTRAINT IF EXISTS partner_restricted_file_objects_related_entity_type_check;
ALTER TABLE partner_restricted_file_objects ADD CONSTRAINT partner_restricted_file_objects_related_entity_type_check CHECK (related_entity_type IN (
  'worker',
  'worker_headshot',
  'worker_credential',
  'partner_agreement_version',
  'partner_work_order_version',
  'partner_vehicle_assignment',
  'syncfield_map_version'
));

CREATE TABLE IF NOT EXISTS syncfield_map_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  name TEXT NOT NULL,
  customer_document_number TEXT,
  document_type TEXT NOT NULL DEFAULT 'construction_map' CHECK (document_type IN ('construction_map', 'work_package', 'permit_map', 'other')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT syncfield_map_documents_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT syncfield_map_documents_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_map_documents_tenant_id_uidx ON syncfield_map_documents(tenant_id, id);
CREATE INDEX IF NOT EXISTS syncfield_map_documents_work_order_idx ON syncfield_map_documents(tenant_id, work_order_id, status);

CREATE TABLE IF NOT EXISTS syncfield_map_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  map_document_id UUID NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  revision_label TEXT,
  received_date DATE,
  source_name TEXT,
  source_received_from TEXT,
  original_filename TEXT NOT NULL,
  original_file_object_id UUID NOT NULL,
  file_hash TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  processing_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (processing_status IN ('uploaded', 'processing', 'ready', 'failed')),
  processing_error TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'ready', 'failed', 'superseded', 'archived')),
  uploaded_by_user_id UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by_version_id UUID REFERENCES syncfield_map_versions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT syncfield_map_versions_tenant_document_fk
    FOREIGN KEY (tenant_id, map_document_id) REFERENCES syncfield_map_documents(tenant_id, id),
  CONSTRAINT syncfield_map_versions_tenant_file_fk
    FOREIGN KEY (tenant_id, original_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_map_versions_tenant_id_uidx ON syncfield_map_versions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_map_versions_revision_uidx
  ON syncfield_map_versions(tenant_id, map_document_id, revision_number)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS syncfield_map_versions_document_idx ON syncfield_map_versions(tenant_id, map_document_id, status);

CREATE TABLE IF NOT EXISTS syncfield_map_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  map_version_id UUID NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  pdf_width NUMERIC(14,4),
  pdf_height NUMERIC(14,4),
  rotation INTEGER NOT NULL DEFAULT 0,
  thumbnail_file_object_id UUID,
  preview_file_object_id UUID,
  processing_status TEXT NOT NULL DEFAULT 'ready' CHECK (processing_status IN ('pending', 'ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT syncfield_map_pages_tenant_version_fk
    FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id),
  CONSTRAINT syncfield_map_pages_tenant_thumbnail_fk
    FOREIGN KEY (tenant_id, thumbnail_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id),
  CONSTRAINT syncfield_map_pages_tenant_preview_fk
    FOREIGN KEY (tenant_id, preview_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_map_pages_tenant_id_uidx ON syncfield_map_pages(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_map_pages_version_page_uidx ON syncfield_map_pages(tenant_id, map_version_id, page_number);

CREATE TABLE IF NOT EXISTS syncfield_map_work_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  map_version_id UUID NOT NULL,
  name TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  x_ratio NUMERIC(8,6) NOT NULL CHECK (x_ratio >= 0 AND x_ratio <= 1),
  y_ratio NUMERIC(8,6) NOT NULL CHECK (y_ratio >= 0 AND y_ratio <= 1),
  zoom_level NUMERIC(8,3) NOT NULL DEFAULT 1 CHECK (zoom_level > 0),
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT syncfield_map_work_zones_tenant_version_fk
    FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_map_work_zones_tenant_id_uidx ON syncfield_map_work_zones(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_map_work_zones_name_uidx
  ON syncfield_map_work_zones(tenant_id, map_version_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS syncfield_map_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_order_version_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  capacity_provider_id UUID NOT NULL,
  crew_assignment_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  foreman_worker_id UUID NOT NULL,
  map_document_id UUID NOT NULL,
  map_version_id UUID NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assignment_status TEXT NOT NULL DEFAULT 'active' CHECK (assignment_status IN ('draft', 'active', 'superseded', 'held', 'archived')),
  assigned_by_user_id UUID REFERENCES users(id),
  supersedes_assignment_id UUID REFERENCES syncfield_map_assignments(id),
  superseded_by_assignment_id UUID REFERENCES syncfield_map_assignments(id),
  current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT syncfield_map_assignments_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT syncfield_map_assignments_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT syncfield_map_assignments_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT syncfield_map_assignments_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT syncfield_map_assignments_tenant_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT syncfield_map_assignments_tenant_crew_assignment_fk
    FOREIGN KEY (tenant_id, crew_assignment_id) REFERENCES partner_work_order_crew_assignments(tenant_id, id),
  CONSTRAINT syncfield_map_assignments_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT syncfield_map_assignments_tenant_foreman_fk
    FOREIGN KEY (tenant_id, foreman_worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT syncfield_map_assignments_tenant_document_fk
    FOREIGN KEY (tenant_id, map_document_id) REFERENCES syncfield_map_documents(tenant_id, id),
  CONSTRAINT syncfield_map_assignments_tenant_version_fk
    FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_map_assignments_tenant_id_uidx ON syncfield_map_assignments(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS syncfield_map_assignments_current_uidx
  ON syncfield_map_assignments(tenant_id, work_order_version_id, crew_assignment_id)
  WHERE current = true AND deleted_at IS NULL AND assignment_status = 'active';
CREATE INDEX IF NOT EXISTS syncfield_map_assignments_partner_idx ON syncfield_map_assignments(tenant_id, organization_id, crew_id, assignment_status);

CREATE TABLE IF NOT EXISTS daily_jsas (
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
  map_version_id UUID,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'void')),
  meeting_started_at TIMESTAMPTZ,
  meeting_completed_at TIMESTAMPTZ,
  work_location TEXT NOT NULL,
  weather TEXT,
  site_conditions TEXT,
  hazards TEXT[] NOT NULL DEFAULT '{}'::text[],
  controls TEXT[] NOT NULL DEFAULT '{}'::text[],
  ppe_confirmed BOOLEAN NOT NULL DEFAULT false,
  traffic_control_reviewed BOOLEAN NOT NULL DEFAULT false,
  emergency_plan_reviewed BOOLEAN NOT NULL DEFAULT false,
  utilities_reviewed BOOLEAN NOT NULL DEFAULT false,
  aerial_hazards_reviewed BOOLEAN NOT NULL DEFAULT false,
  incident_reporting_reviewed BOOLEAN NOT NULL DEFAULT false,
  crew_participation_confirmed BOOLEAN NOT NULL DEFAULT false,
  foreman_certified BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by_user_id UUID REFERENCES users(id),
  submitted_by_user_id UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT daily_jsas_tenant_project_fk
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT daily_jsas_tenant_work_order_fk
    FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT daily_jsas_tenant_wov_fk
    FOREIGN KEY (tenant_id, work_order_version_id) REFERENCES partner_work_order_versions(tenant_id, id),
  CONSTRAINT daily_jsas_tenant_org_fk
    FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT daily_jsas_tenant_provider_fk
    FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers(tenant_id, id),
  CONSTRAINT daily_jsas_tenant_crew_fk
    FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT daily_jsas_tenant_foreman_worker_fk
    FOREIGN KEY (tenant_id, foreman_worker_id) REFERENCES workers(tenant_id, id),
  CONSTRAINT daily_jsas_tenant_map_version_fk
    FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_jsas_tenant_id_uidx ON daily_jsas(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS daily_jsas_current_day_uidx
  ON daily_jsas(tenant_id, work_order_version_id, crew_id, work_date)
  WHERE deleted_at IS NULL AND status <> 'void';
CREATE INDEX IF NOT EXISTS daily_jsas_partner_idx ON daily_jsas(tenant_id, organization_id, work_date, status);

CREATE TABLE IF NOT EXISTS daily_jsa_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  daily_jsa_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  crew_role TEXT,
  participation_status TEXT NOT NULL DEFAULT 'present' CHECK (participation_status IN ('present', 'absent', 'not_applicable')),
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT daily_jsa_participants_tenant_jsa_fk
    FOREIGN KEY (tenant_id, daily_jsa_id) REFERENCES daily_jsas(tenant_id, id),
  CONSTRAINT daily_jsa_participants_tenant_worker_fk
    FOREIGN KEY (tenant_id, worker_id) REFERENCES workers(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_jsa_participants_tenant_id_uidx ON daily_jsa_participants(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS daily_jsa_participants_worker_uidx ON daily_jsa_participants(tenant_id, daily_jsa_id, worker_id);
