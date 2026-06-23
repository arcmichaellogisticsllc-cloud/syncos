CREATE TABLE IF NOT EXISTS contractor_payables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  payable_number TEXT NOT NULL,
  payable_type TEXT NOT NULL,
  payable_party_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  approval_status TEXT NOT NULL DEFAULT 'not_submitted',
  payment_readiness_status TEXT NOT NULL DEFAULT 'not_ready',
  payment_status TEXT NOT NULL DEFAULT 'not_paid',
  capacity_provider_id UUID,
  crew_id UUID,
  worker_id UUID,
  vendor_organization_id UUID,
  project_id UUID,
  settlement_id UUID,
  pay_cycle_start DATE,
  pay_cycle_end DATE,
  due_date DATE,
  gross_payable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deduction_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  chargeback_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  retainage_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_payable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  compliance_status TEXT NOT NULL DEFAULT 'unknown',
  tax_document_status TEXT NOT NULL DEFAULT 'unknown',
  dispute_status TEXT NOT NULL DEFAULT 'none',
  hold_status TEXT NOT NULL DEFAULT 'none',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  rejection_note TEXT,
  hold_reason TEXT,
  hold_note TEXT,
  dispute_reason TEXT,
  dispute_note TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
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
  CONSTRAINT contractor_payables_contract_check CHECK (
    payable_type IN ('subcontractor', 'crew', 'worker_later', 'vendor_later', 'internal_self_perform', 'adjustment', 'retainage_release', 'chargeback')
    AND payable_party_type IN ('capacity_provider', 'crew', 'worker_later', 'vendor_later', 'internal_self_perform')
    AND status IN ('draft', 'assembling', 'ready_for_review', 'under_review', 'approved', 'rejected', 'held', 'disputed', 'payment_ready', 'payment_created_later', 'partially_paid_later', 'paid_later', 'voided', 'archived')
    AND approval_status IN ('not_submitted', 'pending', 'approved', 'rejected', 'withdrawn')
    AND payment_readiness_status IN ('not_ready', 'ready_with_warning', 'ready_for_payment', 'blocked')
    AND payment_status IN ('not_paid', 'partially_paid_later', 'paid_later', 'held', 'disputed')
    AND compliance_status IN ('unknown', 'missing', 'incomplete', 'ready', 'expired', 'blocked')
    AND tax_document_status IN ('unknown', 'missing_w9', 'ready', 'expired', 'blocked')
    AND dispute_status IN ('none', 'open', 'under_review', 'resolved', 'rejected')
    AND hold_status IN ('none', 'hold', 'released')
    AND gross_payable_amount >= 0
    AND deduction_amount >= 0
    AND chargeback_amount >= 0
    AND retainage_amount >= 0
  )
);

