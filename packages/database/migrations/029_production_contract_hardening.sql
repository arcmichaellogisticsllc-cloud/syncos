ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_status_check;
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS production_records_billable_status_check;

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS production_type TEXT NOT NULL DEFAULT 'daily_production';
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS qc_status TEXT NOT NULL DEFAULT 'not_started';

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS assigned_organization_id UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS submitted_by UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS worker_count INTEGER;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS equipment_used JSONB;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS subcontractor_reference TEXT;

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS claimed_quantity NUMERIC(14,2);
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS corrected_quantity NUMERIC(14,2);
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS billable_quantity NUMERIC(14,2);

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS location_summary TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS route_name TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS node_id TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS segment_id TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS address_range TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7);
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7);

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS production_notes TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS delay_reason TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS no_work_reason TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS safety_observation_note TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS material_issue_note TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS access_issue_note TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS weather_delay_note TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS customer_issue_note TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS rejection_note TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS correction_note TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS void_note TEXT;

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS parent_production_record_id UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS correction_due_date DATE;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS correction_owner_user_id UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS is_latest_revision BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS archived_by UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS archive_note TEXT;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS updated_by UUID;

UPDATE production_records
SET
  claimed_quantity = COALESCE(claimed_quantity, quantity_submitted, quantity),
  unit = COALESCE(unit, unit_type),
  submitted_by = COALESCE(submitted_by, submitted_by_user_id),
  submitted_at = COALESCE(submitted_at, CASE WHEN status IN ('submitted', 'qc_review', 'accepted', 'approved', 'billable', 'rejected') THEN updated_at ELSE NULL END),
  reviewed_at = COALESCE(reviewed_at, CASE WHEN status IN ('qc_review', 'accepted', 'approved', 'billable', 'rejected') THEN updated_at ELSE NULL END),
  qc_status = COALESCE(
    qc_status,
    CASE
      WHEN status = 'correction_required' THEN 'corrections_required'
      WHEN status IN ('qc_review', 'under_review') THEN 'pending_review'
      WHEN status IN ('accepted', 'approved', 'billable') THEN 'approved'
      WHEN status = 'rejected' THEN 'rejected'
      ELSE 'not_started'
    END
  ),
  billable_status = CASE WHEN billable_status = 'billable' THEN 'billable' ELSE COALESCE(billable_status, 'not_billable') END,
  archived_at = COALESCE(archived_at, deleted_at)
WHERE true;

ALTER TABLE production_records ADD CONSTRAINT production_records_status_check CHECK (status IN (
  'draft',
  'submitted',
  'under_review',
  'correction_required',
  'corrected',
  'accepted',
  'qc_review',
  'approved',
  'billable',
  'rejected',
  'voided',
  'archived'
));
ALTER TABLE production_records ADD CONSTRAINT production_records_qc_status_check CHECK (qc_status IN ('not_started', 'pending_review', 'corrections_required', 'approved', 'rejected'));
ALTER TABLE production_records ADD CONSTRAINT production_records_billable_status_check CHECK (billable_status IS NULL OR billable_status IN ('not_billable', 'billable_candidate', 'pending_approval', 'billable', 'billed_later', 'blocked'));
ALTER TABLE production_records ADD CONSTRAINT production_records_production_type_check CHECK (production_type IN (
  'daily_production',
  'progress_update',
  'completion_submission',
  'correction_submission',
  'inspection_submission',
  'restoration_submission',
  'delay_report',
  'no_work_report',
  'safety_observation',
  'material_issue',
  'access_issue',
  'weather_delay',
  'customer_issue',
  'other'
));
ALTER TABLE production_records ADD CONSTRAINT production_records_hardened_quantities_non_negative_check CHECK (
  (claimed_quantity IS NULL OR claimed_quantity >= 0)
  AND (approved_quantity IS NULL OR approved_quantity >= 0)
  AND (rejected_quantity IS NULL OR rejected_quantity >= 0)
  AND (corrected_quantity IS NULL OR corrected_quantity >= 0)
  AND (billable_quantity IS NULL OR billable_quantity >= 0)
);
ALTER TABLE production_records ADD CONSTRAINT production_records_revision_positive_check CHECK (revision_number >= 1);

ALTER TABLE production_evidence DROP CONSTRAINT IF EXISTS production_evidence_evidence_type_check;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS storage_reference TEXT;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS filename TEXT;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS uploaded_by UUID;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS geo_latitude NUMERIC(10,7);
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS geo_longitude NUMERIC(10,7);
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS archived_by UUID;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE production_evidence ADD COLUMN IF NOT EXISTS archive_note TEXT;

UPDATE production_evidence
SET
  file_url = COALESCE(file_url, source_url),
  uploaded_at = COALESCE(uploaded_at, created_at),
  caption = COALESCE(caption, summary),
  archived_at = COALESCE(archived_at, deleted_at)
WHERE true;

ALTER TABLE production_evidence ADD CONSTRAINT production_evidence_evidence_type_check CHECK (evidence_type IN (
  'photo',
  'video',
  'gps',
  'daily_report',
  'safety_form',
  'inspection_note',
  'material_ticket',
  'document',
  'form',
  'test_result',
  'gps_point',
  'map_markup',
  'customer_signature',
  'inspector_signature',
  'permit_document',
  'restoration_photo',
  'before_photo',
  'after_photo',
  'other'
));

CREATE INDEX IF NOT EXISTS idx_production_records_tenant_project ON production_records (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_production_records_tenant_work_order ON production_records (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_production_records_tenant_status ON production_records (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_production_records_tenant_qc_status ON production_records (tenant_id, qc_status);
CREATE INDEX IF NOT EXISTS idx_production_records_tenant_billable_status ON production_records (tenant_id, billable_status);
CREATE INDEX IF NOT EXISTS idx_production_records_tenant_production_type ON production_records (tenant_id, production_type);
CREATE INDEX IF NOT EXISTS idx_production_records_tenant_production_date ON production_records (tenant_id, production_date);
CREATE INDEX IF NOT EXISTS idx_production_records_tenant_crew ON production_records (tenant_id, crew_id);
CREATE INDEX IF NOT EXISTS idx_production_records_tenant_capacity_provider ON production_records (tenant_id, capacity_provider_id);
CREATE INDEX IF NOT EXISTS idx_production_records_tenant_submitted_by ON production_records (tenant_id, submitted_by);
CREATE INDEX IF NOT EXISTS idx_production_records_tenant_archived ON production_records (tenant_id, archived_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_records_tenant_id ON production_records (tenant_id, id);
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS fk_production_records_parent_tenant;
ALTER TABLE production_records ADD CONSTRAINT fk_production_records_parent_tenant
  FOREIGN KEY (tenant_id, parent_production_record_id) REFERENCES production_records (tenant_id, id) NOT VALID;
