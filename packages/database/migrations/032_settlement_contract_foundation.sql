ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS settlement_number TEXT,
  ADD COLUMN IF NOT EXISTS settlement_type TEXT NOT NULL DEFAULT 'customer_billable',
  ADD COLUMN IF NOT EXISTS readiness_status TEXT NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS readiness_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS readiness_band TEXT,
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS work_order_id UUID,
  ADD COLUMN IF NOT EXISTS settlement_period_start DATE,
  ADD COLUMN IF NOT EXISTS settlement_period_end DATE,
  ADD COLUMN IF NOT EXISTS invoice_cycle TEXT,
  ADD COLUMN IF NOT EXISTS pay_cycle TEXT,
  ADD COLUMN IF NOT EXISTS gross_billable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contractor_payable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_settlement_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_margin_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS estimated_margin_percent NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS invoice_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payable_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejection_note TEXT,
  ADD COLUMN IF NOT EXISTS hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS hold_note TEXT,
  ADD COLUMN IF NOT EXISTS dispute_note TEXT,
  ADD COLUMN IF NOT EXISTS override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS voided_by UUID,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS void_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by UUID,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

UPDATE settlements
SET settlement_period_start = COALESCE(settlement_period_start, billing_period_start),
    settlement_period_end = COALESCE(settlement_period_end, billing_period_end),
    gross_billable_amount = COALESCE(NULLIF(gross_billable_amount, 0), gross_amount, total_amount, 0),
    deduction_amount = COALESCE(NULLIF(deduction_amount, 0), adjustment_amount, 0),
    net_settlement_amount = COALESCE(NULLIF(net_settlement_amount, 0), net_amount, 0),
    settlement_number = COALESCE(settlement_number, 'SET-' || upper(substr(id::text, 1, 8))),
    archived_at = CASE WHEN status = 'archived' THEN COALESCE(archived_at, deleted_at, updated_at, created_at) ELSE archived_at END
