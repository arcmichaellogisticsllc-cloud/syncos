CREATE TABLE IF NOT EXISTS payment_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  payment_batch_number TEXT NOT NULL,
  batch_type TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  approval_status TEXT NOT NULL DEFAULT 'not_submitted',
  execution_status TEXT NOT NULL DEFAULT 'not_submitted',
  scheduled_payment_date DATE,
  submitted_at TIMESTAMPTZ,
  submitted_by UUID,
  executed_at TIMESTAMPTZ,
  execution_reference TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_payment_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  rejection_note TEXT,
  failure_reason TEXT,
  failure_note TEXT,
  cancelled_by UUID,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  cancel_note TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  voided_by UUID,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  void_note TEXT,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT payment_batches_contract_check CHECK (
    batch_type IN ('contractor_payable', 'payroll', 'mixed_later', 'correction', 'reversal')
    AND payment_method IN ('ach', 'check', 'card_payout', 'wire', 'payroll_provider', 'manual', 'other')
    AND status IN ('draft', 'assembling', 'ready_for_review', 'under_review', 'approved', 'scheduled', 'submitted', 'partially_executed_later', 'executed_later', 'failed', 'cancelled', 'voided', 'archived')
    AND approval_status IN ('not_submitted', 'pending', 'approved', 'rejected', 'withdrawn')
    AND execution_status IN ('not_submitted', 'ready_for_execution', 'submitted_later', 'executed_later', 'partially_executed_later', 'failed', 'cancelled')
    AND item_count >= 0
    AND total_payment_amount >= 0
  )
);

