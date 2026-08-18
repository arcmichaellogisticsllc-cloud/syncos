ALTER TABLE partner_restricted_file_objects DROP CONSTRAINT IF EXISTS partner_restricted_file_objects_category_check;
ALTER TABLE partner_restricted_file_objects ADD CONSTRAINT partner_restricted_file_objects_category_check CHECK (category IN (
  'worker_headshot',
  'worker_credential_evidence',
  'partner_msa_executed',
  'partner_msa_amendment_executed',
  'partner_work_order_executed',
  'partner_vehicle_agreement_executed',
  'syncfield_map_original_pdf',
  'syncfield_production_export'
));

ALTER TABLE partner_restricted_file_objects DROP CONSTRAINT IF EXISTS partner_restricted_file_objects_related_entity_type_check;
ALTER TABLE partner_restricted_file_objects ADD CONSTRAINT partner_restricted_file_objects_related_entity_type_check CHECK (related_entity_type IN (
  'worker',
  'worker_headshot',
  'worker_credential',
  'partner_agreement_version',
  'partner_work_order_version',
  'partner_vehicle_assignment',
  'syncfield_map_version',
  'production_export_artifact'
));

CREATE TABLE IF NOT EXISTS production_export_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID,
  work_order_id UUID,
  daily_report_id UUID,
  daily_report_revision_id UUID,
  map_version_id UUID,
  partner_organization_id UUID,
  crew_id UUID,
  artifact_type TEXT NOT NULL,
  generation_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  restricted_file_object_id UUID,
  mime_type TEXT NOT NULL,
  file_hash TEXT,
  generated_by_user_id UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ,
  source_fingerprint TEXT NOT NULL,
  superseded_by_artifact_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  CONSTRAINT production_export_artifacts_type_check CHECK (artifact_type IN ('annotated_map_pdf', 'daily_production_pdf', 'production_csv', 'production_closeout_package')),
  CONSTRAINT production_export_artifacts_mode_check CHECK (generation_mode IN ('submitted_day', 'customer_qc_status', 'final_accepted_closeout', 'dashboard_export')),
  CONSTRAINT production_export_artifacts_status_check CHECK (status IN ('queued', 'processing', 'ready', 'failed', 'outdated', 'superseded', 'archived')),
  CONSTRAINT production_export_artifacts_project_fk FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CONSTRAINT production_export_artifacts_work_order_fk FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id),
  CONSTRAINT production_export_artifacts_report_fk FOREIGN KEY (tenant_id, daily_report_id) REFERENCES daily_production_reports(tenant_id, id),
  CONSTRAINT production_export_artifacts_revision_fk FOREIGN KEY (tenant_id, daily_report_revision_id) REFERENCES daily_production_report_revisions(tenant_id, id),
  CONSTRAINT production_export_artifacts_map_version_fk FOREIGN KEY (tenant_id, map_version_id) REFERENCES syncfield_map_versions(tenant_id, id),
  CONSTRAINT production_export_artifacts_partner_fk FOREIGN KEY (tenant_id, partner_organization_id) REFERENCES organizations(tenant_id, id),
  CONSTRAINT production_export_artifacts_crew_fk FOREIGN KEY (tenant_id, crew_id) REFERENCES crews(tenant_id, id),
  CONSTRAINT production_export_artifacts_file_fk FOREIGN KEY (tenant_id, restricted_file_object_id) REFERENCES partner_restricted_file_objects(tenant_id, id),
  CONSTRAINT production_export_artifacts_superseded_fk FOREIGN KEY (tenant_id, superseded_by_artifact_id) REFERENCES production_export_artifacts(tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS production_export_artifacts_tenant_id_uidx ON production_export_artifacts(tenant_id, id);
CREATE INDEX IF NOT EXISTS production_export_artifacts_context_idx
  ON production_export_artifacts(tenant_id, project_id, work_order_id, daily_report_id, artifact_type, status);
CREATE INDEX IF NOT EXISTS production_export_artifacts_partner_idx
  ON production_export_artifacts(tenant_id, partner_organization_id, crew_id, artifact_type, status);
CREATE UNIQUE INDEX IF NOT EXISTS production_export_artifacts_fingerprint_uidx
  ON production_export_artifacts(tenant_id, artifact_type, generation_mode, source_fingerprint)
  WHERE deleted_at IS NULL AND status = 'ready';