WHERE settlement_number IS NULL
   OR settlement_period_start IS NULL
   OR settlement_period_end IS NULL
   OR gross_billable_amount = 0
   OR net_settlement_amount = 0
   OR archived_at IS NULL;

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_status_check;
ALTER TABLE settlements ADD CONSTRAINT settlements_status_check CHECK (
  status IN (
    'draft', 'assembling', 'ready_for_review', 'under_review', 'approved', 'rejected', 'held', 'disputed',
    'invoice_ready', 'payable_ready', 'invoice_created_later', 'payable_created_later', 'voided', 'archived',
    'internal_review', 'ready_to_submit', 'submitted', 'customer_review'
  )
);

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_contract_status_check;
ALTER TABLE settlements ADD CONSTRAINT settlements_contract_status_check CHECK (
  settlement_type IN ('customer_billable', 'contractor_payable', 'mixed', 'internal_adjustment', 'retainage_release', 'correction_adjustment', 'chargeback')
  AND readiness_status IN ('not_ready', 'needs_review', 'ready_with_warning', 'ready_for_approval', 'blocked')
  AND (readiness_band IS NULL OR readiness_band IN ('not_ready', 'needs_review', 'ready_with_warning', 'ready_for_approval'))
  AND gross_billable_amount >= 0
  AND contractor_payable_amount >= 0
  AND retainage_amount >= 0
  AND deduction_amount >= 0
  AND chargeback_amount >= 0
  AND net_settlement_amount >= 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_tenant_id ON settlements (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_tenant_number ON settlements (tenant_id, settlement_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_type ON settlements (tenant_id, settlement_type);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_status ON settlements (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_readiness ON settlements (tenant_id, readiness_status);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_customer ON settlements (tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_provider ON settlements (tenant_id, capacity_provider_id);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_project ON settlements (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_work_order ON settlements (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_invoice_ready ON settlements (tenant_id, invoice_ready);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_payable_ready ON settlements (tenant_id, payable_ready);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_archived ON settlements (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_created ON settlements (tenant_id, created_at);

ALTER TABLE settlement_items
  ADD COLUMN IF NOT EXISTS billable_item_id UUID,
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS work_order_id UUID,
  ADD COLUMN IF NOT EXISTS qc_review_id UUID,
  ADD COLUMN IF NOT EXISTS customer_organization_id UUID,
  ADD COLUMN IF NOT EXISTS capacity_provider_id UUID,
  ADD COLUMN IF NOT EXISTS crew_id UUID,
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'customer_billable',
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS retainage_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS retainage_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS deduction_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chargeback_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS contractor_rate NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS contractor_payable_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS margin_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS margin_percent NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS billing_package_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS documentation_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS customer_acceptance_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS prime_acceptance_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS invoice_item_id UUID,
  ADD COLUMN IF NOT EXISTS payable_item_id UUID,
  ADD COLUMN IF NOT EXISTS hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS hold_note TEXT,
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT,
  ADD COLUMN IF NOT EXISTS dispute_note TEXT,
  ADD COLUMN IF NOT EXISTS override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS voided_by UUID,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS void_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by UUID,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

UPDATE settlement_items
SET unit = COALESCE(unit, (
      SELECT COALESCE(pr.unit, pr.unit_type)
      FROM production_records pr
      WHERE pr.id = settlement_items.production_record_id
      LIMIT 1
    )),
    gross_amount = COALESCE(gross_amount, amount, 0),
    net_amount = COALESCE(net_amount, amount, gross_amount, 0),
    archived_at = CASE WHEN status = 'archived' THEN COALESCE(archived_at, deleted_at, updated_at, created_at) ELSE archived_at END
WHERE unit IS NULL OR net_amount IS NULL OR archived_at IS NULL;

ALTER TABLE settlement_items DROP CONSTRAINT IF EXISTS settlement_items_status_check;
ALTER TABLE settlement_items ADD CONSTRAINT settlement_items_status_check CHECK (
  status IN ('draft', 'ready', 'held', 'disputed', 'approved', 'invoice_ready', 'payable_ready', 'invoice_created_later', 'payable_created_later', 'voided', 'archived', 'active')
);

ALTER TABLE settlement_items DROP CONSTRAINT IF EXISTS settlement_items_contract_check;
ALTER TABLE settlement_items ADD CONSTRAINT settlement_items_contract_check CHECK (
  item_type IN ('customer_billable', 'contractor_payable', 'retainage_hold', 'retainage_release', 'deduction', 'chargeback', 'adjustment', 'correction')
  AND quantity >= 0
  AND (unit_rate IS NULL OR unit_rate >= 0)
  AND (gross_amount IS NULL OR gross_amount >= 0)
  AND amount >= 0
  AND (retainage_percent IS NULL OR (retainage_percent >= 0 AND retainage_percent <= 100))
  AND (retainage_amount IS NULL OR retainage_amount >= 0)
  AND deduction_amount >= 0
  AND chargeback_amount >= 0
  AND (net_amount IS NULL OR net_amount >= 0)
  AND (contractor_rate IS NULL OR contractor_rate >= 0)
  AND (contractor_payable_amount IS NULL OR contractor_payable_amount >= 0)
  AND billing_package_status IN ('not_started', 'incomplete', 'ready', 'submitted_later', 'accepted_later', 'rejected_later')
  AND documentation_status IN ('not_started', 'incomplete', 'ready', 'submitted_later', 'accepted_later', 'rejected_later')
  AND customer_acceptance_status IN ('not_required', 'pending', 'accepted', 'rejected', 'correction_required', 'disputed')
  AND prime_acceptance_status IN ('not_required', 'pending', 'accepted', 'rejected', 'correction_required', 'disputed')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_items_tenant_id ON settlement_items (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_tenant_settlement ON settlement_items (tenant_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_tenant_billable ON settlement_items (tenant_id, billable_item_id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_tenant_project ON settlement_items (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_tenant_work_order ON settlement_items (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_tenant_production ON settlement_items (tenant_id, production_record_id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_tenant_qc_review ON settlement_items (tenant_id, qc_review_id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_tenant_customer ON settlement_items (tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_tenant_provider ON settlement_items (tenant_id, capacity_provider_id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_tenant_status ON settlement_items (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_settlement_items_tenant_archived ON settlement_items (tenant_id, archived_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_items_active_billable
  ON settlement_items (tenant_id, billable_item_id)
  WHERE billable_item_id IS NOT NULL AND status NOT IN ('voided', 'archived') AND deleted_at IS NULL;

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS fk_settlements_tenant_customer;
ALTER TABLE settlements ADD CONSTRAINT fk_settlements_tenant_customer
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations (tenant_id, id) NOT VALID;

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS fk_settlements_tenant_provider;
ALTER TABLE settlements ADD CONSTRAINT fk_settlements_tenant_provider
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers (tenant_id, id) NOT VALID;

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS fk_settlements_tenant_project;
ALTER TABLE settlements ADD CONSTRAINT fk_settlements_tenant_project
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) NOT VALID;

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS fk_settlements_tenant_work_order;
ALTER TABLE settlements ADD CONSTRAINT fk_settlements_tenant_work_order
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id) NOT VALID;

ALTER TABLE settlement_items DROP CONSTRAINT IF EXISTS fk_settlement_items_tenant_settlement;
ALTER TABLE settlement_items ADD CONSTRAINT fk_settlement_items_tenant_settlement
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements (tenant_id, id) NOT VALID;

ALTER TABLE settlement_items DROP CONSTRAINT IF EXISTS fk_settlement_items_tenant_billable;
ALTER TABLE settlement_items ADD CONSTRAINT fk_settlement_items_tenant_billable
  FOREIGN KEY (tenant_id, billable_item_id) REFERENCES billable_items (tenant_id, id) NOT VALID;

ALTER TABLE settlement_items DROP CONSTRAINT IF EXISTS fk_settlement_items_tenant_project;
ALTER TABLE settlement_items ADD CONSTRAINT fk_settlement_items_tenant_project
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) NOT VALID;

ALTER TABLE settlement_items DROP CONSTRAINT IF EXISTS fk_settlement_items_tenant_work_order;
ALTER TABLE settlement_items ADD CONSTRAINT fk_settlement_items_tenant_work_order
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id) NOT VALID;

ALTER TABLE settlement_items DROP CONSTRAINT IF EXISTS fk_settlement_items_tenant_production;
ALTER TABLE settlement_items ADD CONSTRAINT fk_settlement_items_tenant_production
  FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records (tenant_id, id) NOT VALID;

ALTER TABLE settlement_items DROP CONSTRAINT IF EXISTS fk_settlement_items_tenant_qc_review;
ALTER TABLE settlement_items ADD CONSTRAINT fk_settlement_items_tenant_qc_review
  FOREIGN KEY (tenant_id, qc_review_id) REFERENCES qc_reviews (tenant_id, id) NOT VALID;