CREATE TABLE IF NOT EXISTS contractor_payable_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contractor_payable_id UUID NOT NULL,
  settlement_id UUID NOT NULL,
  settlement_item_id UUID NOT NULL,
  billable_item_id UUID,
  qc_review_id UUID,
  production_record_id UUID,
  work_order_id UUID,
  project_id UUID,
  capacity_provider_id UUID,
  crew_id UUID,
  worker_id UUID,
  item_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  description TEXT,
  quantity NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'unit',
  contractor_rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_payable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deduction_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  chargeback_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  retainage_percent NUMERIC(7,4),
  retainage_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_payable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  compliance_status TEXT NOT NULL DEFAULT 'unknown',
  tax_document_status TEXT NOT NULL DEFAULT 'unknown',
  dispute_status TEXT NOT NULL DEFAULT 'none',
  hold_status TEXT NOT NULL DEFAULT 'none',
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_item_id UUID,
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
  CONSTRAINT contractor_payable_items_contract_check CHECK (
    item_type IN ('labor', 'subcontractor_production', 'equipment', 'material_reimbursement', 'retainage_hold', 'retainage_release', 'deduction', 'chargeback', 'adjustment', 'correction', 'bonus', 'penalty')
    AND status IN ('draft', 'ready', 'approved', 'held', 'disputed', 'payment_ready', 'payment_created_later', 'voided', 'archived')
    AND compliance_status IN ('unknown', 'missing', 'incomplete', 'ready', 'expired', 'blocked')
    AND tax_document_status IN ('unknown', 'missing_w9', 'ready', 'expired', 'blocked')
    AND dispute_status IN ('none', 'open', 'under_review', 'resolved', 'rejected')
    AND hold_status IN ('none', 'hold', 'released')
    AND quantity >= 0
    AND contractor_rate >= 0
    AND gross_payable_amount >= 0
    AND deduction_amount >= 0
    AND chargeback_amount >= 0
    AND (retainage_percent IS NULL OR retainage_percent >= 0)
    AND retainage_amount >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contractor_payables_tenant_id ON contractor_payables (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workers_tenant_id ON workers (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contractor_payables_tenant_number ON contractor_payables (tenant_id, payable_number);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_type ON contractor_payables (tenant_id, payable_type);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_party_type ON contractor_payables (tenant_id, payable_party_type);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_status ON contractor_payables (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_approval ON contractor_payables (tenant_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_readiness ON contractor_payables (tenant_id, payment_readiness_status);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_payment_status ON contractor_payables (tenant_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_provider ON contractor_payables (tenant_id, capacity_provider_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_crew ON contractor_payables (tenant_id, crew_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_worker ON contractor_payables (tenant_id, worker_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_vendor ON contractor_payables (tenant_id, vendor_organization_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_project ON contractor_payables (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_settlement ON contractor_payables (tenant_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_pay_cycle_start ON contractor_payables (tenant_id, pay_cycle_start);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_pay_cycle_end ON contractor_payables (tenant_id, pay_cycle_end);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_due_date ON contractor_payables (tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_compliance ON contractor_payables (tenant_id, compliance_status);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_tax ON contractor_payables (tenant_id, tax_document_status);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_dispute ON contractor_payables (tenant_id, dispute_status);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_hold ON contractor_payables (tenant_id, hold_status);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_archived ON contractor_payables (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_contractor_payables_tenant_created ON contractor_payables (tenant_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_id ON contractor_payable_items (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_payable ON contractor_payable_items (tenant_id, contractor_payable_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_settlement ON contractor_payable_items (tenant_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_settlement_item ON contractor_payable_items (tenant_id, settlement_item_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_billable ON contractor_payable_items (tenant_id, billable_item_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_qc ON contractor_payable_items (tenant_id, qc_review_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_production ON contractor_payable_items (tenant_id, production_record_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_work_order ON contractor_payable_items (tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_project ON contractor_payable_items (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_provider ON contractor_payable_items (tenant_id, capacity_provider_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_crew ON contractor_payable_items (tenant_id, crew_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_worker ON contractor_payable_items (tenant_id, worker_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_status ON contractor_payable_items (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contractor_payable_items_tenant_archived ON contractor_payable_items (tenant_id, archived_at);

ALTER TABLE contractor_payables DROP CONSTRAINT IF EXISTS fk_contractor_payables_tenant_provider;
ALTER TABLE contractor_payables ADD CONSTRAINT fk_contractor_payables_tenant_provider
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payables DROP CONSTRAINT IF EXISTS fk_contractor_payables_tenant_crew;
ALTER TABLE contractor_payables ADD CONSTRAINT fk_contractor_payables_tenant_crew
  FOREIGN KEY (tenant_id, crew_id) REFERENCES crews (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payables DROP CONSTRAINT IF EXISTS fk_contractor_payables_tenant_worker;
ALTER TABLE contractor_payables ADD CONSTRAINT fk_contractor_payables_tenant_worker
  FOREIGN KEY (tenant_id, worker_id) REFERENCES workers (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payables DROP CONSTRAINT IF EXISTS fk_contractor_payables_tenant_vendor;
ALTER TABLE contractor_payables ADD CONSTRAINT fk_contractor_payables_tenant_vendor
  FOREIGN KEY (tenant_id, vendor_organization_id) REFERENCES organizations (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payables DROP CONSTRAINT IF EXISTS fk_contractor_payables_tenant_project;
ALTER TABLE contractor_payables ADD CONSTRAINT fk_contractor_payables_tenant_project
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payables DROP CONSTRAINT IF EXISTS fk_contractor_payables_tenant_settlement;
ALTER TABLE contractor_payables ADD CONSTRAINT fk_contractor_payables_tenant_settlement
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_payable;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_payable
  FOREIGN KEY (tenant_id, contractor_payable_id) REFERENCES contractor_payables (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_settlement;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_settlement
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_settlement_item;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_settlement_item
  FOREIGN KEY (tenant_id, settlement_item_id) REFERENCES settlement_items (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_billable;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_billable
  FOREIGN KEY (tenant_id, billable_item_id) REFERENCES billable_items (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_qc;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_qc
  FOREIGN KEY (tenant_id, qc_review_id) REFERENCES qc_reviews (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_production;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_production
  FOREIGN KEY (tenant_id, production_record_id) REFERENCES production_records (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_work_order;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_work_order
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_project;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_project
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_provider;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_provider
  FOREIGN KEY (tenant_id, capacity_provider_id) REFERENCES capacity_providers (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_crew;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_crew
  FOREIGN KEY (tenant_id, crew_id) REFERENCES crews (tenant_id, id) NOT VALID;

ALTER TABLE contractor_payable_items DROP CONSTRAINT IF EXISTS fk_contractor_payable_items_tenant_worker;
ALTER TABLE contractor_payable_items ADD CONSTRAINT fk_contractor_payable_items_tenant_worker
  FOREIGN KEY (tenant_id, worker_id) REFERENCES workers (tenant_id, id) NOT VALID;
