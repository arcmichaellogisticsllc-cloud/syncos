CREATE TABLE IF NOT EXISTS billable_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  production_record_id UUID NOT NULL,
  qc_review_id UUID NOT NULL,
  customer_organization_id UUID NOT NULL,
  capacity_provider_id UUID,
  crew_id UUID,
  status TEXT NOT NULL DEFAULT 'candidate',
  readiness_status TEXT NOT NULL DEFAULT 'not_ready',
  readiness_score NUMERIC(5,2),
  readiness_band TEXT,
  approved_quantity NUMERIC(14,2) NOT NULL,
  billable_quantity NUMERIC(14,2) NOT NULL,
  held_quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  rejected_quantity NUMERIC(14,2),
  correction_quantity NUMERIC(14,2),
  unit TEXT NOT NULL,
  rate_code_id UUID,
  rate_description TEXT,
  unit_rate NUMERIC(14,2),
  rate_source TEXT NOT NULL DEFAULT 'unknown',
  rate_confidence TEXT NOT NULL DEFAULT 'unknown',
  estimated_billable_amount NUMERIC(14,2),
  retainage_required BOOLEAN NOT NULL DEFAULT false,
  retainage_percent NUMERIC(5,2),
  retainage_amount NUMERIC(14,2),
  retainage_release_condition TEXT,
  net_billable_amount NUMERIC(14,2),
  customer_acceptance_status TEXT NOT NULL DEFAULT 'not_required',
  prime_acceptance_status TEXT NOT NULL DEFAULT 'not_required',
  billing_package_status TEXT NOT NULL DEFAULT 'not_started',
  documentation_status TEXT NOT NULL DEFAULT 'not_started',
  settlement_item_id UUID,
  invoice_item_id UUID,
  hold_reason TEXT,
  hold_note TEXT,
  dispute_reason TEXT,
  dispute_note TEXT,
  void_reason TEXT,
  void_note TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  voided_by UUID,
  voided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT billable_items_status_check CHECK (status IN ('candidate', 'needs_rate', 'needs_documentation', 'needs_customer_acceptance', 'held', 'ready_for_settlement', 'settlement_created', 'disputed', 'voided', 'archived')),
  CONSTRAINT billable_items_readiness_status_check CHECK (readiness_status IN ('not_ready', 'needs_review', 'ready_with_warning', 'ready_for_settlement', 'blocked')),
  CONSTRAINT billable_items_readiness_band_check CHECK (readiness_band IS NULL OR readiness_band IN ('not_ready', 'needs_review', 'ready_with_warning', 'ready_for_settlement')),
  CONSTRAINT billable_items_unit_check CHECK (unit IN ('feet', 'miles', 'drops', 'addresses', 'passings', 'splice_cases', 'nodes', 'poles', 'permits', 'inspections', 'restoration_items', 'days', 'crews', 'workers', 'equipment_units', 'each')),
  CONSTRAINT billable_items_rate_source_check CHECK (rate_source IN ('contract_rate', 'project_rate', 'customer_rate', 'manual_rate', 'unknown')),
  CONSTRAINT billable_items_rate_confidence_check CHECK (rate_confidence IN ('unknown', 'low', 'medium', 'high', 'confirmed')),
  CONSTRAINT billable_items_customer_acceptance_check CHECK (customer_acceptance_status IN ('not_required', 'pending', 'accepted', 'rejected', 'correction_required', 'disputed')),
  CONSTRAINT billable_items_prime_acceptance_check CHECK (prime_acceptance_status IN ('not_required', 'pending', 'accepted', 'rejected', 'correction_required', 'disputed')),
  CONSTRAINT billable_items_billing_package_check CHECK (billing_package_status IN ('not_started', 'incomplete', 'ready', 'submitted_later', 'accepted_later', 'rejected_later')),
  CONSTRAINT billable_items_documentation_check CHECK (documentation_status IN ('not_started', 'incomplete', 'ready', 'submitted_later', 'accepted_later', 'rejected_later')),
  CONSTRAINT billable_items_quantities_check CHECK (
    approved_quantity >= 0
    AND billable_quantity > 0
    AND held_quantity >= 0
    AND (rejected_quantity IS NULL OR rejected_quantity >= 0)
    AND (correction_quantity IS NULL OR correction_quantity >= 0)
    AND (unit_rate IS NULL OR unit_rate >= 0)
    AND (estimated_billable_amount IS NULL OR estimated_billable_amount >= 0)
    AND (retainage_percent IS NULL OR (retainage_percent >= 0 AND retainage_percent <= 100))
    AND (retainage_amount IS NULL OR retainage_amount >= 0)
    AND (net_billable_amount IS NULL OR net_billable_amount >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billable_items_tenant_id ON billable_items (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_billable_items_tenant_project ON billable_items (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_billable_items_tenant_work_order ON billable_items (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_billable_items_tenant_production ON billable_items (tenant_id, production_record_id);
CREATE INDEX IF NOT EXISTS idx_billable_items_tenant_qc_review ON billable_items (tenant_id, qc_review_id);
CREATE INDEX IF NOT EXISTS idx_billable_items_tenant_status ON billable_items (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_billable_items_tenant_readiness ON billable_items (tenant_id, readiness_status);
CREATE INDEX IF NOT EXISTS idx_billable_items_tenant_customer ON billable_items (tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS idx_billable_items_tenant_provider ON billable_items (tenant_id, capacity_provider_id);
CREATE INDEX IF NOT EXISTS idx_billable_items_tenant_archived ON billable_items (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_billable_items_tenant_created ON billable_items (tenant_id, created_at);

ALTER TABLE billable_items DROP CONSTRAINT IF EXISTS fk_billable_items_tenant_project;
ALTER TABLE billable_items ADD CONSTRAINT fk_billable_items_tenant_project
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) NOT VALID;

ALTER TABLE billable_items DROP CONSTRAINT IF EXISTS fk_billable_items_tenant_work_order;
ALTER TABLE billable_items ADD CONSTRAINT fk_billable_items_tenant_work_order
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id) NOT VALID;

ALTER TABLE billable_items DROP CONSTRAINT IF EXISTS fk_billable_items_tenant_production;
ALTER TABLE billable_items ADD CONSTRAINT fk_billable_items_tenant_production
  FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records (tenant_id, id) NOT VALID;

ALTER TABLE billable_items DROP CONSTRAINT IF EXISTS fk_billable_items_tenant_qc_review;
ALTER TABLE billable_items ADD CONSTRAINT fk_billable_items_tenant_qc_review
  FOREIGN KEY (tenant_id, qc_review_id) REFERENCES qc_reviews (tenant_id, id) NOT VALID;

ALTER TABLE billable_items DROP CONSTRAINT IF EXISTS fk_billable_items_tenant_customer;
ALTER TABLE billable_items ADD CONSTRAINT fk_billable_items_tenant_customer
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations (tenant_id, id) NOT VALID;

ALTER TABLE billable_items DROP CONSTRAINT IF EXISTS fk_billable_items_tenant_provider;
ALTER TABLE billable_items ADD CONSTRAINT fk_billable_items_tenant_provider
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers (tenant_id, id) NOT VALID;

ALTER TABLE billable_items DROP CONSTRAINT IF EXISTS fk_billable_items_tenant_crew;
ALTER TABLE billable_items ADD CONSTRAINT fk_billable_items_tenant_crew
  FOREIGN KEY (tenant_id, crew_id) REFERENCES crews (tenant_id, id) NOT VALID;

ALTER TABLE billable_items DROP CONSTRAINT IF EXISTS fk_billable_items_tenant_rate_code;
ALTER TABLE billable_items ADD CONSTRAINT fk_billable_items_tenant_rate_code
  FOREIGN KEY (tenant_id, rate_code_id) REFERENCES rate_codes (tenant_id, id) NOT VALID;

ALTER TABLE billable_items DROP CONSTRAINT IF EXISTS fk_billable_items_tenant_settlement_item;
ALTER TABLE billable_items ADD CONSTRAINT fk_billable_items_tenant_settlement_item
  FOREIGN KEY (tenant_id, settlement_item_id) REFERENCES settlement_items (tenant_id, id) NOT VALID;
