CREATE TABLE IF NOT EXISTS accounting_export_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  export_batch_number TEXT NOT NULL,
  export_type TEXT NOT NULL,
  target_system TEXT NOT NULL,
  export_format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  approval_status TEXT NOT NULL DEFAULT 'not_submitted',
  export_status TEXT NOT NULL DEFAULT 'not_generated',
  period_start DATE,
  period_end DATE,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_debit_amount NUMERIC(14,2),
  total_credit_amount NUMERIC(14,2),
  total_amount NUMERIC(14,2),
  currency TEXT,
  generated_file_reference TEXT,
  external_batch_reference TEXT,
  submitted_at TIMESTAMPTZ,
  submitted_by UUID,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  rejected_at TIMESTAMPTZ,
  rejected_by UUID,
  rejection_reason TEXT,
  rejection_note TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  failure_note TEXT,
  notes TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  cancelled_by UUID,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  cancel_note TEXT,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT accounting_export_batches_contract_check CHECK (
    export_type IN ('invoices', 'cash_receipts', 'payment_applications', 'contractor_payables', 'payroll', 'payment_execution', 'bank_reconciliation', 'mixed_later', 'correction', 'reversal')
    AND target_system IN ('quickbooks_later', 'sage_later', 'netsuite_later', 'generic_csv', 'generic_json', 'manual_export', 'other')
    AND export_format IN ('csv', 'json', 'manual_summary', 'api_payload_later', 'iif_later')
    AND status IN ('draft', 'assembling', 'ready_for_review', 'under_review', 'approved', 'generated', 'submitted_later', 'accepted_later', 'rejected_later', 'failed', 'cancelled', 'archived')
    AND approval_status IN ('not_submitted', 'pending', 'approved', 'rejected', 'withdrawn')
    AND export_status IN ('not_generated', 'generated', 'submitted_later', 'accepted_later', 'rejected_later', 'failed', 'cancelled')
    AND (period_start IS NULL OR period_end IS NULL OR period_start <= period_end)
  )
);

