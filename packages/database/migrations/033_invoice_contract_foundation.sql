ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_organization_id UUID,
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'not_submitted',
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS cash_application_status TEXT NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS payment_terms TEXT NOT NULL DEFAULT 'net_30',
  ADD COLUMN IF NOT EXISTS billing_period_start DATE,
  ADD COLUMN IF NOT EXISTS billing_period_end DATE,
  ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retainage_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS aging_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS collection_status TEXT NOT NULL DEFAULT 'not_due',
  ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payment_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS writeoff_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS writeoff_reason TEXT,
  ADD COLUMN IF NOT EXISTS invoice_package_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS documentation_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS customer_acceptance_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS prime_acceptance_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejection_note TEXT,
  ADD COLUMN IF NOT EXISTS sent_by UUID,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disputed_by UUID,
  ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ,
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

UPDATE invoices
SET customer_organization_id = COALESCE(customer_organization_id, organization_id),
    subtotal_amount = COALESCE(NULLIF(subtotal_amount, 0), invoice_amount, total_amount, 0),
    total_amount = COALESCE(NULLIF(total_amount, 0), invoice_amount, subtotal_amount, 0),
    original_amount = COALESCE(NULLIF(original_amount, 0), invoice_amount, total_amount, 0),
    balance_amount = COALESCE(NULLIF(balance_amount, 0), invoice_amount, total_amount, 0),
    archived_at = CASE WHEN status = 'archived' THEN COALESCE(archived_at, deleted_at, updated_at, created_at) ELSE archived_at END
WHERE customer_organization_id IS NULL
   OR subtotal_amount = 0
   OR total_amount = 0
   OR original_amount = 0
   OR balance_amount = 0
   OR archived_at IS NULL;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (
  status IN (
    'draft', 'assembling', 'ready_for_review', 'under_review', 'approved', 'sent',
    'partially_paid_later', 'paid_later', 'overdue_later', 'disputed', 'voided', 'archived',
    'submitted', 'overdue'
  )
);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_contract_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_contract_check CHECK (
  invoice_type IN ('standard', 'progress', 'final', 'retainage_release', 'credit_memo', 'rebill', 'adjustment', 'pro_forma')
  AND approval_status IN ('not_submitted', 'pending', 'approved', 'rejected', 'withdrawn')
  AND delivery_status IN ('not_sent', 'queued', 'sent', 'failed', 'acknowledged', 'rejected')
  AND cash_application_status IN ('not_ready', 'ready_for_cash_application', 'partially_applied_later', 'fully_applied_later', 'overpaid_later', 'written_off_later')
  AND payment_status IN ('unpaid', 'partially_paid', 'paid', 'overpaid', 'written_off')
  AND collection_status IN ('not_due', 'due', 'overdue', 'in_collection', 'disputed', 'resolved', 'written_off')
  AND payment_terms IN ('due_on_receipt', 'net_7', 'net_15', 'net_30', 'net_45', 'net_60', 'custom')
  AND invoice_package_status IN ('not_started', 'incomplete', 'ready', 'attached', 'submitted', 'accepted', 'rejected')
  AND documentation_status IN ('not_started', 'incomplete', 'ready', 'attached', 'submitted', 'accepted', 'rejected')
  AND customer_acceptance_status IN ('not_required', 'pending', 'accepted', 'rejected', 'correction_required', 'disputed')
  AND prime_acceptance_status IN ('not_required', 'pending', 'accepted', 'rejected', 'correction_required', 'disputed')
  AND subtotal_amount >= 0
  AND retainage_amount >= 0
  AND adjustment_amount >= 0
  AND COALESCE(tax_amount, 0) >= 0
  AND COALESCE(fee_amount, 0) >= 0
  AND paid_amount >= 0
  AND balance_amount >= 0
  AND aging_days >= 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_tenant_number ON invoices (tenant_id, invoice_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_customer ON invoices (tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_settlement ON invoices (tenant_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_project ON invoices (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status ON invoices (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_approval ON invoices (tenant_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_delivery ON invoices (tenant_id, delivery_status);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_cash_application ON invoices (tenant_id, cash_application_status);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_payment_status ON invoices (tenant_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_collection_status ON invoices (tenant_id, collection_status);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_invoice_date ON invoices (tenant_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_due_date ON invoices (tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_archived ON invoices (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created ON invoices (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_id UUID NOT NULL,
  settlement_id UUID,
  settlement_item_id UUID,
  billable_item_id UUID,
  qc_review_id UUID,
  production_record_id UUID,
  work_order_id UUID,
  project_id UUID,
  customer_organization_id UUID NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'customer_billable',
  status TEXT NOT NULL DEFAULT 'draft',
  description TEXT,
  quantity NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit TEXT,
  unit_rate NUMERIC(14,4) NOT NULL DEFAULT 0,
  gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  retainage_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deduction_amount NUMERIC(14,2),
  adjustment_amount NUMERIC(14,2),
  tax_amount NUMERIC(14,2),
  fee_amount NUMERIC(14,2),
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
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
  CONSTRAINT invoice_items_contract_check CHECK (
    item_type IN ('customer_billable', 'retainage_hold', 'retainage_release', 'deduction', 'chargeback', 'credit', 'adjustment', 'fee', 'tax', 'correction')
    AND status IN ('draft', 'ready', 'invoiced', 'disputed', 'voided', 'archived')
    AND quantity >= 0
    AND unit_rate >= 0
    AND gross_amount >= 0
    AND retainage_amount >= 0
    AND COALESCE(deduction_amount, 0) >= 0
    AND COALESCE(tax_amount, 0) >= 0
    AND COALESCE(fee_amount, 0) >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_items_tenant_id ON invoice_items (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_invoice ON invoice_items (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_settlement ON invoice_items (tenant_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_settlement_item ON invoice_items (tenant_id, settlement_item_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_billable ON invoice_items (tenant_id, billable_item_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_project ON invoice_items (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_customer ON invoice_items (tenant_id, customer_organization_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_status ON invoice_items (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_archived ON invoice_items (tenant_id, archived_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_items_active_settlement_item
  ON invoice_items (tenant_id, settlement_item_id)
  WHERE settlement_item_id IS NOT NULL AND status NOT IN ('voided', 'archived') AND deleted_at IS NULL;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS fk_invoices_tenant_customer;
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_tenant_customer
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations (tenant_id, id) NOT VALID;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS fk_invoices_tenant_project;
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_tenant_project
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id) NOT VALID;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS fk_invoices_tenant_settlement;
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_tenant_settlement
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements (tenant_id, id) NOT VALID;

ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS fk_invoice_items_tenant_invoice;
ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_tenant_invoice
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) NOT VALID;

ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS fk_invoice_items_tenant_settlement;
ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_tenant_settlement
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements (tenant_id, id) NOT VALID;

ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS fk_invoice_items_tenant_settlement_item;
ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_tenant_settlement_item
  FOREIGN KEY (tenant_id, settlement_item_id) REFERENCES settlement_items (tenant_id, id) NOT VALID;

ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS fk_invoice_items_tenant_customer;
ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_tenant_customer
  FOREIGN KEY (tenant_id, customer_organization_id) REFERENCES organizations (tenant_id, id) NOT VALID;

ALTER TABLE settlement_items DROP CONSTRAINT IF EXISTS fk_settlement_items_tenant_invoice_item;
ALTER TABLE settlement_items ADD CONSTRAINT fk_settlement_items_tenant_invoice_item
  FOREIGN KEY (tenant_id, invoice_item_id) REFERENCES invoice_items (tenant_id, id) NOT VALID;
