CREATE TABLE IF NOT EXISTS qc_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  production_record_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  project_id UUID NOT NULL,
  review_type TEXT NOT NULL DEFAULT 'internal_qc',
  review_status TEXT NOT NULL DEFAULT 'pending',
  reviewer_user_id UUID,
  reviewed_at TIMESTAMPTZ,
  claimed_quantity NUMERIC(14,2),
  approved_quantity NUMERIC(14,2),
  rejected_quantity NUMERIC(14,2),
  correction_required_quantity NUMERIC(14,2),
  billable_candidate_quantity NUMERIC(14,2),
  unit TEXT,
  evidence_status TEXT NOT NULL DEFAULT 'pending',
  location_status TEXT NOT NULL DEFAULT 'pending',
  documentation_status TEXT NOT NULL DEFAULT 'pending',
  production_status TEXT NOT NULL DEFAULT 'pending',
  customer_acceptance_status TEXT NOT NULL DEFAULT 'not_required',
  prime_acceptance_status TEXT NOT NULL DEFAULT 'not_required',
  review_notes TEXT,
  rejection_reason TEXT,
  rejection_note TEXT,
  correction_reason TEXT,
  correction_note TEXT,
  correction_due_date DATE,
  correction_owner_user_id UUID,
  source_qc_review_id UUID,
  hard_stop BOOLEAN NOT NULL DEFAULT false,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT qc_reviews_review_type_check CHECK (review_type IN ('internal_qc', 'safety_qc', 'compliance_qc', 'customer_qc', 'prime_qc', 'billing_qc', 'final_acceptance')),
  CONSTRAINT qc_reviews_review_status_check CHECK (review_status IN ('pending', 'in_review', 'approved', 'rejected', 'correction_required', 'corrected', 'voided', 'archived')),
  CONSTRAINT qc_reviews_unit_check CHECK (unit IS NULL OR unit IN ('feet', 'miles', 'drops', 'addresses', 'passings', 'splice_cases', 'nodes', 'poles', 'permits', 'inspections', 'restoration_items', 'days', 'crews', 'workers', 'equipment_units', 'each')),
  CONSTRAINT qc_reviews_evidence_status_check CHECK (evidence_status IN ('pending', 'sufficient', 'insufficient', 'not_required')),
  CONSTRAINT qc_reviews_location_status_check CHECK (location_status IN ('pending', 'valid', 'invalid', 'not_required')),
  CONSTRAINT qc_reviews_documentation_status_check CHECK (documentation_status IN ('pending', 'sufficient', 'insufficient', 'not_required')),
  CONSTRAINT qc_reviews_production_status_check CHECK (production_status IN ('pending', 'valid', 'invalid', 'not_required')),
  CONSTRAINT qc_reviews_customer_acceptance_status_check CHECK (customer_acceptance_status IN ('not_required', 'pending', 'accepted', 'rejected', 'correction_required')),
  CONSTRAINT qc_reviews_prime_acceptance_status_check CHECK (prime_acceptance_status IN ('not_required', 'pending', 'accepted', 'rejected', 'correction_required')),
  CONSTRAINT qc_reviews_quantities_non_negative_check CHECK (
    (claimed_quantity IS NULL OR claimed_quantity >= 0)
    AND (approved_quantity IS NULL OR approved_quantity >= 0)
    AND (rejected_quantity IS NULL OR rejected_quantity >= 0)
    AND (correction_required_quantity IS NULL OR correction_required_quantity >= 0)
    AND (billable_candidate_quantity IS NULL OR billable_candidate_quantity >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_reviews_tenant_id ON qc_reviews (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_qc_reviews_tenant_production ON qc_reviews (tenant_id, production_record_id);
CREATE INDEX IF NOT EXISTS idx_qc_reviews_tenant_work_order ON qc_reviews (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_qc_reviews_tenant_project ON qc_reviews (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_qc_reviews_tenant_status ON qc_reviews (tenant_id, review_status);
CREATE INDEX IF NOT EXISTS idx_qc_reviews_tenant_type ON qc_reviews (tenant_id, review_type);
CREATE INDEX IF NOT EXISTS idx_qc_reviews_tenant_reviewer ON qc_reviews (tenant_id, reviewer_user_id);
CREATE INDEX IF NOT EXISTS idx_qc_reviews_tenant_archived ON qc_reviews (tenant_id, archived_at);

ALTER TABLE qc_reviews DROP CONSTRAINT IF EXISTS fk_qc_reviews_tenant_production;
ALTER TABLE qc_reviews ADD CONSTRAINT fk_qc_reviews_tenant_production
  FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records (tenant_id, id) NOT VALID;

ALTER TABLE qc_reviews DROP CONSTRAINT IF EXISTS fk_qc_reviews_tenant_work_order;
ALTER TABLE qc_reviews ADD CONSTRAINT fk_qc_reviews_tenant_work_order
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id) NOT VALID;

ALTER TABLE qc_reviews DROP CONSTRAINT IF EXISTS fk_qc_reviews_tenant_project;
ALTER TABLE qc_reviews ADD CONSTRAINT fk_qc_reviews_tenant_project
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) NOT VALID;

ALTER TABLE qc_reviews DROP CONSTRAINT IF EXISTS fk_qc_reviews_tenant_source_qc_review;
ALTER TABLE qc_reviews ADD CONSTRAINT fk_qc_reviews_tenant_source_qc_review
  FOREIGN KEY (tenant_id, source_qc_review_id) REFERENCES qc_reviews (tenant_id, id) NOT VALID;

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS source_qc_review_id UUID;
ALTER TABLE production_records DROP CONSTRAINT IF EXISTS fk_production_records_tenant_source_qc_review;
ALTER TABLE production_records ADD CONSTRAINT fk_production_records_tenant_source_qc_review
  FOREIGN KEY (tenant_id, source_qc_review_id) REFERENCES qc_reviews (tenant_id, id) NOT VALID;