CREATE TABLE IF NOT EXISTS payment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  payment_batch_id UUID NOT NULL,
  source_type TEXT NOT NULL,
  contractor_payable_id UUID,
  contractor_payable_item_id UUID,
  payroll_run_id UUID,
  payroll_item_id UUID,
  payee_type TEXT NOT NULL,
  capacity_provider_id UUID,
  crew_id UUID,
  worker_id UUID,
  vendor_organization_id UUID,
  payee_name TEXT,
  payment_method TEXT NOT NULL,
  payment_amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_date DATE,
  execution_status TEXT NOT NULL DEFAULT 'not_submitted',
  execution_reference TEXT,
  failure_reason TEXT,
  failure_note TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  voided_by UUID,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  void_note TEXT,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT payment_items_contract_check CHECK (
    source_type IN ('contractor_payable', 'payroll', 'correction', 'reversal')
    AND payee_type IN ('capacity_provider', 'crew', 'worker', 'vendor_later', 'internal_self_perform')
    AND payment_method IN ('ach', 'check', 'card_payout', 'wire', 'payroll_provider', 'manual', 'other')
    AND status IN ('draft', 'ready', 'approved', 'scheduled', 'submitted_later', 'executed_later', 'failed', 'cancelled', 'voided', 'archived')
    AND execution_status IN ('not_submitted', 'ready_for_execution', 'submitted_later', 'executed_later', 'failed', 'cancelled')
    AND payment_amount > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_batches_tenant_id ON payment_batches (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_batches_tenant_number ON payment_batches (tenant_id, payment_batch_number);
CREATE INDEX IF NOT EXISTS idx_payment_batches_tenant_type ON payment_batches (tenant_id, batch_type);
CREATE INDEX IF NOT EXISTS idx_payment_batches_tenant_method ON payment_batches (tenant_id, payment_method);
CREATE INDEX IF NOT EXISTS idx_payment_batches_tenant_status ON payment_batches (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_batches_tenant_approval ON payment_batches (tenant_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_payment_batches_tenant_execution ON payment_batches (tenant_id, execution_status);
CREATE INDEX IF NOT EXISTS idx_payment_batches_tenant_scheduled ON payment_batches (tenant_id, scheduled_payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_batches_tenant_submitted ON payment_batches (tenant_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_payment_batches_tenant_executed ON payment_batches (tenant_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_payment_batches_tenant_archived ON payment_batches (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_payment_batches_tenant_created ON payment_batches (tenant_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_items_tenant_id ON payment_items (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_batch ON payment_items (tenant_id, payment_batch_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_source ON payment_items (tenant_id, source_type);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_contractor_payable ON payment_items (tenant_id, contractor_payable_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_contractor_payable_item ON payment_items (tenant_id, contractor_payable_item_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_payroll_run ON payment_items (tenant_id, payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_payroll_item ON payment_items (tenant_id, payroll_item_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_payee_type ON payment_items (tenant_id, payee_type);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_capacity_provider ON payment_items (tenant_id, capacity_provider_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_crew ON payment_items (tenant_id, crew_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_worker ON payment_items (tenant_id, worker_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_vendor ON payment_items (tenant_id, vendor_organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_status ON payment_items (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_execution ON payment_items (tenant_id, execution_status);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_archived ON payment_items (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_payment_items_tenant_created ON payment_items (tenant_id, created_at);

ALTER TABLE payment_items DROP CONSTRAINT IF EXISTS fk_payment_items_tenant_batch;
ALTER TABLE payment_items ADD CONSTRAINT fk_payment_items_tenant_batch
  FOREIGN KEY (tenant_id, payment_batch_id) REFERENCES payment_batches (tenant_id, id) NOT VALID;

ALTER TABLE payment_items DROP CONSTRAINT IF EXISTS fk_payment_items_tenant_contractor_payable;
ALTER TABLE payment_items ADD CONSTRAINT fk_payment_items_tenant_contractor_payable
  FOREIGN KEY (tenant_id, contractor_payable_id) REFERENCES contractor_payables (tenant_id, id) NOT VALID;

ALTER TABLE payment_items DROP CONSTRAINT IF EXISTS fk_payment_items_tenant_contractor_payable_item;
ALTER TABLE payment_items ADD CONSTRAINT fk_payment_items_tenant_contractor_payable_item
  FOREIGN KEY (tenant_id, contractor_payable_item_id) REFERENCES contractor_payable_items (tenant_id, id) NOT VALID;

ALTER TABLE payment_items DROP CONSTRAINT IF EXISTS fk_payment_items_tenant_payroll_run;
ALTER TABLE payment_items ADD CONSTRAINT fk_payment_items_tenant_payroll_run
  FOREIGN KEY (tenant_id, payroll_run_id) REFERENCES payroll_runs (tenant_id, id) NOT VALID;

ALTER TABLE payment_items DROP CONSTRAINT IF EXISTS fk_payment_items_tenant_payroll_item;
ALTER TABLE payment_items ADD CONSTRAINT fk_payment_items_tenant_payroll_item
  FOREIGN KEY (tenant_id, payroll_item_id) REFERENCES payroll_items (tenant_id, id) NOT VALID;

ALTER TABLE payment_items DROP CONSTRAINT IF EXISTS fk_payment_items_tenant_capacity_provider;
ALTER TABLE payment_items ADD CONSTRAINT fk_payment_items_tenant_capacity_provider
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers (tenant_id, id) NOT VALID;

ALTER TABLE payment_items DROP CONSTRAINT IF EXISTS fk_payment_items_tenant_crew;
ALTER TABLE payment_items ADD CONSTRAINT fk_payment_items_tenant_crew
  FOREIGN KEY (tenant_id, crew_id) REFERENCES crews (tenant_id, id) NOT VALID;

ALTER TABLE payment_items DROP CONSTRAINT IF EXISTS fk_payment_items_tenant_worker;
ALTER TABLE payment_items ADD CONSTRAINT fk_payment_items_tenant_worker
  FOREIGN KEY (tenant_id, worker_id) REFERENCES workers (tenant_id, id) NOT VALID;

ALTER TABLE payment_items DROP CONSTRAINT IF EXISTS fk_payment_items_tenant_vendor;
ALTER TABLE payment_items ADD CONSTRAINT fk_payment_items_tenant_vendor
  FOREIGN KEY (tenant_id, vendor_organization_id) REFERENCES organizations (tenant_id, id) NOT VALID;