CREATE TABLE IF NOT EXISTS accounting_export_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  accounting_export_batch_id UUID NOT NULL,
  source_object_type TEXT NOT NULL,
  source_object_id UUID NOT NULL,
  invoice_id UUID,
  invoice_item_id UUID,
  cash_receipt_id UUID,
  payment_application_id UUID,
  contractor_payable_id UUID,
  contractor_payable_item_id UUID,
  payroll_run_id UUID,
  payroll_item_id UUID,
  payment_batch_id UUID,
  payment_item_id UUID,
  bank_transaction_id UUID,
  reconciliation_match_id UUID,
  export_item_type TEXT NOT NULL,
  export_status TEXT NOT NULL DEFAULT 'pending',
  mapping_status TEXT NOT NULL DEFAULT 'unmapped',
  target_account_code TEXT,
  target_account_name TEXT,
  target_entity_reference TEXT,
  target_item_reference TEXT,
  target_class_reference TEXT,
  target_location_reference TEXT,
  debit_amount NUMERIC(14,2),
  credit_amount NUMERIC(14,2),
  amount NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'USD',
  memo TEXT,
  transaction_date DATE,
  external_reference TEXT,
  error_message TEXT,
  override_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  archived_by UUID,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  archive_note TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT accounting_export_items_contract_check CHECK (
    source_object_type IN ('invoice', 'invoice_item', 'cash_receipt', 'payment_application', 'contractor_payable', 'contractor_payable_item', 'payroll_run', 'payroll_item', 'payment_batch', 'payment_item', 'bank_transaction', 'reconciliation_match')
    AND export_item_type IN ('revenue', 'receivable', 'cash_receipt', 'unapplied_cash', 'payable', 'payroll_expense', 'payment', 'bank_transaction', 'reconciliation', 'fee', 'adjustment', 'correction', 'reversal')
    AND export_status IN ('pending', 'generated', 'submitted_later', 'accepted_later', 'rejected_later', 'failed', 'cancelled', 'archived')
    AND mapping_status IN ('unmapped', 'mapped', 'mapping_warning', 'mapping_error', 'override_mapped')
    AND (debit_amount IS NULL OR debit_amount >= 0)
    AND (credit_amount IS NULL OR credit_amount >= 0)
    AND (amount IS NULL OR amount >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_number ON accounting_export_batches (tenant_id, export_batch_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_id ON accounting_export_batches (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_type ON accounting_export_batches (tenant_id, export_type);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_target ON accounting_export_batches (tenant_id, target_system);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_format ON accounting_export_batches (tenant_id, export_format);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_status ON accounting_export_batches (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_approval ON accounting_export_batches (tenant_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_export_status ON accounting_export_batches (tenant_id, export_status);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_period_start ON accounting_export_batches (tenant_id, period_start);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_period_end ON accounting_export_batches (tenant_id, period_end);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_submitted ON accounting_export_batches (tenant_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_accepted ON accounting_export_batches (tenant_id, accepted_at);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_archived ON accounting_export_batches (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_accounting_export_batches_tenant_created ON accounting_export_batches (tenant_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_id ON accounting_export_items (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_batch ON accounting_export_items (tenant_id, accounting_export_batch_id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_source ON accounting_export_items (tenant_id, source_object_type, source_object_id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_invoice ON accounting_export_items (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_cash_receipt ON accounting_export_items (tenant_id, cash_receipt_id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_contractor_payable ON accounting_export_items (tenant_id, contractor_payable_id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_payroll_run ON accounting_export_items (tenant_id, payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_payment_batch ON accounting_export_items (tenant_id, payment_batch_id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_bank_transaction ON accounting_export_items (tenant_id, bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_reconciliation_match ON accounting_export_items (tenant_id, reconciliation_match_id);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_type ON accounting_export_items (tenant_id, export_item_type);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_status ON accounting_export_items (tenant_id, export_status);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_mapping ON accounting_export_items (tenant_id, mapping_status);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_archived ON accounting_export_items (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_accounting_export_items_tenant_created ON accounting_export_items (tenant_id, created_at);

ALTER TABLE accounting_export_items DROP CONSTRAINT IF EXISTS fk_accounting_export_items_tenant_batch;
ALTER TABLE accounting_export_items ADD CONSTRAINT fk_accounting_export_items_tenant_batch
  FOREIGN KEY (tenant_id, accounting_export_batch_id) REFERENCES accounting_export_batches (tenant_id, id) NOT VALID;

ALTER TABLE accounting_export_items DROP CONSTRAINT IF EXISTS fk_accounting_export_items_tenant_invoice;
ALTER TABLE accounting_export_items ADD CONSTRAINT fk_accounting_export_items_tenant_invoice
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) NOT VALID;

ALTER TABLE accounting_export_items DROP CONSTRAINT IF EXISTS fk_accounting_export_items_tenant_cash_receipt;
ALTER TABLE accounting_export_items ADD CONSTRAINT fk_accounting_export_items_tenant_cash_receipt
  FOREIGN KEY (tenant_id, cash_receipt_id) REFERENCES cash_receipts (tenant_id, id) NOT VALID;

ALTER TABLE accounting_export_items DROP CONSTRAINT IF EXISTS fk_accounting_export_items_tenant_payment_application;
ALTER TABLE accounting_export_items ADD CONSTRAINT fk_accounting_export_items_tenant_payment_application
  FOREIGN KEY (tenant_id, payment_application_id) REFERENCES payment_applications (tenant_id, id) NOT VALID;

ALTER TABLE accounting_export_items DROP CONSTRAINT IF EXISTS fk_accounting_export_items_tenant_contractor_payable;
ALTER TABLE accounting_export_items ADD CONSTRAINT fk_accounting_export_items_tenant_contractor_payable
  FOREIGN KEY (tenant_id, contractor_payable_id) REFERENCES contractor_payables (tenant_id, id) NOT VALID;

ALTER TABLE accounting_export_items DROP CONSTRAINT IF EXISTS fk_accounting_export_items_tenant_payroll_run;
ALTER TABLE accounting_export_items ADD CONSTRAINT fk_accounting_export_items_tenant_payroll_run
  FOREIGN KEY (tenant_id, payroll_run_id) REFERENCES payroll_runs (tenant_id, id) NOT VALID;

ALTER TABLE accounting_export_items DROP CONSTRAINT IF EXISTS fk_accounting_export_items_tenant_payment_batch;
ALTER TABLE accounting_export_items ADD CONSTRAINT fk_accounting_export_items_tenant_payment_batch
  FOREIGN KEY (tenant_id, payment_batch_id) REFERENCES payment_batches (tenant_id, id) NOT VALID;

ALTER TABLE accounting_export_items DROP CONSTRAINT IF EXISTS fk_accounting_export_items_tenant_payment_item;
ALTER TABLE accounting_export_items ADD CONSTRAINT fk_accounting_export_items_tenant_payment_item
  FOREIGN KEY (tenant_id, payment_item_id) REFERENCES payment_items (tenant_id, id) NOT VALID;

ALTER TABLE accounting_export_items DROP CONSTRAINT IF EXISTS fk_accounting_export_items_tenant_bank_transaction;
ALTER TABLE accounting_export_items ADD CONSTRAINT fk_accounting_export_items_tenant_bank_transaction
  FOREIGN KEY (tenant_id, bank_transaction_id) REFERENCES bank_transactions (tenant_id, id) NOT VALID;

ALTER TABLE accounting_export_items DROP CONSTRAINT IF EXISTS fk_accounting_export_items_tenant_reconciliation_match;
ALTER TABLE accounting_export_items ADD CONSTRAINT fk_accounting_export_items_tenant_reconciliation_match
  FOREIGN KEY (tenant_id, reconciliation_match_id) REFERENCES reconciliation_matches (tenant_id, id) NOT VALID;
